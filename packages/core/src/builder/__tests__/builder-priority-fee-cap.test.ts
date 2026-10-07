/**
 * `priorityFee.maxLamports`: a hard cap on the total priority fee, applied
 * after the price and the final compute unit limit are known.
 *
 * - v1: the total is clamped.
 * - legacy/v0: the per-CU price is reduced to floor(max × 1e6 / limit), using
 *   the runtime's worst-case limit when no limit instruction is emitted.
 */

import { describe, it, expect, vi } from 'vitest';
import {
    USER_INSTRUCTION,
    SET_COMPUTE_UNIT_LIMIT,
    callerLimitIx,
    callerPriceIx,
    build,
    buildWithBudget,
    stubRpc,
    emittedPrice,
    onlyU32,
} from './helpers/compute-budget.js';

const PRICE = 10_000n; // micro-lamports per CU
const fixed = (extra: Record<string, unknown> = {}) => ({ strategy: 'fixed' as const, microLamports: PRICE, ...extra });

describe('legacy/v0 maxLamports', () => {
    it('reduces the price against a fixed limit', async () => {
        // 10_000 × 200_000 / 1e6 = 2_000 lamports; cap at 1_000 → 5_000 per CU
        const { message, budget } = await buildWithBudget(
            { computeUnits: 200_000, priorityFee: fixed({ maxLamports: 1_000n }) },
            [USER_INSTRUCTION],
        );
        expect(emittedPrice(message.instructions)).toBe(5_000n);
        expect(budget.computeUnitPriceMicroLamports).toBe(5_000n);
        expect(budget.priorityFeeLamports).toBe(1_000n);
        expect(budget.source.priorityFee).toBe('clamped');
    });

    it('reduces the price against a caller-supplied limit', async () => {
        const message = await build({ priorityFee: fixed({ maxLamports: 1_000n }) }, [
            callerLimitIx(400_000),
            USER_INSTRUCTION,
        ]);
        expect(onlyU32(message.instructions, SET_COMPUTE_UNIT_LIMIT)).toBe(400_000);
        expect(emittedPrice(message.instructions)).toBe(2_500n);
    });

    it("uses the worst-case bound (200k × instructions, max 1.4M) for 'auto'", async () => {
        // 2 instructions → 400_000 CU bound; cap 1_000 → 2_500 per CU
        const { message, budget } = await buildWithBudget({ priorityFee: fixed({ maxLamports: 1_000n }) }, [
            USER_INSTRUCTION,
            USER_INSTRUCTION,
        ]);
        expect(emittedPrice(message.instructions)).toBe(2_500n);
        expect(budget.computeUnitLimit).toBeNull();
        expect(budget.priorityFeeLamports).toBe(1_000n);

        // 10 instructions → 2M, capped to 1.4M; cap 1_400 → 1_000 per CU
        const many = await build({ priorityFee: fixed({ maxLamports: 1_400n }) }, Array(10).fill(USER_INSTRUCTION));
        expect(emittedPrice(many.instructions)).toBe(1_000n);
    });

    it("uses the worst-case bound for 'simulate', whose limit is estimated later", async () => {
        const message = await build(
            { computeUnits: { strategy: 'simulate' }, priorityFee: fixed({ maxLamports: 1_000n }) },
            [USER_INSTRUCTION],
        );
        expect(emittedPrice(message.instructions)).toBe(5_000n);
    });

    it('also caps a caller-supplied price', async () => {
        const { message, budget } = await buildWithBudget(
            { priorityFee: fixed({ preferInstruction: true, maxLamports: 1_000n }) },
            [callerPriceIx(50_000n), callerLimitIx(200_000), USER_INSTRUCTION],
        );
        expect(emittedPrice(message.instructions)).toBe(5_000n);
        expect(budget.source.priorityFee).toBe('clamped');
    });

    it('clamping to zero emits no price instruction', async () => {
        const { message, budget } = await buildWithBudget(
            { computeUnits: 200_000, priorityFee: fixed({ maxLamports: 0n }) },
            [USER_INSTRUCTION],
        );
        expect(emittedPrice(message.instructions)).toBeUndefined();
        expect(budget.computeUnitPriceMicroLamports).toBe(0n);
        expect(budget.priorityFeeLamports).toBe(0n);
        expect(budget.source.priorityFee).toBe('clamped');
    });

    it('does not clamp under the cap and keeps the config attribution', async () => {
        const { message, budget } = await buildWithBudget(
            { computeUnits: 200_000, priorityFee: fixed({ maxLamports: 100_000n }) },
            [USER_INSTRUCTION],
        );
        expect(emittedPrice(message.instructions)).toBe(PRICE);
        expect(budget.priorityFeeLamports).toBe(2_000n);
        expect(budget.source.priorityFee).toBe('config');
    });

    it("logs the clamp at 'minimal' and stays quiet at 'silent'", async () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        try {
            await build({ logLevel: 'minimal', computeUnits: 200_000, priorityFee: fixed({ maxLamports: 1_000n }) }, [
                USER_INSTRUCTION,
            ]);
            const clampLines = log.mock.calls.filter(call => String(call[0]).includes('clamped'));
            expect(clampLines).toHaveLength(1);
            expect(String(clampLines[0]![0])).toMatch(/10,000 → 5,000 micro-lamports\/CU/);

            log.mockClear();
            await build({ logLevel: 'silent', computeUnits: 200_000, priorityFee: fixed({ maxLamports: 1_000n }) }, [
                USER_INSTRUCTION,
            ]);
            expect(log).not.toHaveBeenCalled();
        } finally {
            log.mockRestore();
        }
    });
});

