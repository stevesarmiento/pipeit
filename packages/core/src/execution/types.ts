/**
 * Types for execution strategies.
 *
 * @packageDocumentation
 */

import type { Address } from '@solana/addresses';
import type { Rpc, SendTransactionApi } from '@solana/rpc';
import type { RpcSubscriptions, SignatureNotificationsApi, SlotNotificationsApi } from '@solana/rpc-subscriptions';
import type { TpuSubmissionDetails } from '../errors/tpu-errors.js';

/**
 * Jito block engine regional endpoints.
 */
export type JitoBlockEngineRegion = 'mainnet' | 'ny' | 'amsterdam' | 'frankfurt' | 'tokyo' | 'singapore' | 'slc';

/**
 * Configuration for Jito bundle submission.
 */
export interface JitoConfig {
    /**
     * Whether Jito bundle submission is enabled.
     */
    enabled: boolean;

    /**
     * Tip amount in lamports to include in the bundle.
     * Higher tips increase priority in the Jito auction.
     * @default 10_000n (0.00001 SOL)
     */
    tipLamports?: bigint;

    /**
     * Jito block engine URL.
     * Can be a full URL or a region key.
     * @default 'mainnet' (load-balanced)
     */
    blockEngineUrl?: string | JitoBlockEngineRegion;

    /**
     * Whether to use MEV protection (delays submission to risky leaders).
     * @default true
     */
    mevProtection?: boolean;
}

/**
 * Configuration for parallel RPC submission.
 */
export interface ParallelConfig {
    /**
     * Whether parallel submission is enabled.
     */
    enabled: boolean;

    /**
     * Additional RPC endpoint URLs to submit to in parallel.
     * These are used alongside the builder's configured RPC.
     */
    endpoints?: string[];

    /**
     * Whether to include the builder's default RPC in the parallel race.
     * @default true
     */
    raceWithDefault?: boolean;
}

/**
 * Configuration for direct TPU submission.
 *
 * TPU (Transaction Processing Unit) submission bypasses RPC nodes
 * and sends transactions directly to validator QUIC endpoints.
 * This provides lower latency and higher landing probability.
 *
 * Requires the `@pipeit/fastlane` package and a server-side
 * API route for browser environments.
 */
export interface TpuConfig {
    /**
     * Whether TPU submission is enabled.
     */
    enabled: boolean;

    /**
     * RPC URL for fetching leader schedule and cluster info.
     * If not provided, uses the builder's configured RPC URL.
     */
    rpcUrl?: string;

    /**
     * WebSocket URL for slot update subscriptions.
     * If not provided, derived from rpcUrl by replacing http(s) with ws(s).
     */
    wsUrl?: string;

    /**
     * Number of upcoming leaders to send transactions to.
     * Higher values increase landing probability but use more resources.
     * @default 2
     */
    fanout?: number;

    /**
     * API route URL for browser environments.
     * When running in the browser, transactions are sent to this
     * endpoint which forwards them via the native TPU client.
     * @default '/api/tpu'
     */
    apiRoute?: string;
}

/**
 * Execution strategy presets.
 * - 'standard': Default RPC submission only (no Jito, no parallel, no TPU)
 * - 'economical': Jito bundle only (good balance of speed and cost)
 * - 'fast': Jito + parallel RPC race (maximum landing probability)
 * - 'ultra': Direct TPU + Jito race (fastest possible, requires @pipeit/fastlane)
 */
export type ExecutionPreset = 'standard' | 'economical' | 'fast' | 'ultra';

/**
 * Full execution configuration.
 * Can be a preset string or detailed configuration object.
 */
export type ExecutionConfig =
    | ExecutionPreset
    | {
          jito?: JitoConfig;
          parallel?: ParallelConfig;
          tpu?: TpuConfig;
      };

/**
 * Resolved execution configuration with all values filled in.
 */
export interface ResolvedExecutionConfig {
    jito: {
        enabled: boolean;
        tipLamports: bigint;
        blockEngineUrl: string;
        mevProtection: boolean;
    };
    parallel: {
        enabled: boolean;
        endpoints: string[];
        raceWithDefault: boolean;
    };
    tpu: {
        enabled: boolean;
        rpcUrl: string;
        wsUrl: string;
        fanout: number;
        apiRoute: string;
    };
}

/**
 * Context required for execution strategies.
 */
