//! Leader tracking coordination.
//!
//! Coordinates slot tracking, leader schedule, and validator socket addresses
//! to determine where to send transactions at any given moment.

use anyhow::{Context, Result};
use futures_util::StreamExt;
use log::{debug, error, info, warn};
use solana_client::nonblocking::pubsub_client::PubsubClient;
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_client::rpc_response::SlotUpdate;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::RwLock;

use super::schedule_tracker::ScheduleTracker;
use super::slots_tracker::{SlotEvent, SlotsTracker};
use super::Slot;

/// Information about a leader validator.
#[derive(Debug, Clone)]
pub struct LeaderInfo {
    /// Validator identity pubkey.
    pub identity: String,
    /// TPU socket address (ip:port).
    pub tpu_socket: String,
    /// Current slot when this info was generated.
    pub slot: Slot,
}

/// TPU socket addresses for a validator.
/// Stores both normal and forwards ports for flexible routing.
#[derive(Debug, Clone)]
pub struct TpuSockets {
    /// Standard TPU QUIC socket address.
    pub tpu_socket: Option<String>,
    /// TPU forwards QUIC socket address (preferred by validators).
    pub tpu_forwards_socket: Option<String>,
}

/// Coordinates leader tracking for TPU transaction routing.
///
/// Responsibilities:
/// 1. Track current slot via WebSocket subscriptions
/// 2. Maintain leader schedule for current and next epochs
/// 3. Map leader identities to TPU socket addresses
///
/// The separation of identities from IPs allows independent updates
/// since the schedule is based on identities and IPs can change.
pub struct LeaderTracker {
    /// RPC URL for fetching data.
    rpc_url: String,
    /// WebSocket URL for subscriptions.
    ws_url: String,
    /// Real-time slot tracker.
    pub slots_tracker: RwLock<SlotsTracker>,
    /// Leader schedule tracker.
    schedule_tracker: RwLock<ScheduleTracker>,
    /// Maps validator identity -> TPU socket addresses (normal + forwards).
    leader_sockets: RwLock<HashMap<String, TpuSockets>>,
    /// Whether the tracker is ready.
    ready: RwLock<bool>,
}

impl LeaderTracker {
    /// Creates a new LeaderTracker.
    ///
    /// # Arguments
    ///
    /// * `rpc_url` - RPC endpoint URL
    /// * `ws_url` - WebSocket endpoint URL
    pub async fn new(rpc_url: String, ws_url: String) -> Result<Self> {
        let rpc_client = RpcClient::new(rpc_url.clone());

        let schedule_tracker = ScheduleTracker::new(&rpc_client)
            .await
            .context("Failed to initialize schedule tracker")?;

        Ok(Self {
            rpc_url,
            ws_url,
            slots_tracker: RwLock::new(SlotsTracker::new()),
            schedule_tracker: RwLock::new(schedule_tracker),
            leader_sockets: RwLock::new(HashMap::new()),
            ready: RwLock::new(false),
        })
    }

    /// Returns whether the tracker is ready to provide leader info.
    pub async fn is_ready(&self) -> bool {
        *self.ready.read().await
    }

    /// Gets the current estimated slot.
    pub async fn current_slot(&self) -> Slot {
        self.slots_tracker.read().await.current_slot()
    }

    /// Refreshes the current slot from RPC when WebSocket is stale.
    /// 
    /// This is a fallback mechanism when the WebSocket subscription lags
    /// and the slot tracker reports the same slot for multiple rounds.
    pub async fn refresh_slot_from_rpc(&self) -> Result<Slot> {
        let rpc_client = RpcClient::new(self.rpc_url.clone());
        let slot = rpc_client
            .get_slot()
            .await
            .context("Failed to fetch slot from RPC")?;
        
        // Update the slots tracker with this fresh value
        let mut tracker = self.slots_tracker.write().await;
        tracker.record(SlotEvent::Start(slot));
        
        Ok(slot)
    }

    /// Get slot position within leader's 4-slot window (0-3).
    /// 
    /// Solana leaders get 4 consecutive slots (NUM_CONSECUTIVE_LEADER_SLOTS = 4).
    /// This returns which slot within that window we're currently in:
    /// - 0, 1, 2: Early/middle slots - current leader is likely to process
    /// - 3: Last slot - hedge by also sending to next leader
    pub fn get_slot_position(slot: u64) -> u8 {
        (slot % 4) as u8
    }

