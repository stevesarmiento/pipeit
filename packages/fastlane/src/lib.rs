//! @pipeit/fastlane
//!
//! Native QUIC client for direct Solana TPU transaction submission.
//! Provides Node.js bindings via NAPI-RS for maximum performance.
//!
//! ## Features
//!
//! - Direct QUIC connections to validator TPU endpoints
//! - Real-time leader schedule tracking
//! - Connection pooling with 0-RTT support
//! - Pre-warming connections to upcoming leaders
//!
//! ## Usage
//!
//! ```typescript
//! import { TpuClient } from '@pipeit/fastlane';
//!
//! const client = new TpuClient({
//!   rpcUrl: 'https://api.mainnet-beta.solana.com',
//!   wsUrl: 'wss://api.mainnet-beta.solana.com',
//! });
//!
//! await client.waitReady();
//! const result = await client.sendTransaction(serializedTxBuffer);
//! ```

#![deny(clippy::all)]

mod client;
mod connection_manager;
pub mod tracker;

// Re-export main types
pub use client::{SendResult, TpuClient, TpuClientConfig};
pub use connection_manager::{DeliveryResult, TpuConnectionManager};
pub use tracker::{LeaderInfo, LeaderTracker, ScheduleTracker, SlotEvent, SlotsTracker};

