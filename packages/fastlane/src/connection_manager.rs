//! QUIC connection management for TPU endpoints.
//!
//! Maintains a pool of QUIC connections to validator TPU endpoints
//! with support for connection reuse and 0-RTT reconnection.
//!
//! Features multi-endpoint architecture to avoid Quinn's mutex contention
//! under high load, distributing connections across multiple QUIC endpoints.

use anyhow::{anyhow, Context, Result};
use dashmap::DashMap;
use log::{debug, info, warn};
use quinn::{
    crypto::rustls::QuicClientConfig, ClientConfig, Connection as QuinnConnection, Endpoint,
    IdleTimeout, TransportConfig,
};
use std::net::SocketAddr;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use crate::errors::{classify_error, is_retryable_error, TpuErrorCode};
use crate::tracker::{LeaderInfo, LeaderTracker};

/// ALPN protocol identifier for Solana TPU.
const ALPN_TPU_PROTOCOL_ID: &[u8] = b"solana-tpu";

/// Maximum idle timeout for QUIC connections.
/// Yellowstone-jet uses 30s - longer timeout keeps connections warm longer.
const QUIC_MAX_TIMEOUT: Duration = Duration::from_secs(30);

/// Keep-alive interval for QUIC connections.
const QUIC_KEEP_ALIVE: Duration = Duration::from_secs(4);

/// Number of QUIC endpoints to distribute connections across.
/// Multiple endpoints avoid Quinn's internal mutex contention under high load.
/// Each endpoint has its own event loop for better parallelism.
const NUM_ENDPOINTS: usize = 5;

/// Maximum retry attempts per leader (yellowstone-jet uses 3).
const MAX_SEND_ATTEMPTS: usize = 3;

/// Delay between retries in milliseconds.
const RETRY_DELAY_MS: u64 = 50;

/// Timeout for sending to a single leader (connect + all retries).
/// Keeps this short - slow leaders won't help landing anyway.
/// 1 second is enough for connect + send on a healthy validator.
const LEADER_SEND_TIMEOUT: Duration = Duration::from_secs(1);

/// Generates proper QUIC server name (SNI) from socket address.
/// 
/// This format is required for validators to properly route QUIC connections.
/// Using incorrect SNI can cause validators to reject or misroute connections.
/// 
/// Format follows yellowstone-jet: `{ip}.{port}.sol`
fn socket_addr_to_quic_server_name(addr: &SocketAddr) -> String {
    format!("{}.{}.sol", addr.ip(), addr.port())
}

/// Result of sending to a single leader.
#[derive(Debug, Clone)]
pub struct LeaderDeliveryResult {
    /// Validator identity pubkey.
    pub identity: String,
    /// TPU socket address.
    pub address: String,
    /// Whether send succeeded.
    pub success: bool,
    /// Latency for this leader in milliseconds.
    pub latency_ms: u64,
    /// Error message if failed.
    pub error: Option<String>,
    /// Error code for programmatic handling.
    pub error_code: Option<TpuErrorCode>,
    /// Number of attempts made for this leader.
    pub attempts: usize,
}

/// Result of a transaction delivery attempt.
#[derive(Debug, Clone)]
pub struct DeliveryResult {
    /// Whether the transaction was delivered to at least one leader.
    pub delivered: bool,
    /// Total latency in milliseconds.
    pub latency_ms: u64,
    /// Number of leaders the transaction was successfully sent to.
    pub leader_count: usize,
    /// Per-leader breakdown of send results.
    pub leaders: Vec<LeaderDeliveryResult>,
    /// Total retry attempts made across all leaders.
    pub total_retries: usize,
}

/// Wrapper for a cached QUIC connection.
#[derive(Default)]
struct CachedConnection {
    conn: Option<QuinnConnection>,
}

/// Manages QUIC connections to Solana TPU endpoints.
///
/// Features:
/// - Multi-endpoint architecture to avoid Quinn mutex contention
/// - Connection pooling with automatic reconnection
/// - 0-RTT support for faster reconnection
/// - Pre-warming connections to upcoming leaders
pub struct TpuConnectionManager {
    /// Multiple QUIC endpoints to distribute load across.
    /// Each endpoint has its own event loop for better parallelism.
    endpoints: Vec<Endpoint>,
    /// Cached connections by address.
    connections: Arc<DashMap<String, CachedConnection>>,
    /// Leader tracker for routing.
    leader_tracker: Arc<LeaderTracker>,
    /// Round-robin counter for endpoint selection.
    next_endpoint: AtomicUsize,
}

