//! Leader tracking coordination.
//!
//! Coordinates slot tracking, leader schedule, and validator socket addresses
//! to determine where to send transactions at any given moment.

use anyhow::{Context, Result};
use futures_util::StreamExt;
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
#[derive(Debug, Clone, PartialEq, Eq)]
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
    /// Optional Yellowstone gRPC URL for slot subscriptions.
    grpc_url: Option<String>,
    /// Optional Yellowstone gRPC x-token for authenticated endpoints.
    grpc_x_token: Option<String>,
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
    pub async fn new(
        rpc_url: String,
        ws_url: String,
        grpc_url: Option<String>,
        grpc_x_token: Option<String>,
    ) -> Result<Self> {
        let rpc_client = RpcClient::new(rpc_url.clone());

        let schedule_tracker = ScheduleTracker::new(&rpc_client)
            .await
            .context("Failed to initialize schedule tracker")?;

        Ok(Self {
            rpc_url,
            ws_url,
            grpc_url,
            grpc_x_token,
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
            return vec![];
        }

        // Validate we're in the current epoch
        if curr_slot < schedule_tracker.current_epoch_slot_start()
            || curr_slot >= schedule_tracker.next_epoch_slot_start()
        {
            return vec![];
        }

        let mut leaders = Vec::new();
        let mut seen = HashSet::new();

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
                        }
                    }
                    None => {}
                }
            }
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
        self.get_future_leaders(0, fanout as u64 * 4).await
    }

    /// Updates the leader socket addresses from cluster nodes.
    ///
    /// Fetches both normal TPU QUIC and TPU forwards QUIC addresses.
    /// Should be called periodically (e.g., every 10 seconds) as
    /// validator IPs can change.
    pub async fn update_leader_sockets(&self) -> Result<()> {
        let rpc_client = RpcClient::new(self.rpc_url.clone());

        let nodes = rpc_client
            .get_cluster_nodes()
            .await
            .context("Failed to fetch cluster nodes")?;

        let mut sockets = self.leader_sockets.write().await;
        let mut seen = HashSet::new();

        for node in nodes {
            let pubkey = node.pubkey.to_string();
            seen.insert(pubkey.clone());

            // Standard TPU QUIC socket (full SocketAddr from RPC)
            let tpu_socket = node.tpu_quic.map(|addr| addr.to_string());

            // TPU forwards QUIC socket (preferred by validators)
            let tpu_forwards_socket = node.tpu_forwards_quic.map(|addr| addr.to_string());

            // Only store if at least one socket is available
            if tpu_socket.is_some() || tpu_forwards_socket.is_some() {
                let new_entry = TpuSockets {
                    tpu_socket,
                    tpu_forwards_socket,
                };

                let needs_update = sockets
                    .get(&pubkey)
                    .map(|existing| existing != &new_entry)
                    .unwrap_or(true);

                if needs_update {
                    sockets.insert(pubkey, new_entry);
                }
            }
        }

        // Remove validators no longer present in the cluster nodes response.
        sockets.retain(|pubkey, _| seen.contains(pubkey));

        Ok(())
    }

    /// Starts the slot updates listener with automatic reconnection.
    ///
    /// This should be spawned as a background task. If the WebSocket
    /// connection drops, it will automatically reconnect after a short delay.
    pub async fn run_slot_listener(self: Arc<Self>) -> Result<()> {
        loop {
            match self.run_slot_listener_inner().await {
                Ok(_) => {}
                Err(_) => {
                    tokio::time::sleep(Duration::from_secs(1)).await;
                }
            }
        }
    }

    /// Inner slot listener that handles the configured connection.
    /// Returns when the connection ends (either normally or due to error).
    async fn run_slot_listener_inner(&self) -> Result<()> {
        if let Some(grpc_url) = self.grpc_url.as_ref() {
            return self.run_grpc_slot_listener_inner(grpc_url).await;
        }

        self.run_wss_slot_listener_inner().await
    }

    /// Inner slot listener that handles the WebSocket connection.
    async fn run_wss_slot_listener_inner(&self) -> Result<()> {
        let ws_client = PubsubClient::new(&self.ws_url)
            .await
            .context("Failed to connect to WebSocket")?;

        let (mut slot_notifications, _unsubscribe) = ws_client
            .slot_updates_subscribe()
            .await
            .context("Failed to subscribe to slot updates")?;

        // Mark as ready once we start receiving updates
        {
            let mut ready = self.ready.write().await;
            *ready = true;
        }

        while let Some(slot_event) = slot_notifications.next().await {
            let _ = self.handle_slot_event(slot_event).await;
        }

        // Stream ended - will trigger reconnect in the outer loop
        Ok(())
    }

    /// Inner slot listener that handles the Yellowstone gRPC connection.
    async fn run_grpc_slot_listener_inner(&self, grpc_url: &str) -> Result<()> {
        use yellowstone_grpc_client::{ClientTlsConfig, GeyserGrpcBuilder};
        use yellowstone_grpc_proto::geyser::{
            SubscribeRequest, SubscribeRequestFilterSlots,
            subscribe_update::UpdateOneof,
        };

        let mut builder = GeyserGrpcBuilder::from_shared(grpc_url.to_string())
            .context("Failed to build gRPC client")?;
        let x_token = self.grpc_x_token.clone();
        builder = builder.x_token(x_token).context("Failed to set gRPC x-token")?;

        let mut client = builder
            .tls_config(ClientTlsConfig::default().with_enabled_roots())
            .context("Failed to configure gRPC TLS")?
            .connect()
            .await
            .context("Failed to connect to gRPC endpoint")?;

        let subscribe_request = SubscribeRequest {
            slots: std::collections::HashMap::from([(
                "fastlane-slot-tracker".to_string(),
                SubscribeRequestFilterSlots {
                    interslot_updates: Some(true),
                    ..Default::default()
                },
            )]),
            ..Default::default()
        };

        let mut stream = client
            .subscribe_once(subscribe_request)
            .await
            .context("Failed to subscribe to gRPC slot updates")?;

        let mut ready_set = false;
        while let Some(result) = stream.next().await {
            let update = result.context("gRPC slot stream error")?;
            if let Some(UpdateOneof::Slot(slot_update)) = update.update_oneof {
                let slot = slot_update.slot;

                // Record the slot update (monotonic source; bypass outlier filtering)
                let curr_slot = {
                    let mut tracker = self.slots_tracker.write().await;
                    tracker.record_monotonic(slot)
                };

                // Mark as ready once we start receiving updates
                if !ready_set {
                    let mut ready = self.ready.write().await;
                    *ready = true;
                    ready_set = true;
                }

                // Check if we need to rotate to next epoch (keep schedule fresh across epoch boundaries)
                let needs_rotation = {
                    let schedule_tracker = self.schedule_tracker.read().await;
                    curr_slot >= schedule_tracker.next_epoch_slot_start()
                };

                if needs_rotation {
                    self.rotate_epoch(curr_slot).await?;
                }
            }
        }

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

        schedule_tracker.maybe_rotate(curr_slot, &rpc_client).await
            .context("Epoch rotation failed")?;

        Ok(())
    }

    /// Starts a background task to periodically update leader sockets.
    ///
    /// Should be spawned as a background task.
    pub async fn run_socket_updater(self: Arc<Self>, interval: Duration) {
        loop {
            let _ = self.update_leader_sockets().await;
            tokio::time::sleep(interval).await;
        }
    }
}

