/**
 * Parallel transaction submission to multiple RPC endpoints.
 *
 * Submitting to multiple endpoints simultaneously increases the probability
 * of landing a transaction, especially during network congestion.
 *
 * @packageDocumentation
 */

import type { ParallelSubmitOptions, ParallelSubmitResult } from './types.js';

// ============================================================================
// Constants
// ============================================================================

/**
 * Default timeout for individual RPC submissions (30 seconds).
 */
const DEFAULT_SUBMIT_TIMEOUT = 30_000;

// ============================================================================
// Errors
// ============================================================================

/**
 * Error thrown when all parallel submission attempts fail.
 */
export class ParallelSubmitError extends Error {
    readonly errors: Array<{ endpoint: string; error: Error }>;

    constructor(message: string, errors: Array<{ endpoint: string; error: Error }>) {
        super(message);
        this.name = 'ParallelSubmitError';
        this.errors = errors;
    }
}

// ============================================================================
// Types
// ============================================================================

/**
 * Internal result from a single endpoint submission attempt.
 */
interface EndpointSubmitResult {
    signature: string;
    endpoint: string;
    startTime: number;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Submit transaction to a single RPC endpoint.
 *
 * @param endpoint - RPC endpoint URL
 * @param transaction - Base64-encoded signed transaction
 * @param skipPreflight - Whether to skip preflight simulation
 * @param abortSignal - Signal to abort the request
 * @returns Submission result with signature and timing
 */
async function submitToEndpoint(
    endpoint: string,
    transaction: string,
    skipPreflight: boolean,
    abortSignal?: AbortSignal,
): Promise<EndpointSubmitResult> {
    const startTime = performance.now();

    const fetchOptions: RequestInit = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'sendTransaction',
            params: [
                transaction,
                {
                    encoding: 'base64',
                    skipPreflight,
                    preflightCommitment: 'confirmed',
                },
            ],
        }),
    };

    if (abortSignal) {
        fetchOptions.signal = abortSignal;
    }

    const response = await fetch(endpoint, fetchOptions);

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`RPC error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();

    if (data.error) {
        throw new Error(data.error.message || JSON.stringify(data.error));
    }

    if (!data.result) {
        throw new Error('No signature returned from RPC');
    }

    return {
        signature: data.result,
        endpoint,
        startTime,
    };
}

/**
 * Create a promise that rejects after a timeout.
 */
function createTimeoutPromise(ms: number, signal?: AbortSignal): Promise<never> {
    return new Promise((_, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`Submission timed out after ${ms}ms`));
        }, ms);

        signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new Error('Submission aborted'));
        });
    });
}

// ============================================================================
// Main Export
// ============================================================================

/**
 * Submit a transaction to multiple RPC endpoints in parallel.
 *
 * Uses Promise.race to return as soon as the first endpoint succeeds.
 * All other pending requests are cancelled via AbortController.
 *
 * This strategy maximizes landing probability by betting on whichever
 * endpoint has the fastest path to the current leader.
 *
 * @param options - Submission options
 * @returns Result from the first successful endpoint
 * @throws {ParallelSubmitError} If all endpoints fail
 *
 * @example
 * ```ts
 * const result = await submitParallel({
 *   endpoints: [
 *     'https://api.mainnet-beta.solana.com',
 *     'https://my-helius-rpc.com',
 *   ],
 *   transaction: base64Tx,
 *   skipPreflight: true,
 * });
 *
 * console.log(`Landed via ${result.endpoint} in ${result.latencyMs}ms`);
 * ```
 */
export async function submitParallel(options: ParallelSubmitOptions): Promise<ParallelSubmitResult> {
    const { endpoints, transaction, skipPreflight = true, abortSignal } = options;

    if (endpoints.length === 0) {
        throw new ParallelSubmitError('No endpoints provided', []);
    }

    // Single endpoint - no need for parallel logic
    if (endpoints.length === 1) {
        const startTime = performance.now();
        const result = await submitToEndpoint(endpoints[0], transaction, skipPreflight, abortSignal);
        return {
            signature: result.signature,
            endpoint: result.endpoint,
            latencyMs: Math.round(performance.now() - startTime),
        };
    }

    // Create abort controller to cancel losing requests
    const abortController = new AbortController();
    const combinedSignal = abortSignal
        ? combineAbortSignals(abortSignal, abortController.signal)
        : abortController.signal;

    const errors: Array<{ endpoint: string; error: Error }> = [];
    const startTime = performance.now();

    // Create submission promises for each endpoint
    const submissionPromises = endpoints.map(async endpoint => {
        try {
            return await submitToEndpoint(endpoint, transaction, skipPreflight, combinedSignal);
        } catch (error) {
            // Collect errors but don't reject yet
            errors.push({
                endpoint,
                error: error instanceof Error ? error : new Error(String(error)),
            });
            // Re-throw to let Promise.any continue
            throw error;
        }
    });

    try {
        // Use Promise.race to wrap Promise.any with a timeout
        const result = (await Promise.race([
            Promise.any(submissionPromises),
            createTimeoutPromise(DEFAULT_SUBMIT_TIMEOUT, combinedSignal),
        ])) as EndpointSubmitResult;

        // Cancel remaining requests
        abortController.abort();

        return {
            signature: result.signature,
            endpoint: result.endpoint,
            latencyMs: Math.round(performance.now() - startTime),
        };
    } catch (error) {
        // All submissions failed or timed out
        abortController.abort();

        if (error instanceof AggregateError) {
            throw new ParallelSubmitError(
                `All ${endpoints.length} endpoints failed`,
                errors.length > 0
                    ? errors
                    : error.errors.map((e, i) => ({
                          endpoint: endpoints[i],
                          error: e instanceof Error ? e : new Error(String(e)),
                      })),
            );
        }

        throw new ParallelSubmitError(error instanceof Error ? error.message : 'Parallel submission failed', errors);
    }
}

/**
 * Combine two abort signals into one.
 * The combined signal aborts when either input signal aborts.
 */
function combineAbortSignals(signal1: AbortSignal, signal2: AbortSignal): AbortSignal {
    const controller = new AbortController();

    const abort = () => controller.abort();

    signal1.addEventListener('abort', abort);
    signal2.addEventListener('abort', abort);

    // Check if either is already aborted
    if (signal1.aborted || signal2.aborted) {
        controller.abort();
    }

    return controller.signal;
}

/**
 * Submit transaction to RPC endpoint using the configured RPC client.
 *
 * This is a lower-level function that uses the RPC connection object
 * rather than direct fetch. Useful when you want to use the builder's
 * configured RPC with all its settings.
 *
 * @param rpcUrl - The RPC endpoint URL
 * @param transaction - Base64-encoded signed transaction
 * @param options - Submission options
 * @returns Transaction signature
 */
export async function submitToRpc(
    rpcUrl: string,
    transaction: string,
    options: {
        skipPreflight?: boolean;
        preflightCommitment?: 'processed' | 'confirmed' | 'finalized';
        maxRetries?: number;
        abortSignal?: AbortSignal;
    } = {},
): Promise<string> {
    const { skipPreflight = true, preflightCommitment = 'confirmed', maxRetries, abortSignal } = options;

    const startTime = performance.now();

    // Parse RPC URL for display
    const rpcHost = (() => {
        try {
            return new URL(rpcUrl).hostname;
        } catch {
            return rpcUrl;
        }
    })();

    console.log('\n┌─────────────────────────────────────────────────────────────┐');
    console.log('│ 📡 RPC SUBMISSION (Standard)                                │');
    console.log('├─────────────────────────────────────────────────────────────┤');
    console.log(`│ Protocol: HTTP/JSON-RPC                                     │`);
    console.log(`│ Target: ${rpcHost}`.slice(0, 61).padEnd(62) + '│');
    console.log(`│ Method: sendTransaction                                     │`);

    const params: Record<string, unknown> = {
        encoding: 'base64',
        skipPreflight,
    };

    if (!skipPreflight) {
        params.preflightCommitment = preflightCommitment;
    }

    if (maxRetries !== undefined) {
        params.maxRetries = maxRetries;
    }

    const fetchOptions: RequestInit = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'sendTransaction',
            params: [transaction, params],
        }),
    };

    if (abortSignal) {
        fetchOptions.signal = abortSignal;
    }

    const response = await fetch(rpcUrl, fetchOptions);

    if (!response.ok) {
        const errorText = await response.text();
        console.log(`│ Result: ❌ FAILED (${response.status})`.padEnd(62) + '│');
        console.log('└─────────────────────────────────────────────────────────────┘\n');
        throw new Error(`RPC error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();

    if (data.error) {
        console.log(`│ Result: ❌ FAILED`.padEnd(62) + '│');
        console.log('└─────────────────────────────────────────────────────────────┘\n');
        throw new Error(data.error.message || JSON.stringify(data.error));
    }

    if (!data.result) {
        console.log(`│ Result: ❌ No signature`.padEnd(62) + '│');
        console.log('└─────────────────────────────────────────────────────────────┘\n');
        throw new Error('No signature returned from RPC');
    }

    const latencyMs = Math.round(performance.now() - startTime);
    console.log(`│ Result: ✅ SUCCESS`.padEnd(62) + '│');
    console.log(`│ Latency: ${latencyMs}ms`.padEnd(62) + '│');
    console.log(`│ Signature: ${data.result.slice(0, 20)}...`.padEnd(62) + '│');
    console.log('└─────────────────────────────────────────────────────────────┘\n');

    return data.result;
}



