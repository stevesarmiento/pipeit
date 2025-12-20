/**
 * Execution strategy orchestration.
 *
 * Resolves preset strategies to full configurations and executes
 * transactions with the appropriate submission paths.
 *
 * @packageDocumentation
 */

import type {
    ExecutionConfig,
    ExecutionPreset,
    ResolvedExecutionConfig,
    ExecutionContext,
    ExecutionResult,
} from './types.js';
import { sendBundle, getBundleStatuses, JITO_BLOCK_ENGINES, JITO_DEFAULT_TIP_LAMPORTS } from './jito.js';
import { submitParallel, submitToRpc } from './parallel.js';

// ============================================================================
// Strategy Presets
// ============================================================================

/** Default TPU configuration values. */
const TPU_DEFAULTS = {
    // Default to public mainnet RPC - users should override for better performance
    rpcUrl: 'https://api.mainnet-beta.solana.com',
    wsUrl: 'wss://api.mainnet-beta.solana.com',
    fanout: 8, // More leaders = higher landing rate (looks at 32 slots ahead)
    apiRoute: '/api/tpu',
};

/**
 * Default configurations for each execution preset.
 *
 * - 'standard': Default RPC only, no Jito, no parallel, no TPU
 * - 'economical': Jito bundle only (good balance)
 * - 'fast': Jito + parallel RPC race (max speed)
 * - 'ultra': TPU + Jito race (fastest possible)
 */
const PRESET_CONFIGS: Record<ExecutionPreset, ResolvedExecutionConfig> = {
    standard: {
        jito: {
            enabled: false,
            tipLamports: 0n,
            blockEngineUrl: JITO_BLOCK_ENGINES.mainnet,
            mevProtection: false,
        },
        parallel: {
            enabled: false,
            endpoints: [],
            raceWithDefault: true,
        },
        tpu: {
            enabled: false,
            ...TPU_DEFAULTS,
        },
    },
    economical: {
        jito: {
            enabled: true,
            tipLamports: JITO_DEFAULT_TIP_LAMPORTS,
            blockEngineUrl: JITO_BLOCK_ENGINES.mainnet,
            mevProtection: true,
        },
        parallel: {
            enabled: false,
            endpoints: [],
            raceWithDefault: true,
        },
        tpu: {
            enabled: false,
            ...TPU_DEFAULTS,
        },
    },
    fast: {
        jito: {
            enabled: true,
            tipLamports: JITO_DEFAULT_TIP_LAMPORTS,
            blockEngineUrl: JITO_BLOCK_ENGINES.mainnet,
            mevProtection: true,
        },
        parallel: {
            enabled: true,
            endpoints: [],
            raceWithDefault: true,
        },
        tpu: {
            enabled: false,
            ...TPU_DEFAULTS,
        },
    },
    ultra: {
        jito: {
            enabled: true,
            tipLamports: JITO_DEFAULT_TIP_LAMPORTS,
            blockEngineUrl: JITO_BLOCK_ENGINES.mainnet,
            mevProtection: true,
        },
        parallel: {
            enabled: false,
            endpoints: [],
            raceWithDefault: true,
        },
        tpu: {
            enabled: true,
            ...TPU_DEFAULTS,
        },
    },
};

// ============================================================================
// Strategy Resolution
// ============================================================================

/**
 * Check if a value is an execution preset string.
 */
function isPreset(config: ExecutionConfig): config is ExecutionPreset {
    return typeof config === 'string';
}

/**
 * Resolve execution configuration to a fully populated config object.
 *
 * Converts preset strings to full configs and fills in defaults for
 * partial configurations.
 *
 * @param config - User-provided execution config (preset or object)
 * @returns Fully resolved execution configuration
 *
 * @example
 * ```ts
 * // Preset
 * const resolved = resolveExecutionConfig('fast');
 *
 * // Partial config - missing values filled with defaults
 * const resolved = resolveExecutionConfig({
 *   jito: { enabled: true, tipLamports: 50_000n },
 * });
 * ```
 */
