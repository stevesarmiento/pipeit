/**
 * Tests for priority fee instruction creation and estimation.
 */

import { describe, it, expect } from 'vitest';
import type { Rpc } from '@solana/rpc';
import {
    COMPUTE_BUDGET_PROGRAM,
    PRIORITY_FEE_LEVELS,
    createSetComputeUnitPriceInstruction,
    estimatePriorityFee,
    getPriorityFeeFromLevel,
    calculatePriorityFeeCost,
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

describe('createSetComputeUnitPriceInstruction', () => {
    it('produces the historical byte layout: [3, u64 LE micro-lamports]', () => {
        const ix = createSetComputeUnitPriceInstruction(10_000);

        expect(ix.programAddress).toBe(COMPUTE_BUDGET_PROGRAM);
        expect(ix.accounts).toHaveLength(0);

        const data = ix.data as Uint8Array;
        expect(data).toHaveLength(9);
        expect(data[0]).toBe(3); // SetComputeUnitPrice discriminator
        const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
        expect(view.getBigUint64(1, true)).toBe(10_000n);
    });

    it('encodes zero and large values correctly', () => {
        const zero = createSetComputeUnitPriceInstruction(0);
        const zeroView = new DataView(
            (zero.data as Uint8Array).buffer,
            (zero.data as Uint8Array).byteOffset,
            (zero.data as Uint8Array).byteLength,
        );
        expect(zeroView.getBigUint64(1, true)).toBe(0n);

        const large = createSetComputeUnitPriceInstruction(5_000_000);
        const largeView = new DataView(
            (large.data as Uint8Array).buffer,
            (large.data as Uint8Array).byteOffset,
            (large.data as Uint8Array).byteLength,
        );
        expect(largeView.getBigUint64(1, true)).toBe(5_000_000n);
    });
});

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