describe('version 1 maxLamports', () => {
    const V1 = { version: 1 as const, loadedAccountsDataSizeLimit: 65_536 };

    it('clamps the total against a fixed limit', async () => {
        const { message, budget } = await buildWithBudget(
            { ...V1, computeUnits: 300_000, priorityFee: fixed({ maxLamports: 1_000n }) },
            [USER_INSTRUCTION],
        );
        expect(message.config?.priorityFeeLamports).toBe(1_000n);
        expect(budget.priorityFeeLamports).toBe(1_000n);
        expect(budget.computeUnitPriceMicroLamports).toBe(PRICE);
        expect(budget.source.priorityFee).toBe('clamped');
    });

    it('clamps the total against a simulated limit', async () => {
        const rpc = stubRpc({ unitsConsumed: 100_000n });
        const { message, budget } = await buildWithBudget(
            { version: 1, rpc, priorityFee: fixed({ maxLamports: 500n }) },
            [USER_INSTRUCTION],
        );
        expect(budget.computeUnitLimit).toBe(110_000);
        expect(message.config?.priorityFeeLamports).toBe(500n);
        expect(budget.source).toEqual({ priorityFee: 'clamped', computeUnits: 'simulated' });
    });

    it('clamps an explicit lamports total', async () => {
        const message = await build(
            {
                ...V1,
                computeUnits: 300_000,
                priorityFee: { strategy: 'fixed', lamports: 50_000n, maxLamports: 1_000n },
            },
            [USER_INSTRUCTION],
        );
        expect(message.config?.priorityFeeLamports).toBe(1_000n);
    });

    it('clamping to zero leaves the fee unset', async () => {
        const message = await build({ ...V1, computeUnits: 300_000, priorityFee: fixed({ maxLamports: 0n }) }, [
            USER_INSTRUCTION,
        ]);
        expect(message.config?.priorityFeeLamports).toBeUndefined();
    });

    it('does not clamp under the cap', async () => {
        const { message, budget } = await buildWithBudget(
            { ...V1, computeUnits: 300_000, priorityFee: fixed({ maxLamports: 100_000n }) },
            [USER_INSTRUCTION],
        );
        expect(message.config?.priorityFeeLamports).toBe(3_000n);
        expect(budget.source.priorityFee).toBe('config');
    });

    it("logs the clamp at 'minimal'", async () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        try {
            await build(
                { ...V1, logLevel: 'minimal', computeUnits: 300_000, priorityFee: fixed({ maxLamports: 1_000n }) },
                [USER_INSTRUCTION],
            );
            const clampLines = log.mock.calls.filter(call => String(call[0]).includes('clamped'));
            expect(clampLines).toHaveLength(1);
            expect(String(clampLines[0]![0])).toMatch(/3,000 → 1,000 lamports total/);
        } finally {
            log.mockRestore();
        }
    });
});
