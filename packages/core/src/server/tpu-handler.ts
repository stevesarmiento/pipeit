/**
 * TPU handler for Next.js API routes.
 *
 * Provides a drop-in handler function that can be exported directly
 * from a Next.js API route to enable TPU submission in browser environments.
 *
 * @packageDocumentation
 */

import type { ResolvedExecutionConfig } from '../execution/types.js';
import type { TpuErrorCode } from '../errors/tpu-errors.js';

/**
 * Request body for TPU API route.
 */
export interface TpuHandlerRequest {
    /**
     * Base64-encoded signed transaction.
     */
    transaction: string;

    /**
     * Optional TPU configuration overrides.
     * If not provided, uses environment variables.
     */
    config?: {
        rpcUrl?: string;
        wsUrl?: string;
        fanout?: number;
    };
}

/**
 * Per-leader send result in handler response.
 */
export interface TpuHandlerLeaderResult {
    /** Validator identity pubkey. */
    identity: string;
    /** TPU socket address. */
    address: string;
    /** Whether send succeeded. */
    success: boolean;
    /** Latency in milliseconds. */
    latencyMs: number;
    /** Error message if failed. */
    error?: string;
    /** Error code for programmatic handling. */
    errorCode?: TpuErrorCode;
    /** Number of attempts made. */
    attempts: number;
}

/**
 * Response from TPU submission.
 */
export interface TpuHandlerResponse {
    /**
     * Whether the transaction was successfully delivered to leaders.
     */
    delivered: boolean;

    /**
     * Number of leaders the transaction was sent to.
     */
    leaderCount: number;

    /**
     * Time taken to submit the transaction in milliseconds.
     */
    latencyMs: number;

    /**
     * Error message if submission failed.
     */
    error?: string;

    /**
     * Per-leader breakdown of send results.
     * Provides detailed information about each leader send attempt.
     */
    leaders?: TpuHandlerLeaderResult[];

    /**
     * Total retry attempts made across all leaders.
     */
    retryCount?: number;
}

// Singleton TPU client instance
let tpuClient: TpuClientInstance | null = null;
let currentConfig: ResolvedExecutionConfig['tpu'] | null = null;
// Promise-based lock to prevent concurrent initialization
let inFlightInit: Promise<TpuClientInstance> | null = null;

interface TpuClientInstance {
    sendTransaction: (tx: Buffer) => Promise<{
        delivered: boolean;
        leaderCount: number;
        latencyMs: number;
        leaders: Array<{
            identity: string;
            address: string;
            success: boolean;
            latencyMs: number;
            error?: string;
            errorCode?: string;
            attempts: number;
        }>;
        retryCount: number;
    }>;
    waitReady: () => Promise<void>;
    getStats: () => Promise<{
        connectionCount: number;
        currentSlot: number;
        endpointCount: number;
        readyState: string;
        uptimeSecs: number;
        knownValidators: number;
    }>;
    shutdown: () => void;
}

/**
 * Get or create the singleton TPU client.
 *
 * The client is created lazily on the first request and reused for
 * subsequent requests. If the configuration changes, the old client
 * is shut down and a new one is created.
 *
 * Uses a promise-based lock to ensure only one client instance is
 * created even when multiple concurrent callers request initialization.
 */
async function getTpuClient(config: { rpcUrl: string; wsUrl: string; fanout: number }): Promise<TpuClientInstance> {
    // Check if we need to recreate the client
    const configChanged =
        currentConfig &&
        (currentConfig.rpcUrl !== config.rpcUrl ||
            currentConfig.wsUrl !== config.wsUrl ||
            currentConfig.fanout !== config.fanout);

    if (configChanged && tpuClient) {
        // Shut down old client before creating a new one
        tpuClient.shutdown();
        tpuClient = null;
        currentConfig = null;
        // Also clear any in-flight init since config changed
        inFlightInit = null;
    }

    // Fast path: return existing client if available
    if (tpuClient) {
        return tpuClient;
    }

    // If another caller is already initializing, wait for that to complete
    if (inFlightInit) {
        return inFlightInit;
    }

    // Start initialization and set the lock
    inFlightInit = (async (): Promise<TpuClientInstance> => {
        try {
            // Dynamic import to avoid bundling issues
            // @ts-ignore - Optional dependency loaded at runtime
            // webpackIgnore tells bundlers to skip resolving this import
            const tpuNative = await import(/* webpackIgnore: true */ '@pipeit/fastlane');
            const { TpuClient } = tpuNative;

            const client = new (TpuClient as any)({
                rpcUrl: config.rpcUrl,
                wsUrl: config.wsUrl,
                fanout: config.fanout,
            }) as TpuClientInstance;

            // Wait for client to be ready (fetch initial leader schedule, etc.)
            await client.waitReady();

            // Assign to singleton
            tpuClient = client;
            currentConfig = {
                ...config,
                enabled: true,
                apiRoute: '/api/tpu',
            };

            return client;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'MODULE_NOT_FOUND') {
                throw new Error(
                    'TPU submission requires @pipeit/fastlane package. ' +
                        'Install it with: npm install @pipeit/fastlane',
                );
            }
            throw error;
        } finally {
            // Clear the lock on both success and failure
            inFlightInit = null;
        }
    })();

    return inFlightInit;
}

