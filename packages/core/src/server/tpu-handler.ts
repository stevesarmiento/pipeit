/**
 * TPU handler for Next.js API routes.
 *
 * Provides a drop-in handler function that can be exported directly
 * from a Next.js API route to enable TPU submission in browser environments.
 *
 * @packageDocumentation
 */

import type { ResolvedExecutionConfig } from '../execution/types.js';

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
}

// Singleton TPU client instance
let tpuClient: TpuClientInstance | null = null;
let currentConfig: ResolvedExecutionConfig['tpu'] | null = null;

interface TpuClientInstance {
  sendTransaction: (tx: Buffer) => Promise<{
    delivered: boolean;
    leaderCount: number;
    latencyMs: number;
  }>;
  waitReady: () => Promise<void>;
  shutdown: () => void;
}

/**
 * Get or create the singleton TPU client.
 *
 * The client is created lazily on the first request and reused for
 * subsequent requests. If the configuration changes, the old client
 * is shut down and a new one is created.
 */
async function getTpuClient(config: {
  rpcUrl: string;
  wsUrl: string;
  fanout: number;
}): Promise<TpuClientInstance> {
  // Check if we need to recreate the client
  const configChanged =
    !currentConfig ||
    currentConfig.rpcUrl !== config.rpcUrl ||
    currentConfig.wsUrl !== config.wsUrl ||
    currentConfig.fanout !== config.fanout;

  if (configChanged && tpuClient) {
    // Shut down old client
    tpuClient.shutdown();
    tpuClient = null;
  }

  if (!tpuClient) {
    try {
      // Dynamic import to avoid bundling issues
      // @ts-ignore - Optional dependency loaded at runtime
      // webpackIgnore tells bundlers to skip resolving this import
      const tpuNative = await import(/* webpackIgnore: true */ '@pipeit/tpu-native');
      const { TpuClient } = tpuNative;

      const client = new (TpuClient as any)({
        rpcUrl: config.rpcUrl,
        wsUrl: config.wsUrl,
        fanout: config.fanout,
      }) as TpuClientInstance;

      // Wait for client to be ready (fetch initial leader schedule, etc.)
      await client.waitReady();

      tpuClient = client;
      currentConfig = {
        ...config,
        enabled: true,
        apiRoute: '/api/tpu',
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'MODULE_NOT_FOUND') {
        throw new Error(
          'TPU submission requires @pipeit/tpu-native package. ' +
            'Install it with: npm install @pipeit/tpu-native'
        );
      }
      throw error;
    }
  }

  return tpuClient;
}

/**
 * Resolve TPU configuration from request and environment variables.
 */
function resolveConfig(requestConfig?: TpuHandlerRequest['config']): {
  rpcUrl: string;
  wsUrl: string;
  fanout: number;
} {
  const rpcUrl =
    requestConfig?.rpcUrl ||
    process.env.SOLANA_RPC_URL ||
    process.env.RPC_URL ||
    '';

  if (!rpcUrl) {
    throw new Error(
      'RPC URL is required. Set SOLANA_RPC_URL or RPC_URL environment variable, or provide it in the request config.'
    );
  }

  // Derive WebSocket URL from RPC URL if not provided
  const wsUrl =
    requestConfig?.wsUrl ||
    process.env.SOLANA_WS_URL ||
    process.env.WS_URL ||
    deriveWsUrl(rpcUrl);

  const fanout = requestConfig?.fanout ?? 2;

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
  defaultConfig?: { rpcUrl?: string; wsUrl?: string; fanout?: number }
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
        { status: 400 }
      );
    }

    // Resolve configuration
    const config = resolveConfig({
      ...defaultConfig,
      ...body.config,
    });

    // Get or create TPU client
    const client = await getTpuClient(config);

    // Convert base64 transaction to Buffer
    const txBuffer = Buffer.from(body.transaction, 'base64');

    const startTime = performance.now();

    console.log('\n┌─────────────────────────────────────────────────────────────┐');
    console.log('│ 🚀 TPU DIRECT SUBMISSION                                    │');
    console.log('├─────────────────────────────────────────────────────────────┤');
    console.log(`│ Protocol: QUIC (native)                                     │`);
    console.log(`│ Target: Validator TPU endpoints                             │`);
    console.log(`│ Transaction size: ${txBuffer.length} bytes`.padEnd(62) + '│');

    // Send transaction
    const result = await client.sendTransaction(txBuffer);

    const latencyMs = Math.round(performance.now() - startTime);

    console.log(`│ Leaders reached: ${result.leaderCount}`.padEnd(62) + '│');
    console.log(`│ Delivery: ${result.delivered ? '✅ SUCCESS' : '❌ FAILED'}`.padEnd(62) + '│');
    console.log(`│ Latency: ${latencyMs}ms`.padEnd(62) + '│');
    console.log('└─────────────────────────────────────────────────────────────┘\n');

    return Response.json({
      delivered: result.delivered,
      leaderCount: result.leaderCount,
      latencyMs,
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
      { status: 500 }
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

