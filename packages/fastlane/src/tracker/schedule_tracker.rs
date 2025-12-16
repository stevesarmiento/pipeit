//! Leader schedule tracking per epoch.
//!
//! Caches the leader schedule for the current and next epochs,
//! and handles epoch boundary rotations.

use anyhow::{ensure, Context, Result};
use solana_client::nonblocking::rpc_client::RpcClient;
use std::collections::HashMap;

use super::Slot;

/// Tracks leader schedules for current and upcoming epochs.
///
/// Maintains schedules for two epochs:
/// - Current epoch: the active epoch
/// - Next epoch: prefetched for seamless transitions
///
/// When the current slot crosses into the next epoch, schedules are
/// rotated and a new next epoch schedule is fetched.
#[derive(Debug)]
pub struct ScheduleTracker {
    /// First slot of the current epoch.
    curr_epoch_slot_start: Slot,
    /// First slot of the next epoch.
    next_epoch_slot_start: Slot,
    /// Maps slot index within epoch -> validator pubkey for current epoch.
    curr_schedule: HashMap<usize, String>,
    /// Maps slot index within epoch -> validator pubkey for next epoch.
    next_schedule: HashMap<usize, String>,
    /// Number of slots in an epoch.
    slots_in_epoch: Slot,
}

impl ScheduleTracker {
    /// Creates a new ScheduleTracker by fetching current and next epoch schedules.
    ///
    /// # Arguments
    ///
    /// * `rpc_client` - RPC client to fetch schedule data
    ///
    /// # Errors
    ///
    /// Returns an error if:
    /// - RPC connection fails
    /// - Epoch info is invalid
    /// - Leader schedule fetch fails
    pub async fn new(rpc_client: &RpcClient) -> Result<Self> {
        let epoch_info = rpc_client
            .get_epoch_info()
            .await
            .context("Failed to fetch epoch info from RPC")?;

        // Validate epoch info
        ensure!(
            epoch_info.slots_in_epoch > 0,
            "Invalid slots_in_epoch: {}",
            epoch_info.slots_in_epoch
        );

        ensure!(
            epoch_info.slot_index < epoch_info.slots_in_epoch,
            "slot_index {} exceeds slots_in_epoch {}",
            epoch_info.slot_index,
            epoch_info.slots_in_epoch
        );

        // Calculate epoch boundaries
        let curr_epoch_slot_start = epoch_info.absolute_slot - epoch_info.slot_index;
        let next_epoch_slot_start = curr_epoch_slot_start + epoch_info.slots_in_epoch;

        // Fetch both schedules
        let curr_schedule = Self::fetch_schedule(rpc_client, curr_epoch_slot_start)
            .await
            .context("Failed to fetch current epoch schedule")?;

        let next_schedule = Self::fetch_schedule(rpc_client, next_epoch_slot_start)
            .await
            .unwrap_or_default(); // Next epoch schedule may not be available yet

        Ok(Self {
            curr_epoch_slot_start,
            next_epoch_slot_start,
            curr_schedule,
            next_schedule,
            slots_in_epoch: epoch_info.slots_in_epoch,
        })
    }

    /// Fetches the leader schedule for a given epoch.
    ///
    /// # Arguments
    ///
    /// * `rpc_client` - The RPC client to use
    /// * `slot` - The first slot of the epoch
    ///
    /// # Returns
    ///
    /// A HashMap mapping slot indices to validator pubkeys
    pub async fn fetch_schedule(
        rpc_client: &RpcClient,
        slot: Slot,
    ) -> Result<HashMap<usize, String>> {
        let leader_schedule = rpc_client
            .get_leader_schedule(Some(slot))
            .await
            .context("RPC call to get_leader_schedule failed")?
            .context(format!("No leader schedule available for slot {}", slot))?;

        // Convert from RPC format: {pubkey: [slot_indices]}
        // to our format: {slot_index: pubkey}
        let mut schedule = HashMap::with_capacity(leader_schedule.len() * 4);

        for (pubkey, slot_indices) in leader_schedule {
            for &slot_index in &slot_indices {
                schedule.insert(slot_index, pubkey.clone());
            }
        }

        ensure!(
            !schedule.is_empty(),
            "Fetched empty schedule for slot {}",
            slot
        );

        Ok(schedule)
    }

    /// Gets the leader for a given slot index within the current epoch.
    ///
    /// # Arguments
    ///
    /// * `slot_index` - Slot index within the epoch (0-based)
    ///
    /// # Returns
    ///
    /// The validator pubkey for this slot, or None if not found.
    pub fn get_leader_for_slot_index(&self, slot_index: usize) -> Option<&str> {
        self.curr_schedule.get(&slot_index).map(|s| s.as_str())
    }

    /// Returns the first slot of the current epoch.
    pub fn current_epoch_slot_start(&self) -> Slot {
        self.curr_epoch_slot_start
    }

    /// Returns the first slot of the next epoch.
    pub fn next_epoch_slot_start(&self) -> Slot {
        self.next_epoch_slot_start
    }

    /// Returns the number of slots in an epoch.
    pub fn slots_in_epoch(&self) -> Slot {
        self.slots_in_epoch
    }

    /// Converts an absolute slot number to a slot index within the current epoch.
    ///
    /// # Returns
    ///
    /// The slot index, or None if the slot is outside the current epoch range.
    pub fn slot_to_index(&self, slot: Slot) -> Option<usize> {
        if slot < self.curr_epoch_slot_start {
            return None; // Slot is in the past
        }

        if slot >= self.next_epoch_slot_start {
            return None; // Slot is in future epoch
        }

        let index = slot - self.curr_epoch_slot_start;
        Some(index as usize)
    }

    /// Rotates to the next epoch and fetches the new next_schedule.
    ///
    /// Should be called when the current slot crosses into the next epoch.
    ///
    /// # Returns
    ///
    /// Returns `true` if rotation occurred, `false` if current slot is still in current epoch.
    pub async fn maybe_rotate(
        &mut self,
        current_slot: Slot,
        rpc_client: &RpcClient,
    ) -> Result<bool> {
        if current_slot < self.next_epoch_slot_start {
            return Ok(false); // Still in current epoch
        }

        log::info!(
            "Rotating epoch: {} -> {}",
            self.curr_epoch_slot_start,
            self.next_epoch_slot_start
        );

        // Rotate to next epoch
        self.curr_epoch_slot_start = self.next_epoch_slot_start;
        self.next_epoch_slot_start += self.slots_in_epoch;
        self.curr_schedule = std::mem::take(&mut self.next_schedule);

        // Fetch new next epoch schedule
        self.next_schedule = Self::fetch_schedule(rpc_client, self.next_epoch_slot_start)
            .await
            .unwrap_or_default(); // May not be available yet

        Ok(true)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_slot_to_index() {
        let tracker = ScheduleTracker {
            curr_epoch_slot_start: 1000,
            next_epoch_slot_start: 1432,
            curr_schedule: HashMap::new(),
            next_schedule: HashMap::new(),
            slots_in_epoch: 432,
        };

        assert_eq!(tracker.slot_to_index(1000), Some(0));
        assert_eq!(tracker.slot_to_index(1001), Some(1));
        assert_eq!(tracker.slot_to_index(1431), Some(431));
        assert_eq!(tracker.slot_to_index(999), None); // Before epoch
        assert_eq!(tracker.slot_to_index(1432), None); // After epoch
    }
}


