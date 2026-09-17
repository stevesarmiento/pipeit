/**
 * Un-mocked tests for the shared Phoenix helpers: market-param resolution
 * runs against the REAL Rise tick converter so the display-tick regression
 * (throws on fractional display ticks, silently 1000x off on integer ones)
 * can never come back.
 */

import { priceUsdToTicksWithMarketParams, projectExchangeMarket } from '@ellipsis-labs/rise';
import { describe, expect, it } from 'vitest';
import { assertPositiveSize, marketParamsFor, resolvePhoenixClient } from '../shared.js';
import { UnknownPhoenixMarketError, UnsupportedPhoenixOrderConfigError } from '../types.js';
import { createFakePhoenixClient } from './helpers.js';

describe('marketParamsFor', () => {
    it('returns the RAW integer tick size, not the fractional display tick', async () => {
        const { asClient, market } = createFakePhoenixClient({ tickSize: 100, baseLotsDecimals: 3 });

        const params = await marketParamsFor(asClient, 'SOL');

        expect(params).toEqual({ tickSize: 100, baseLotsDecimals: 3 });
        // Sanity-check the regression this guards against: the projected
        // display tick for this market is fractional and the real converter
        // rejects it outright.
        const projected = projectExchangeMarket(market as never);
        expect(projected.units.tickSize).toBe(0.1);
        expect(() => priceUsdToTicksWithMarketParams(65, { tickSize: projected.units.tickSize, baseLotsDecimals: 3 })).toThrow();
    });

    it('produces params the real converter maps to exact tick values', async () => {
        const { asClient } = createFakePhoenixClient({ tickSize: 100, baseLotsDecimals: 3 });

        const params = await marketParamsFor(asClient, 'SOL');

        expect(priceUsdToTicksWithMarketParams(65, params)).toBe(650n);
        expect(priceUsdToTicksWithMarketParams('65.13', params)).toBe(651n);
    });

    it('is exact (not 1000x off) on markets whose display tick is an integer', async () => {
        const { asClient, market } = createFakePhoenixClient({ tickSize: 1000, baseLotsDecimals: 3 });

        const params = await marketParamsFor(asClient, 'SOL');

        expect(priceUsdToTicksWithMarketParams(65_000, params)).toBe(65_000n);
        // The old display-tick path would NOT throw here — it would produce
        // a silent 1000x error.
        const projected = projectExchangeMarket(market as never);
        expect(
            priceUsdToTicksWithMarketParams(65_000, {
                tickSize: projected.units.tickSize,
                baseLotsDecimals: 3,
            }),
        ).toBe(65_000_000n);
    });

    it('throws UnknownPhoenixMarketError listing the available symbols', async () => {
        const { asClient } = createFakePhoenixClient({ symbol: 'ETH' });

        const promise = marketParamsFor(asClient, 'DOGE');

        await expect(promise).rejects.toThrow(UnknownPhoenixMarketError);
        await expect(promise).rejects.toMatchObject({ symbol: 'DOGE', availableSymbols: ['ETH'] });
    });
});

describe('assertPositiveSize', () => {
    it('accepts positive numbers, strings, and bigints', () => {
        for (const baseUnits of [1, 0.5, '1.5', '0.001', 2n] as const) {
            expect(() => assertPositiveSize({ baseUnits }, 'open')).not.toThrow();
        }
    });

    it('rejects zero, negative, scientific-notation, and malformed values', () => {
        for (const baseUnits of [0, -1, 0n, -3n, '0', '0.000', '-1', '1e-7', 'abc', Number.NaN, Infinity] as const) {
            expect(() => assertPositiveSize({ baseUnits }, 'open')).toThrow(UnsupportedPhoenixOrderConfigError);
        }
    });
});

describe('resolvePhoenixClient', () => {
    it('never flags injected clients for disposal', () => {
        const { asClient } = createFakePhoenixClient();

        const resolved = resolvePhoenixClient({ client: asClient });

        expect(resolved.client).toBe(asClient);
        expect(resolved.shouldDispose).toBe(false);
    });
});
