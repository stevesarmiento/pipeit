/**
 * `priorityFee.preferInstruction` / `computeUnits.preferInstruction`.
 *
 * Omitting `priorityFee` defers to a caller-supplied SetComputeUnitPrice but
 * falls back to the static 'medium' level. Setting it discards the caller's
 * price. `preferInstruction: true` is the third option: the caller's price
 * when the instructions carry one, the configured strategy otherwise.
 *
 * The unchanged paths (omitted, explicit-wins, 'none') are asserted here too.
 */

import { describe, it, expect } from 'vitest';
import { PRIORITY_FEE_LEVELS } from '../../compute-budget/index.js';
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
    computeBudgetInstructions,
} from './helpers/compute-budget.js';

const ROUTE_PRICE = 7_000n;
const CONFIG_PRICE = 25_000n;
const WITH_PRICE = [callerPriceIx(ROUTE_PRICE), USER_INSTRUCTION];
const WITHOUT_PRICE = [USER_INSTRUCTION];

const V1 = { version: 1 as const, computeUnits: 200_000, loadedAccountsDataSizeLimit: 65_536 };
const lamportsFor = (price: bigint) => (price * 200_000n + 999_999n) / 1_000_000n;

describe("legacy/v0 priorityFee 'preferInstruction'", () => {
    it('fixed strategy + preferInstruction uses the route price when present', async () => {
        const message = await build(
            { priorityFee: { strategy: 'fixed', microLamports: CONFIG_PRICE, preferInstruction: true } },
            WITH_PRICE,
        );
        expect(emittedPrice(message.instructions)).toBe(ROUTE_PRICE);
    });

    it('fixed strategy + preferInstruction falls back to the configured price when absent', async () => {
        const message = await build(
            { priorityFee: { strategy: 'fixed', microLamports: CONFIG_PRICE, preferInstruction: true } },
            WITHOUT_PRICE,
        );
        expect(emittedPrice(message.instructions)).toBe(CONFIG_PRICE);
    });

    it('fixed strategy without preferInstruction keeps winning over the route price', async () => {
        const message = await build({ priorityFee: { strategy: 'fixed', microLamports: CONFIG_PRICE } }, WITH_PRICE);
        expect(emittedPrice(message.instructions)).toBe(CONFIG_PRICE);
    });

    it('preferInstruction: false behaves like the explicit default', async () => {
        const message = await build(
            { priorityFee: { strategy: 'fixed', microLamports: CONFIG_PRICE, preferInstruction: false } },
            WITH_PRICE,
        );
        expect(emittedPrice(message.instructions)).toBe(CONFIG_PRICE);
    });

    it("'none' + preferInstruction gives the route price or nothing", async () => {
        const withPrice = await build({ priorityFee: { strategy: 'none', preferInstruction: true } }, WITH_PRICE);
        expect(emittedPrice(withPrice.instructions)).toBe(ROUTE_PRICE);

        const withoutPrice = await build({ priorityFee: { strategy: 'none', preferInstruction: true } }, WITHOUT_PRICE);
        expect(emittedPrice(withoutPrice.instructions)).toBeUndefined();
    });

    it('percentile + preferInstruction skips the rpc when the route has a price and queries it otherwise', async () => {
        const calls: string[] = [];
        const rpc = stubRpc({ recentFees: [1_000n, 2_000n, 3_000n, 4_000n], calls });
        const config = {
            rpc,
            priorityFee: { strategy: 'percentile' as const, percentile: 75, preferInstruction: true },
        };

        const withPrice = await build(config, WITH_PRICE);
        expect(emittedPrice(withPrice.instructions)).toBe(ROUTE_PRICE);
        expect(calls).not.toContain('getRecentPrioritizationFees');

        const withoutPrice = await build(config, WITHOUT_PRICE);
        expect(emittedPrice(withoutPrice.instructions)).toBe(3_000n);
        expect(calls).toContain('getRecentPrioritizationFees');
    });

    it('the budget attributes the price to the instruction or the config accordingly', async () => {
        const config = {
            priorityFee: { strategy: 'fixed' as const, microLamports: CONFIG_PRICE, preferInstruction: true },
        };
        expect((await buildWithBudget(config, WITH_PRICE)).budget.source.priorityFee).toBe('instruction');
        expect((await buildWithBudget(config, WITHOUT_PRICE)).budget.source.priorityFee).toBe('config');
    });
});

