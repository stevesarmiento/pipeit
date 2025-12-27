/**
 * Jupiter Metis REST API client.
 *
 * Provides a minimal client for Jupiter's Metis Swap API.
 *
 * @packageDocumentation
 */

import type {
    MetisQuoteParams,
    QuoteResponse,
    SwapInstructionsRequest,
    SwapInstructionsResponse,
} from './types.js';

/**
 * Default Metis API base URL.
 */
export const METIS_DEFAULT_BASE_URL = 'https://api.jup.ag/swap/v1';

function normalizeBaseUrl(baseUrl: string): string {
    const trimmed = baseUrl.trim();
    if (!trimmed) {
        return trimmed;
    }

    // Relative paths (e.g. /api/metis for proxy) should stay as-is
    const isRelative = trimmed.startsWith('/');
    const hasProtocol = /^https?:\/\//i.test(trimmed);
    const normalized = isRelative || hasProtocol ? trimmed : `https://${trimmed}`;

    // Normalize trailing slashes so we can safely join paths.
    return normalized.replace(/\/+$/, '');
}

function joinUrl(baseUrl: string, path: string): string {
    const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
    const normalizedPath = path.replace(/^\/+/, '');
    return `${normalizedBaseUrl}/${normalizedPath}`;
}

/**
 * Configuration for the Metis client.
 */
export interface MetisClientConfig {
    /**
     * REST API base URL.
     *
     * If not provided, defaults to https://api.jup.ag/swap/v1.
     * You may pass a hostname without a protocol (https:// will be assumed).
     */
    baseUrl?: string;
    /**
     * API key for authentication.
     * Sent as the x-api-key header. Get one from https://portal.jup.ag
     */
    apiKey?: string;
    /** Custom fetch implementation (for testing or environments without global fetch) */
    fetch?: typeof globalThis.fetch;
}

/**
 * Jupiter Metis REST API client.
 */
export interface MetisClient {
    /** Get a swap quote */
    getQuote(params: MetisQuoteParams): Promise<QuoteResponse>;
    /** Get swap instructions from a quote */
    getSwapInstructions(request: SwapInstructionsRequest): Promise<SwapInstructionsResponse>;
}

/**
 * Create a Jupiter Metis REST API client.
 *
 * @example
 * ```ts
 * const client = createMetisClient({ apiKey: 'your-api-key' });
 *
 * const quote = await client.getQuote({
 *   inputMint: 'So11111111111111111111111111111111111111112',
 *   outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
 *   amount: 1_000_000_000n,
 * });
 *
 * const instructions = await client.getSwapInstructions({
 *   quoteResponse: quote,
 *   userPublicKey: 'YourWalletAddress...',
 * });
 * ```
 */
export function createMetisClient(config: MetisClientConfig = {}): MetisClient {
    const {
        baseUrl: baseUrlInput,
        apiKey,
        fetch: customFetch = globalThis.fetch,
    } = config;

    const baseUrl = normalizeBaseUrl(baseUrlInput ?? METIS_DEFAULT_BASE_URL);

    /**
     * Build common headers including API key if provided.
     */
    function buildHeaders(contentType?: string): Record<string, string> {
        const headers: Record<string, string> = {};
        if (apiKey) {
            headers['x-api-key'] = apiKey;
        }
        if (contentType) {
            headers['Content-Type'] = contentType;
        }
        return headers;
    }

    /**
     * Make a GET request to the Metis API.
     */
    async function get<T>(path: string, params?: URLSearchParams): Promise<T> {
        const base = joinUrl(baseUrl, path);
        const url = params ? `${base}?${params}` : base;

        const response = await customFetch(url, {
            headers: buildHeaders(),
        });

        if (!response.ok) {
            const errorText = await response.text().catch(() => 'Unknown error');
            throw new MetisApiError(response.status, errorText, path);
        }

        return response.json() as Promise<T>;
    }

    /**
     * Make a POST request to the Metis API.
     */
    async function post<T>(path: string, body: unknown): Promise<T> {
        const url = joinUrl(baseUrl, path);

        const response = await customFetch(url, {
            method: 'POST',
            headers: buildHeaders('application/json'),
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            const errorText = await response.text().catch(() => 'Unknown error');
            throw new MetisApiError(response.status, errorText, path);
        }

        return response.json() as Promise<T>;
    }

    return {
        async getQuote(params: MetisQuoteParams): Promise<QuoteResponse> {
            const urlParams = new URLSearchParams();

            // Required parameters
            urlParams.set('inputMint', params.inputMint);
            urlParams.set('outputMint', params.outputMint);
            urlParams.set('amount', params.amount.toString());

            // Optional parameters
            if (params.slippageBps !== undefined) {
                urlParams.set('slippageBps', params.slippageBps.toString());
            }
            if (params.swapMode !== undefined) {
                urlParams.set('swapMode', params.swapMode);
            }
            if (params.dexes !== undefined && params.dexes.length > 0) {
                urlParams.set('dexes', params.dexes.join(','));
            }
            if (params.excludeDexes !== undefined && params.excludeDexes.length > 0) {
                urlParams.set('excludeDexes', params.excludeDexes.join(','));
            }
            if (params.restrictIntermediateTokens !== undefined) {
                urlParams.set('restrictIntermediateTokens', String(params.restrictIntermediateTokens));
            }
            if (params.onlyDirectRoutes !== undefined) {
                urlParams.set('onlyDirectRoutes', String(params.onlyDirectRoutes));
            }
            if (params.asLegacyTransaction !== undefined) {
                urlParams.set('asLegacyTransaction', String(params.asLegacyTransaction));
            }
            if (params.platformFeeBps !== undefined) {
                urlParams.set('platformFeeBps', params.platformFeeBps.toString());
            }
            if (params.maxAccounts !== undefined) {
                urlParams.set('maxAccounts', params.maxAccounts.toString());
            }
            if (params.instructionVersion !== undefined) {
                urlParams.set('instructionVersion', params.instructionVersion);
            }

            return get<QuoteResponse>('quote', urlParams);
        },

        async getSwapInstructions(request: SwapInstructionsRequest): Promise<SwapInstructionsResponse> {
            return post<SwapInstructionsResponse>('swap-instructions', request);
        },
    };
}

/**
 * Error thrown when the Metis API returns an error response.
 */
export class MetisApiError extends Error {
    readonly statusCode: number;
    readonly responseBody: string;
    readonly path: string;

    constructor(statusCode: number, responseBody: string, path: string) {
        super(`Metis API error (${statusCode}) at ${path}: ${responseBody}`);
        this.name = 'MetisApiError';
        this.statusCode = statusCode;
        this.responseBody = responseBody;
        this.path = path;
    }
}
