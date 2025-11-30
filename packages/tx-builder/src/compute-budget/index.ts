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
  createSetComputeUnitLimitInstruction,
  estimateComputeUnits,
  shouldAddComputeUnitInstruction,
  getComputeUnitLimit,
} from './compute-units.js';