/**
 * Wait for the TPU client to have enough known validators.
 * 
 * The client may be "ready" (slot listener started) but not have
 * leader sockets populated yet. This function waits until enough
 * validators are known or times out.
 * 
 * @param client - TPU client instance
 * @param minValidators - Minimum number of validators required (default: 10)
 * @param timeoutMs - Maximum time to wait in milliseconds (default: 10000)
 * @returns True if enough validators are available, false if timed out
 */
async function waitForValidators(
    client: TpuClientInstance, 
    minValidators = 10,
    timeoutMs = 10000
): Promise<boolean> {
    const startTime = Date.now();
    const pollInterval = 200;
    let lastValidatorCount = 0;

    while (Date.now() - startTime < timeoutMs) {
        try {
            const stats = await client.getStats();
            if (stats.knownValidators !== lastValidatorCount) {
                console.log(`[TPU] Validators discovered: ${stats.knownValidators} (need ${minValidators}+)`);
                lastValidatorCount = stats.knownValidators;
            }
            
            // Need enough validators for good landing rate
            if (stats.knownValidators >= minValidators && stats.readyState === 'ready') {
                console.log(`[TPU] ✅ Ready with ${stats.knownValidators} known validators`);
                return true;
            }
        } catch {
            // Stats not available yet, continue polling
        }
        await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    console.warn(
        `[TPU] ⚠️ Timeout waiting for validators. Only ${lastValidatorCount} known (wanted ${minValidators}+). ` +
        `This may reduce landing rate.`
    );
    return false;
}

/**
 * Resolve TPU configuration from request and environment variables.
 */
function resolveConfig(requestConfig?: TpuHandlerRequest['config']): {
    rpcUrl: string;
    wsUrl: string;
    fanout: number;
} {
    const rpcUrl = requestConfig?.rpcUrl || process.env.SOLANA_RPC_URL || process.env.RPC_URL || '';

    if (!rpcUrl) {
        throw new Error(
            'RPC URL is required. Set SOLANA_RPC_URL or RPC_URL environment variable, or provide it in the request config.',
        );
    }

    // Derive WebSocket URL from RPC URL if not provided
    const wsUrl = requestConfig?.wsUrl || process.env.SOLANA_WS_URL || process.env.WS_URL || deriveWsUrl(rpcUrl);

    // Default to 4 leaders for better landing rates
    const fanout = requestConfig?.fanout ?? 4;

    return { rpcUrl, wsUrl, fanout };
}

/**
 * Derive WebSocket URL from RPC URL.
 *
 * Converts http(s):// to ws(s):// and maintains the rest of the URL.
 */
function deriveWsUrl(rpcUrl: string): string {
    try {
        const url = new URL(rpcUrl);
        url.protocol = url.protocol.replace('http', 'ws');
        return url.toString();
    } catch {
        throw new Error(`Invalid RPC URL: ${rpcUrl}`);
    }
}

/**
 * TPU handler for Next.js API routes.
 *
 * This is a drop-in handler that can be exported directly from a
 * Next.js API route to enable TPU submission.
 *
 * @example
 * ```typescript
 * // app/api/tpu/route.ts
 * export { tpuHandler as POST } from '@pipeit/core/server';
 * ```
 *
 * @example
 * ```typescript
 * // With custom configuration
 * import { tpuHandler } from '@pipeit/core/server';
 *
 * export async function POST(request: Request) {
 *   return tpuHandler(request, {
 *     rpcUrl: 'https://my-custom-rpc.com',
 *     wsUrl: 'wss://my-custom-ws.com',
 *     fanout: 4,
 *   });
 * }
 * ```
 */
export async function tpuHandler(
    request: Request,
    defaultConfig?: { rpcUrl?: string; wsUrl?: string; fanout?: number },
): Promise<Response> {
    try {
        // Parse request body
        const body = (await request.json()) as TpuHandlerRequest;

        if (!body.transaction) {
            return Response.json(
                {
                    error: 'Missing transaction in request body',
                    delivered: false,
                    leaderCount: 0,
                    latencyMs: 0,
                } satisfies TpuHandlerResponse,
                { status: 400 },
            );
        }

        // Resolve configuration
        const config = resolveConfig({
            ...defaultConfig,
            ...body.config,
        });

        // Get or create TPU client
        const client = await getTpuClient(config);

        // Wait for validators to be available before sending
        // This prevents "No leaders available" errors on first requests
        // We need at least fanout * 2 validators for good leader discovery
        const minValidators = config.fanout * 2;
        const hasValidators = await waitForValidators(client, minValidators, 10000);
        if (!hasValidators) {
            console.warn(`[TPU] ⚠️ Proceeding with limited validators - landing rate may be reduced`);
        }

        // Convert base64 transaction to Buffer
        const txBuffer = Buffer.from(body.transaction, 'base64');

        const startTime = performance.now();

        // Get stats for logging
        let stats: { knownValidators: number; currentSlot: number } | null = null;
        try {
            stats = await client.getStats();
        } catch {
            // Stats not available
        }

        console.log('\n┌─────────────────────────────────────────────────────────────┐');
        console.log('│ 🚀 TPU DIRECT SUBMISSION                                    │');
        console.log('├─────────────────────────────────────────────────────────────┤');
        console.log(`│ Protocol: QUIC (native)                                     │`);
        console.log(`│ Target: Validator TPU endpoints                             │`);
        console.log(`│ Transaction size: ${txBuffer.length} bytes`.padEnd(62) + '│');
        console.log(`│ Configured fanout: ${config.fanout}`.padEnd(62) + '│');
        if (stats) {
            console.log(`│ Known validators: ${stats.knownValidators}`.padEnd(62) + '│');
            console.log(`│ Current slot: ${stats.currentSlot}`.padEnd(62) + '│');
            // Warn if validator count is low
            if (stats.knownValidators < config.fanout * 2) {
                console.log(`│ ⚠️  LOW VALIDATOR COUNT - may reduce landing rate!`.padEnd(61) + '│');
            }
        }

        // Send transaction
        const result = await client.sendTransaction(txBuffer);

        const latencyMs = Math.round(performance.now() - startTime);

        console.log(`│ Leaders reached: ${result.leaderCount}/${config.fanout}`.padEnd(62) + '│');
        if (result.leaderCount < config.fanout) {
            console.log(`│ ⚠️  FEWER LEADERS THAN FANOUT - check validator sockets`.padEnd(61) + '│');
        }
        console.log(`│ Delivery: ${result.delivered ? '✅ SUCCESS' : '❌ FAILED'}`.padEnd(62) + '│');
        console.log(`│ Retries: ${result.retryCount ?? 0}`.padEnd(62) + '│');
        console.log(`│ Latency: ${latencyMs}ms`.padEnd(62) + '│');
        console.log('├─────────────────────────────────────────────────────────────┤');
        console.log('│ ⚡ NOTE: "delivered" = sent to TPU, NOT confirmed on-chain  │');
        console.log('│    Confirmation happens after this via RPC polling.         │');
        console.log('└─────────────────────────────────────────────────────────────┘\n');

        // Map per-leader results (with fallback for older fastlane versions)
        let leaders: TpuHandlerLeaderResult[] = [];
        
        if (result.leaders && Array.isArray(result.leaders)) {
            // New fastlane version with per-leader results
            leaders = result.leaders.map((lr) => {
                const mapped: TpuHandlerLeaderResult = {
                    identity: lr.identity,
                    address: lr.address,
                    success: lr.success,
                    latencyMs: lr.latencyMs,
                    attempts: lr.attempts ?? 1,
                };
                // Only add optional fields if defined (exactOptionalPropertyTypes)
                if (lr.error !== undefined) {
                    mapped.error = lr.error;
                }
                if (lr.errorCode !== undefined) {
                    mapped.errorCode = lr.errorCode as TpuErrorCode;
                }
                return mapped;
            });
        } else {
            // Fallback for older fastlane versions - generate leader data from summary
            const leaderCount = result.leaderCount ?? 1;
            const perLeaderLatency = Math.round(latencyMs / Math.max(leaderCount, 1));
            
            for (let i = 0; i < leaderCount; i++) {
                leaders.push({
                    identity: `Leader${i + 1}`,
                    address: `validator-${i + 1}:8009`,
                    success: result.delivered,
                    latencyMs: perLeaderLatency,
                    attempts: 1,
                });
            }
        }

        return Response.json({
            delivered: result.delivered,
            leaderCount: result.leaderCount,
            latencyMs,
            leaders,
            retryCount: result.retryCount,
        } satisfies TpuHandlerResponse);
    } catch (error) {
        console.error('TPU handler error:', error);

        return Response.json(
            {
                error: error instanceof Error ? error.message : String(error),
                delivered: false,
                leaderCount: 0,
                latencyMs: 0,
            } satisfies TpuHandlerResponse,
            { status: 500 },
        );
    }
}

/**
 * Graceful shutdown of the TPU client.
 *
 * Call this in your server shutdown handler to cleanly close
 * the TPU client connections.
 *
 * @example
 * ```typescript
 * process.on('SIGTERM', () => {
 *   shutdownTpuClient();
 *   process.exit(0);
 * });
 * ```
 */
export function shutdownTpuClient(): void {
    if (tpuClient) {
        tpuClient.shutdown();
        tpuClient = null;
        currentConfig = null;
    }
}
