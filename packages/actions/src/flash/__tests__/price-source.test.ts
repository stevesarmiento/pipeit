/**
 * Tests for Flash API price source helpers.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFlashApiPriceSource, flashApiPriceToOraclePrice } from '../price-source.js';
import { FlashPriceSourceError } from '../types.js';

describe('flashApiPriceToOraclePrice', () => {
    it('converts Flash API price data to OraclePrice', () => {
        const price = flashApiPriceToOraclePrice({
            price: '14852000000',
            exponent: '-8',
            timestamp_us: '1707900000000000',
        });

        expect(price.price.toString()).toBe('14852000000');
        expect(price.exponent.toString()).toBe('-8');
        expect(price.confidence.toString()).toBe('0');
        expect(price.timestamp.toString()).toBe('1707900000');
    });
});

describe('createFlashApiPriceSource', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('fetches requested prices', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => ({
                ok: true,
                json: async () => ({
                    SOL: { price: '15000000000', exponent: '-8', timestamp_us: '1707900000000000' },
                }),
            })),
        );

        const prices = await createFlashApiPriceSource('https://example.com')(['SOL']);

        expect(fetch).toHaveBeenCalledWith('https://example.com/prices');
        expect(prices.get('SOL')?.price.toString()).toBe('15000000000');
    });

    it('throws when a requested symbol is missing', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => ({
                ok: true,
                json: async () => ({}),
            })),
        );

        await expect(createFlashApiPriceSource('https://example.com')(['SOL'])).rejects.toThrow(FlashPriceSourceError);
    });
});
