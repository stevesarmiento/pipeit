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
 * Enhanced TPU submission result with continuous resubmission stats.
 */
export interface TpuSubmissionResult {
    /** Whether the transaction was confirmed on-chain */
    confirmed: boolean;
    /** Transaction signature */
    signature: string;
    /** Number of send rounds attempted */
    rounds: number;
    /** Total leaders sent across all rounds */
    totalLeadersSent: number;
    /** Total latency in ms */
    latencyMs: number;
    /** Error message if any */
    error?: string;
    
    // Backwards compat
    delivered?: boolean;
    leaderCount?: number;
    leaders?: LeaderResult[];
    retryCount?: number;
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
                        fanout: 8,
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

                const signature = await new TransactionBuilder({
                    rpc: ctx.rpc,
                    priorityFee: 'high',
                })
                    .setFeePayerSigner(ctx.signer)
                    .addInstruction(instruction)
                    .execute({
                        rpcSubscriptions: ctx.rpcSubscriptions,
                        commitment: 'confirmed',
                        execution: {
                            tpu: {
                                enabled: true,
                                fanout: 8,
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
 * TPU Stats Panel - Shows continuous resubmission statistics.
 */
function TpuStatsPanel({ result }: { result: TpuSubmissionResult }) {
    const isConfirmed = result.confirmed ?? result.delivered ?? false;
    const rounds = result.rounds ?? 0;
    const totalLeaders = result.totalLeadersSent ?? result.leaderCount ?? 0;
    const latencySeconds = result.latencyMs > 1000 
        ? `${(result.latencyMs / 1000).toFixed(1)}s`
        : `${result.latencyMs}ms`;

    return (
        <motion.div
            className="bg-gray-50 rounded-xl p-4 border border-gray-200"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
        >
            <h3 className="text-sm font-semibold text-gray-700 mb-3">TPU Continuous Submission Stats</h3>
            <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="bg-white rounded-lg p-2 border">
                    <div className="text-gray-500 text-xs">Status</div>
                    <div className={cn('font-bold', isConfirmed ? 'text-emerald-600' : 'text-amber-600')}>
                        {isConfirmed ? '✅ Confirmed' : '⏳ Pending'}
                    </div>
                </div>
                <div className="bg-white rounded-lg p-2 border">
                    <div className="text-gray-500 text-xs">Time</div>
                    <div className="font-bold text-gray-900">{latencySeconds}</div>
                </div>
                <div className="bg-white rounded-lg p-2 border">
                    <div className="text-gray-500 text-xs">Rounds</div>
                    <div className="font-bold text-gray-900">{rounds}</div>
                </div>
                <div className="bg-white rounded-lg p-2 border">
                    <div className="text-gray-500 text-xs">Total Leaders</div>
                    <div className="font-bold text-gray-900">{totalLeaders}</div>
                </div>
                {result.signature && (
                    <div className="bg-white rounded-lg p-2 border col-span-2">
                        <div className="text-gray-500 text-xs">Signature</div>
                        <div className="font-mono text-xs text-gray-700 truncate">
                            {result.signature}
                        </div>
                    </div>
                )}
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
                            ✅ Transaction confirmed on-chain via TPU!
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

            {/* Rounds visualization */}
            {lastResult && (lastResult.rounds ?? 0) > 0 && (
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mb-6"
                >
                    <div className="text-center mb-4">
                        <span className="text-sm font-medium text-gray-600">
                            Submission Rounds ({lastResult.rounds} rounds, {lastResult.totalLeadersSent ?? lastResult.leaderCount ?? 0} leaders)
                        </span>
                    </div>
                    <div className="flex justify-center flex-wrap gap-2 max-w-md mx-auto">
                        {Array.from({ length: Math.min(lastResult.rounds ?? 0, 20) }).map((_, index) => (
                            <motion.div
                                key={index}
                                className={cn(
                                    'w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium',
                                    index === (lastResult.rounds ?? 1) - 1 && lastResult.confirmed
                                        ? 'bg-emerald-500 text-white'
                                        : 'bg-purple-100 text-purple-600'
                                )}
                                initial={{ scale: 0, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                transition={{ delay: index * 0.05 }}
                            >
                                {index + 1}
                            </motion.div>
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
                        <div className="font-semibold text-gray-800 text-sm">Continuous TPU Resubmission</div>
                        <div className="text-xs text-gray-600 mt-1">
                            Transactions are sent continuously to fresh validator leaders every ~400ms until confirmed on-chain.
                            Achieves 90%+ landing rate similar to yellowstone-jet and Jito.
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

// Execute with direct TPU submission (continuous resubmission until confirmed)
const result = await createFlow({
  rpc,
  rpcSubscriptions,
  signer,
  execution: {
    tpu: {
      enabled: true,        // Enable TPU submission
      fanout: 6,            // Send to 6 leaders per round
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
      priorityFee: 'high', // 2.5 lamports/CU - balanced cost/speed
    })
      .setFeePayerSigner(ctx.signer)
      .addInstruction(instruction)
      .execute({
        rpcSubscriptions: ctx.rpcSubscriptions,
        commitment: 'confirmed',
        execution: {
          tpu: {
            enabled: true,
            fanout: 6, // Leaders per round
            apiRoute: '/api/tpu',
          },
        },
      })

    return { signature }
  })
  .execute()

// Result includes confirmation status (90%+ landing rate):
// {
//   confirmed: true,           // On-chain confirmation!
//   signature: '...',          // Transaction signature
//   rounds: 4,                 // Send rounds attempted
//   totalLeadersSent: 24,      // Total leaders (6 per round × 4)
//   latencyMs: 5000,           // Total time including confirmation
// }`;