    /// Get leaders using slot-aware strategy to minimize tx leakage.
    /// 
    /// Strategy:
    /// - Slots 0-2 of leader window: returns current leader only (fanout = 1)
    /// - Slot 3 of leader window: returns current + next leader (fanout = 2)
    /// 
    /// This achieves the same landing rate as high fanout but with minimal
    /// transaction leakage (fewer validators see the transaction).
    pub async fn get_slot_aware_leaders(&self) -> (Vec<LeaderInfo>, u8) {
        let current_slot = self.current_slot().await;
        
        // If slot is 0, we can't determine position - caller should fallback
        if current_slot == 0 {
            return (vec![], 0);
        }
        
        let slot_position = Self::get_slot_position(current_slot);
        
        // Last slot of leader's window (position 3) - include next leader as hedge
        // Otherwise, just send to current leader
        let num_leaders = if slot_position == 3 { 2 } else { 1 };
        
        // Look ahead enough slots to find the required number of unique leaders
        // Each leader has 4 slots, so for 2 leaders we need to look at 8 slots
        let lookahead = num_leaders as u64 * 4;
        let leaders = self.get_future_leaders(0, lookahead).await;
        
        // Take only the number of leaders we need
        let leaders: Vec<LeaderInfo> = leaders.into_iter().take(num_leaders).collect();
        
        (leaders, slot_position)
    }

    /// Returns the number of validators with known socket addresses.
    pub async fn validator_count(&self) -> usize {
        self.leader_sockets.read().await.len()
    }

    /// Gets upcoming leaders for transaction routing.
    ///
    /// Prefers TPU forwards port (recommended by validators), falling back
    /// to normal TPU port if forwards is not available.
    ///
    /// # Arguments
    ///
    /// * `start` - Start offset from current slot (usually 0)
    /// * `end` - End offset from current slot (usually 2-4)
    ///
    /// # Returns
    ///
    /// Vector of leader info for the specified slot range, deduplicated.
    pub async fn get_future_leaders(&self, start: u64, end: u64) -> Vec<LeaderInfo> {
        // Acquire all locks together for consistent view
        let slot_tracker = self.slots_tracker.read().await;
        let schedule_tracker = self.schedule_tracker.read().await;
        let leader_sockets = self.leader_sockets.read().await;

        let curr_slot = slot_tracker.current_slot();

        if curr_slot == 0 {
            eprintln!("[TPU] ⚠️ Current slot is 0, cannot determine leaders");
            return vec![];
        }

        // Validate we're in the current epoch
        if curr_slot < schedule_tracker.current_epoch_slot_start()
            || curr_slot >= schedule_tracker.next_epoch_slot_start()
        {
            eprintln!(
                "[TPU] ⚠️ Current slot {} is outside epoch range [{}, {})",
                curr_slot,
                schedule_tracker.current_epoch_slot_start(),
                schedule_tracker.next_epoch_slot_start()
            );
            return vec![];
        }

        let mut leaders = Vec::new();
        let mut seen = HashSet::new();
        let mut missing_sockets = 0;
        let mut no_usable_address = 0;

        for i in start..end {
            let target_slot = match curr_slot.checked_add(i) {
                Some(s) => s,
                None => break, // Overflow protection
            };

            // Skip if out of current epoch range
            if target_slot >= schedule_tracker.next_epoch_slot_start() {
                break;
            }

            // Convert absolute slot to epoch-relative index
            let slot_index = match schedule_tracker.slot_to_index(target_slot) {
                Some(idx) => idx,
                None => continue,
            };

            // Get leader for this slot
            if let Some(leader_pubkey) = schedule_tracker.get_leader_for_slot_index(slot_index) {
                // Deduplicate - only add each leader once
                if !seen.insert(leader_pubkey.to_string()) {
                    continue;
                }

                match leader_sockets.get(leader_pubkey) {
                    Some(sockets) => {
                        // Prefer forwards port, fall back to normal TPU port
                        let socket = sockets
                            .tpu_forwards_socket
                            .as_ref()
                            .or(sockets.tpu_socket.as_ref());

                        if let Some(s) = socket {
                            leaders.push(LeaderInfo {
                                identity: leader_pubkey.to_string(),
                                tpu_socket: s.clone(),
                                slot: curr_slot,
                            });
                        } else {
                            no_usable_address += 1;
                            eprintln!(
                                "[TPU] ⚠️ Leader {}... has socket entry but no usable address",
                                &leader_pubkey[..8]
                            );
                        }
                    }
                    None => {
                        missing_sockets += 1;
                        // Only print first few to avoid spam
                        if missing_sockets <= 3 {
                            eprintln!(
                                "[TPU] ⚠️ Leader {}... for slot {} not in cluster nodes",
                                &leader_pubkey[..8],
                                target_slot
                            );
                        }
                    }
                }
            }
        }

        // Summary logging if we had issues
        if missing_sockets > 3 {
            eprintln!(
                "[TPU] ⚠️ ...and {} more leaders missing from cluster nodes (total: {})",
                missing_sockets - 3,
                missing_sockets
            );
        }
        if missing_sockets > 0 || no_usable_address > 0 {
            eprintln!(
                "[TPU] 📊 Leader lookup summary: found={}, missing_sockets={}, no_usable_addr={}",
                leaders.len(),
                missing_sockets,
                no_usable_address
            );
        }

        leaders
    }