impl TpuConnectionManager {
    /// Creates a new TPU connection manager with multiple QUIC endpoints.
    ///
    /// # Arguments
    ///
    /// * `leader_tracker` - Leader tracker for determining where to send transactions
    ///
    /// # Errors
    ///
    /// Returns an error if any QUIC endpoint cannot be initialized.
    pub fn new(leader_tracker: Arc<LeaderTracker>) -> Result<Self> {
        info!(
            "Creating TPU connection manager with {} endpoints",
            NUM_ENDPOINTS
        );

        // Generate client certificate for QUIC authentication
        let client_certificate = solana_tls_utils::QuicClientCertificate::new(None);

        let mut crypto = solana_tls_utils::tls_client_config_builder()
            .with_client_auth_cert(
                vec![client_certificate.certificate.clone()],
                client_certificate.key.clone_key(),
            )
            .expect("Failed to set QUIC client certificates");

        // Enable 0-RTT for faster reconnection
        crypto.enable_early_data = true;
        crypto.alpn_protocols = vec![ALPN_TPU_PROTOCOL_ID.to_vec()];

        // Configure transport settings
        let transport_config = {
            let mut config = TransportConfig::default();
            let timeout = IdleTimeout::try_from(QUIC_MAX_TIMEOUT).unwrap();
            config.max_idle_timeout(Some(timeout));
            config.keep_alive_interval(Some(QUIC_KEEP_ALIVE));
            config.send_fairness(false);
            config
        };

        let client_config =
            ClientConfig::new(Arc::new(QuicClientConfig::try_from(crypto).unwrap()));
        let client_config = {
            let mut cfg = client_config;
            cfg.transport_config(Arc::new(transport_config));
            cfg
        };

        // Create multiple QUIC endpoints to distribute load
        let mut endpoints = Vec::with_capacity(NUM_ENDPOINTS);
        for i in 0..NUM_ENDPOINTS {
            let mut endpoint = Endpoint::client("0.0.0.0:0".parse()?)
                .context(format!("Failed to create QUIC endpoint {}", i))?;
            endpoint.set_default_client_config(client_config.clone());
            endpoints.push(endpoint);
            debug!("Created QUIC endpoint {}", i);
        }

        info!(
            "TPU connection manager created with {} endpoints",
            endpoints.len()
        );

        Ok(Self {
            endpoints,
            connections: Arc::new(DashMap::new()),
            leader_tracker,
            next_endpoint: AtomicUsize::new(0),
        })
    }

    /// Selects the next endpoint using round-robin distribution.
    fn select_endpoint(&self) -> &Endpoint {
        let idx = self.next_endpoint.fetch_add(1, Ordering::Relaxed) % self.endpoints.len();
        &self.endpoints[idx]
    }

    /// Sends a transaction to the current leaders with per-leader tracking.
    ///
    /// Uses default fanout of 4 leaders.
    pub async fn send_transaction(&self, tx_data: &[u8]) -> Result<DeliveryResult> {
        self.send_transaction_with_fanout(tx_data, 4).await
    }

