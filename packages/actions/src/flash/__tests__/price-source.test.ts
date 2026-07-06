/**
 * Tests for the Pyth Hermes price source.
 *
 * The happy-path fixture is a recorded response from the real
 * `https://hermes.pyth.network/v2/updates/price/latest` endpoint (2026-07-06)
 * for the SOL and USDC price ids bundled in the Crypto.1 PoolConfig, so the
 * parser is exercised against the actual wire shape. Fetch is injected —
 * no global stubbing — so this suite passes under both vitest and bun test.
 */

import { describe, expect, it, vi } from 'vitest';
import { FLASH_PYTH_HERMES_BASE_URL, createFlashPythPriceSource, pythPriceToOraclePrice } from '../price-source.js';
import { FlashPriceSourceError } from '../types.js';
import { POOL_CONFIG } from './helpers.js';

function priceIdOf(symbol: string): string {
    const token = POOL_CONFIG.tokens.find(candidate => candidate.symbol === symbol);
    return token!.pythPriceId.toLowerCase().replace(/^0x/, '');
}

// Recorded live Hermes response (trimmed to the parsed section the parser
// consumes). Note: Hermes returns ids WITHOUT the 0x prefix used in
// PoolConfig.
const RECORDED_RESPONSE = {
    binary: { encoding: 'hex', data: ['504e4155...'] },
    parsed: [
        {
            id: priceIdOf('SOL'),
            price: { price: '8074559120', conf: '4958513', expo: -8, publish_time: 1783324248 },
            ema_price: { price: '8071064300', conf: '4324525', expo: -8, publish_time: 1783324248 },
        },
        {
            id: priceIdOf('USDC'),
            price: { price: '99979417', conf: '45659', expo: -8, publish_time: 1783324248 },
            ema_price: { price: '99980482', conf: '39923', expo: -8, publish_time: 1783324248 },
        },
    ],
};

function fetchReturning(body: unknown, init: { ok?: boolean; status?: number } = {}) {
    return vi.fn(async () =>
        ({
            ok: init.ok ?? true,
            status: init.status ?? 200,
            json: async () => body,
            text: async () => JSON.stringify(body),
        }) as unknown as Response,
    );
}

describe('pythPriceToOraclePrice', () => {
    it('maps Hermes fields onto flash-sdk OraclePrice exactly', () => {
        const oracle = pythPriceToOraclePrice({ price: '8074559120', conf: '4958513', expo: -8, publish_time: 1783324248 });

        expect(oracle.price.toString()).toBe('8074559120');
        expect(oracle.exponent.toString()).toBe('-8');
        expect(oracle.confidence.toString()).toBe('4958513');
        expect(oracle.timestamp.toString()).toBe('1783324248');
    });
});

describe('createFlashPythPriceSource', () => {
    it('resolves symbols to prices via the recorded Hermes response', async () => {
        const fetch = fetchReturning(RECORDED_RESPONSE);
        const priceSource = createFlashPythPriceSource({ poolConfig: POOL_CONFIG, fetch });

        const prices = await priceSource(['SOL', 'USDC']);

        expect(prices.get('SOL')?.price.toString()).toBe('8074559120');
        expect(prices.get('SOL')?.exponent.toString()).toBe('-8');
        expect(prices.get('USDC')?.price.toString()).toBe('99979417');

        const url = fetch.mock.calls[0][0] as unknown as string;
        expect(url.startsWith(`${FLASH_PYTH_HERMES_BASE_URL}/v2/updates/price/latest?ids[]=`)).toBe(true);
        expect(url).toContain(priceIdOf('SOL'));
    });

    it('shares one price id across symbols that alias the same feed (SOL/WSOL)', async () => {
        const fetch = fetchReturning(RECORDED_RESPONSE);
        const priceSource = createFlashPythPriceSource({ poolConfig: POOL_CONFIG, fetch });

        const prices = await priceSource(['SOL', 'WSOL']);

        expect(prices.get('SOL')?.price.toString()).toBe('8074559120');
        expect(prices.get('WSOL')?.price.toString()).toBe('8074559120');
        // Only one unique id should be requested.
        const url = fetch.mock.calls[0][0] as unknown as string;
        expect(url.match(/ids\[\]=/g)).toHaveLength(1);
    });

    it('normalizes a custom base URL with a trailing slash', async () => {
        const fetch = fetchReturning(RECORDED_RESPONSE);
        const priceSource = createFlashPythPriceSource({
            poolConfig: POOL_CONFIG,
            fetch,
            baseUrl: 'https://example.com/hermes/',
        });

        await priceSource(['SOL']);

        expect((fetch.mock.calls[0][0] as unknown as string).startsWith('https://example.com/hermes/v2/')).toBe(true);
    });

    it('throws a typed error for symbols without a Pyth price id', async () => {
        const fetch = fetchReturning(RECORDED_RESPONSE);
        const priceSource = createFlashPythPriceSource({ poolConfig: POOL_CONFIG, fetch });

        await expect(priceSource(['DOGE'])).rejects.toThrow(FlashPriceSourceError);
        expect(fetch).not.toHaveBeenCalled();
    });

    it('throws with structured status details on non-ok responses', async () => {
        const fetch = fetchReturning({ error: 'nope' }, { ok: false, status: 429 });
        const priceSource = createFlashPythPriceSource({ poolConfig: POOL_CONFIG, fetch });

        try {
            await priceSource(['SOL']);
            expect.unreachable('should have thrown');
        } catch (error) {
            expect(error).toBeInstanceOf(FlashPriceSourceError);
            expect((error as FlashPriceSourceError).statusCode).toBe(429);
            expect((error as FlashPriceSourceError).responseBody).toContain('nope');
        }
    });

    it('throws when the response is missing a requested price', async () => {
        const fetch = fetchReturning({ parsed: [] });
        const priceSource = createFlashPythPriceSource({ poolConfig: POOL_CONFIG, fetch });

        await expect(priceSource(['SOL'])).rejects.toThrow(FlashPriceSourceError);
    });

    it('wraps network failures in a typed error', async () => {
        const fetch = vi.fn(async () => {
            throw new Error('socket hang up');
        });
        const priceSource = createFlashPythPriceSource({ poolConfig: POOL_CONFIG, fetch: fetch as never });

        await expect(priceSource(['SOL'])).rejects.toThrow(FlashPriceSourceError);
        await expect(priceSource(['SOL'])).rejects.toThrow(/socket hang up/);
    });
});
