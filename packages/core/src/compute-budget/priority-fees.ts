/**
 * Priority fee estimation and instruction creation.
 *
 * @packageDocumentation
 */

import type { Address } from '@solana/addresses';
import type { Instruction } from '@solana/instructions';
import type { Rpc } from '@solana/rpc';
import { address } from '@solana/addresses';
import type {
  PriorityFeeConfig,
  PriorityFeeEstimate,
  PrioritizationFeeEntry,
} from './types.js';

/**
 * Compute Budget program address.
 */
export const COMPUTE_BUDGET_PROGRAM = address('ComputeBudget111111111111111111111111111111');

/**
 * Predefined priority fee levels in micro-lamports per compute unit.
 */
export const PRIORITY_FEE_LEVELS = {
  none: 0,
  low: 1_000,        // 0.001 lamports per CU
  medium: 10_000,    // 0.01 lamports per CU
  high: 50_000,      // 0.05 lamports per CU
  veryHigh: 100_000, // 0.1 lamports per CU
} as const;

export type PriorityFeeLevel = keyof typeof PRIORITY_FEE_LEVELS;

/**
 * RPC API for getting recent prioritization fees.
 */
interface GetRecentPrioritizationFeesApi {
  getRecentPrioritizationFees(
    addresses?: Address[]
  ): {
    slot: bigint;
    prioritizationFee: bigint;
  }[];
}

/**
 * Create SetComputeUnitPrice instruction.
 * Sets the priority fee in micro-lamports per compute unit.
 *
 * @param microLamports - Fee in micro-lamports per compute unit
 * @returns Instruction to set compute unit price
 *
 * @example
 * ```ts
 * const ix = createSetComputeUnitPriceInstruction(10_000);
 * // Sets priority fee to 0.01 lamports per CU
 * ```
 */
export function createSetComputeUnitPriceInstruction(microLamports: number): Instruction {
  // Instruction data: [3, microLamports as u64 LE]
  const data = new Uint8Array(9);
  data[0] = 3; // SetComputeUnitPrice discriminator
  new DataView(data.buffer).setBigUint64(1, BigInt(microLamports), true);

  return {
    programAddress: COMPUTE_BUDGET_PROGRAM,
    accounts: [],
    data,
  };
}

/**
 * Estimate priority fee based on recent network activity.
 *
 * @param rpc - RPC client with getRecentPrioritizationFees support
 * @param config - Priority fee configuration
 * @returns Estimated priority fee
 *
 * @example
 * ```ts
 * const estimate = await estimatePriorityFee(rpc, {
 *   strategy: 'percentile',
 *   percentile: 75,
 * });
 * console.log(`Recommended fee: ${estimate.microLamports} micro-lamports/CU`);
 * ```
 */
export async function estimatePriorityFee(
  rpc: Rpc<GetRecentPrioritizationFeesApi>,
  config: PriorityFeeConfig
): Promise<PriorityFeeEstimate> {
  const { strategy, percentile = 50, microLamports, lockedWritableAccounts } = config;

  // For fixed strategy, just return the configured value
  if (strategy === 'fixed') {
    return {
      microLamports: microLamports ?? 0,
      percentile: 0,
      recentFees: [],
    };
  }

  // For 'none' strategy, return 0
  if (strategy === 'none') {
    return {
      microLamports: 0,
      percentile: 0,
      recentFees: [],
    };
  }

  // For percentile strategy, fetch recent fees
  const recentFees = await rpc
    .getRecentPrioritizationFees(lockedWritableAccounts)
    .send();

  if (!recentFees || recentFees.length === 0) {
    // No recent fee data, use a sensible default
    return {
      microLamports: PRIORITY_FEE_LEVELS.low,
      percentile,
      recentFees: [],
    };
  }

  // Calculate percentile
  const fees = recentFees
    .map((entry) => Number(entry.prioritizationFee))
    .filter((fee) => fee > 0)
    .sort((a, b) => a - b);

  if (fees.length === 0) {
    return {
      microLamports: PRIORITY_FEE_LEVELS.low,
      percentile,
      recentFees: recentFees as PrioritizationFeeEntry[],
    };
  }

  // Calculate the percentile value
  const index = Math.ceil((percentile / 100) * fees.length) - 1;
  const clampedIndex = Math.max(0, Math.min(index, fees.length - 1));
  const estimatedFee = fees[clampedIndex];

  return {
    microLamports: estimatedFee,
    percentile,
    recentFees: recentFees as PrioritizationFeeEntry[],
  };
}

/**
 * Get priority fee from a level name.
 *
 * @param level - Priority fee level
 * @returns Micro-lamports per compute unit
 */
export function getPriorityFeeFromLevel(level: PriorityFeeLevel): number {
  return PRIORITY_FEE_LEVELS[level];
}

/**
 * Calculate total priority fee cost for a transaction.
 *
 * @param microLamportsPerCU - Fee in micro-lamports per compute unit
 * @param computeUnits - Total compute units
 * @returns Total fee in lamports
 *
 * @example
 * ```ts
 * const totalFee = calculatePriorityFeeCost(10_000, 200_000);
 * // 10_000 * 200_000 / 1_000_000 = 2000 lamports = 0.000002 SOL
 * ```
 */
export function calculatePriorityFeeCost(
  microLamportsPerCU: number,
  computeUnits: number
): number {
  // micro-lamports to lamports: divide by 1_000_000
  return (microLamportsPerCU * computeUnits) / 1_000_000;
}