export interface ExecutionContext {
    /**
     * RPC client for standard transaction submission.
     */
    rpc?: Rpc<SendTransactionApi>;

    /**
     * RPC subscriptions for confirmation.
     */
    rpcSubscriptions?: RpcSubscriptions<SignatureNotificationsApi & SlotNotificationsApi>;

    /**
     * Fee payer address (needed for tip instruction).
     */
    feePayer?: Address;

    /**
     * Abort signal for cancellation.
     */
    abortSignal?: AbortSignal;
}

/**
 * Result from execution strategy.
 */
export interface ExecutionResult {
    /**
     * Transaction signature.
     */
    signature: string;

    /**
     * Which execution path landed the transaction.
     */
    landedVia: 'jito' | 'rpc' | 'parallel' | 'tpu';

    /**
     * Time from submission to confirmation in milliseconds.
     */
    latencyMs?: number;

    /**
     * Bundle ID if submitted via Jito.
     */
    bundleId?: string;

    /**
     * Which endpoint landed the transaction (for parallel).
     */
    endpoint?: string;

    /**
     * Number of leaders the transaction was sent to (for TPU).
     */
    leaderCount?: number;

    /**
     * Whether the transaction was confirmed on-chain.
     * For TPU submissions with continuous resubmission, this is set by the server.
     */
    confirmed?: boolean;

    /**
     * Number of send rounds for TPU continuous submission.
     */
    rounds?: number;

    /**
     * Enhanced TPU submission details with per-leader breakdown.
     * Only present when transaction was submitted via TPU.
     */
    tpuDetails?: TpuSubmissionDetails;
}

/**
 * Execution result with explicit confirmation status.
 *
 * This type is useful when the transaction was delivered but confirmation
 * could not be verified within the timeout window. The transaction likely
 * landed but should be verified on an explorer.
 */
export interface ExecutionResultWithStatus {
    /**
     * Transaction signature (base58 encoded).
     */
    signature: string;

    /**
     * Confirmation status of the transaction.
     * - 'confirmed': Transaction was confirmed on-chain
     * - 'pending': Transaction was delivered but confirmation timed out (likely landed)
     * - 'failed': Transaction execution failed
     */
    status: 'confirmed' | 'pending' | 'failed';

    /**
     * Which execution path was used.
     */
    landedVia: 'tpu' | 'jito' | 'rpc' | 'parallel';

    /**
     * Time from submission to result in milliseconds.
     */
    latencyMs?: number;

    /**
     * Error message if status is 'failed'.
     */
    error?: string;
}

// ============================================================================
// Jito API Types
// ============================================================================

/**
 * Jito sendBundle JSON-RPC response.
 */
export interface JitoBundleResponse {
    jsonrpc: '2.0';
    id: number;
    result?: string; // bundle_id (SHA-256 hash of signatures)
    error?: {
        code: number;
        message: string;
    };
}

/**
 * Jito getBundleStatuses response.
 */
export interface JitoBundleStatusResponse {
    jsonrpc: '2.0';
    id: number;
    result?: {
        context: {
            slot: number;
        };
        value: Array<{
            bundle_id: string;
            transactions: string[];
            slot: number;
            confirmation_status: 'processed' | 'confirmed' | 'finalized';
            err: { Ok: null } | { Err: unknown };
        } | null>;
    };
    error?: {
        code: number;
        message: string;
    };
}

/**
 * Jito getTipAccounts response.
 */
export interface JitoTipAccountsResponse {
    jsonrpc: '2.0';
    id: number;
    result?: string[];
    error?: {
        code: number;
        message: string;
    };
}

// ============================================================================
// Parallel Submission Types
// ============================================================================

/**
 * Options for parallel submission.
 */
export interface ParallelSubmitOptions {
    /**
     * RPC endpoint URLs to submit to.
     */
    endpoints: string[];

    /**
     * Base64-encoded signed transaction.
     */
    transaction: string;

    /**
     * Whether to skip preflight simulation.
     * @default true
     */
    skipPreflight?: boolean;

    /**
     * Abort signal for cancellation.
     */
    abortSignal?: AbortSignal;
}

/**
 * Result from parallel submission.
 */
export interface ParallelSubmitResult {
    /**
     * Transaction signature.
     */
    signature: string;

    /**
     * Which endpoint successfully submitted the transaction.
     */
    endpoint: string;

    /**
     * Time from submission to response in milliseconds.
     */
    latencyMs: number;
}