    /// Sends a transaction to leaders with configurable fanout.
    ///
    /// The transaction is sent to multiple leaders in parallel based on
    /// the leader tracker's recommendations. Returns as soon as at least
    /// one leader succeeds (early return) to minimize latency while still
    /// collecting results from all leaders for reporting.
    ///
    /// # Arguments
    ///
    /// * `tx_data` - Serialized transaction bytes
    /// * `fanout` - Number of leaders to target
    ///
    /// # Returns
    ///
    /// Delivery result with per-leader breakdown and retry statistics.
    pub async fn send_transaction_with_fanout(&self, tx_data: &[u8], fanout: u32) -> Result<DeliveryResult> {
        debug!(
            "Sending transaction ({} bytes) to {} leaders IN PARALLEL, preview: {:02x?}",
            tx_data.len(),
            fanout,
            &tx_data[..tx_data.len().min(32)]
        );

        let start = Instant::now();
        let leaders = self.leader_tracker.get_leaders_with_fanout(fanout).await;

        if leaders.is_empty() {
            return Err(anyhow!("No leaders available"));
        }

        info!("Sending to {} leaders in parallel (early return on first success)", leaders.len());

        // Create channel to receive results as they complete
        let (tx, mut rx) = tokio::sync::mpsc::channel::<LeaderDeliveryResult>(leaders.len());

        // Spawn all send tasks
        for leader in &leaders {
            let tx_data = tx_data.to_vec();
            let tpu_socket = leader.tpu_socket.clone();
            let identity = leader.identity.clone();
            let manager = self.clone();
            let result_tx = tx.clone();

            tokio::spawn(async move {
                let result = manager
                    .send_to_leader_with_retry(&tx_data, &tpu_socket, &identity)
                    .await;
                // Ignore send errors - channel may be closed if we already returned
                let _ = result_tx.send(result).await;
            });
        }

        // Drop our sender so the channel closes when all spawned tasks complete
        drop(tx);

        // Collect ALL results - wait for all sends to complete (or timeout)
        // This ensures we send to ALL leaders for maximum landing probability
        let mut leader_results = Vec::with_capacity(leaders.len());
        let mut success_count = 0;
        let mut total_retries = 0;
        let mut first_success_latency: Option<u64> = None;

        // Wait for results with a short timeout - if leaders haven't responded by 800ms,
        // they probably won't help with landing (blockhash might get stale)
        let collect_timeout = Duration::from_millis(800);
        let collect_start = std::time::Instant::now();

        while let Ok(Some(result)) = tokio::time::timeout(
            collect_timeout.saturating_sub(collect_start.elapsed()),
            rx.recv()
        ).await {
            if result.attempts > 1 {
                total_retries += result.attempts - 1;
            }

            if result.success {
                eprintln!(
                    "[TPU] ✅ Sent to {} at {} ({}ms, {} attempts)",
                    &result.identity[..8],
                    result.address,
                    result.latency_ms,
                    result.attempts
                );
                success_count += 1;
                if first_success_latency.is_none() {
                    first_success_latency = Some(start.elapsed().as_millis() as u64);
                }
            } else {
                eprintln!(
                    "[TPU] ❌ Failed {} at {}: {} ({}ms, {} attempts)",
                    &result.identity[..8],
                    result.address,
                    result.error.as_deref().unwrap_or("unknown"),
                    result.latency_ms,
                    result.attempts
                );
            }

            leader_results.push(result);

            // Check if we've received all results
            if leader_results.len() >= leaders.len() {
                break;
            }
        }

        // Log final summary
        eprintln!(
            "[TPU] 📊 Send complete: {}/{} leaders succeeded in {}ms",
            success_count,
            leaders.len(),
            start.elapsed().as_millis()
        );

        // All leaders completed without success
        let delivered = success_count > 0;

        info!(
            "Parallel send complete: {}/{} leaders succeeded in {}ms",
            success_count,
            leaders.len(),
            start.elapsed().as_millis()
        );

        if !delivered {
            return Err(anyhow!(
                "Failed to send transaction to any leader ({} attempted, {} total retries)",
                leaders.len(),
                total_retries
            ));
        }

        Ok(DeliveryResult {
            delivered,
            latency_ms: start.elapsed().as_millis() as u64,
            leader_count: success_count,
            leaders: leader_results,
            total_retries,
        })
    }

    /// Sends a transaction to specific leaders (slot-aware selection).
    /// 
    /// This method accepts an explicit list of leaders instead of using
    /// fanout-based discovery. Used by slot-aware sending strategy which
    /// determines the optimal leaders based on current slot position.
    ///
    /// # Arguments
    ///
    /// * `tx_data` - Serialized transaction bytes
    /// * `leaders` - Explicit list of leaders to send to
    ///
    /// # Returns
    ///
    /// Delivery result with per-leader breakdown.
    pub async fn send_to_leaders(&self, tx_data: &[u8], leaders: &[LeaderInfo]) -> Result<DeliveryResult> {
        if leaders.is_empty() {
            return Err(anyhow!("No leaders provided"));
        }

        let start = Instant::now();

        // Create channel to receive results as they complete
        let (tx, mut rx) = tokio::sync::mpsc::channel::<LeaderDeliveryResult>(leaders.len());

        // Spawn all send tasks
        for leader in leaders {
            let tx_data = tx_data.to_vec();
            let tpu_socket = leader.tpu_socket.clone();
            let identity = leader.identity.clone();
            let manager = self.clone();
            let result_tx = tx.clone();

            tokio::spawn(async move {
                let result = manager
                    .send_to_leader_with_retry(&tx_data, &tpu_socket, &identity)
                    .await;
                let _ = result_tx.send(result).await;
            });
        }

        drop(tx);

        // Collect results with timeout
        let mut leader_results = Vec::with_capacity(leaders.len());
        let mut success_count = 0;
        let mut total_retries = 0;

        let collect_timeout = Duration::from_millis(800);
        let collect_start = std::time::Instant::now();

        while let Ok(Some(result)) = tokio::time::timeout(
            collect_timeout.saturating_sub(collect_start.elapsed()),
            rx.recv()
        ).await {
            if result.attempts > 1 {
                total_retries += result.attempts - 1;
            }

            if result.success {
                eprintln!(
                    "[TPU] ✅ Sent to {} at {} ({}ms)",
                    &result.identity[..8.min(result.identity.len())],
                    result.address,
                    result.latency_ms
                );
                success_count += 1;
            } else {
                eprintln!(
                    "[TPU] ❌ Failed {} at {}: {}",
                    &result.identity[..8.min(result.identity.len())],
                    result.address,
                    result.error.as_deref().unwrap_or("unknown")
                );
            }

            leader_results.push(result);

            if leader_results.len() >= leaders.len() {
                break;
            }
        }

        let delivered = success_count > 0;

        if !delivered {
            return Err(anyhow!(
                "Failed to send transaction to any leader ({} attempted)",
                leaders.len()
            ));
        }

        Ok(DeliveryResult {
            delivered,
            latency_ms: start.elapsed().as_millis() as u64,
            leader_count: success_count,
            leaders: leader_results,
            total_retries,
        })
    }

