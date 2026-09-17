/**
 * Priority fee estimation and conversion helpers.
 *
 * @packageDocumentation
 */

import type { Address } from '@solana/addresses';
import type { Rpc } from '@solana/rpc';
import { address } from '@solana/addresses';
import type { PriorityFeeConfig, PriorityFeeEstimate, PrioritizationFeeEntry } from './types.js';

/**
 * Compute Budget program address.
 */
export const COMPUTE_BUDGET_PROGRAM = address('ComputeBudget111111111111111111111111111111');

/**
 * Predefined priority fee levels in micro-lamports per compute unit.
 */
export const PRIORITY_FEE_LEVELS = {
    none: 0,
    low: 1_000, // 0.001 lamports per CU
    medium: 10_000, // 0.01 lamports per CU
    high: 50_000, // 0.05 lamports per CU
    veryHigh: 100_000, // 0.1 lamports per CU
} as const;

export type PriorityFeeLevel = keyof typeof PRIORITY_FEE_LEVELS;

/**
 * RPC API for getting recent prioritization fees.
 */
interface GetRecentPrioritizationFeesApi {
    getRecentPrioritizationFees(addresses?: Address[]): {
        slot: bigint;
        prioritizationFee: bigint;
    }[];
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
    config: PriorityFeeConfig,
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
    const recentFees = await rpc.getRecentPrioritizationFees(lockedWritableAccounts).send();

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
        .map(entry => Number(entry.prioritizationFee))
        .filter(fee => fee > 0)
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
export function calculatePriorityFeeCost(microLamportsPerCU: number, computeUnits: number): number {
    // micro-lamports to lamports: divide by 1_000_000
    return (microLamportsPerCU * computeUnits) / 1_000_000;
}

/**
 * Convert a per-compute-unit price into the total priority fee a version 1
 * transaction pays.
 *
 * Legacy and version 0 transactions state a price in micro-lamports per compute
 * unit; version 1 states the total in lamports. The runtime rounds the total up
 * to whole lamports, so this does the same. This is the single conversion point
 * Pipeit uses when a per-CU `priorityFee` is applied to a v1 transaction.
 *
 * @param microLamportsPerCU - Fee in micro-lamports per compute unit
 * @param computeUnitLimit - The transaction's final compute unit limit
 * @returns Total priority fee in lamports
 *
 * @example
 * ```ts
 * microLamportsToPriorityFeeLamports(10_000, 200_000); // 2_000n lamports
 * microLamportsToPriorityFeeLamports(10_000, 333_333); // 3_334n (rounded up)
 * microLamportsToPriorityFeeLamports(10_000n, 200_000); // bigint prices (e.g. decoded u64) are accepted
 * ```
 */
export function microLamportsToPriorityFeeLamports(
    microLamportsPerCU: number | bigint,
    computeUnitLimit: number,
): bigint {
    if (!Number.isFinite(computeUnitLimit) || computeUnitLimit <= 0) return 0n;
    let pricePerCU: bigint;
    if (typeof microLamportsPerCU === 'bigint') {
        pricePerCU = microLamportsPerCU;
    } else {
        if (!Number.isFinite(microLamportsPerCU)) return 0n;
        pricePerCU = BigInt(Math.round(microLamportsPerCU));
    }
    if (pricePerCU <= 0n) return 0n;
    const microLamports = pricePerCU * BigInt(Math.round(computeUnitLimit));
    return (microLamports + 999_999n) / 1_000_000n;
}
