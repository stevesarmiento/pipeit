/**
 * `TransactionBuilder.buildWithBudget()`: every ResolvedBudget field, and
 * the message's identity with `build()`.
 */

import { describe, it, expect, vi } from 'vitest';
import type { ResolvedBudget } from '../../compute-budget/index.js';
import {
    USER_INSTRUCTION,
    callerHeapIx,
    callerLadsIx,
    callerLimitIx,
    callerPriceIx,
    makeBuilder,
    buildWithBudget,
    stubRpc,
} from './helpers/compute-budget.js';

describe('legacy/v0 budget result', () => {
    it("'auto' with the default level: no limit, worst-case total, default/config sources", async () => {
        const { budget } = await buildWithBudget({}, [USER_INSTRUCTION, USER_INSTRUCTION]);
        expect(budget).toEqual<ResolvedBudget>({
            version: 0,
            computeUnitLimit: null,
            computeUnitPriceMicroLamports: 10_000n,
            priorityFeeLamports: 4_000n, // 10_000 × 400_000 / 1e6
            loadedAccountsDataSizeLimit: null,
            heapSize: null,
            source: { priorityFee: 'config', computeUnits: 'default' },
        });
    });

    it('fixed limit and price: exact total, config sources', async () => {
        const { budget } = await buildWithBudget(
            { version: 'legacy', computeUnits: 300_000, priorityFee: { strategy: 'fixed', microLamports: 5_000 } },
            [USER_INSTRUCTION],
        );
        expect(budget).toEqual<ResolvedBudget>({
            version: 'legacy',
            computeUnitLimit: 300_000,
            computeUnitPriceMicroLamports: 5_000n,
            priorityFeeLamports: 1_500n,
            loadedAccountsDataSizeLimit: null,
            heapSize: null,
            source: { priorityFee: 'config', computeUnits: 'config' },
        });
    });

    it('rounds the total up to whole lamports', async () => {
        const { budget } = await buildWithBudget(
            { computeUnits: 333_333, priorityFee: { strategy: 'fixed', microLamports: 10_000 } },
            [USER_INSTRUCTION],
        );
        expect(budget.priorityFeeLamports).toBe(3_334n);
    });

    it("'simulate': null limit now, 'simulated' source, worst-case total", async () => {
        const { budget } = await buildWithBudget(
            { computeUnits: { strategy: 'simulate' }, priorityFee: { strategy: 'fixed', microLamports: 1_000 } },
            [USER_INSTRUCTION],
        );
        expect(budget.computeUnitLimit).toBeNull();
        expect(budget.source.computeUnits).toBe('simulated');
        expect(budget.priorityFeeLamports).toBe(200n);
    });

    it('caller-supplied budget: instruction sources and the lads/heap values', async () => {
        const { budget } = await buildWithBudget({}, [
            callerHeapIx(262_144),
            callerLimitIx(287_202),
            callerPriceIx(5_000n),
            callerLadsIx(65_536),
            USER_INSTRUCTION,
        ]);
        expect(budget).toEqual<ResolvedBudget>({
            version: 0,
            computeUnitLimit: 287_202,
            computeUnitPriceMicroLamports: 5_000n,
            priorityFeeLamports: 1_437n,
            loadedAccountsDataSizeLimit: 65_536,
            heapSize: 262_144,
            source: { priorityFee: 'instruction', computeUnits: 'instruction' },
        });
    });

    it("'none' reports a zero price and total", async () => {
        const { budget } = await buildWithBudget({ priorityFee: 'none', computeUnits: 200_000 }, [USER_INSTRUCTION]);
        expect(budget.computeUnitPriceMicroLamports).toBe(0n);
        expect(budget.priorityFeeLamports).toBe(0n);
    });

    it('a caller limit above 1.4M is reported clamped, like the instruction', async () => {
        const { budget } = await buildWithBudget({}, [callerLimitIx(2_000_000), USER_INSTRUCTION]);
        expect(budget.computeUnitLimit).toBe(1_400_000);
    });

    it('build() and buildWithBudget().message are identical', async () => {
        const builder = makeBuilder({ computeUnits: 200_000, priorityFee: 'high' }, [USER_INSTRUCTION]);
        const message = await builder.build();
        const { message: withBudget } = await builder.buildWithBudget();
        expect(withBudget).toEqual(message);
    });

    it('new config fields survive setters (clone)', async () => {
        const resolve = vi.fn(async () => 50_000n);
        // makeBuilder already goes through setFeePayer/setBlockhashLifetime/addInstructions,
        // each of which clones; one more addInstruction for good measure.
        const { budget } = await makeBuilder(
            { computeUnits: 200_000, priorityFee: { strategy: 'custom', resolve, maxLamports: 1_000n } },
            [],
        )
            .addInstruction(USER_INSTRUCTION)
            .buildWithBudget();
        expect(resolve).toHaveBeenCalledTimes(1);
        expect(budget.computeUnitPriceMicroLamports).toBe(5_000n);
        expect(budget.source.priorityFee).toBe('clamped');
    });
});

