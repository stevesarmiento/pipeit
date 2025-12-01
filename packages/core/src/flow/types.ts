/**
 * Types for the transaction flow API.
 * 
 * @packageDocumentation
 */

import type { TransactionSigner } from '@solana/signers';
import type { Instruction } from '@solana/instructions';
import type {
  Rpc,
  GetLatestBlockhashApi,
  GetAccountInfoApi,
  GetEpochInfoApi,
  GetSignatureStatusesApi,
  SendTransactionApi,
} from '@solana/rpc';
import type {
  RpcSubscriptions,
  SignatureNotificationsApi,
  SlotNotificationsApi,
} from '@solana/rpc-subscriptions';

// =============================================================================
// Shared RPC Types (used by both core and actions)
// =============================================================================

/**
 * Minimum RPC API required for transaction flows and actions.
 */
export type FlowRpcApi = GetAccountInfoApi & GetEpochInfoApi & GetSignatureStatusesApi & SendTransactionApi & GetLatestBlockhashApi;

/**
 * Minimum RPC subscriptions API required for transaction flows and actions.
 */
export type FlowRpcSubscriptionsApi = SignatureNotificationsApi & SlotNotificationsApi;

/**
 * Base context shared between Flow and Actions.
 * Contains the core dependencies needed for transaction execution.
 */
export interface BaseContext {
  /** Transaction signer. */
  signer: TransactionSigner;
  /** RPC client. */
  rpc: Rpc<FlowRpcApi>;
  /** RPC subscriptions client. */
  rpcSubscriptions: RpcSubscriptions<FlowRpcSubscriptionsApi>;
}

// =============================================================================
// Flow-Specific Types
// =============================================================================

/**
 * Result from a completed flow step.
 */
export interface FlowStepResult {
  /**
   * Transaction signature.
   */
  signature: string;
  
  /**
   * Index of the instruction within the transaction (for batched steps).
   */
  instructionIndex?: number;
}

/**
 * Context passed to each flow step.
 * Extends BaseContext with flow-specific properties for step orchestration.
 */
export interface FlowContext extends BaseContext {
  /**
   * Results from previous steps, keyed by step name.
   */
  results: Map<string, FlowStepResult>;

  /**
   * Get a previous step's result by name.
   * Convenience method for `results.get(name)`.
   * 
   * @param stepName - Name of the step to get result for
   * @returns The step result, or undefined if not found
   */
  get: (stepName: string) => FlowStepResult | undefined;
}

/**
 * Hooks for monitoring flow execution.
 */
export interface FlowHooks {
  /**
   * Called when a step starts executing.
   */
  onStepStart?: (name: string) => void;

  /**
   * Called when a step completes successfully.
   */
  onStepComplete?: (name: string, result: FlowStepResult) => void;

  /**
   * Called when a step fails.
   */
  onStepError?: (name: string, error: Error) => void;
}

/**
 * Function that creates an instruction, optionally using context from previous steps.
 */
export type StepCreator = (ctx: FlowContext) => Instruction | Promise<Instruction>;

/**
 * Internal step definition for instruction steps.
 */
export interface InstructionStep {
  type: 'instruction';
  name: string;
  create: StepCreator;
}

/**
 * Internal step definition for transaction steps (custom async operations).
 */
export interface TransactionStep {
  type: 'transaction';
  name: string;
  execute: (ctx: FlowContext) => Promise<FlowStepResult>;
}

/**
 * Internal step definition for atomic groups.
 */
export interface AtomicGroupStep {
  type: 'atomic-group';
  name: string;
  creates: StepCreator[];
}

/**
 * Union type for all step types.
 */
export type FlowStep = InstructionStep | TransactionStep | AtomicGroupStep;

/**
 * Execution strategy for the flow.
 * - `auto`: Try batching, fallback to sequential if too large
 * - `batch`: Always batch consecutive instruction steps
 * - `sequential`: Execute each step as separate transaction
 */
export type ExecutionStrategy = 'auto' | 'batch' | 'sequential';

/**
 * Configuration for creating a flow.
 * Extends BaseContext with flow-specific configuration options.
   */
export interface FlowConfig extends BaseContext {
  /**
   * Execution strategy. Defaults to 'auto'.
   */
  strategy?: ExecutionStrategy;

  /**
   * Commitment level for confirmations. Defaults to 'confirmed'.
   */
  commitment?: 'processed' | 'confirmed' | 'finalized';
}

