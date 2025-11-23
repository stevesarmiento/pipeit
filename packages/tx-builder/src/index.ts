/**
 * @pipeit/tx-builder
 *
 * Type-safe transaction builder for Solana with smart defaults.
 *
 * @packageDocumentation
 */

// Main API - Opinionated builder
export { transaction, OpinionatedTransactionBuilder } from './builder/opinionated.js';
export type { TransactionBuilderConfig } from './builder/opinionated.js';

// Advanced API - Type-safe builder
export { TransactionBuilder } from './builder/core.js';
export type { BuilderState, RequiredState, BuilderConfig, LifetimeConstraint } from './types.js';

// Errors
export * from './errors/index.js';

// Validation
export * from './validation/index.js';

// Utils
export * from './utils/index.js';

// Middleware (for advanced use cases)
export * from './middleware/index.js';

// Helpers (convenience functions)
export * from './helpers.js';
