//! TpuClient - Main interface exposed to Node.js via NAPI.
//!
//! Provides a high-level API for sending transactions directly to
//! Solana validator TPU endpoints with per-leader results and retry logic.
//!
//! Features continuous resubmission until confirmed for 90%+ landing rates.

use anyhow::Context;
use napi::bindgen_prelude::*;
use napi_derive::napi;
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_sdk::signature::Signature;
use std::sync::Arc;
use std::time::{Duration, Instant};
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

/// Result for a single leader send attempt.
#[napi(object)]
#[derive(Debug, Clone)]
pub struct LeaderSendResult {
    /// Validator identity pubkey.
    pub identity: String,
    /// TPU socket address.
    pub address: String,
    /// Whether send succeeded.
    pub success: bool,
    /// Latency for this leader in milliseconds.
    pub latency_ms: u32,
    /// Error message if failed.
    pub error: Option<String>,
    /// Error code for programmatic handling.
    pub error_code: Option<String>,
    /// Number of attempts made for this leader.
    pub attempts: u32,
}

/// Result from sending a transaction.
#[napi(object)]
#[derive(Debug, Clone)]
pub struct SendResult {
    /// Whether the transaction was successfully delivered.
    pub delivered: bool,
    /// Total latency in milliseconds.
    pub latency_ms: u32,
    /// Number of leaders the transaction was sent to.
    pub leader_count: u32,
    /// Per-leader breakdown of send results.
    pub leaders: Vec<LeaderSendResult>,
    /// Total retry attempts made across all leaders.
    pub retry_count: u32,
}

/// Client health and statistics.
#[napi(object)]
#[derive(Debug, Clone)]
pub struct TpuClientStats {
    /// Number of active QUIC connections.
    pub connection_count: u32,
    /// Current estimated slot.
    pub current_slot: u32,
    /// Number of QUIC endpoints.
    pub endpoint_count: u32,
    /// Client ready state: "initializing", "ready", or "error".
    pub ready_state: String,
    /// Seconds since client was created.
    pub uptime_secs: u32,
    /// Number of validators with known sockets.
    pub known_validators: u32,
}

/// Result from continuous send until confirmed.
#[napi(object)]
#[derive(Debug, Clone)]
pub struct SendUntilConfirmedResult {
    /// Whether the transaction was confirmed on-chain.
    pub confirmed: bool,
    /// Transaction signature (base58).
    pub signature: String,
    /// Number of send rounds attempted.
    pub rounds: u32,
    /// Total number of leader sends across all rounds.
    pub total_leaders_sent: u32,
    /// Total latency in milliseconds.
    pub latency_ms: u32,
    /// Error message if failed.
    pub error: Option<String>,
}

/// Native QUIC client for direct Solana TPU transaction submission.
/// 
/// Supports continuous resubmission until confirmed for high landing rates.
#[napi]
pub struct TpuClient {
    /// Leader tracker for routing.
    leader_tracker: Arc<LeaderTracker>,
    /// Connection manager for QUIC connections.
    connection_manager: Arc<TpuConnectionManager>,
    /// RPC client for confirmation checking.
    rpc_client: Arc<RpcClient>,
    /// Tokio runtime for async operations.
    runtime: tokio::runtime::Runtime,
    /// Shutdown signal sender.
    shutdown_tx: Option<oneshot::Sender<()>>,
    /// Time when client was created.
    start_time: Instant,
    /// Number of leaders to fanout to.
    fanout: u32,
}

#[napi]
impl TpuClient {
    /// Creates a new TPU client instance.
    #[napi(constructor)]
    pub fn new(config: TpuClientConfig) -> napi::Result<Self> {

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

        // Create RPC client for confirmation checking
        let rpc_client = Arc::new(RpcClient::new(config.rpc_url.clone()));

        // Create shutdown channel
        let (shutdown_tx, shutdown_rx) = oneshot::channel();

        // Spawn background tasks
        let lt_clone = leader_tracker.clone();
        let cm_clone = connection_manager.clone();
        let prewarm = config.prewarm_connections.unwrap_or(true);
        let fanout = config.fanout.unwrap_or(4);
        let prewarm_lookahead = (fanout as u64) * 4;

        runtime.spawn(async move {
            // IMPORTANT: Fetch validator sockets FIRST before starting slot listener
            // This ensures we have socket data when is_ready() returns true
            let _ = lt_clone.update_leader_sockets().await;

            // Start slot listener (this will set is_ready = true)
            let lt_for_slots = lt_clone.clone();
            let slot_listener = tokio::spawn(async move {
                let _ = lt_for_slots.run_slot_listener().await;
            });

            // Start socket updater (every 60 seconds)
            let lt_for_sockets = lt_clone.clone();
            let socket_updater = tokio::spawn(async move {
                lt_for_sockets
                    .run_socket_updater(Duration::from_secs(60))
                    .await;
            });

            // Start connection pre-warmer (every 400ms = 1 slot time)
            // pre-warms connections every ~3 slots for optimal landing.
            // We prewarm more aggressively (every slot) since we're frontend-facing.
            let prewarm_task = if prewarm {
                Some(tokio::spawn(async move {
                    loop {
                        // Prewarm connections to next fanout * 4 slots (leader lookahead).
                        cm_clone.prewarm_connections(prewarm_lookahead).await;
                        tokio::time::sleep(Duration::from_millis(400)).await;
                    }
                }))
            } else {
                None
            };

            // Wait for shutdown signal
            let _ = shutdown_rx.await;

            // Cancel tasks
            slot_listener.abort();
            socket_updater.abort();
            if let Some(task) = prewarm_task {
                task.abort();
            }
        });

        Ok(Self {
            leader_tracker,
            connection_manager,
            rpc_client,
            runtime,
            shutdown_tx: Some(shutdown_tx),
            start_time: Instant::now(),
            fanout,
        })
    }

