/**
 * @pipeit/core
 *
 * Type-safe transaction builder for Solana with smart defaults.
 *
 * Features:
 * - Type-safe builder with compile-time validation
 * - Auto-blockhash fetching and durable nonce support
 * - Priority fee estimation and compute budget management
 * - Address lookup table compression
 * - Advanced sending strategies (skipPreflight, maxRetries)
 * - Multi-step transaction orchestration (Flow API)
 * - Kit instruction-plans integration
 *
 * @packageDocumentation
 */

// Main export - unified builder
export { TransactionBuilder } from './builder/builder.js';
export type { 
  TransactionBuilderConfig, 
  SimulationResult,
  ExportFormat,
  ExportedTransaction,
} from './builder/builder.js';

// Flow API - for multi-step transaction orchestration with dynamic context
export { createFlow, TransactionFlow } from './flow/index.js';
export type {
  // Shared types (used by @pipeit/actions)
  FlowRpcApi,
  FlowRpcSubscriptionsApi,
  BaseContext,
  // Flow-specific types
  FlowConfig,
  FlowContext,
  FlowHooks,
  FlowStep,
  FlowStepResult,
  StepCreator,
  ExecutionStrategy,
} from './flow/index.js';

// Plans API - Kit instruction-plans re-exports and helpers
export * from './plans/index.js';

// Re-export Kit types for convenience
export type { Base64EncodedWireTransaction } from '@solana/transactions';

// Type-safety types
export type { 
  BuilderState, 
  RequiredState, 
  BuilderConfig, 
  LifetimeConstraint,
  SendingConfig,
  ExecuteConfig,
} from './types.js';

// Errors
export * from './errors/index.js';

// Validation
export * from './validation/index.js';

// Utils
export * from './utils/index.js';

// Helpers
export * from './helpers.js';

// Signers - re-exports from Kit
export * from './signers/index.js';

// Packing - message packing utilities
export * from './packing/index.js';

// Compute Budget - priority fees and compute units
export * from './compute-budget/index.js';

// Confirmation - transaction confirmation strategies
export * from './confirmation/index.js';

// Nonce - durable nonce utilities
export * from './nonce/index.js';

// Lookup Tables - address lookup table utilities
export * from './lookup-tables/index.js';

