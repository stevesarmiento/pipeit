'use client';

import { useMemo } from 'react';
import { createFlow, type FlowConfig } from '@pipeit/core';
import type { TpuErrorCode } from '@pipeit/core';
import { VisualPipeline } from '@/lib/visual-pipeline';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '@/lib/utils';

/**
 * Per-leader result from TPU submission.
 */
export interface LeaderResult {
    identity: string;
    address: string;
    success: boolean;
    latencyMs: number;
    error?: string;
    errorCode?: TpuErrorCode;
    attempts: number;
}

/**
 * Enhanced TPU submission result with per-leader breakdown.
 */
export interface TpuSubmissionResult {
    delivered: boolean;
    leaderCount: number;
    latencyMs: number;
    leaders: LeaderResult[];
    retryCount: number;
}

/**
 * State for tracking TPU submission in real-time.
 */
export type TpuState =
    | { type: 'idle' }
    | { type: 'connecting' }
    | { type: 'sending'; startTime: number }
    | { type: 'complete'; result: TpuSubmissionResult }
    | { type: 'error'; message: string };

/**
 * Hook for the TPU direct pipeline.
 * Returns a VisualPipeline compatible with the playground pattern.
 * 
 * TPU results are captured via the tpuEvents fetch interceptor.
 */
export function useTpuDirectPipeline() {
    const visualPipeline = useMemo(() => {
        const flowFactory = (config: FlowConfig) =>
            createFlow({
                ...config,
                execution: {
                    tpu: {
                        enabled: true,
                        fanout: 8, // More leaders = higher landing rate
                        apiRoute: '/api/tpu',
                    },
                },
            }).transaction('tpu-transfer', async ctx => {
                const { getTransferSolInstruction } = await import('@solana-program/system');
                const { lamports } = await import('@solana/kit');

                const instruction = getTransferSolInstruction({
                    source: ctx.signer,
                    destination: ctx.signer.address,
                    amount: lamports(1000n),
                });

                const { TransactionBuilder } = await import('@pipeit/core');

                // TPU requires higher priority fees to compete with other transactions
                // 'max' = 5 lamports/CU for best landing rate
                const signature = await new TransactionBuilder({
                    rpc: ctx.rpc,
                    priorityFee: 'max', // Max priority for TPU landing
                })
                    .setFeePayerSigner(ctx.signer)
                    .addInstruction(instruction)
                    .execute({
                        rpcSubscriptions: ctx.rpcSubscriptions,
                        commitment: 'confirmed',
                        execution: {
                            tpu: {
                                enabled: true,
                                fanout: 8, // More leaders = higher landing rate
                                apiRoute: '/api/tpu',
                            },
                        },
                    });

                return { signature };
            });

        return new VisualPipeline('tpu-direct', flowFactory, [{ name: 'tpu-transfer', type: 'transaction' }]);
    }, []);

    return visualPipeline;
}

/**
 * TPU Leader Node - Visual representation of a single validator leader.
 */