export function resolveExecutionConfig(config: ExecutionConfig | undefined): ResolvedExecutionConfig {
    // Default to standard if not provided
    if (!config) {
        return { ...PRESET_CONFIGS.standard };
    }

    // If it's a preset string, return the preset config
    if (isPreset(config)) {
        return { ...PRESET_CONFIGS[config] };
    }

    // Merge user config with defaults
    const jitoConfig = config.jito;
    const parallelConfig = config.parallel;
    const tpuConfig = config.tpu;

    return {
        jito: {
            enabled: jitoConfig?.enabled ?? false,
            tipLamports: jitoConfig?.tipLamports ?? JITO_DEFAULT_TIP_LAMPORTS,
            blockEngineUrl:
                typeof jitoConfig?.blockEngineUrl === 'string' && jitoConfig.blockEngineUrl in JITO_BLOCK_ENGINES
                    ? JITO_BLOCK_ENGINES[jitoConfig.blockEngineUrl as keyof typeof JITO_BLOCK_ENGINES]
                    : (jitoConfig?.blockEngineUrl ?? JITO_BLOCK_ENGINES.mainnet),
            mevProtection: jitoConfig?.mevProtection ?? true,
        },
        parallel: {
            enabled: parallelConfig?.enabled ?? false,
            endpoints: parallelConfig?.endpoints ?? [],
            raceWithDefault: parallelConfig?.raceWithDefault ?? true,
        },
        tpu: {
            enabled: tpuConfig?.enabled ?? false,
            rpcUrl: tpuConfig?.rpcUrl ?? TPU_DEFAULTS.rpcUrl,
            wsUrl: tpuConfig?.wsUrl ?? TPU_DEFAULTS.wsUrl,
            fanout: tpuConfig?.fanout ?? TPU_DEFAULTS.fanout,
            apiRoute: tpuConfig?.apiRoute ?? TPU_DEFAULTS.apiRoute,
        },
    };
}

// ============================================================================
// Strategy Execution
// ============================================================================

/**
 * Error thrown when execution strategy fails.
 */
export class ExecutionStrategyError extends Error {
    readonly jitoError: Error | undefined;
    readonly parallelError: Error | undefined;
    readonly tpuError: Error | undefined;

    constructor(message: string, options?: { jitoError?: Error; parallelError?: Error; tpuError?: Error }) {
        super(message);
        this.name = 'ExecutionStrategyError';
        this.jitoError = options?.jitoError;
        this.parallelError = options?.parallelError;
        this.tpuError = options?.tpuError;
    }
}

/**
 * Execute a signed transaction using the resolved strategy.
 *
 * This is the core function that routes the transaction to the
 * appropriate submission paths based on configuration.
 *
 * @param transaction - Base64-encoded signed transaction
 * @param config - Resolved execution configuration
 * @param context - Execution context (RPC URL, abort signal, etc.)
 * @returns Execution result with signature and metadata
 *
 * @example
 * ```ts
 * const result = await executeWithStrategy(
 *   base64Tx,
 *   resolveExecutionConfig('fast'),
 *   { rpcUrl: 'https://api.mainnet-beta.solana.com' }
 * );
 * ```
 */
export async function executeWithStrategy(
    transaction: string,
    config: ResolvedExecutionConfig,
    context: ExecutionContext & { rpcUrl?: string },
): Promise<ExecutionResult> {
    const { jito, parallel, tpu } = config;
    const { rpcUrl, abortSignal } = context;

    const startTime = performance.now();

    // Case 1: TPU enabled - use direct TPU submission (possibly racing with others)
    if (tpu.enabled) {
        return executeTpuStrategy(transaction, config, context, startTime);
    }

    // Case 2: Neither Jito nor parallel enabled - standard RPC submission
    if (!jito.enabled && !parallel.enabled) {
        if (!rpcUrl) {
            throw new ExecutionStrategyError('RPC URL required for standard submission');
        }

        const signature = await submitToRpc(rpcUrl, transaction, {
            skipPreflight: true,
            ...(abortSignal && { abortSignal }),
        });

        return {
            signature,
            landedVia: 'rpc',
            latencyMs: Math.round(performance.now() - startTime),
        };
    }

    // Case 3: Jito only - submit bundle
    if (jito.enabled && !parallel.enabled) {
        const bundleId = await sendBundle([transaction], {
            blockEngineUrl: jito.blockEngineUrl,
            ...(abortSignal && { abortSignal }),
        });

        // Get the signature from bundle status (first transaction's signature)
        // Note: For single-tx bundles, we need to extract the signature
        const signature = await waitForBundleSignature(bundleId, {
            blockEngineUrl: jito.blockEngineUrl,
            ...(abortSignal && { abortSignal }),
        });

        return {
            signature,
            landedVia: 'jito',
            latencyMs: Math.round(performance.now() - startTime),
            bundleId,
        };
    }

    // Case 4: Parallel only - submit to multiple RPCs
    if (!jito.enabled && parallel.enabled) {
        const endpoints = buildEndpointList(rpcUrl, parallel);

        if (endpoints.length === 0) {
            throw new ExecutionStrategyError('No endpoints available for parallel submission');
        }

        const result = await submitParallel({
            endpoints,
            transaction,
            skipPreflight: true,
            ...(abortSignal && { abortSignal }),
        });

        return {
            signature: result.signature,
            landedVia: 'parallel',
            latencyMs: result.latencyMs,
            endpoint: result.endpoint,
        };
    }

    // Case 5: Both Jito and parallel - race them
    return executeRaceStrategy(transaction, config, context, startTime);
}

