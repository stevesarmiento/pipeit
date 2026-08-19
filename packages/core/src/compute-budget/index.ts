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
    createSetComputeUnitPriceInstruction,
    estimatePriorityFee,
    getPriorityFeeFromLevel,
    calculatePriorityFeeCost,
} from './priority-fees.js';

// Compute units
export {
    DEFAULT_COMPUTE_UNIT_LIMIT,
    MAX_COMPUTE_UNIT_LIMIT,
    DEFAULT_COMPUTE_BUFFER,
    MAX_LOADED_ACCOUNTS_DATA_SIZE_LIMIT,
    createSetComputeUnitLimitInstruction,
    estimateComputeUnits,
    shouldAddComputeUnitInstruction,
    getComputeUnitLimit,
} from './compute-units.js';

// Re-export @solana-program/compute-budget helpers for convenience.
//
// NOTE: the three estimator exports below (estimateComputeUnitLimitFactory,
// fillProvisorySetComputeUnitLimitInstruction,
// estimateAndUpdateProvisoryComputeUnitLimitFactory) follow Kit v6-era naming
// and are deprecated upstream in Kit v7. Prefer the resource-limit estimators
// re-exported below; these pass-throughs are slated for removal in a future
// Pipeit minor.
export {
    getSetComputeUnitLimitInstruction,
    getSetComputeUnitPriceInstruction,
    getSetLoadedAccountsDataSizeLimitInstruction,
    estimateComputeUnitLimitFactory,
    fillProvisorySetComputeUnitLimitInstruction,
    estimateAndUpdateProvisoryComputeUnitLimitFactory,
} from '@solana-program/compute-budget';

// Re-export Kit v7's version-agnostic compute-budget APIs.
// The setters work on all transaction versions: on legacy/v0 they
// append-or-replace the corresponding compute-budget instruction; on v1 they
// write message config. The resource-limit estimators simulate to determine
// both computeUnitLimit and (for v1) loadedAccountsDataSizeLimit.
//
// Kit's setTransactionMessageComputeUnitPrice is deliberately NOT re-exported:
// it would collide with @solana-program/compute-budget's same-named export
// above. Import it directly from @solana/kit if needed.
export {
    setTransactionMessageComputeUnitLimit,
    getTransactionMessageComputeUnitLimit,
    setTransactionMessageLoadedAccountsDataSizeLimit,
    getTransactionMessageLoadedAccountsDataSizeLimit,
    estimateResourceLimitsFactory,
    estimateAndSetResourceLimitsFactory,
    fillTransactionMessageProvisoryResourceLimits,
} from '@solana/kit';
