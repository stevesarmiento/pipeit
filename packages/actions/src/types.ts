/**
 * Core types for @pipeit/actions
 * 
 * Design principles:
 * - Protocol-agnostic interfaces
 * - Pluggable adapters
 * - Type-safe composition
 * 
 * @packageDocumentation
 */

import type { Address } from '@solana/addresses';
import type { Instruction } from '@solana/instructions';
import type {
  FlowRpcApi,
  FlowRpcSubscriptionsApi,
  BaseContext,
  PriorityFeeLevel,
  PriorityFeeConfig,
} from '@pipeit/core';

// Re-export core types for convenience
export type { PriorityFeeLevel, PriorityFeeConfig } from '@pipeit/core';

// =============================================================================
// Re-export shared types from core with action-specific aliases
// =============================================================================

/**
 * Minimum RPC API required for actions.
 * Re-exported from core for convenience.
 */
export type ActionsRpcApi = FlowRpcApi;

/**
 * Minimum RPC subscriptions API required for actions.
 * Re-exported from core for convenience.
 */
export type ActionsRpcSubscriptionsApi = FlowRpcSubscriptionsApi;

// =============================================================================
// Core Action Types
// =============================================================================

/**
 * Context passed to all actions during execution.
 * Contains the RPC clients and signer needed to build instructions.
 * Extends BaseContext from core.
 */
export interface ActionContext extends BaseContext {}

/**
 * Result returned by an action.
 * Contains the instructions to execute and optional metadata.
 */
export interface ActionResult {
  /** Instructions to include in the transaction */
  instructions: Instruction[];
  /** Suggested compute units for this action (optional hint) */
  computeUnits?: number;
  /** Address lookup table addresses used by the instructions */
  addressLookupTableAddresses?: string[];
  /** Any additional data returned by the action */
  data?: Record<string, unknown>;
}

/**
 * An action executor - a function that takes context and returns instructions.
 */
export type ActionExecutor = (ctx: ActionContext) => Promise<ActionResult>;

/**
 * An action factory - creates an executor from parameters.
 * 
 * @example
 * ```ts
 * const swapAction: ActionFactory<SwapParams> = (params) => async (ctx) => {
 *   // Build instructions based on params and ctx
 *   return { instructions: [...] }
 * }
 * ```
 */
export type ActionFactory<TParams> = (params: TParams) => ActionExecutor;

// =============================================================================
// Swap Types (Protocol-Agnostic)
// =============================================================================

/**
 * Parameters for a token swap action.
 * Protocol-agnostic - works with any swap adapter.
 */
export interface SwapParams {
  /** Token mint to swap from */
  inputMint: Address | string;
  /** Token mint to swap to */
  outputMint: Address | string;
  /** Amount to swap (in smallest units, e.g., lamports for SOL) */
  amount: bigint | number;
  /** Slippage tolerance in basis points (default: 50 = 0.5%) */
  slippageBps?: number;
}

/**
 * Extended result for swap actions with quote information.
 */
export interface SwapResult extends ActionResult {
  data: {
    /** Input amount in smallest units */
    inputAmount: bigint;
    /** Expected output amount in smallest units */
    outputAmount: bigint;
    /** Price impact percentage (optional) */
    priceImpactPct?: number;
    /** Route information (adapter-specific) */
    route?: unknown;
  };
}

/**
 * Adapter interface for swap operations.
 * Implement this to create a custom swap adapter.
 * 
 * @example
 * ```ts
 * const mySwapAdapter: SwapAdapter = {
 *   swap: (params) => async (ctx) => {
 *     // Call your preferred DEX API
 *     return { instructions: [...], data: { inputAmount, outputAmount } }
 *   }
 * }
 * ```
 */
export interface SwapAdapter {
  /** Create a swap action from parameters */
  swap: ActionFactory<SwapParams>;
}

// =============================================================================
// Pipe Configuration
// =============================================================================

/**
 * Configuration for creating a pipe.
 * Extends BaseContext from core with action-specific configuration.
 */
export interface PipeConfig extends BaseContext {
  /** Configured adapters for different action types */
  adapters?: {
    /** Swap adapter (e.g., Jupiter, Raydium API) */
    swap?: SwapAdapter;
  };
  
  /**
   * Priority fee configuration.
   * - PriorityFeeLevel string: Use preset level ('none', 'low', 'medium', 'high', 'veryHigh')
   * - PriorityFeeConfig object: Use custom configuration with strategy
   * @default 'medium'
   */
  priorityFee?: PriorityFeeLevel | PriorityFeeConfig;
  
  /**
   * Compute unit configuration.
   * - 'auto': Use default (no explicit instruction)
   * - number: Use fixed compute unit limit
   * @default 'auto'
   */
  computeUnits?: 'auto' | number;
  
  /**
   * Auto-retry failed transactions.
   * - true: Use default retry (3 attempts, exponential backoff)
   * - false: No retry
   * - Object: Custom retry configuration
   * @default { maxAttempts: 3, backoff: 'exponential' }
   */
  autoRetry?: boolean | { maxAttempts: number; backoff: 'linear' | 'exponential' };
  
  /**
   * Logging level for transaction building.
   * @default 'minimal'
   */
  logLevel?: 'silent' | 'minimal' | 'verbose';
}

/**
 * Options for executing a pipe.
 */
export interface ExecuteOptions {
  /** 
   * Commitment level for transaction confirmation.
   * @default 'confirmed'
   */
  commitment?: 'processed' | 'confirmed' | 'finalized';
  /**
   * Optional abort signal to cancel execution.
   * When aborted, the execution will stop and throw an error.
   */
  abortSignal?: AbortSignal;
}

/**
 * Hooks for monitoring pipe execution progress.
 */
export interface PipeHooks {
  /** Called when an action starts executing (building instructions) */
  onActionStart?: (index: number) => void;
  /** Called when an action completes successfully (instructions built) */
  onActionComplete?: (index: number, result: ActionResult) => void;
  /** Called when an action fails */
  onActionError?: (index: number, error: Error) => void;
}

/**
 * Result from executing a pipe.
 */
export interface PipeResult {
  /** Transaction signature */
  signature: string;
  /** Results from each action in the pipe */
  actionResults: ActionResult[];
}