impl std::fmt::Debug for LeaderTracker {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("LeaderTracker")
            .field("rpc_url", &self.rpc_url)
            .field("ws_url", &self.ws_url)
            .field("grpc_url", &self.grpc_url)
            .finish()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_slot_position_basic_cycle() {
        // Slot position cycles 0-3 within leader's 4-slot window
        assert_eq!(LeaderTracker::get_slot_position(0), 0);
        assert_eq!(LeaderTracker::get_slot_position(1), 1);
        assert_eq!(LeaderTracker::get_slot_position(2), 2);
        assert_eq!(LeaderTracker::get_slot_position(3), 3);
    }

    #[test]
    fn test_get_slot_position_wraps_correctly() {
        // Position wraps back to 0 after slot 3
        assert_eq!(LeaderTracker::get_slot_position(4), 0);
        assert_eq!(LeaderTracker::get_slot_position(5), 1);
        assert_eq!(LeaderTracker::get_slot_position(6), 2);
        assert_eq!(LeaderTracker::get_slot_position(7), 3);
        assert_eq!(LeaderTracker::get_slot_position(8), 0);
    }

    #[test]
    fn test_get_slot_position_large_slots() {
        // Test with realistic slot numbers (mainnet is in the hundreds of millions)
        assert_eq!(LeaderTracker::get_slot_position(100), 0); // 100 % 4 = 0
        assert_eq!(LeaderTracker::get_slot_position(101), 1);
        assert_eq!(LeaderTracker::get_slot_position(102), 2);
        assert_eq!(LeaderTracker::get_slot_position(103), 3);

        // Very large slot numbers
        assert_eq!(LeaderTracker::get_slot_position(300_000_000), 0);
        assert_eq!(LeaderTracker::get_slot_position(300_000_001), 1);
        assert_eq!(LeaderTracker::get_slot_position(300_000_002), 2);
        assert_eq!(LeaderTracker::get_slot_position(300_000_003), 3);
    }

    #[test]
    fn test_get_slot_position_hedge_slot() {
        // Position 3 is the "hedge" slot where we should send to next leader too
        assert_eq!(LeaderTracker::get_slot_position(3), 3);
        assert_eq!(LeaderTracker::get_slot_position(7), 3);
        assert_eq!(LeaderTracker::get_slot_position(11), 3);
        assert_eq!(LeaderTracker::get_slot_position(99), 3); // 99 % 4 = 3
    }
}
