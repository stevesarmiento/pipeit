/**
 * Types for compute budget and priority fee configuration.
 *
 * @packageDocumentation
 */

import type { Address } from '@solana/addresses';
import type { Instruction } from '@solana/instructions';
import type { TransactionVersion } from '@solana/transaction-messages';

/**
 * Priority fee strategy options.
 */
export type PriorityFeeStrategy = 'fixed' | 'percentile' | 'none' | 'custom';

/**
 * Context handed to a `'custom'` priority fee resolver by
 * `TransactionBuilder.build()`. Everything a provider-specific fee API
 * (Helius `getPriorityFeeEstimate`, Triton, QuickNode, your own model) needs
 * is here, so the resolver stays free of builder internals.
 */
export interface PriorityFeeContext {
    /** Transaction version being built. */
    version: TransactionVersion;
    /** Fee payer of the transaction. */
    feePayer: Address;
    /**
     * The transaction's instructions after ComputeBudget normalization, i.e.
     * with any caller-supplied ComputeBudget instructions removed.
     */
    instructions: readonly Instruction[];
    /**
     * Writable accounts of the transaction: the fee payer followed by every
     * account an instruction marks writable, de-duplicated in order of first
     * appearance. Suitable for account-based estimators such as
     * `getRecentPrioritizationFees`.
     */
    writableAccounts: readonly Address[];
    /**
     * The compute unit limit the transaction will carry, when it is already
     * known. On version 1 the resolver runs after the limit is settled (by
     * config, caller instruction or simulation), so this is always a number.
     * On legacy/v0 it is the configured or caller-supplied limit, or `null`
     * for `'auto'` and `'simulate'`, which emit no limit at build time.
     */
    computeUnitLimit: number | null;
    /**
     * Compile the draft transaction (unsigned, base64 wire format) with the
     * budget instructions omitted, for transaction-based estimators. Lazy: it
     * compiles only when called, and it never simulates.
     */
    draftTransactionBase64: () => string;
}

/**
 * Resolver for the `'custom'` priority fee strategy. Returns the price in
 * micro-lamports per compute unit. Errors propagate out of `build()`; the
 * builder never falls back to a preset.
 */
export type PriorityFeeResolver = (context: PriorityFeeContext) => Promise<bigint>;

/**
 * Configuration for priority fees.
 */
export interface PriorityFeeConfig {
    /**
     * Strategy for determining priority fee.
     * - 'fixed': Use a fixed micro-lamports value
     * - 'percentile': Use recent fee data at specified percentile
     * - 'none': No priority fee
     * - 'custom': Call `resolve` with a {@link PriorityFeeContext}
     */
    strategy: PriorityFeeStrategy;

    /**
     * Fixed micro-lamports per compute unit (for 'fixed' strategy).
     *
     * On version 1 transactions this is converted into a total fee using the
     * final compute unit limit: `lamports = ceil(limit × microLamports / 1e6)`.
     */
    microLamports?: number | bigint;

    /**
     * Absolute total priority fee in lamports (for 'fixed' strategy).
     *
     * Version 1 transactions only: v1 expresses the priority fee as a total in
     * lamports rather than a per-compute-unit price. When set, it overrides the
     * per-CU conversion. Throws if used with legacy or version 0 transactions.
     */
    lamports?: bigint;

    /**
     * Percentile of recent fees to use (for 'percentile' strategy).
     * Range: 0-100. Higher = more aggressive fee.
     * @default 50
     */
    percentile?: number;

    /**
     * Accounts to check for recent prioritization fees (for 'percentile' strategy).
     * If not provided, uses global recent fees.
     */
    lockedWritableAccounts?: Address[];

    /**
     * Resolver for the 'custom' strategy. Required when `strategy` is
     * `'custom'`; the builder throws at construction time if it is missing.
     */
    resolve?: PriorityFeeResolver;

    /**
     * Prefer a caller-supplied SetComputeUnitPrice instruction over this
     * configuration. When `true` and the added instructions carry a
     * well-formed SetComputeUnitPrice, its price is used and the configured
     * strategy is not consulted; otherwise the strategy resolves as usual.
     * Lets a wallet say "use the route's price if it has one, else mine".
     * @default false (explicit config wins over the instruction)
     */
    preferInstruction?: boolean;

