//! QUIC connection management for TPU endpoints.
//!
//! Maintains a pool of QUIC connections to validator TPU endpoints
//! with support for connection reuse and 0-RTT reconnection.
//!
//! Features multi-endpoint architecture to avoid Quinn's mutex contention
//! under high load, distributing connections across multiple QUIC endpoints.

use anyhow::{anyhow, Context, Result};
use dashmap::DashMap;
use log::{debug, info};
use quinn::{
    crypto::rustls::QuicClientConfig, ClientConfig, Connection as QuinnConnection, Endpoint,
    IdleTimeout, TransportConfig,
};
use std::net::SocketAddr;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use crate::tracker::LeaderTracker;

/// ALPN protocol identifier for Solana TPU.
const ALPN_TPU_PROTOCOL_ID: &[u8] = b"solana-tpu";

/// Maximum idle timeout for QUIC connections.
const QUIC_MAX_TIMEOUT: Duration = Duration::from_secs(5);

/// Keep-alive interval for QUIC connections.
const QUIC_KEEP_ALIVE: Duration = Duration::from_secs(4);

/// Number of QUIC endpoints to distribute connections across.
/// Multiple endpoints avoid Quinn's internal mutex contention under high load.
/// Each endpoint has its own event loop for better parallelism.
const NUM_ENDPOINTS: usize = 5;

/// Result of a transaction delivery attempt.
#[derive(Debug, Clone)]
pub struct DeliveryResult {
    /// Whether the transaction was delivered to at least one leader.
    pub delivered: bool,
    /// Total latency in milliseconds.
    pub latency_ms: u64,
    /// Number of leaders the transaction was sent to.
    pub leader_count: usize,
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

    /// Sends a transaction to the current leaders.
    ///
    /// The transaction is sent to multiple leaders in parallel based on
    /// the leader tracker's recommendations.
    ///
    /// # Arguments
    ///
    /// * `tx_data` - Serialized transaction bytes
    ///
    /// # Returns
    ///
    /// Delivery result indicating success and latency.
    pub async fn send_transaction(&self, tx_data: &[u8]) -> Result<DeliveryResult> {
        debug!(
            "Sending transaction ({} bytes), preview: {:02x?}",
            tx_data.len(),
            &tx_data[..tx_data.len().min(32)]
        );

        let start = Instant::now();
        let leaders = self.leader_tracker.get_leaders().await;

        if leaders.is_empty() {
            return Err(anyhow!("No leaders available"));
        }

        let mut tx_sent = false;
        let mut send_count = 0;

        for leader in &leaders {
            match self.send_to_leader(tx_data, &leader.tpu_socket).await {
                Ok(_) => {
                    info!(
                        "Sent {} bytes to {} at: {}",
                        tx_data.len(),
                        leader.identity,
                        leader.tpu_socket
                    );
                    tx_sent = true;
                    send_count += 1;
                }
                Err(e) => {
                    debug!(
                        "Failed to send to {} at {}: {}",
                        leader.identity, leader.tpu_socket, e
                    );
                }
            }
        }

        if !tx_sent {
            return Err(anyhow!(
                "Failed to send transaction to any leader ({} attempted)",
                leaders.len()
            ));
        }

        Ok(DeliveryResult {
            delivered: true,
            latency_ms: start.elapsed().as_millis() as u64,
            leader_count: send_count,
        })
    }

    /// Sends transaction data to a specific leader.
    async fn send_to_leader(&self, tx_data: &[u8], tpu_address: &str) -> Result<()> {
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

        // Try 0-RTT connection first for lower latency
        let connection = match endpoint.connect(addr, "solana")?.into_0rtt() {
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