/**
 * Build the list of endpoints for parallel submission.
 */
function buildEndpointList(
    defaultRpcUrl: string | undefined,
    parallelConfig: ResolvedExecutionConfig['parallel'],
): string[] {
    const endpoints: string[] = [];

    // Add user-provided endpoints
    if (parallelConfig.endpoints.length > 0) {
        endpoints.push(...parallelConfig.endpoints);
    }

    // Add default RPC if configured to race with it
    if (parallelConfig.raceWithDefault && defaultRpcUrl) {
        // Avoid duplicates
        if (!endpoints.includes(defaultRpcUrl)) {
            endpoints.push(defaultRpcUrl);
        }
    }

    return endpoints;
}

/**
 * Execute the race strategy - Jito vs parallel RPC.
 *
 * Both paths are started simultaneously, and the first to succeed wins.
 * This maximizes landing probability at the cost of potentially paying
 * both Jito tip and priority fees.
 */
async function executeRaceStrategy(
    transaction: string,
    config: ResolvedExecutionConfig,
    context: ExecutionContext & { rpcUrl?: string },
    startTime: number,
): Promise<ExecutionResult> {
    const { jito, parallel } = config;
    const { rpcUrl, abortSignal } = context;

    // Create abort controller to cancel the loser
    const abortController = new AbortController();
    const combinedSignal = abortSignal
        ? combineAbortSignals(abortSignal, abortController.signal)
        : abortController.signal;

    const endpoints = buildEndpointList(rpcUrl, parallel);

    // Track errors from each path
    let jitoError: Error | undefined;
    let parallelError: Error | undefined;

    // Create Jito submission promise
    const jitoPromise = (async (): Promise<ExecutionResult> => {
        try {
            const bundleId = await sendBundle([transaction], {
                blockEngineUrl: jito.blockEngineUrl,
                abortSignal: combinedSignal,
            });

            const signature = await waitForBundleSignature(bundleId, {
                blockEngineUrl: jito.blockEngineUrl,
                abortSignal: combinedSignal,
            });

            return {
                signature,
                landedVia: 'jito',
                latencyMs: Math.round(performance.now() - startTime),
                bundleId,
            };
        } catch (error) {
            jitoError = error instanceof Error ? error : new Error(String(error));
            throw error;
        }
    })();

    // Create parallel submission promise (only if endpoints available)
    const parallelPromise =
        endpoints.length > 0
            ? (async (): Promise<ExecutionResult> => {
                  try {
                      const result = await submitParallel({
                          endpoints,
                          transaction,
                          skipPreflight: true,
                          abortSignal: combinedSignal,
                      });

                      return {
                          signature: result.signature,
                          landedVia: 'parallel',
                          latencyMs: result.latencyMs,
                          endpoint: result.endpoint,
                      };
                  } catch (error) {
                      parallelError = error instanceof Error ? error : new Error(String(error));
                      throw error;
                  }
              })()
            : Promise.reject(new Error('No parallel endpoints'));

    try {
        // Race Jito vs parallel
        const result = await Promise.any([jitoPromise, parallelPromise]);

        // Cancel the loser
        abortController.abort();

        return result;
    } catch (error) {
        // Both failed
        abortController.abort();

        const errorOptions: { jitoError?: Error; parallelError?: Error } = {};
        if (jitoError) errorOptions.jitoError = jitoError;
        if (parallelError) errorOptions.parallelError = parallelError;

        throw new ExecutionStrategyError('All execution paths failed', errorOptions);
    }
}