describe("legacy/v0 computeUnits 'preferInstruction'", () => {
    it('uses the route limit when present and the configured units otherwise', async () => {
        const config = { computeUnits: { strategy: 'fixed' as const, units: 400_000, preferInstruction: true } };

        const withLimit = await build(config, [callerLimitIx(287_202), USER_INSTRUCTION]);
        expect(onlyU32(withLimit.instructions, SET_COMPUTE_UNIT_LIMIT)).toBe(287_202);

        const withoutLimit = await build(config, [USER_INSTRUCTION]);
        expect(onlyU32(withoutLimit.instructions, SET_COMPUTE_UNIT_LIMIT)).toBe(400_000);
    });

    it("'auto' + preferInstruction keeps the route limit, and emits nothing without one", async () => {
        const config = { computeUnits: { strategy: 'auto' as const, preferInstruction: true } };

        const withLimit = await build(config, [callerLimitIx(287_202), USER_INSTRUCTION]);
        expect(onlyU32(withLimit.instructions, SET_COMPUTE_UNIT_LIMIT)).toBe(287_202);

        const withoutLimit = await build(config, [USER_INSTRUCTION]);
        expect(computeBudgetInstructions(withoutLimit.instructions, SET_COMPUTE_UNIT_LIMIT)).toHaveLength(0);
    });

    it('without preferInstruction the configured units still win', async () => {
        const message = await build({ computeUnits: { strategy: 'fixed', units: 400_000 } }, [
            callerLimitIx(287_202),
            USER_INSTRUCTION,
        ]);
        expect(onlyU32(message.instructions, SET_COMPUTE_UNIT_LIMIT)).toBe(400_000);
    });
});

describe("version 1 priorityFee 'preferInstruction'", () => {
    it('uses the route price when present, converted against the final limit', async () => {
        const message = await build(
            { ...V1, priorityFee: { strategy: 'fixed', microLamports: CONFIG_PRICE, preferInstruction: true } },
            WITH_PRICE,
        );
        expect(message.config?.priorityFeeLamports).toBe(lamportsFor(ROUTE_PRICE));
    });

    it('falls back to the configured strategy when the route has no price', async () => {
        const message = await build(
            { ...V1, priorityFee: { strategy: 'fixed', microLamports: CONFIG_PRICE, preferInstruction: true } },
            WITHOUT_PRICE,
        );
        expect(message.config?.priorityFeeLamports).toBe(lamportsFor(CONFIG_PRICE));
    });

    it("'none' + preferInstruction gives the route price or no fee", async () => {
        const withPrice = await build(
            { ...V1, priorityFee: { strategy: 'none', preferInstruction: true } },
            WITH_PRICE,
        );
        expect(withPrice.config?.priorityFeeLamports).toBe(lamportsFor(ROUTE_PRICE));

        const withoutPrice = await build(
            { ...V1, priorityFee: { strategy: 'none', preferInstruction: true } },
            WITHOUT_PRICE,
        );
        expect(withoutPrice.config?.priorityFeeLamports).toBeUndefined();
    });

    it('explicit config without preferInstruction still wins', async () => {
        const message = await build(
            { ...V1, priorityFee: { strategy: 'fixed', microLamports: CONFIG_PRICE } },
            WITH_PRICE,
        );
        expect(message.config?.priorityFeeLamports).toBe(lamportsFor(CONFIG_PRICE));
    });
});

describe('unchanged precedence paths', () => {
    it("omitted priorityFee: route price when present, 'medium' otherwise", async () => {
        expect(emittedPrice((await build({}, WITH_PRICE)).instructions)).toBe(ROUTE_PRICE);
        expect(emittedPrice((await build({}, WITHOUT_PRICE)).instructions)).toBe(BigInt(PRIORITY_FEE_LEVELS.medium));
    });

    it('a preset level wins over the route price', async () => {
        expect(emittedPrice((await build({ priorityFee: 'high' }, WITH_PRICE)).instructions)).toBe(
            BigInt(PRIORITY_FEE_LEVELS.high),
        );
    });

    it("'none' suppresses the route price", async () => {
        expect(emittedPrice((await build({ priorityFee: 'none' }, WITH_PRICE)).instructions)).toBeUndefined();
        expect(
            emittedPrice((await build({ priorityFee: { strategy: 'none' } }, WITH_PRICE)).instructions),
        ).toBeUndefined();
    });

    it('a bigint microLamports is accepted for the fixed strategy', async () => {
        const message = await build({ priorityFee: { strategy: 'fixed', microLamports: 12_345n } }, WITHOUT_PRICE);
        expect(emittedPrice(message.instructions)).toBe(12_345n);
    });
});
