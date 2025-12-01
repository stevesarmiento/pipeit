/**
 * @pipeit/actions - High-level DeFi actions for Solana.
 * 
 * A simple, composable API for building DeFi transactions on Solana.
 * Uses pluggable adapters to avoid vendor lock-in.
 * 
 * @example
 * ```ts
 * import { pipe } from '@pipeit/actions'
 * import { jupiter } from '@pipeit/actions/adapters'
 * import { SOL, USDC } from '@pipeit/actions/tokens'
 * 
 * // Swap SOL for USDC using Jupiter
 * const result = await pipe({
 *   rpc,
 *   rpcSubscriptions,
 *   signer,
 *   adapters: { swap: jupiter() }
 * })
 *   .swap({ inputMint: SOL, outputMint: USDC, amount: 10_000_000n })
 *   .execute()
 * 
 * console.log('Transaction:', result.signature)
 * ```
 * 
 * @packageDocumentation
 */

// Core API
export { pipe, Pipe } from './pipe.js';

// Errors
export {
  NoActionsError,
  NoAdapterError,
  ActionExecutionError,
  isNoActionsError,
  isNoAdapterError,
  isActionExecutionError,
} from './errors.js';

// Types
export type {
  ActionContext,
  ActionExecutor,
  ActionFactory,
  ActionResult,
  ActionsRpcApi,
  ActionsRpcSubscriptionsApi,
  ExecuteOptions,
  PipeConfig,
  PipeHooks,
  PipeResult,
  SwapAdapter,
  SwapParams,
  SwapResult,
  // Re-exported from core for convenience
  PriorityFeeLevel,
  PriorityFeeConfig,
} from './types.js';
