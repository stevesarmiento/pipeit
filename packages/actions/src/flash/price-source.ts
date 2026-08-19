/**
 * Flash Trade price source helpers.
 *
 * Flash positions are priced against Pyth oracles; every token in a Flash
 * `PoolConfig` carries a `pythPriceId`. The default price source resolves
 * those ids against the public Pyth Hermes API — the same feed flash-sdk
 * itself consumes.
 *
 * @packageDocumentation
 */

import { BN } from '@coral-xyz/anchor';
import { OraclePrice, type PoolConfig } from 'flash-sdk';
import { FlashPriceSourceError, type FlashPriceSource } from './types.js';

/** Public Pyth Hermes endpoint used by the default price source. */
export const FLASH_PYTH_HERMES_BASE_URL = 'https://hermes.pyth.network';

const DEFAULT_TIMEOUT_MS = 10_000;

/** One parsed price entry from Hermes `/v2/updates/price/latest`. */
export interface PythParsedPrice {
    id: string;
    price: {
        price: string | number;
        conf: string | number;
        expo: number;
        publish_time: number;
    };
}

interface PythLatestPriceResponse {
    parsed?: PythParsedPrice[];
}

export interface FlashPythPriceSourceConfig {
    /** Pool config providing the symbol → `pythPriceId` mapping. */
    poolConfig: PoolConfig;
    /** Hermes base URL. Defaults to {@link FLASH_PYTH_HERMES_BASE_URL}. */
    baseUrl?: string;
    /** Custom fetch implementation (for testing or proxied environments). */
    fetch?: typeof globalThis.fetch;
    /** Request timeout in milliseconds. Defaults to 10 000. */
    timeoutMs?: number;
}

function normalizePriceId(id: string): string {
    return id.toLowerCase().replace(/^0x/, '');
}

function normalizeBaseUrl(baseUrl: string): string {
    return baseUrl.replace(/\/+$/, '');
}

/**
 * Converts a parsed Pyth Hermes price into a flash-sdk {@link OraclePrice}.
 * Hermes fields map directly: `price`/`expo`/`conf`/`publish_time` →
 * `price`/`exponent`/`confidence`/`timestamp` (seconds).
 */
export function pythPriceToOraclePrice(price: PythParsedPrice['price']): OraclePrice {
    return new OraclePrice({
        price: new BN(String(price.price)),
        exponent: new BN(String(price.expo)),
        confidence: new BN(String(price.conf)),
        timestamp: new BN(String(price.publish_time)),
    });
}

/**
 * Creates the default Flash price source, backed by Pyth Hermes.
 *
 * @example
 * ```ts
 * const priceSource = createFlashPythPriceSource({ poolConfig: context.poolConfig });
 * const prices = await priceSource(['SOL']);
 * ```
 */
export function createFlashPythPriceSource(config: FlashPythPriceSourceConfig): FlashPriceSource {
    const { poolConfig, timeoutMs = DEFAULT_TIMEOUT_MS } = config;
    const fetchImpl = config.fetch ?? globalThis.fetch;
    const baseUrl = normalizeBaseUrl(config.baseUrl ?? FLASH_PYTH_HERMES_BASE_URL);

    return async symbols => {
        const uniqueSymbols = [...new Set(symbols)];
        const priceIdBySymbol = new Map<string, string>();

        for (const symbol of uniqueSymbols) {
            const token = poolConfig.tokens.find(candidate => candidate.symbol === symbol);
            if (!token?.pythPriceId) {
                throw new FlashPriceSourceError(
                    `Flash pool ${poolConfig.poolName} has no Pyth price id for symbol ${symbol}.`,
                );
            }
            priceIdBySymbol.set(symbol, normalizePriceId(token.pythPriceId));
        }

        const uniquePriceIds = [...new Set(priceIdBySymbol.values())];
        const query = uniquePriceIds.map(id => `ids[]=${encodeURIComponent(id)}`).join('&');
        const url = `${baseUrl}/v2/updates/price/latest?${query}`;

        let response: Response;
        try {
            response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
        } catch (cause) {
            throw new FlashPriceSourceError(
                `Flash price request to Pyth Hermes failed: ${cause instanceof Error ? cause.message : String(cause)}`,
            );
        }

        if (!response.ok) {
            throw new FlashPriceSourceError(`Flash price request failed with status ${response.status}.`, {
                statusCode: response.status,
                responseBody: await response.text().catch(() => undefined),
            });
        }

        const data = (await response.json()) as PythLatestPriceResponse;
        const parsedById = new Map<string, PythParsedPrice>();
        for (const entry of data.parsed ?? []) {
            parsedById.set(normalizePriceId(entry.id), entry);
        }

        const prices = new Map<string, OraclePrice>();
        for (const [symbol, priceId] of priceIdBySymbol) {
            const entry = parsedById.get(priceId);
            if (!entry) {
                throw new FlashPriceSourceError(
                    `Pyth Hermes response is missing a price for ${symbol} (id ${priceId}).`,
                );
            }
            prices.set(symbol, pythPriceToOraclePrice(entry.price));
        }

        return prices;
    };
}
