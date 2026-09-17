/**
 * Core types for transaction building.
 *
 * @packageDocumentation
 */

import type { Address } from '@solana/addresses';
import type { Instruction } from '@solana/instructions';
import type { TransactionMessage, TransactionVersion } from '@solana/transaction-messages';
import type { Rpc, GetLatestBlockhashApi } from '@solana/rpc';
import type { ExecutionConfig } from './execution/types.js';

/**
 * State tracking for transaction builder.
 * Used to ensure required fields are set before building.
 */
export interface BuilderState {
    feePayer?: boolean;
    lifetime?: boolean;
}

/**
 * Required state for a complete transaction.
 */
export type RequiredState = {
    feePayer: true;
    lifetime: true;
};

/**
 * Transaction versions Pipeit can construct.
 *
 * - `'legacy'`: original message format (1232-byte limit, no lookup tables)
 * - `0`: versioned format with address lookup table support (1232-byte limit)
 * - `1`: SIMD-0385 format (4096-byte limit, no lookup tables). Resource
 *   limits and the priority fee live in the message config rather than in
 *   ComputeBudget instructions, and the compute unit limit and loaded
 *   accounts data size limit are mandatory.
 */
export type SupportedTransactionVersion = TransactionVersion;

/**
 * Configuration for transaction builder.
 */
export interface BuilderConfig {
    /**
     * Transaction version: 0 (default), 'legacy', or 1 (SIMD-0385, up to 4096 bytes).
     */
    version?: SupportedTransactionVersion;
    /**
     * RPC client for auto-fetching blockhash when not explicitly provided.
     */
    rpc?: Rpc<GetLatestBlockhashApi>;
}

/**
 * Lifetime constraint for transaction (blockhash or nonce).
 */
export type LifetimeConstraint =
    | { type: 'blockhash'; blockhash: string; lastValidBlockHeight: bigint }
    | {
          type: 'nonce';
          nonce: string;
          nonceAccountAddress: Address;
          nonceAuthorityAddress: Address;
      };

/**
 * Result of building a transaction.
 */
export interface BuildResult {
    /**
     * The built transaction message.
     */
    message: TransactionMessage;
    /**
     * Instructions included in the transaction.
     */
    instructions: readonly Instruction[];
    /**
     * Estimated size of the transaction in bytes.
     */
    estimatedSize?: number;
}

/**
 * Configuration for transaction sending behavior.
 */
export interface SendingConfig {
    /**
     * Skip preflight simulation before sending.
     * Setting this to `true` can speed up transactions but may result
     * in failed transactions consuming fees.
     * @default false
     */
    skipPreflight?: boolean;

    /**
     * Skip preflight on retry attempts.
     * Useful when the first attempt has already validated the transaction.
     * @default true
     */
    skipPreflightOnRetry?: boolean;

    /**
     * Maximum number of times the RPC node should retry sending.
     * This is separate from client-side retries.
     * @default undefined (use RPC default)
     */
    maxRetries?: number;

    /**
     * Commitment level for preflight simulation.
     * Only applies when skipPreflight is false.
     * @default 'confirmed'
     */
    preflightCommitment?: 'processed' | 'confirmed' | 'finalized';

    /**
     * Minimum context slot for preflight simulation.
     * Ensures the RPC node has processed transactions up to this slot.
     */
    minContextSlot?: bigint;
}

/**
 * Configuration for transaction execution with all options.
 */
export interface ExecuteConfig extends SendingConfig {
    /**
     * Commitment level for confirmation.
     * @default 'confirmed'
     */
    commitment?: 'processed' | 'confirmed' | 'finalized';

    /**
     * Confirmation strategy.
     * - 'auto': Automatically select based on transaction lifetime
     * - 'blockheight': Race against block height expiration
     * - 'timeout': Race against a timeout
     * @default 'auto'
     */
    confirmationStrategy?: 'auto' | 'blockheight' | 'timeout';

    /**
     * Timeout in milliseconds for 'timeout' confirmation strategy.
     * @default 60000
     */
    confirmationTimeout?: number;

    /**
     * Abort signal to cancel the operation.
     */
    abortSignal?: AbortSignal;

    /**
     * Execution strategy for transaction submission.
     * Controls how the transaction is sent to the network.
     *
     * Presets:
     * - 'standard': Default RPC submission only (no Jito, no parallel)
     * - 'economical': Jito bundle only (good balance of speed and cost)
     * - 'fast': Jito + parallel RPC race (maximum landing probability)
     *
     * Or provide an object for fine-grained control over Jito and parallel settings.
     *
     * @default 'standard'
     *
     * @example
     * ```ts
     * // Use a preset
     * await builder.execute({ rpcSubscriptions, execution: 'fast' });
     *
     * // Fine-grained control
     * await builder.execute({
     *   rpcSubscriptions,
     *   execution: {
     *     jito: { enabled: true, tipLamports: 50_000n },
     *     parallel: { enabled: true, endpoints: ['https://my-rpc.com'] },
     *   },
     * });
     * ```
     */
    execution?: ExecutionConfig;
}
