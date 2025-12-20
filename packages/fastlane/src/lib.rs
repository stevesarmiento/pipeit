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
//! - Per-leader send results with error classification
//! - Internal retry with exponential backoff
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
//! // result.leaders contains per-validator send status
//! ```

#![deny(clippy::all)]

mod client;
mod connection_manager;
mod errors;
pub mod tracker;

// Re-export main types
pub use client::{LeaderSendResult, SendResult, TpuClient, TpuClientConfig, TpuClientStats};
pub use connection_manager::{DeliveryResult, LeaderDeliveryResult, TpuConnectionManager};
pub use errors::TpuErrorCode;
pub use tracker::{LeaderInfo, LeaderTracker, ScheduleTracker, SlotEvent, SlotsTracker};

