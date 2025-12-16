//! TpuClient - Main interface exposed to Node.js via NAPI.
//!
//! Provides a high-level API for sending transactions directly to
//! Solana validator TPU endpoints.

use anyhow::Context;
use log::info;
use napi::bindgen_prelude::*;
use napi_derive::napi;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::oneshot;

use crate::connection_manager::TpuConnectionManager;
use crate::tracker::LeaderTracker;

/// Helper to convert anyhow::Error to napi::Error
fn anyhow_to_napi(err: anyhow::Error) -> napi::Error {
    napi::Error::from_reason(err.to_string())
}

/// Configuration for the TPU client.
#[napi(object)]
#[derive(Debug, Clone)]
pub struct TpuClientConfig {
    /// RPC URL for fetching leader schedule and cluster info.
    pub rpc_url: String,
    /// WebSocket URL for slot update subscriptions.
    pub ws_url: String,
    /// Number of upcoming leaders to send transactions to (default: 2).
    pub fanout: Option<u32>,
    /// Whether to pre-warm connections to upcoming leaders (default: true).
    pub prewarm_connections: Option<bool>,
}

/// Result from sending a transaction.
#[napi(object)]
#[derive(Debug, Clone)]
pub struct SendResult {
    /// Whether the transaction was successfully delivered.
    pub delivered: bool,
    /// Latency in milliseconds.
    pub latency_ms: u32,
    /// Number of leaders the transaction was sent to.
    pub leader_count: u32,
}

/// Native QUIC client for direct Solana TPU transaction submission.
#[napi]
pub struct TpuClient {
    /// Leader tracker for routing.
    leader_tracker: Arc<LeaderTracker>,
    /// Connection manager for QUIC connections.
    connection_manager: Arc<TpuConnectionManager>,
    /// Tokio runtime for async operations.
    runtime: tokio::runtime::Runtime,
    /// Shutdown signal sender.
    shutdown_tx: Option<oneshot::Sender<()>>,
}

#[napi]
impl TpuClient {
    /// Creates a new TPU client instance.
    #[napi(constructor)]
    pub fn new(config: TpuClientConfig) -> napi::Result<Self> {
        // Initialize logging
        let _ = env_logger::try_init();

        info!(
            "Creating TpuClient with RPC: {}, WS: {}",
            config.rpc_url, config.ws_url
        );

        // Create tokio runtime
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()
            .context("Failed to create tokio runtime")
            .map_err(anyhow_to_napi)?;

        // Initialize leader tracker
        let leader_tracker = runtime.block_on(async {
            LeaderTracker::new(config.rpc_url.clone(), config.ws_url.clone())
                .await
                .context("Failed to create leader tracker")
        }).map_err(anyhow_to_napi)?;

        let leader_tracker = Arc::new(leader_tracker);

        // Initialize connection manager
        let connection_manager = TpuConnectionManager::new(leader_tracker.clone())
            .context("Failed to create connection manager")
            .map_err(anyhow_to_napi)?;
        let connection_manager = Arc::new(connection_manager);

        // Create shutdown channel
        let (shutdown_tx, shutdown_rx) = oneshot::channel();

        // Spawn background tasks
        let lt_clone = leader_tracker.clone();
        let cm_clone = connection_manager.clone();
        let prewarm = config.prewarm_connections.unwrap_or(true);

        runtime.spawn(async move {
            // Start slot listener
            let lt_for_slots = lt_clone.clone();
            let slot_listener = tokio::spawn(async move {
                if let Err(e) = lt_for_slots.run_slot_listener().await {
                    log::error!("Slot listener error: {}", e);
                }
            });

            // Start socket updater (every 60 seconds)
            let lt_for_sockets = lt_clone.clone();
            let socket_updater = tokio::spawn(async move {
                lt_for_sockets
                    .run_socket_updater(Duration::from_secs(60))
                    .await;
            });

            // Start connection pre-warmer (every 2 seconds)
            let prewarm_task = if prewarm {
                Some(tokio::spawn(async move {
                    loop {
                        cm_clone.prewarm_connections(40).await;
                        tokio::time::sleep(Duration::from_secs(2)).await;
                    }
                }))
            } else {
                None
            };

            // Wait for initial socket update
            if let Err(e) = lt_clone.update_leader_sockets().await {
                log::error!("Initial socket update failed: {}", e);
            }

            // Wait for shutdown signal
            let _ = shutdown_rx.await;

            // Cancel tasks
            slot_listener.abort();
            socket_updater.abort();
            if let Some(task) = prewarm_task {
                task.abort();
            }
        });

        info!("TpuClient created successfully");

        Ok(Self {
            leader_tracker,
            connection_manager,
            runtime,
            shutdown_tx: Some(shutdown_tx),
        })
    }

    /// Sends a serialized transaction to TPU endpoints.
    #[napi]
    pub async fn send_transaction(&self, transaction: Buffer) -> napi::Result<SendResult> {
        let tx_data = transaction.as_ref();
        let cm = self.connection_manager.clone();

        let result = cm
            .send_transaction(tx_data)
            .await
            .context("Failed to send transaction")
            .map_err(anyhow_to_napi)?;

        Ok(SendResult {
            delivered: result.delivered,
            latency_ms: result.latency_ms as u32,
            leader_count: result.leader_count as u32,
        })
    }

    /// Gets the current estimated slot number.
    #[napi]
    pub fn get_current_slot(&self) -> u32 {
        self.runtime
            .block_on(self.leader_tracker.current_slot()) as u32
    }

    /// Gets the number of active QUIC connections.
    #[napi]
    pub async fn get_connection_count(&self) -> u32 {
        self.connection_manager.connection_count() as u32
    }

    /// Waits for the client to be fully initialized.
    #[napi]
    pub async fn wait_ready(&self) -> napi::Result<()> {
        let lt = self.leader_tracker.clone();

        // Wait for up to 30 seconds for the client to be ready
        for _ in 0..60 {
            if lt.is_ready().await {
                return Ok(());
            }
            tokio::time::sleep(Duration::from_millis(500)).await;
        }

        Err(napi::Error::from_reason("Timeout waiting for client to be ready"))
    }

    /// Shuts down the client and closes all connections.
    #[napi]
    pub fn shutdown(&mut self) {
        info!("Shutting down TpuClient");

        // Send shutdown signal
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(());
        }

        // Close all connections
        self.connection_manager.close_all();
    }
}

impl Drop for TpuClient {
    fn drop(&mut self) {
        self.shutdown();
    }
}


