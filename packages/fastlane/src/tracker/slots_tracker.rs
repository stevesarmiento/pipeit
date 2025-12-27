//! Real-time slot tracking via WebSocket subscriptions.
//!
//! Tracks slot progression and estimates the current slot based on
//! slot update events. Filters out outliers from malicious validators
//! that may broadcast far-future slots.

use super::{Slot, MAX_SLOT_SKIP_DISTANCE, RECENT_LEADER_SLOTS_CAPACITY};
use std::collections::VecDeque;

/// Represents a slot event (start or end of a slot).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SlotEvent {
    /// First shred received for a slot (slot started processing).
    Start(Slot),
    /// Slot completed processing.
    End(Slot),
}

impl SlotEvent {
    /// Returns the slot number for this event.
    pub fn slot(&self) -> Slot {
        match self {
            SlotEvent::Start(slot) | SlotEvent::End(slot) => *slot,
        }
    }

    /// Returns true if this is a slot start event.
    pub fn is_start(&self) -> bool {
        matches!(self, SlotEvent::Start(_))
    }
}

/// Tracks recent slot events and estimates the current slot.
///
/// Uses a median-based algorithm to filter out outlier slots from
/// malicious or misconfigured validators.
#[derive(Debug)]
pub struct SlotsTracker {
    /// Recent slot events for estimation.
    recent_events: VecDeque<SlotEvent>,
    /// Current estimated slot.
    current_slot: Slot,
}

impl SlotsTracker {
    /// Creates a new slots tracker.
    pub fn new() -> Self {
        Self {
            recent_events: VecDeque::with_capacity(RECENT_LEADER_SLOTS_CAPACITY),
            current_slot: 0,
        }
    }

    /// Returns the current estimated slot.
    pub fn current_slot(&self) -> Slot {
        self.current_slot
    }

    /// Records a slot event and returns the new current slot estimate.
    ///
    /// # Arguments
    ///
    /// * `event` - The slot event to record
    ///
    /// # Returns
    ///
    /// The new estimated current slot after processing the event.
    pub fn record(&mut self, event: SlotEvent) -> Slot {
        self.recent_events.push_back(event);

        // Trim to capacity
        if self.recent_events.len() > RECENT_LEADER_SLOTS_CAPACITY {
            let excess = self.recent_events.len() - RECENT_LEADER_SLOTS_CAPACITY;
            self.recent_events.drain(..excess);
        }

        self.current_slot = self.estimate_current_slot();
        self.current_slot
    }

    /// Records a slot start event (first shred received).
    pub fn record_start(&mut self, slot: Slot) -> Slot {
        self.record(SlotEvent::Start(slot))
    }

    /// Records a slot end event (slot completed).
    pub fn record_end(&mut self, slot: Slot) -> Slot {
        self.record(SlotEvent::End(slot))
    }

    /// Records a slot update from a monotonic source (e.g., gRPC).
    ///
    /// Ignores out-of-order or duplicate slots and bypasses outlier filtering.
    pub fn record_monotonic(&mut self, slot: Slot) -> Slot {
        if slot <= self.current_slot {
            return self.current_slot;
        }

        self.current_slot = slot;
        self.recent_events.clear();
        self.recent_events.push_back(SlotEvent::Start(slot));
        self.current_slot
    }

    /// Estimates the current slot based on recent events.
    ///
    /// Uses a median-based approach to filter outliers:
    /// 1. Sort events by slot number
    /// 2. Find the median slot
    /// 3. Reject slots that are too far from expected current
    /// 4. Return the most recent reasonable slot
    fn estimate_current_slot(&self) -> Slot {
        if self.recent_events.is_empty() {
            return self.current_slot;
        }

        let mut sorted_events: Vec<SlotEvent> = self.recent_events.iter().copied().collect();

        // Sort by slot, with start events before end events for same slot
        sorted_events.sort_unstable_by(|a, b| {
            a.slot()
                .cmp(&b.slot())
                .then_with(|| b.is_start().cmp(&a.is_start()))
        });

        // Use median to filter out outliers (validators broadcasting far-future slots)
        let max_idx = sorted_events.len() - 1;
        let median_idx = max_idx / 2;
        let median_slot = sorted_events[median_idx].slot();
        let expected_current = median_slot + (max_idx - median_idx) as u64;
        let max_reasonable = expected_current + MAX_SLOT_SKIP_DISTANCE;

        // Find the most recent reasonable slot
        let idx = sorted_events
            .iter()
            .rposition(|e| e.slot() <= max_reasonable)
            .unwrap_or(median_idx);

        let slot_event = &sorted_events[idx];
        if slot_event.is_start() {
            slot_event.slot()
        } else {
            slot_event.slot().saturating_add(1)
        }
    }
}

impl Default for SlotsTracker {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tracker_from_slots(slots: Vec<Slot>) -> SlotsTracker {
        let mut tracker = SlotsTracker::new();
        for slot in slots {
            tracker.record_start(slot);
            tracker.record_end(slot);
        }
        tracker
    }

    #[test]
    fn test_estimate_with_sequential_slots() {
        let tracker = tracker_from_slots((1..=12).collect());
        assert_eq!(tracker.current_slot(), 13);
    }

    #[test]
    fn test_estimate_with_reverse_order() {
        let tracker = tracker_from_slots((1..=12).rev().collect());
        assert_eq!(tracker.current_slot(), 13);
    }

    #[test]
    fn test_record_updates_estimate() {
        let mut tracker = SlotsTracker::new();
        assert_eq!(tracker.record_start(13), 13);
        assert_eq!(tracker.current_slot(), 13);
        assert_eq!(tracker.record_start(14), 14);
        assert_eq!(tracker.current_slot(), 14);
    }

    #[test]
    fn test_outlier_rejection() {
        // Slot 100 is way beyond MAX_SLOT_SKIP_DISTANCE from slot 1
        let tracker = tracker_from_slots(vec![1, 100]);
        assert_eq!(tracker.current_slot(), 2);

        let tracker = tracker_from_slots(vec![1, 2, 100]);
        assert_eq!(tracker.current_slot(), 3);
    }
}