function TpuLeaderNode({ leader, index }: { leader: LeaderResult; index: number }) {
    return (
        <motion.div
            className="relative group"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.1 }}
        >
            <motion.div
                className={cn(
                    'w-14 h-14 rounded-full flex items-center justify-center border-2 transition-all cursor-pointer',
                    leader.success
                        ? 'bg-gradient-to-br from-emerald-400 to-emerald-600 border-emerald-300'
                        : 'bg-gradient-to-br from-red-400 to-red-600 border-red-300',
                )}
                whileHover={{ scale: 1.1 }}
                animate={{
                    boxShadow: leader.success
                        ? '0 0 20px rgba(16, 185, 129, 0.4)'
                        : '0 0 20px rgba(239, 68, 68, 0.4)',
                }}
            >
                {leader.success ? (
                    <motion.svg
                        className="w-7 h-7 text-white"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        initial={{ pathLength: 0 }}
                        animate={{ pathLength: 1 }}
                        transition={{ duration: 0.5, delay: index * 0.1 + 0.2 }}
                    >
                        <motion.path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={3}
                            d="M5 13l4 4L19 7"
                        />
                    </motion.svg>
                ) : (
                    <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                )}
            </motion.div>

            {/* Leader info */}
            <div className="mt-1.5 text-center">
                <div className="text-[10px] font-berkeley-mono text-gray-600 truncate max-w-[70px]">
                    {leader.identity.slice(0, 6)}...
                </div>
                <div className="text-[10px] text-gray-400">{leader.latencyMs}ms</div>
                {leader.attempts > 1 && (
                    <div className="text-[10px] text-amber-500 font-medium">{leader.attempts}x retry</div>
                )}
            </div>

            {/* Hover tooltip */}
            <div className="absolute -top-28 left-1/2 -translate-x-1/2 bg-gray-900 text-white px-3 py-2 rounded-lg text-xs z-20 min-w-[180px] opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                <div className="font-semibold mb-1">Validator Leader</div>
                <div className="text-gray-300 space-y-0.5 text-[10px]">
                    <div>Identity: {leader.identity}</div>
                    <div>Address: {leader.address}</div>
                    <div>Status: {leader.success ? '✅ Delivered' : '❌ Failed'}</div>
                    <div>Latency: {leader.latencyMs}ms</div>
                    <div>Attempts: {leader.attempts}</div>
                    {leader.error && <div className="text-red-300">Error: {leader.error}</div>}
                    {leader.errorCode && <div className="text-red-300">Code: {leader.errorCode}</div>}
                </div>
                <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-full w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900" />
            </div>
        </motion.div>
    );
}

/**
 * TPU Stats Panel - Shows real-time submission statistics.
 */
function TpuStatsPanel({ result }: { result: TpuSubmissionResult }) {
    const successCount = result.leaders.filter(l => l.success).length;
    const avgLatency = Math.round(result.leaders.reduce((sum, l) => sum + l.latencyMs, 0) / result.leaders.length);

    return (
        <motion.div
            className="bg-gray-50 rounded-xl p-4 border border-gray-200"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
        >
            <h3 className="text-sm font-semibold text-gray-700 mb-3">TPU Submission Stats</h3>
            <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="bg-white rounded-lg p-2 border">
                    <div className="text-gray-500 text-xs">Delivered</div>
                    <div className={cn('font-bold', result.delivered ? 'text-emerald-600' : 'text-red-600')}>
                        {result.delivered ? 'Yes' : 'No'}
                    </div>
                </div>
                <div className="bg-white rounded-lg p-2 border">
                    <div className="text-gray-500 text-xs">Leaders</div>
                    <div className="font-bold text-gray-900">
                        {successCount}/{result.leaderCount}
                    </div>
                </div>
                <div className="bg-white rounded-lg p-2 border">
                    <div className="text-gray-500 text-xs">Total Latency</div>
                    <div className="font-bold text-gray-900">{result.latencyMs}ms</div>
                </div>
                <div className="bg-white rounded-lg p-2 border">
                    <div className="text-gray-500 text-xs">Avg Leader Latency</div>
                    <div className="font-bold text-gray-900">{avgLatency}ms</div>
                </div>
                <div className="bg-white rounded-lg p-2 border col-span-2">
                    <div className="text-gray-500 text-xs">Retries</div>
                    <div className={cn('font-bold', result.retryCount > 0 ? 'text-amber-600' : 'text-gray-900')}>
                        {result.retryCount} {result.retryCount > 0 && '(auto-recovered)'}
                    </div>
                </div>
            </div>
        </motion.div>
    );
}

/**
 * TPU Real-Time Visualization Component.
 */