/**
 * Wait for a bundle to land and return the transaction signature.
 *
 * Polls getBundleStatuses until the bundle is confirmed or timeout.
 */
async function waitForBundleSignature(
    bundleId: string,
    options: {
        blockEngineUrl: string;
        abortSignal?: AbortSignal;
        maxAttempts?: number;
        pollIntervalMs?: number;
    },
): Promise<string> {
    const { blockEngineUrl, abortSignal, maxAttempts = 30, pollIntervalMs = 500 } = options;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        if (abortSignal?.aborted) {
            throw new Error('Bundle confirmation aborted');
        }

        const [status] = await getBundleStatuses([bundleId], {
            blockEngineUrl,
            ...(abortSignal && { abortSignal }),
        });

        if (status) {
            // Bundle found - return the first transaction signature
            if (status.transactions.length > 0) {
                return status.transactions[0];
            }
        }

        // Wait before next poll
        await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }

    throw new Error(`Bundle ${bundleId} not confirmed within timeout`);
}

/**
 * Combine two abort signals into one.
 */
function combineAbortSignals(signal1: AbortSignal, signal2: AbortSignal): AbortSignal {
    const controller = new AbortController();

    const abort = () => controller.abort();

    signal1.addEventListener('abort', abort);
    signal2.addEventListener('abort', abort);

    if (signal1.aborted || signal2.aborted) {
        controller.abort();
    }

    return controller.signal;
}

// ============================================================================
// TPU Execution
// ============================================================================

/**
 * Check if we're running in a browser environment.
 */
function isBrowser(): boolean {
    return typeof window !== 'undefined' && typeof window.document !== 'undefined';
}

/**
 * Submit transaction via TPU (direct or through API route).
 *
 * In browser environments, this sends to the configured API route.
 * In server environments, this uses the native TPU client directly.
 */
/** TPU submission result with per-leader details */
interface TpuSubmissionResult {
    delivered: boolean;
    latencyMs: number;
    leaderCount: number;
    leaders?: Array<{
        identity: string;
        address: string;
        success: boolean;
        latencyMs: number;
        error?: string;
        errorCode?: string;
        attempts: number;
    }>;
    retryCount?: number;
}

async function submitToTpu(
    transaction: string,
    tpuConfig: ResolvedExecutionConfig['tpu'],
    abortSignal?: AbortSignal,
): Promise<TpuSubmissionResult> {
    console.log('🚀 [TPU] submitToTpu called, isBrowser:', isBrowser());

    if (isBrowser()) {
        console.log('🌐 [TPU] Running in browser, dispatching start event');
        // Emit start event
        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('pipeit:tpu:start'));
            console.log('✅ [TPU] Dispatched pipeit:tpu:start event');
        }

        console.log('📡 [TPU] Calling API route:', tpuConfig.apiRoute);
        // Browser: route through API with config
        const response = await fetch(tpuConfig.apiRoute, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                transaction,
                config: {
                    rpcUrl: tpuConfig.rpcUrl,
                    wsUrl: tpuConfig.wsUrl,
                    fanout: tpuConfig.fanout,
                },
            }),
            ...(abortSignal && { signal: abortSignal }),
        });

        console.log('📬 [TPU] API response status:', response.status);

        if (!response.ok) {
            const error = await response.text();
            console.error('❌ [TPU] API error:', error);
            throw new Error(`TPU API error: ${response.status} - ${error}`);
        }

        const result: TpuSubmissionResult = await response.json();
        console.log('📦 [TPU] API result:', result);

        // Emit result event for UI components to listen to
        if (typeof window !== 'undefined') {
            console.log('🎯 [TPU] Dispatching pipeit:tpu:result event');
            window.dispatchEvent(
                new CustomEvent('pipeit:tpu:result', {
                    detail: result,
                }),
            );
            console.log('✅ [TPU] Dispatched pipeit:tpu:result event with', result.leaderCount, 'leaders');
        }

        return result;
    }

    // Server: use native client
    // Dynamic import to avoid bundling native module in browser builds
    try {
        // @ts-ignore - Optional dependency loaded at runtime
        // webpackIgnore tells bundlers to skip resolving this import
        const tpuNative = await import(/* webpackIgnore: true */ '@pipeit/fastlane');

        // Get or create singleton client
        const client = await getTpuClientSingleton(tpuConfig);

        // Convert base64 transaction to Buffer
        const txBuffer = Buffer.from(transaction, 'base64');

        const result = await client.sendTransaction(txBuffer);

        return {
            delivered: result.delivered,
            latencyMs: result.latencyMs,
            leaderCount: result.leaderCount,
        };
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'MODULE_NOT_FOUND') {
            throw new ExecutionStrategyError(
                'TPU submission requires @pipeit/fastlane package. Install it with: npm install @pipeit/fastlane',
            );
        }
        throw error;
    }
}

