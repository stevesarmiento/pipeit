/**
 * Tests for priority fee estimation and conversion.
 */

import { describe, it, expect } from 'vitest';
import type { Rpc } from '@solana/rpc';
import {
    PRIORITY_FEE_LEVELS,
    estimatePriorityFee,
    getPriorityFeeFromLevel,
    calculatePriorityFeeCost,
    microLamportsToPriorityFeeLamports,
    worstCaseComputeUnitLimit,
    clampMicroLamportsToTotal,
} from '../priority-fees.js';
import type { PrioritizationFeeEntry } from '../types.js';

function stubRpc(entries: PrioritizationFeeEntry[]): Rpc<any> {
    return {
        getRecentPrioritizationFees: () => ({
            send: async () => entries,
        }),
    } as unknown as Rpc<any>;
}

function feeEntry(prioritizationFee: number): PrioritizationFeeEntry {
    return { slot: 1n, prioritizationFee: BigInt(prioritizationFee) };
}

describe('PRIORITY_FEE_LEVELS', () => {
    it('defines the documented preset values in micro-lamports/CU', () => {
        expect(PRIORITY_FEE_LEVELS).toEqual({
            none: 0,
            low: 1_000,
            medium: 10_000,
            high: 50_000,
            veryHigh: 100_000,
        });
    });

    it('getPriorityFeeFromLevel resolves each level', () => {
        expect(getPriorityFeeFromLevel('medium')).toBe(10_000);
        expect(getPriorityFeeFromLevel('none')).toBe(0);
    });
});

describe('estimatePriorityFee', () => {
    it('fixed strategy returns the configured value without RPC calls', async () => {
        const estimate = await estimatePriorityFee(stubRpc([]), {
            strategy: 'fixed',
            microLamports: 42,
        });
        expect(estimate.microLamports).toBe(42);
    });

    it('none strategy returns zero', async () => {
        const estimate = await estimatePriorityFee(stubRpc([]), { strategy: 'none' });
        expect(estimate.microLamports).toBe(0);
    });

    it('percentile strategy picks the requested percentile of recent fees', async () => {
        const rpc = stubRpc([feeEntry(1_000), feeEntry(2_000), feeEntry(3_000), feeEntry(4_000)]);

        const median = await estimatePriorityFee(rpc, { strategy: 'percentile', percentile: 50 });
        expect(median.microLamports).toBe(2_000);

        const aggressive = await estimatePriorityFee(rpc, { strategy: 'percentile', percentile: 100 });
        expect(aggressive.microLamports).toBe(4_000);
    });

    it('falls back to the low preset when there is no recent fee data', async () => {
        const estimate = await estimatePriorityFee(stubRpc([]), { strategy: 'percentile' });
        expect(estimate.microLamports).toBe(PRIORITY_FEE_LEVELS.low);
    });

    it('falls back to the low preset when all recent fees are zero', async () => {
        const estimate = await estimatePriorityFee(stubRpc([feeEntry(0), feeEntry(0)]), {
            strategy: 'percentile',
        });
        expect(estimate.microLamports).toBe(PRIORITY_FEE_LEVELS.low);
    });
});

describe('calculatePriorityFeeCost', () => {
    it('converts micro-lamports/CU x CU into lamports', () => {
        expect(calculatePriorityFeeCost(10_000, 200_000)).toBe(2_000);
        expect(calculatePriorityFeeCost(0, 200_000)).toBe(0);
    });
});

describe('microLamportsToPriorityFeeLamports (v1 total fee)', () => {
    it('returns 0n for a zero price or zero limit', () => {
        expect(microLamportsToPriorityFeeLamports(0, 200_000)).toBe(0n);
        expect(microLamportsToPriorityFeeLamports(10_000, 0)).toBe(0n);
    });

    it('matches the exact per-CU × CU product when it divides evenly', () => {
        // 20,000 CU × 250,000 µL/CU = 5,000 lamports (the SIMD-0385 worked example)
        expect(microLamportsToPriorityFeeLamports(250_000, 20_000)).toBe(5_000n);
        expect(microLamportsToPriorityFeeLamports(10_000, 200_000)).toBe(2_000n);
    });

    it('rounds up to whole lamports like the runtime', () => {
        // 333,333 × 10,000 = 3,333,330,000 µL = 3,333.33 lamports → 3,334
        expect(microLamportsToPriorityFeeLamports(10_000, 333_333)).toBe(3_334n);
        expect(microLamportsToPriorityFeeLamports(1, 1)).toBe(1n);
    });

    it('stays exact for large values via BigInt', () => {
        expect(microLamportsToPriorityFeeLamports(100_000_000, 1_400_000)).toBe(140_000_000n);
    });

    it('treats non-finite input as no fee', () => {
        expect(microLamportsToPriorityFeeLamports(Number.NaN, 1)).toBe(0n);
        expect(microLamportsToPriorityFeeLamports(1, Number.POSITIVE_INFINITY)).toBe(0n);
    });
});

describe('worstCaseComputeUnitLimit', () => {
    it('is 200,000 per instruction, at least one instruction', () => {
        expect(worstCaseComputeUnitLimit(0)).toBe(200_000);
        expect(worstCaseComputeUnitLimit(1)).toBe(200_000);
        expect(worstCaseComputeUnitLimit(3)).toBe(600_000);
    });

    it('caps at 1,400,000', () => {
        expect(worstCaseComputeUnitLimit(7)).toBe(1_400_000);
        expect(worstCaseComputeUnitLimit(50)).toBe(1_400_000);
    });
});

describe('clampMicroLamportsToTotal', () => {
    it('reduces the price so price × limit stays under the cap', () => {
        expect(clampMicroLamportsToTotal(10_000n, 200_000, 1_000n)).toBe(5_000n);
        expect(clampMicroLamportsToTotal(10_000n, 400_000, 1_000n)).toBe(2_500n);
    });

    it('floors the reduced price', () => {
        // 1_000 lamports / 300_000 CU = 3_333.33 micro-lamports per CU
        expect(clampMicroLamportsToTotal(10_000n, 300_000, 1_000n)).toBe(3_333n);
    });

    it('returns the input unchanged under the cap', () => {
        expect(clampMicroLamportsToTotal(10_000n, 200_000, 2_000n)).toBe(10_000n);
        expect(clampMicroLamportsToTotal(10_000n, 200_000, 100_000n)).toBe(10_000n);
    });

    it('returns zero for a zero price or a zero cap', () => {
        expect(clampMicroLamportsToTotal(0n, 200_000, 1_000n)).toBe(0n);
        expect(clampMicroLamportsToTotal(10_000n, 200_000, 0n)).toBe(0n);
    });

    it('leaves the price alone when the limit is not positive', () => {
        expect(clampMicroLamportsToTotal(10_000n, 0, 1_000n)).toBe(10_000n);
    });

    it("rejects the 'custom' strategy in estimatePriorityFee", async () => {
        await expect(estimatePriorityFee(stubRpc([]), { strategy: 'custom' })).rejects.toThrow(/custom/);
    });
});
