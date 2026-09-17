/**
 * Compute budget utilities for priority fees and compute unit management.
 *
 * @packageDocumentation
 */

// Types
export type {
    PriorityFeeStrategy,
    PriorityFeeConfig,
    ComputeUnitStrategy,
    ComputeUnitConfig,
    PriorityFeeEstimate,
    PrioritizationFeeEntry,
    ComputeUnitEstimate,
} from './types.js';

// Priority fees
export {
    COMPUTE_BUDGET_PROGRAM,
    PRIORITY_FEE_LEVELS,
    type PriorityFeeLevel,
    estimatePriorityFee,
    getPriorityFeeFromLevel,
    calculatePriorityFeeCost,
    microLamportsToPriorityFeeLamports,
} from './priority-fees.js';

// Compute units
export {
    DEFAULT_COMPUTE_UNIT_LIMIT,
    MAX_COMPUTE_UNIT_LIMIT,
    DEFAULT_COMPUTE_BUFFER,
    MAX_LOADED_ACCOUNTS_DATA_SIZE_LIMIT,
    LOADED_ACCOUNTS_DATA_SIZE_PAGE,
    roundUpToLoadedAccountsDataSizePage,
    applyBuffer,
    estimateComputeUnits,
    shouldAddComputeUnitInstruction,
    getComputeUnitLimit,
} from './compute-units.js';

// Buffered simulation-based estimation (used by TransactionBuilder and executePlan)
export { createBufferedResourceLimitsEstimator, type BufferedResourceLimitsConfig } from './resource-limits.js';

// Re-export @solana-program/compute-budget instruction builders for convenience.
// (Legacy/v0 only: on v1 the compute budget lives in the message config and
// ComputeBudget instructions are no-ops.)
export {
    getSetComputeUnitLimitInstruction,
    getSetComputeUnitPriceInstruction,
    getSetLoadedAccountsDataSizeLimitInstruction,
} from '@solana-program/compute-budget';

// Re-export Kit's version-agnostic compute-budget APIs.
// The setters work on all transaction versions: on legacy/v0 they
// append-or-replace the corresponding compute-budget instruction; on v1 they
// write message config. The resource-limit estimators simulate to determine
// both computeUnitLimit and (for v1) loadedAccountsDataSizeLimit.
//
// Kit's setTransactionMessageComputeUnitPrice (legacy/v0 only) is deliberately
// NOT re-exported: it would collide with @solana-program/compute-budget's
// same-named export above. Import it directly from @solana/kit if needed.
export {
    setTransactionMessageComputeUnitLimit,
    getTransactionMessageComputeUnitLimit,
    setTransactionMessageLoadedAccountsDataSizeLimit,
    getTransactionMessageLoadedAccountsDataSizeLimit,
    estimateResourceLimitsFactory,
    estimateAndSetResourceLimitsFactory,
    fillTransactionMessageProvisoryResourceLimits,
    // Version 1 only: total priority fee in lamports and the whole config at once
    setTransactionMessagePriorityFeeLamports,
    getTransactionMessagePriorityFeeLamports,
    setTransactionMessageConfig,
    type V1TransactionConfig,
} from '@solana/kit';