    /// Gets upcoming leaders for transaction routing.
    ///
    /// This is the main method for transaction routing.
    /// 
    /// # Arguments
    /// 
    /// * `fanout` - Number of upcoming leaders to target (default: 4)
    pub async fn get_leaders(&self) -> Vec<LeaderInfo> {
        // Default to 4 leaders for better landing rates
        self.get_leaders_with_fanout(4).await
    }

    /// Gets upcoming leaders with configurable fanout.
    ///
    /// # Arguments
    /// 
    /// * `fanout` - Number of upcoming leaders to target
    pub async fn get_leaders_with_fanout(&self, fanout: u32) -> Vec<LeaderInfo> {
        // Look ahead by fanout * 4 slots to capture enough unique leaders.
        // Validators can have up to 4 consecutive slots (NUM_CONSECUTIVE_LEADER_SLOTS),
        // so with fanout=4 we need to look at least 16 slots ahead to find 4 unique leaders.
        let leaders = self.get_future_leaders(0, fanout as u64 * 4).await;
        
        // Always log leader discovery results (this is important for debugging)
        if (leaders.len() as u32) < fanout {
            let sockets_count = self.leader_sockets.read().await.len();
            eprintln!(
                "[TPU] ⚠️ LOW LEADER COUNT: Found {} leaders (wanted {}). \
                Sockets available: {}. Check logs above for missing validators.",
                leaders.len(),
                fanout,
                sockets_count
            );
        } else {
            eprintln!(
                "[TPU] ✅ Found {} leaders for fanout {}",
                leaders.len(),
                fanout
            );
        }
        
        leaders
    }

    /// Updates the leader socket addresses from cluster nodes.
    ///
    /// Fetches both normal TPU QUIC and TPU forwards QUIC addresses.
    /// Should be called periodically (e.g., every 60 seconds) as
    /// validator IPs can change.
    pub async fn update_leader_sockets(&self) -> Result<()> {
        let rpc_client = RpcClient::new(self.rpc_url.clone());

        let nodes = rpc_client
            .get_cluster_nodes()
            .await
            .context("Failed to fetch cluster nodes")?;

        let mut new_sockets = HashMap::new();

        for node in nodes {
            if let Some(gossip) = node.gossip {
                let ip = gossip.ip();

                // Standard TPU QUIC socket
                let tpu_socket = node.tpu_quic.map(|addr| format!("{}:{}", ip, addr.port()));

                // TPU forwards QUIC socket (preferred by validators)
                let tpu_forwards_socket = node
                    .tpu_forwards_quic
                    .map(|addr| format!("{}:{}", ip, addr.port()));

                // Only add if at least one socket is available
                if tpu_socket.is_some() || tpu_forwards_socket.is_some() {
                    new_sockets.insert(
                        node.pubkey.to_string(),
                        TpuSockets {
                            tpu_socket,
                            tpu_forwards_socket,
                        },
                    );
                }
            }
        }

        // Count validators with each type of socket
        let with_forwards = new_sockets.values().filter(|s| s.tpu_forwards_socket.is_some()).count();
        let with_tpu = new_sockets.values().filter(|s| s.tpu_socket.is_some()).count();
        
        info!(
            "📡 Updated sockets for {} validators ({} with forwards, {} with tpu)",
            new_sockets.len(),
            with_forwards,
            with_tpu
        );

        let mut sockets = self.leader_sockets.write().await;
        *sockets = new_sockets;

        Ok(())
    }