// Singleton TPU client instance
let tpuClientInstance: unknown = null;
let tpuClientConfig: ResolvedExecutionConfig['tpu'] | null = null;

/**
 * Get or create a singleton TPU client.
 */
async function getTpuClientSingleton(config: ResolvedExecutionConfig['tpu']): Promise<{
    sendTransaction: (tx: Buffer) => Promise<{ delivered: boolean; latencyMs: number; leaderCount: number }>;
    waitReady: () => Promise<void>;
}> {
    // Check if config changed
    if (
        tpuClientInstance &&
        tpuClientConfig &&
        tpuClientConfig.rpcUrl === config.rpcUrl &&
        tpuClientConfig.wsUrl === config.wsUrl
    ) {
        return tpuClientInstance as {
            sendTransaction: (tx: Buffer) => Promise<{ delivered: boolean; latencyMs: number; leaderCount: number }>;
            waitReady: () => Promise<void>;
        };
    }

    // Create new client
    // @ts-ignore - Optional dependency loaded at runtime
    // webpackIgnore tells bundlers to skip resolving this import
    const tpuNative = await import(/* webpackIgnore: true */ '@pipeit/fastlane');
    const { TpuClient } = tpuNative;

    const client = new (TpuClient as any)({
        rpcUrl: config.rpcUrl,
        wsUrl: config.wsUrl,
        fanout: config.fanout,
    });

    await client.waitReady();

    tpuClientInstance = client;
    tpuClientConfig = config;

    return client;
}

/**
 * Execute TPU strategy, optionally racing with Jito.
 */
async function executeTpuStrategy(
    transaction: string,
    config: ResolvedExecutionConfig,
    context: ExecutionContext & { rpcUrl?: string },
    startTime: number,
): Promise<ExecutionResult> {
    const { jito, tpu } = config;
    const { abortSignal, rpcUrl: contextRpcUrl } = context;

    // Merge context rpcUrl into tpu config if not set
    const tpuConfig = {
        ...tpu,
        rpcUrl: tpu.rpcUrl || contextRpcUrl || '',
        wsUrl:
            tpu.wsUrl || (contextRpcUrl ? contextRpcUrl.replace('https://', 'wss://').replace('http://', 'ws://') : ''),
    };

    // If Jito is also enabled, race TPU vs Jito
    if (jito.enabled) {
        return executeTpuJitoRace(transaction, { ...config, tpu: tpuConfig }, context, startTime);
    }

    // TPU only
    const result = await submitToTpu(transaction, tpuConfig, abortSignal);

    if (!result.delivered) {
        throw new ExecutionStrategyError('TPU submission failed - transaction not delivered to any leader');
    }

    // Extract signature from the transaction
    // The signature is the first 64 bytes after the signature count
    const signature = extractSignatureFromTransaction(transaction);

    return {
        signature,
        landedVia: 'tpu',
        latencyMs: result.latencyMs,
        leaderCount: result.leaderCount,
    };
}

/**
 * Extract the first signature from a base64-encoded serialized transaction.
 *
 * Solana transaction format starts with a compact array of signatures.
 * For a single-signer transaction, this is: [1, ...64 bytes of signature...]
 */
function extractSignatureFromTransaction(base64Tx: string): string {
    const bytes = Buffer.from(base64Tx, 'base64');

    // First byte is the number of signatures (for single signer, it's 1)
    const numSignatures = bytes[0];
    if (numSignatures < 1) {
        throw new ExecutionStrategyError('Transaction has no signatures');
    }

    // Extract the first signature (64 bytes starting at offset 1)
    const signatureBytes = bytes.slice(1, 65);

    // Convert to base58 for the signature string
    return encodeBase58(signatureBytes);
}

