/**
 * Titan REST API client.
 *
 * Provides a minimal client for Titan's REST API with MessagePack decoding.
 *
 * @packageDocumentation
 */

import { decode } from '@msgpack/msgpack';
import type {
    SwapQuoteParams,
    SwapQuotes,
    ServerInfo,
    ProviderInfo,
    VenueInfo,
    TitanPubkey,
} from './types.js';
import { encodeBase58 } from './convert.js';

/**
 * Configuration for the Titan client.
 */
export interface TitanClientConfig {
    /** REST API base URL (default: https://api.titan.ag/api/v1) */
    baseUrl?: string;
    /** Authentication token (optional, for fee collection) */
    authToken?: string;
    /** Custom fetch implementation (for testing or environments without global fetch) */
    fetch?: typeof globalThis.fetch;
}

/**
 * Titan REST API client.
 */
export interface TitanClient {
    /** Get a swap quote */
    getSwapQuote(params: SwapQuoteParams): Promise<SwapQuotes>;
    /** Get server info */
    getInfo(): Promise<ServerInfo>;
    /** List available providers */
    listProviders(includeIcons?: boolean): Promise<ProviderInfo[]>;
    /** Get available venues (DEXes) */
    getVenues(includeProgramIds?: boolean): Promise<VenueInfo>;
}

/**
 * Convert a pubkey (Uint8Array or string) to base58 string for URL params.
 */
function pubkeyToString(pubkey: TitanPubkey | string): string {
    if (typeof pubkey === 'string') {
        return pubkey;
    }
    return encodeBase58(pubkey);
}

/**
 * Create a Titan REST API client.
 *
 * @example
 * ```ts
 * const client = createTitanClient();
 *
 * const quotes = await client.getSwapQuote({
 *   swap: {
 *     inputMint: 'So11111111111111111111111111111111111111112',
 *     outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
 *     amount: 1_000_000_000n,
 *   },
 *   transaction: {
 *     userPublicKey: 'YourWalletAddress...',
 *   },
 * });
 * ```
 */
export function createTitanClient(config: TitanClientConfig = {}): TitanClient {
    const {
        baseUrl = 'https://api.titan.ag/api/v1',
        authToken,
        fetch: customFetch = globalThis.fetch,
    } = config;

    /**
     * Make a GET request to the Titan API.
     */
    async function get<T>(path: string, params?: URLSearchParams): Promise<T> {
        const url = params ? `${baseUrl}${path}?${params}` : `${baseUrl}${path}`;

        const headers: Record<string, string> = {};
        if (authToken) {
            headers['Authorization'] = `Bearer ${authToken}`;
        }

        const response = await customFetch(url, { headers });

        if (!response.ok) {
            const errorText = await response.text().catch(() => 'Unknown error');
            throw new TitanApiError(response.status, errorText, path);
        }

        // Titan returns MessagePack-encoded responses
        const buffer = await response.arrayBuffer();
        // Use useBigInt64 to decode u64 values as BigInt (prevents precision loss)
        return decode(new Uint8Array(buffer), { useBigInt64: true }) as T;
    }

    return {
        async getSwapQuote(params: SwapQuoteParams): Promise<SwapQuotes> {
            const { swap, transaction } = params;

            const urlParams = new URLSearchParams();

            // Required parameters
            urlParams.set('inputMint', pubkeyToString(swap.inputMint));
            urlParams.set('outputMint', pubkeyToString(swap.outputMint));
            urlParams.set('amount', swap.amount.toString());
            urlParams.set('userPublicKey', pubkeyToString(transaction.userPublicKey));

            // Optional swap parameters
            if (swap.swapMode !== undefined) {
                urlParams.set('swapMode', swap.swapMode);
            }
            if (swap.slippageBps !== undefined) {
                urlParams.set('slippageBps', swap.slippageBps.toString());
            }
            if (swap.dexes !== undefined && swap.dexes.length > 0) {
                urlParams.set('dexes', swap.dexes.join(','));
            }
            if (swap.excludeDexes !== undefined && swap.excludeDexes.length > 0) {
                urlParams.set('excludeDexes', swap.excludeDexes.join(','));
            }
            if (swap.onlyDirectRoutes !== undefined) {
                urlParams.set('onlyDirectRoutes', String(swap.onlyDirectRoutes));
            }
            if (swap.providers !== undefined && swap.providers.length > 0) {
                urlParams.set('providers', swap.providers.join(','));
            }

            // Optional transaction parameters
            if (transaction.closeInputTokenAccount !== undefined) {
                urlParams.set('closeInputTokenAccount', String(transaction.closeInputTokenAccount));
            }
            if (transaction.createOutputTokenAccount !== undefined) {
                urlParams.set('createOutputTokenAccount', String(transaction.createOutputTokenAccount));
            }
            if (transaction.feeAccount !== undefined) {
                urlParams.set('feeAccount', pubkeyToString(transaction.feeAccount));
            }
            if (transaction.feeBps !== undefined) {
                urlParams.set('feeBps', transaction.feeBps.toString());
            }
            if (transaction.feeFromInputMint !== undefined) {
                urlParams.set('feeFromInputMint', String(transaction.feeFromInputMint));
            }
            if (transaction.outputAccount !== undefined) {
                urlParams.set('outputAccount', pubkeyToString(transaction.outputAccount));
            }

            return get<SwapQuotes>('/quote/swap', urlParams);
        },

        async getInfo(): Promise<ServerInfo> {
            return get<ServerInfo>('/info');
        },

        async listProviders(includeIcons = false): Promise<ProviderInfo[]> {
            const params = new URLSearchParams();
            if (includeIcons) {
                params.set('includeIcons', 'true');
            }
            return get<ProviderInfo[]>('/providers', params);
        },

        async getVenues(includeProgramIds = false): Promise<VenueInfo> {
            const params = new URLSearchParams();
            if (includeProgramIds) {
                params.set('includeProgramIds', 'true');
            }
            return get<VenueInfo>('/venues', params);
        },
    };
}

/**
 * Error thrown when the Titan API returns an error response.
 */
export class TitanApiError extends Error {
    readonly statusCode: number;
    readonly responseBody: string;
    readonly path: string;

    constructor(statusCode: number, responseBody: string, path: string) {
        super(`Titan API error (${statusCode}) at ${path}: ${responseBody}`);
        this.name = 'TitanApiError';
        this.statusCode = statusCode;
        this.responseBody = responseBody;
        this.path = path;
    }
}
