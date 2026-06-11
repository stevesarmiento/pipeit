/**
 * Flash Trade price source helpers.
 *
 * @packageDocumentation
 */

import { BN } from '@coral-xyz/anchor';
import { OraclePrice } from 'flash-sdk';
import { FlashPriceSourceError, type FlashPriceSource } from './types.js';

export const FLASH_DEFAULT_API_BASE_URL = 'https://flashapi.trade';

interface FlashApiPrice {
    price: string | number;
    exponent: string | number;
    confidence?: string | number;
    timestamp_us?: string | number;
    timestamp?: string | number;
}

function toBn(value: string | number | bigint | undefined, fallback = '0'): BN {
    return new BN(String(value ?? fallback));
}

function timestampUsToSeconds(timestampUs: string | number | undefined): BN {
    if (timestampUs === undefined) {
        return new BN(0);
    }

    return new BN((BigInt(String(timestampUs)) / 1_000_000n).toString());
}

export function flashApiPriceToOraclePrice(price: FlashApiPrice): OraclePrice {
    return new OraclePrice({
        price: toBn(price.price),
        exponent: toBn(price.exponent),
        confidence: toBn(price.confidence),
        timestamp:
            price.timestamp !== undefined
                ? toBn(price.timestamp)
                : timestampUsToSeconds(price.timestamp_us === undefined ? undefined : String(price.timestamp_us)),
    });
}

export function createFlashApiPriceSource(baseUrl = FLASH_DEFAULT_API_BASE_URL): FlashPriceSource {
    return async symbols => {
        const response = await fetch(`${baseUrl.replace(/\/$/, '')}/prices`);
        if (!response.ok) {
            throw new FlashPriceSourceError(`Flash price API request failed with status ${response.status}.`);
        }

        const data = (await response.json()) as Record<string, FlashApiPrice>;
        const prices = new Map<string, OraclePrice>();

        for (const symbol of symbols) {
            const price = data[symbol];
            if (!price) {
                throw new FlashPriceSourceError(`Flash price API response is missing price for ${symbol}.`);
            }
            prices.set(symbol, flashApiPriceToOraclePrice(price));
        }

        return prices;
    };
}
