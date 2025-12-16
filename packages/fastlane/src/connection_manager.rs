//! QUIC connection management for TPU endpoints.
//!
//! Maintains a pool of QUIC connections to validator TPU endpoints
//! with support for connection reuse and 0-RTT reconnection.

use anyhow::{anyhow, Context, Result};
use dashmap::DashMap;
use log::{debug, info};
use quinn::{
    crypto::rustls::QuicClientConfig, ClientConfig, Connection as QuinnConnection, Endpoint,
    IdleTimeout, TransportConfig,
};
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::{Duration, Instant};

use crate::tracker::LeaderTracker;

/// ALPN protocol identifier for Solana TPU.
const ALPN_TPU_PROTOCOL_ID: &[u8] = b"solana-tpu";

/// Maximum idle timeout for QUIC connections.
const QUIC_MAX_TIMEOUT: Duration = Duration::from_secs(5);

/// Keep-alive interval for QUIC connections.
const QUIC_KEEP_ALIVE: Duration = Duration::from_secs(4);

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
/// - Connection pooling with automatic reconnection
/// - 0-RTT support for faster reconnection
/// - Pre-warming connections to upcoming leaders
pub struct TpuConnectionManager {
    /// QUIC endpoint for outgoing connections.
    endpoint: Endpoint,
    /// Cached connections by address.
    connections: Arc<DashMap<String, CachedConnection>>,
    /// Leader tracker for routing.
    leader_tracker: Arc<LeaderTracker>,
}

impl TpuConnectionManager {
    /// Creates a new TPU connection manager.
    ///
    /// # Arguments
    ///
    /// * `leader_tracker` - Leader tracker for determining where to send transactions
    ///
    /// # Errors
    ///
    /// Returns an error if the QUIC endpoint cannot be initialized.
    pub fn new(leader_tracker: Arc<LeaderTracker>) -> Result<Self> {
        info!("Creating TPU connection manager");

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

        let mut client_config =
            ClientConfig::new(Arc::new(QuicClientConfig::try_from(crypto).unwrap()));
        client_config.transport_config(Arc::new(transport_config));

        // Create QUIC endpoint bound to any available port
        let mut endpoint = Endpoint::client("0.0.0.0:0".parse()?)?;
        endpoint.set_default_client_config(client_config);

        info!("TPU connection manager created");

        Ok(Self {
            endpoint,
            connections: Arc::new(DashMap::new()),
            leader_tracker,
        })
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

        // Try 0-RTT connection first for lower latency
        let connection = match self.endpoint.connect(addr, "solana")?.into_0rtt() {
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
            endpoint: self.endpoint.clone(),
            connections: self.connections.clone(),
            leader_tracker: self.leader_tracker.clone(),
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