export function TpuRealTimeVisualization({ tpuState, lastResult }: { tpuState: TpuState; lastResult: TpuSubmissionResult | null }) {
    return (
        <div className="w-full max-w-2xl mx-auto">
            {/* State indicator */}
            <div className="text-center mb-6">
                <AnimatePresence mode="wait">
                    {tpuState.type === 'idle' && (
                        <motion.div
                            key="idle"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="text-gray-500"
                        >
                            Ready to submit via TPU
                        </motion.div>
                    )}
                    {tpuState.type === 'connecting' && (
                        <motion.div
                            key="connecting"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="flex items-center justify-center gap-2 text-blue-600"
                        >
                            <motion.div
                                className="w-2 h-2 rounded-full bg-blue-600"
                                animate={{ scale: [1, 1.5, 1] }}
                                transition={{ repeat: Infinity, duration: 0.8 }}
                            />
                            Connecting to TPU endpoints...
                        </motion.div>
                    )}
                    {tpuState.type === 'sending' && (
                        <motion.div
                            key="sending"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="flex items-center justify-center gap-2 text-purple-600"
                        >
                            <motion.div
                                className="w-2 h-2 rounded-full bg-purple-600"
                                animate={{ scale: [1, 1.5, 1] }}
                                transition={{ repeat: Infinity, duration: 0.5 }}
                            />
                            Sending to validator leaders...
                        </motion.div>
                    )}
                    {tpuState.type === 'complete' && (
                        <motion.div
                            key="complete"
                            initial={{ opacity: 0, scale: 0.9 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0 }}
                            className="text-emerald-600 font-semibold"
                        >
                            ✅ Transaction delivered via TPU!
                        </motion.div>
                    )}
                    {tpuState.type === 'error' && (
                        <motion.div
                            key="error"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="text-red-600"
                        >
                            ❌ {tpuState.message}
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            {/* Leader nodes visualization */}
            {lastResult && (
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mb-6"
                >
                    <div className="text-center mb-4">
                        <span className="text-sm font-medium text-gray-600">Per-Leader Results</span>
                    </div>
                    <div className="flex justify-center gap-8">
                        {lastResult.leaders.map((leader, index) => (
                            <TpuLeaderNode key={leader.identity} leader={leader} index={index} />
                        ))}
                    </div>
                </motion.div>
            )}

            {/* Stats panel */}
            {lastResult && (
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.3 }}
                >
                    <TpuStatsPanel result={lastResult} />
                </motion.div>
            )}

            {/* Protocol info */}
            <motion.div
                className="mt-6 p-4 bg-gradient-to-r from-purple-50 to-blue-50 rounded-xl border border-purple-100"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.5 }}
            >
                <div className="flex items-start gap-3">
                    <div className="text-2xl">🚀</div>
                    <div>
                        <div className="font-semibold text-gray-800 text-sm">Direct TPU Submission</div>
                        <div className="text-xs text-gray-600 mt-1">
                            Transactions are sent directly to validator QUIC endpoints, bypassing RPC queues.
                            Each leader attempt includes automatic retry with error classification.
                        </div>
                    </div>
                </div>
            </motion.div>
        </div>
        
    );
}

export const tpuDirectCode = `import { createFlow, TransactionBuilder } from '@pipeit/core'
import { getTransferSolInstruction } from '@solana-program/system'
import { lamports } from '@solana/kit'

// Execute with direct TPU submission
const result = await createFlow({
  rpc,
  rpcSubscriptions,
  signer,
  execution: {
    tpu: {
      enabled: true,        // Enable TPU submission
      fanout: 8,            // Send to 8 upcoming leaders for best landing
      apiRoute: '/api/tpu', // Browser API endpoint
    }
  }
})
  .transaction('fast-transfer', async (ctx) => {
    const instruction = getTransferSolInstruction({
      source: ctx.signer,
      destination: ctx.signer.address,
      amount: lamports(1000n),
    })
    
    const signature = await new TransactionBuilder({
      rpc: ctx.rpc,
      priorityFee: 'max', // 5 lamports/CU for best TPU landing
    })
      .setFeePayerSigner(ctx.signer)
      .addInstruction(instruction)
      .execute({
        rpcSubscriptions: ctx.rpcSubscriptions,
        commitment: 'confirmed',
        execution: {
          tpu: {
            enabled: true,
            fanout: 8, // More leaders = higher landing rate
            apiRoute: '/api/tpu',
          },
        },
      })

    return { signature }
  })
  .execute()

// Enhanced result includes per-leader breakdown:
// result.tpuDetails = {
//   leaders: [
//     { identity: '...', success: true, latencyMs: 45, attempts: 1 },
//     { identity: '...', success: true, latencyMs: 52, attempts: 1 },
//     // ... more leaders
//   ],
//   retryCount: 0
// }`;
