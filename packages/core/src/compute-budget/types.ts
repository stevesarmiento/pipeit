/**
 * Types for compute budget and priority fee configuration.
 *
 * @packageDocumentation
 */

import type { Address } from '@solana/addresses';

/**
 * Priority fee strategy options.
 */
export type PriorityFeeStrategy = 'fixed' | 'percentile' | 'none';

/**
 * Configuration for priority fees.
 */
export interface PriorityFeeConfig {
  /**
   * Strategy for determining priority fee.
   * - 'fixed': Use a fixed micro-lamports value
   * - 'percentile': Use recent fee data at specified percentile
   * - 'none': No priority fee
   */
  strategy: PriorityFeeStrategy;

  /**
   * Fixed micro-lamports per compute unit (for 'fixed' strategy).
   */
  microLamports?: number;

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