    /// Sends a serialized transaction to TPU endpoints (single attempt).
    ///
    /// Uses slot-aware leader selection when available, falling back to fanout.
    /// Returns detailed per-leader results including retry statistics.
    /// For higher landing rates, use `send_until_confirmed` instead.
    #[napi]
    pub async fn send_transaction(&self, transaction: Buffer) -> napi::Result<SendResult> {
        let tx_data = transaction.as_ref();
        let cm = self.connection_manager.clone();
        let fanout = self.fanout;

        let (leaders, _slot_position) = self.leader_tracker.get_slot_aware_leaders().await;
        let result = if leaders.is_empty() {
            cm.send_transaction_with_fanout(tx_data, fanout)
                .await
                .context("Failed to send transaction")
                .map_err(anyhow_to_napi)?
        } else {
            cm.send_to_leaders(tx_data, &leaders)
                .await
                .context("Failed to send transaction")
                .map_err(anyhow_to_napi)?
        };

        // Convert internal LeaderDeliveryResult to NAPI LeaderSendResult
        let leaders: Vec<LeaderSendResult> = result
            .leaders
            .into_iter()
            .map(|lr| LeaderSendResult {
                identity: lr.identity,
                address: lr.address,
                success: lr.success,
                latency_ms: lr.latency_ms as u32,
                error: lr.error,
                error_code: lr.error_code.map(|c| c.to_string()),
                attempts: lr.attempts as u32,
            })
            .collect();

        Ok(SendResult {
            delivered: result.delivered,
            latency_ms: result.latency_ms as u32,
            leader_count: result.leader_count as u32,
            leaders,
            retry_count: result.total_retries as u32,
        })
    }