    /// Starts the slot updates listener with automatic reconnection.
    ///
    /// This should be spawned as a background task. If the WebSocket
    /// connection drops, it will automatically reconnect after a short delay.
    pub async fn run_slot_listener(self: Arc<Self>) -> Result<()> {
        loop {
            match self.run_slot_listener_inner().await {
                Ok(_) => {
                    warn!("WebSocket slot listener ended unexpectedly, reconnecting...");
                }
                Err(e) => {
                    error!("WebSocket error: {}, reconnecting in 1s...", e);
                    tokio::time::sleep(Duration::from_secs(1)).await;
                }
            }
        }
    }

    /// Inner slot listener that handles the WebSocket connection.
    /// Returns when the connection ends (either normally or due to error).
    async fn run_slot_listener_inner(&self) -> Result<()> {
        let ws_client = PubsubClient::new(&self.ws_url)
            .await
            .context("Failed to connect to WebSocket")?;

        let (mut slot_notifications, _unsubscribe) = ws_client
            .slot_updates_subscribe()
            .await
            .context("Failed to subscribe to slot updates")?;

        info!("Listening for slot updates...");

        // Mark as ready once we start receiving updates
        {
            let mut ready = self.ready.write().await;
            *ready = true;
        }

        while let Some(slot_event) = slot_notifications.next().await {
            if let Err(e) = self.handle_slot_event(slot_event).await {
                error!("Error handling slot event: {}", e);
            }
        }

        // Stream ended - will trigger reconnect in the outer loop
        Ok(())
    }

    /// Handles a single slot update event.
    async fn handle_slot_event(&self, slot_update: SlotUpdate) -> Result<()> {
        // Convert to our SlotEvent type
        let event = match slot_update {
            SlotUpdate::FirstShredReceived { slot, .. } => SlotEvent::Start(slot),
            SlotUpdate::Completed { slot, .. } => SlotEvent::End(slot),
            _ => return Ok(()), // Ignore other event types
        };

        // Record the slot event
        let curr_slot = {
            let mut slot_tracker = self.slots_tracker.write().await;
            slot_tracker.record(event)
        };

        // Check if we need to rotate to next epoch
        let needs_rotation = {
            let schedule_tracker = self.schedule_tracker.read().await;
            curr_slot >= schedule_tracker.next_epoch_slot_start()
        };

        if needs_rotation {
            self.rotate_epoch(curr_slot).await?;
        }

        Ok(())
    }

    /// Rotates the schedule to the next epoch.
    async fn rotate_epoch(&self, curr_slot: Slot) -> Result<()> {
        let rpc_client = RpcClient::new(self.rpc_url.clone());
        let mut schedule_tracker = self.schedule_tracker.write().await;

        info!(
            "Rotating epoch: {} -> {}",
            schedule_tracker.current_epoch_slot_start(),
            schedule_tracker.next_epoch_slot_start()
        );

        match schedule_tracker.maybe_rotate(curr_slot, &rpc_client).await {
            Ok(true) => {
                info!("Successfully rotated to next epoch");
            }
            Ok(false) => {
                warn!("Rotation not needed despite check");
            }
            Err(e) => {
                error!("Failed to rotate epoch: {}", e);
                return Err(e).context("Epoch rotation failed");
            }
        }

        Ok(())
    }

    /// Starts a background task to periodically update leader sockets.
    ///
    /// Should be spawned as a background task.
    pub async fn run_socket_updater(self: Arc<Self>, interval: Duration) {
        loop {
            match self.update_leader_sockets().await {
                Ok(_) => debug!("Leader sockets updated successfully"),
                Err(e) => error!("Failed to update leader sockets: {}", e),
            }
            tokio::time::sleep(interval).await;
        }
    }
}

impl std::fmt::Debug for LeaderTracker {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("LeaderTracker")
            .field("rpc_url", &self.rpc_url)
            .field("ws_url", &self.ws_url)
            .finish()
    }
}