    /// Sends transaction data to a specific leader with retry logic and timeout.
    ///
    /// Wraps the inner retry logic in a timeout to prevent slow leaders
    /// from blocking the entire send operation.
    async fn send_to_leader_with_retry(
        &self,
        tx_data: &[u8],
        tpu_address: &str,
        identity: &str,
    ) -> LeaderDeliveryResult {
        match tokio::time::timeout(
            LEADER_SEND_TIMEOUT,
            self.send_to_leader_with_retry_inner(tx_data, tpu_address, identity),
        )
        .await
        {
            Ok(result) => result,
            Err(_) => {
                // Timeout elapsed - leader is too slow or unreachable
                warn!(
                    "⏱️ Timeout sending to {} at {} after {:?}",
                    identity, tpu_address, LEADER_SEND_TIMEOUT
                );
                LeaderDeliveryResult {
                    identity: identity.to_string(),
                    address: tpu_address.to_string(),
                    success: false,
                    latency_ms: LEADER_SEND_TIMEOUT.as_millis() as u64,
                    error: Some(format!("Timeout after {:?}", LEADER_SEND_TIMEOUT)),
                    error_code: Some(TpuErrorCode::Timeout),
                    attempts: MAX_SEND_ATTEMPTS,
                }
            }
        }
    }

    /// Inner retry logic for sending to a leader.
    ///
    /// Retries on retryable errors (connection, stream, timeout) with
    /// a small delay between attempts.
    async fn send_to_leader_with_retry_inner(
        &self,
        tx_data: &[u8],
        tpu_address: &str,
        identity: &str,
    ) -> LeaderDeliveryResult {
        let start = Instant::now();
        let mut last_error: Option<String> = None;
        let mut error_code: Option<TpuErrorCode> = None;

        for attempt in 0..MAX_SEND_ATTEMPTS {
            match self.send_to_leader_once(tx_data, tpu_address).await {
                Ok(_) => {
                    return LeaderDeliveryResult {
                        identity: identity.to_string(),
                        address: tpu_address.to_string(),
                        success: true,
                        latency_ms: start.elapsed().as_millis() as u64,
                        error: None,
                        error_code: None,
                        attempts: attempt + 1,
                    };
                }
                Err(e) => {
                    let code = classify_error(&e);
                    last_error = Some(e.to_string());
                    error_code = Some(code);

                    // Only retry on retryable errors and if we have attempts left
                    if attempt < MAX_SEND_ATTEMPTS - 1 && is_retryable_error(&e) {
                        debug!(
                            "Retrying send to {} (attempt {}/{}): {}",
                            tpu_address,
                            attempt + 1,
                            MAX_SEND_ATTEMPTS,
                            e
                        );
                        tokio::time::sleep(Duration::from_millis(RETRY_DELAY_MS)).await;
                    }
                }
            }
        }

        LeaderDeliveryResult {
            identity: identity.to_string(),
            address: tpu_address.to_string(),
            success: false,
            latency_ms: start.elapsed().as_millis() as u64,
            error: last_error,
            error_code,
            attempts: MAX_SEND_ATTEMPTS,
        }
    }

