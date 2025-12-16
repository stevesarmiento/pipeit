//! Leader tracking module for TPU transaction routing.
//!
//! This module provides real-time tracking of:
//! - Current slot via WebSocket subscriptions
//! - Leader schedule per epoch
//! - Validator TPU socket addresses
//!
//! The components work together to determine which validators should
//! receive transactions at any given moment.

mod leader_tracker;
mod schedule_tracker;
mod slots_tracker;

pub use leader_tracker::{LeaderInfo, LeaderTracker};
pub use schedule_tracker::ScheduleTracker;
pub use slots_tracker::{SlotEvent, SlotsTracker};

/// Type alias for slot numbers.
pub type Slot = u64;

/// Maximum number of slots to skip before considering a slot invalid.
pub const MAX_SLOT_SKIP_DISTANCE: u64 = 48;

/// Capacity for tracking recent leader slots.
pub const RECENT_LEADER_SLOTS_CAPACITY: usize = 48;