describe('version 1 budget result', () => {
    it('explicit limits: every field from the config block', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            const { budget } = await buildWithBudget(
                {
                    version: 1,
                    computeUnits: 300_000,
                    loadedAccountsDataSizeLimit: 65_536,
                    priorityFee: { strategy: 'fixed', microLamports: 10_000 },
                },
                [callerHeapIx(262_144), USER_INSTRUCTION],
            );
            expect(budget).toEqual<ResolvedBudget>({
                version: 1,
                computeUnitLimit: 300_000,
                computeUnitPriceMicroLamports: 10_000n,
                priorityFeeLamports: 3_000n,
                loadedAccountsDataSizeLimit: 65_536,
                heapSize: 262_144,
                source: { priorityFee: 'config', computeUnits: 'config' },
            });
            expect(warn).not.toHaveBeenCalled();
        } finally {
            warn.mockRestore();
        }
    });

    it('simulated limits: estimated values and the simulated source', async () => {
        const rpc = stubRpc({ unitsConsumed: 100_000n });
        const { budget } = await buildWithBudget({ version: 1, rpc, priorityFee: 'low' }, [USER_INSTRUCTION]);
        expect(budget.computeUnitLimit).toBe(110_000);
        expect(budget.loadedAccountsDataSizeLimit).toBeGreaterThan(0);
        expect(budget.computeUnitPriceMicroLamports).toBe(1_000n);
        expect(budget.priorityFeeLamports).toBe(110n);
        expect(budget.source).toEqual({ priorityFee: 'config', computeUnits: 'simulated' });
    });

    it("the no-rpc fallback reports the 'default' source", async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            const { budget } = await buildWithBudget({ version: 1, priorityFee: 'none' }, [USER_INSTRUCTION]);
            expect(budget.computeUnitLimit).toBe(200_000);
            expect(budget.source.computeUnits).toBe('default');
        } finally {
            warn.mockRestore();
        }
    });

    it('caller-supplied price and limit: instruction sources', async () => {
        const { budget } = await buildWithBudget({ version: 1, loadedAccountsDataSizeLimit: 65_536 }, [
            callerLimitIx(287_202),
            callerPriceIx(5_000n),
            USER_INSTRUCTION,
        ]);
        expect(budget.computeUnitLimit).toBe(287_202);
        expect(budget.computeUnitPriceMicroLamports).toBe(5_000n);
        expect(budget.priorityFeeLamports).toBe(1_437n);
        expect(budget.source).toEqual({ priorityFee: 'instruction', computeUnits: 'instruction' });
    });

    it('an explicit lamports total reports a zero per-CU price', async () => {
        const { budget } = await buildWithBudget(
            {
                version: 1,
                computeUnits: 300_000,
                loadedAccountsDataSizeLimit: 65_536,
                priorityFee: { strategy: 'fixed', lamports: 5_000n },
            },
            [USER_INSTRUCTION],
        );
        expect(budget.computeUnitPriceMicroLamports).toBe(0n);
        expect(budget.priorityFeeLamports).toBe(5_000n);
    });
});