    /// Sends transaction data to a specific leader (single attempt).
    async fn send_to_leader_once(&self, tx_data: &[u8], tpu_address: &str) -> Result<()> {
        let conn = self.get_or_create_connection(tpu_address).await?;

        // Open unidirectional stream for transaction
        let mut send_stream = conn
            .open_uni()
            .await
            .context("Failed to open unidirectional stream")?;

        // Write transaction data
        send_stream
            .write_all(tx_data)
            .await
            .context("Failed to write transaction data")?;

        // Finish the stream (no response expected)
        send_stream.finish().context("Failed to finish stream")?;

        Ok(())
    }

    /// Gets an existing connection or creates a new one.
    ///
    /// Uses round-robin endpoint selection for new connections to
    /// distribute load across all available QUIC endpoints.
    async fn get_or_create_connection(&self, address: &str) -> Result<QuinnConnection> {
        // Check for existing active connection
        if let Some(cached) = self.connections.get(address) {
            if let Some(ref conn) = cached.conn {
                if conn.close_reason().is_none() {
                    debug!("Reusing connection to {}", address);
                    return Ok(conn.clone());
                }
            }
        }

        // Mark as connecting (prevents duplicate connection attempts)
        self.connections
            .insert(address.to_string(), CachedConnection::default());

        debug!("Creating new connection to {}", address);
        let addr: SocketAddr = address.parse().context("Invalid validator address")?;

        // Select endpoint using round-robin for load distribution
        let endpoint = self.select_endpoint();

        // Generate proper SNI - validators require correct format for routing
        let server_name = socket_addr_to_quic_server_name(&addr);

        // Try 0-RTT connection first for lower latency
        let connection = match endpoint.connect(addr, &server_name)?.into_0rtt() {
            Ok((conn, rtt_accepted)) => {
                debug!("Attempting 0-RTT connection to: {}", addr);
                if rtt_accepted.await {
                    debug!("0-RTT accepted");
                }
                conn
            }
            Err(connecting) => {
                debug!("0-RTT not available, waiting for full handshake");
                match connecting.await {
                    Ok(conn) => conn,
                    Err(e) => {
                        // Failed to connect - remove from cache
                        self.connections.remove(address);
                        return Err(e.into());
                    }
                }
            }
        };

        // Cache the connection
        self.connections.insert(
            address.to_string(),
            CachedConnection {
                conn: Some(connection.clone()),
            },
        );

        debug!("Connected to {}", address);
        Ok(connection)
    }

    /// Pre-warms connections to upcoming leaders.
    ///
    /// This should be called periodically to ensure connections are
    /// ready when needed for transaction submission.
    pub async fn prewarm_connections(&self, lookahead: u64) {
        let leaders = self.leader_tracker.get_future_leaders(0, lookahead).await;

        for leader in leaders {
            let manager = self.clone();
            let socket = leader.tpu_socket.clone();
            let identity = leader.identity.clone();

            tokio::spawn(async move {
                match manager.get_or_create_connection(&socket).await {
                    Ok(_) => debug!("Pre-warmed connection to {} at {}", identity, socket),
                    Err(e) => debug!("Failed to pre-warm connection to {}: {}", socket, e),
                }
            });
        }
    }

    /// Returns the number of active connections.
    pub fn connection_count(&self) -> usize {
        self.connections
            .iter()
            .filter(|entry| {
                entry
                    .value()
                    .conn
                    .as_ref()
                    .map(|c| c.close_reason().is_none())
                    .unwrap_or(false)
            })
            .count()
    }

    /// Closes all connections.
    ///
    /// Note: Endpoints will clean up remaining state when dropped.
    pub fn close_all(&self) {
        for entry in self.connections.iter() {
            if let Some(ref conn) = entry.value().conn {
                conn.close(0u32.into(), b"shutdown");
            }
        }
        self.connections.clear();
    }
}

impl Clone for TpuConnectionManager {
    fn clone(&self) -> Self {
        Self {
            endpoints: self.endpoints.clone(),
            connections: self.connections.clone(),
            leader_tracker: self.leader_tracker.clone(),
            // Each clone starts with its own round-robin counter
            next_endpoint: AtomicUsize::new(0),
        }
    }
}

impl Drop for TpuConnectionManager {
    fn drop(&mut self) {
        self.close_all();
    }
}

impl std::fmt::Debug for TpuConnectionManager {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("TpuConnectionManager")
            .field("connection_count", &self.connection_count())
            .finish()
    }
}


