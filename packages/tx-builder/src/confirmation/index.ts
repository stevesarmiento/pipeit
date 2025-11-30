/**
 * Transaction confirmation strategies for robust transaction handling.
 *
 * @packageDocumentation
 */

// Types
export type {
  ConfirmationStrategy,
  ConfirmationConfig,
  ConfirmationResult,
  WaitForConfirmationOptions,
} from './types.js';

// Strategies
export {
  DEFAULT_CONFIRMATION_TIMEOUT,
  type ConfirmationRpc,
  type ConfirmationRpcSubscriptions,
  BlockHeightExceededError,
  ConfirmationTimeoutError,
  confirmWithBlockheight,
  confirmWithTimeout,
  confirmTransaction,
} from './strategies.js';
