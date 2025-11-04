/**
 * Preset configurations for common transaction patterns.
 *
 * @packageDocumentation
 */

import type { PriorityFeeLevel } from './simple-builder.js';

/**
 * Compute unit limit presets.
 */
export const COMPUTE_UNIT_LIMITS = {
  /**
   * Minimum compute units (very simple transactions).
   */
  min: 200_000,
  /**
   * Default compute units (most transactions).
   */
  default: 200_000,
  /**
   * High compute units (complex transactions).
   */
  high: 1_400_000,
  /**
   * Maximum compute units.
   */
  max: 1_400_000,
} as const;

/**
 * Priority fee presets in micro-lamports.
 */
export const PRIORITY_FEES: Record<PriorityFeeLevel, bigint> = {
  low: 1_000n,
  medium: 5_000n,
  high: 10_000n,
  veryHigh: 50_000n,
};

/**
 * Get priority fee for a given level.
 */
export function getPriorityFee(level: PriorityFeeLevel): bigint {
  return PRIORITY_FEES[level];
}

/**
 * Get compute unit limit for a given preset.
 */
export function getComputeUnitLimit(
  preset: keyof typeof COMPUTE_UNIT_LIMITS
): number {
  return COMPUTE_UNIT_LIMITS[preset];
}