    /// Sends a transaction continuously until confirmed or timeout.
    ///
    /// Uses slot-aware leader selection to minimize tx leakage:
    /// - Slots 0-2 of leader window: sends to current leader only
    /// - Slot 3 of leader window: sends to current + next leader (hedge)
    ///
    /// Falls back to fixed fanout if slot estimation is unreliable.
    ///
    /// # Arguments
    /// * `transaction` - Serialized signed transaction
    /// * `timeout_ms` - Maximum time to wait for confirmation (default: 30000ms)
    ///
    /// # Returns
    /// Result indicating whether the transaction was confirmed on-chain.
    #[napi]
    pub async fn send_until_confirmed(
        &self,
        transaction: Buffer,
        timeout_ms: Option<u32>,
    ) -> napi::Result<SendUntilConfirmedResult> {
        let timeout = Duration::from_millis(timeout_ms.unwrap_or(30_000) as u64);
        let start = Instant::now();
        let tx_data = transaction.as_ref().to_vec();
        
        // Extract signature from transaction
        let signature = match Self::extract_signature(&tx_data) {
            Ok(sig) => sig,
            Err(e) => {
                return Ok(SendUntilConfirmedResult {
                    confirmed: false,
                    signature: String::new(),
                    rounds: 0,
                    total_leaders_sent: 0,
                    latency_ms: start.elapsed().as_millis() as u32,
                    error: Some(format!("Failed to extract signature: {}", e)),
                });
            }
        };
        
        let signature_str = signature.to_string();
        
        let mut rounds = 0u32;
        let mut total_leaders_sent = 0u32;
        let slot_duration = Duration::from_millis(400);
        
        // Staleness detection - track if slot hasn't changed between rounds
        let mut last_slot: u64 = 0;
        let mut stale_rounds: u32 = 0;
        
        // Send loop - continues until confirmed or timeout
        while start.elapsed() < timeout {
            rounds += 1;
            
            // Check for stale slot (same slot for multiple rounds)
            let current_slot = self.leader_tracker.current_slot().await;
            if current_slot == last_slot && current_slot != 0 {
                stale_rounds += 1;
                if stale_rounds >= 2 {
                    let _ = self.leader_tracker.refresh_slot_from_rpc().await;
                }
            } else {
                stale_rounds = 0;
                last_slot = current_slot;
            }
            
            // 1. Get slot-aware leaders (1 or 2 based on slot position)
            let (leaders, _slot_position) = self.leader_tracker.get_slot_aware_leaders().await;
            
            // Fallback to fixed fanout if slot estimation is unreliable
            let send_result = if leaders.is_empty() {
                self.connection_manager
                    .send_transaction_with_fanout(&tx_data, self.fanout)
                    .await
            } else {
                self.connection_manager
                    .send_to_leaders(&tx_data, &leaders)
                    .await
            };
            
            if let Ok(result) = &send_result {
                total_leaders_sent += result.leader_count as u32;
            }
            
            // 2. Check if confirmed
            if let Ok(true) = self.check_confirmed(&signature).await {
                let latency = start.elapsed().as_millis() as u32;
                return Ok(SendUntilConfirmedResult {
                    confirmed: true,
                    signature: signature_str,
                    rounds,
                    total_leaders_sent,
                    latency_ms: latency,
                    error: None,
                });
            }
            
            // 3. Wait one slot before next round
            // Use a shorter sleep if we're close to timeout
            let remaining = timeout.saturating_sub(start.elapsed());
            if remaining < slot_duration {
                tokio::time::sleep(remaining).await;
            } else {
                tokio::time::sleep(slot_duration).await;
            }
        }
        
        // Timeout - do one final confirmation check
        let final_confirmed = self.check_confirmed(&signature).await.unwrap_or(false);
        let latency = start.elapsed().as_millis() as u32;
        
        if final_confirmed {
            Ok(SendUntilConfirmedResult {
                confirmed: true,
                signature: signature_str,
                rounds,
                total_leaders_sent,
                latency_ms: latency,
                error: None,
            })
        } else {
            Ok(SendUntilConfirmedResult {
                confirmed: false,
                signature: signature_str,
                rounds,
                total_leaders_sent,
                latency_ms: latency,
                error: Some(format!(
                    "Transaction not confirmed within {}ms ({} rounds, {} leaders sent)",
                    timeout.as_millis(),
                    rounds,
                    total_leaders_sent
                )),
            })
        }
    }
    
    /// Extract signature from a serialized transaction.
    /// 
    /// Solana transaction format: [num_signatures, ...signatures (64 bytes each), ...]
    fn extract_signature(tx_data: &[u8]) -> anyhow::Result<Signature> {
        if tx_data.is_empty() {
            anyhow::bail!("Empty transaction data");
        }
        
        let num_signatures = tx_data[0] as usize;
        if num_signatures == 0 {
            anyhow::bail!("Transaction has no signatures");
        }
        
        if tx_data.len() < 1 + 64 {
            anyhow::bail!("Transaction too short to contain signature");
        }
        
        // First signature is at offset 1, 64 bytes
        let sig_bytes: [u8; 64] = tx_data[1..65]
            .try_into()
            .context("Failed to extract signature bytes")?;
        
        Ok(Signature::from(sig_bytes))
    }
    
    /// Check if a transaction is confirmed on-chain.
    async fn check_confirmed(&self, signature: &Signature) -> anyhow::Result<bool> {
        let response = self.rpc_client
            .get_signature_statuses(&[*signature])
            .await
            .context("Failed to get signature status")?;
        
        if let Some(Some(status)) = response.value.first() {
            // Check if confirmed or finalized
            // The confirmation_status field indicates the commitment level achieved
            if let Some(ref conf_status) = status.confirmation_status {
                use solana_client::rpc_response::TransactionConfirmationStatus;
                return Ok(matches!(
                    conf_status,
                    TransactionConfirmationStatus::Confirmed | TransactionConfirmationStatus::Finalized
                ));
            }
            // If confirmations is Some, it's at least confirmed
            if status.confirmations.is_some() {
                return Ok(true);
            }
            // If err is None and we have a status, the transaction was processed
            if status.err.is_none() {
                return Ok(true);
            }
        }
        
        Ok(false)
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

    /// Gets comprehensive client statistics.
    #[napi]
    pub async fn get_stats(&self) -> TpuClientStats {
        let is_ready = self.leader_tracker.is_ready().await;
        let current_slot = self.leader_tracker.current_slot().await;
        let validator_count = self.leader_tracker.validator_count().await;

        TpuClientStats {
            connection_count: self.connection_manager.connection_count() as u32,
            current_slot: current_slot as u32,
            endpoint_count: 5, // NUM_ENDPOINTS from connection_manager
            ready_state: if is_ready {
                "ready".to_string()
            } else {
                "initializing".to_string()
            },
            uptime_secs: self.start_time.elapsed().as_secs() as u32,
            known_validators: validator_count as u32,
        }
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