    /**
     * Hard cap on the total priority fee in lamports, applied after the price
     * and the final compute unit limit are known.
     *
     * - Version 1: the total `priorityFeeLamports` is clamped to this value.
     * - Legacy/v0: the per-CU price is reduced to
     *   `floor(maxLamports × 1e6 / computeUnitLimit)`. When no limit
     *   instruction is emitted (`'auto'`, `'simulate'`), the runtime's
     *   worst-case bound `min(200,000 × instruction count, 1,400,000)` is used.
     *
     * A price clamped to zero emits no price instruction, like `'none'`.
     * Clamps are logged when `logLevel` is not `'silent'`.
     */
    maxLamports?: bigint;
}

/**
 * Compute unit strategy options.
 */
export type ComputeUnitStrategy = 'fixed' | 'simulate' | 'auto';

/**
 * Configuration for compute units.
 */
export interface ComputeUnitConfig {
    /**
     * Strategy for determining compute unit limit.
     * - 'fixed': Use a fixed unit limit
     * - 'simulate': Use simulation to determine units + buffer
     * - 'auto': Default limit (no explicit instruction)
     */
    strategy: ComputeUnitStrategy;

    /**
     * Fixed compute unit limit (for 'fixed' strategy).
     */
    units?: number;

    /**
     * Buffer multiplier for 'simulate' strategy.
     * Applied to simulated units consumed.
     * @default 1.1 (10% buffer)
     */
    buffer?: number;

    /**
     * Prefer a caller-supplied SetComputeUnitLimit instruction over this
     * configuration. When `true` and the added instructions carry a
     * well-formed SetComputeUnitLimit, its limit is used and the configured
     * strategy is not consulted.
     * @default false (explicit config wins over the instruction)
     */
    preferInstruction?: boolean;
}

/**
 * Where a resolved budget value came from.
 */
export interface ResolvedBudgetSource {
    /**
     * - 'instruction': a caller-supplied SetComputeUnitPrice was used
     * - 'config': the configured level or strategy was used
     * - 'clamped': the value was reduced to honour `maxLamports`
     */
    priorityFee: 'instruction' | 'config' | 'clamped';
    /**
     * - 'instruction': a caller-supplied SetComputeUnitLimit was used
     * - 'config': a fixed limit from config was used
     * - 'simulated': the limit is (v1) or will be (legacy/v0 `'simulate'`,
     *   during `execute()`/`export()`) estimated by simulation
     * - 'default': no limit instruction is emitted; the runtime default applies
     */
    computeUnits: 'instruction' | 'config' | 'simulated' | 'default';
}

/**
 * The compute budget `TransactionBuilder.build()` resolved for a message.
 * Returned by `buildWithBudget()` so a wallet can display the fee and reserve
 * it (for example in send-all amounts) without decoding the message.
 */
export interface ResolvedBudget {
    /** Transaction version. */
    version: TransactionVersion;
    /**
     * Compute unit limit carried by the message, or `null` when legacy/v0
     * emitted no limit instruction (`'auto'`, or `'simulate'` whose limit is
     * estimated later during `execute()`/`export()`).
     */
    computeUnitLimit: number | null;
    /** Per-CU price in micro-lamports; `0n` when none. */
    computeUnitPriceMicroLamports: bigint;
    /**
     * Total priority fee in lamports: the value encoded in the v1 config, or
     * `price × limit` on legacy/v0. When legacy/v0 carries no limit, this is
     * the worst case `price × min(200,000 × instruction count, 1,400,000)`,
     * so reserving it never under-reserves.
     */
    priorityFeeLamports: bigint;
    /** Loaded accounts data size limit in bytes, or `null` when not set. */
    loadedAccountsDataSizeLimit: number | null;
    /** Requested heap frame in bytes, or `null` when not set. */
    heapSize: number | null;
    /** Attribution of the price and limit. */
    source: ResolvedBudgetSource;
}

/**
 * Result from priority fee estimation.
 */
export interface PriorityFeeEstimate {
    /**
     * Estimated micro-lamports per compute unit.
     */
    microLamports: number;

    /**
     * Percentile used for estimation.
     */
    percentile: number;

    /**
     * Raw fee data from RPC.
     */
    recentFees: PrioritizationFeeEntry[];
}

/**
 * Entry from getRecentPrioritizationFees RPC response.
 */
export interface PrioritizationFeeEntry {
    /**
     * Slot number.
     */
    slot: bigint;

    /**
     * Prioritization fee in micro-lamports.
     */
    prioritizationFee: bigint;
}

/**
 * Result from compute unit estimation.
 */
export interface ComputeUnitEstimate {
    /**
     * Estimated compute units.
     */
    units: number;

    /**
     * Units consumed in simulation (before buffer).
     */
    simulatedUnits?: bigint;

    /**
     * Buffer applied.
     */
    buffer: number;
}
