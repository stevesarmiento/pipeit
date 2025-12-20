/**
 * Error types and utilities for transaction building.
 *
 * @packageDocumentation
 */

// Pipeit-specific errors
export * from './errors.js';
export * from './predicates.js';
export * from './messages.js';

// TPU-specific errors
export * from './tpu-errors.js';

// Kit errors (re-exported for convenience)
export * from './kit-errors.js';

// Program error identification
export * from './programs.js';

// Error diagnostics - detailed human-readable error info
export * from './diagnostics.js';