/**
 * Encode bytes to base58 string (Solana's signature format).
 */
function encodeBase58(bytes: Uint8Array): string {
    const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

    // Convert bytes to a big integer
    let num = BigInt(0);
    for (const byte of bytes) {
        num = num * 256n + BigInt(byte);
    }

    // Convert to base58
    let result = '';
    while (num > 0n) {
        const remainder = Number(num % 58n);
        num = num / 58n;
        result = ALPHABET[remainder] + result;
    }

    // Add leading '1's for leading zero bytes
    for (const byte of bytes) {
        if (byte === 0) {
            result = '1' + result;
        } else {
            break;
        }
    }

    return result || '1';
}

/**
 * Race TPU vs Jito submission.
 */
async function executeTpuJitoRace(
    transaction: string,
    config: ResolvedExecutionConfig,
    context: ExecutionContext & { rpcUrl?: string },
    startTime: number,
): Promise<ExecutionResult> {
    const { jito, tpu } = config;
    const { abortSignal } = context;

    // Create abort controller to cancel the loser
    const abortController = new AbortController();
    const combinedSignal = abortSignal
        ? combineAbortSignals(abortSignal, abortController.signal)
        : abortController.signal;

    let tpuError: Error | undefined;
    let jitoError: Error | undefined;

    // TPU submission promise
    const tpuPromise = (async (): Promise<ExecutionResult> => {
        try {
            const result = await submitToTpu(transaction, tpu, combinedSignal);

            if (!result.delivered) {
                throw new Error('TPU submission failed');
            }

            const signature = extractSignatureFromTransaction(transaction);

            return {
                signature,
                landedVia: 'tpu',
                latencyMs: result.latencyMs,
                leaderCount: result.leaderCount,
            };
        } catch (error) {
            tpuError = error instanceof Error ? error : new Error(String(error));
            throw error;
        }
    })();

    // Jito submission promise
    const jitoPromise = (async (): Promise<ExecutionResult> => {
        try {
            const bundleId = await sendBundle([transaction], {
                blockEngineUrl: jito.blockEngineUrl,
                abortSignal: combinedSignal,
            });

            const signature = await waitForBundleSignature(bundleId, {
                blockEngineUrl: jito.blockEngineUrl,
                abortSignal: combinedSignal,
            });

            return {
                signature,
                landedVia: 'jito',
                latencyMs: Math.round(performance.now() - startTime),
                bundleId,
            };
        } catch (error) {
            jitoError = error instanceof Error ? error : new Error(String(error));
            throw error;
        }
    })();

    try {
        // Race TPU vs Jito
        const result = await Promise.any([tpuPromise, jitoPromise]);

        // Cancel the loser
        abortController.abort();

        return result;
    } catch {
        // Both failed
        abortController.abort();

        const errorOptions: { tpuError?: Error; jitoError?: Error } = {};
        if (tpuError) errorOptions.tpuError = tpuError;
        if (jitoError) errorOptions.jitoError = jitoError;

        throw new ExecutionStrategyError('All execution paths failed (TPU + Jito)', errorOptions);
    }
}

// ============================================================================
// Utility Exports
// ============================================================================

/**
 * Check if an execution config enables Jito.
 */
export function isJitoEnabled(config: ExecutionConfig | undefined): boolean {
    const resolved = resolveExecutionConfig(config);
    return resolved.jito.enabled;
}

/**
 * Check if an execution config enables parallel submission.
 */
export function isParallelEnabled(config: ExecutionConfig | undefined): boolean {
    const resolved = resolveExecutionConfig(config);
    return resolved.parallel.enabled;
}

/**
 * Check if an execution config enables TPU submission.
 */
export function isTpuEnabled(config: ExecutionConfig | undefined): boolean {
    const resolved = resolveExecutionConfig(config);
    return resolved.tpu.enabled;
}

/**
 * Get the tip amount for an execution config.
 * Returns 0 if Jito is not enabled.
 */
export function getTipAmount(config: ExecutionConfig | undefined): bigint {
    const resolved = resolveExecutionConfig(config);
    return resolved.jito.enabled ? resolved.jito.tipLamports : 0n;
}
