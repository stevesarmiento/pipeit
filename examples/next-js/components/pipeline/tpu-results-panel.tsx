'use client';

import { motion, AnimatePresence } from 'motion/react';
import { cn } from '@/lib/utils';
import type { TpuSubmissionResult, LeaderResult } from './examples/tpu-direct';

/**
 * Compact TPU Leader Node for the results panel.
 */
function TpuLeaderBadge({ leader, index }: { leader: LeaderResult; index: number }) {
    return (
        <motion.div
            className="relative group"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: index * 0.1 }}
        >
            <div
                className={cn(
                    'w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all cursor-pointer',
                    leader.success
                        ? 'bg-gradient-to-br from-emerald-400 to-emerald-600 border-emerald-300'
                        : 'bg-gradient-to-br from-red-400 to-red-600 border-red-300',
                )}
                style={{
                    boxShadow: leader.success
                        ? '0 0 12px rgba(16, 185, 129, 0.4)'
                        : '0 0 12px rgba(239, 68, 68, 0.4)',
                }}
            >
                {leader.success ? (
                    <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                ) : (
                    <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                )}
            </div>

            {/* Labels */}
            <div className="mt-1 text-center">
                <div className="text-[9px] font-berkeley-mono text-gray-500">{leader.latencyMs}ms</div>
                {leader.attempts > 1 && (
                    <div className="text-[9px] text-amber-600 font-medium">{leader.attempts}x</div>
                )}
            </div>

            {/* Hover tooltip */}
            <div className="absolute -top-20 left-1/2 -translate-x-1/2 bg-gray-900 text-white px-2 py-1.5 rounded-lg text-[10px] z-30 min-w-[140px] opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                <div className="font-semibold mb-0.5">Leader {index + 1}</div>
                <div className="text-gray-300 space-y-0.5">
                    <div className="truncate">{leader.identity.slice(0, 20)}...</div>
                    <div>{leader.success ? '✅ Delivered' : '❌ Failed'}</div>
                    {leader.error && <div className="text-red-300 truncate">{leader.error}</div>}
                    {leader.errorCode && <div className="text-amber-300">{leader.errorCode}</div>}
                </div>
                <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-full w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900" />
            </div>
        </motion.div>
    );
}

interface TpuResultsPanelProps {
    result: TpuSubmissionResult | null;
    isExecuting?: boolean;
}

/**
 * TPU Results Panel - Shows per-leader results after TPU submission.
 */
export function TpuResultsPanel({ result, isExecuting }: TpuResultsPanelProps) {
    console.log('🎨 [TpuResultsPanel] Render:', { 
        hasResult: !!result, 
        isExecuting, 
        leaderCount: result?.leaders?.length,
        leaders: result?.leaders,
        delivered: result?.delivered
    });
    
    if (!result && !isExecuting) {
        return (
            <div className="flex items-center justify-center gap-3 py-4 px-4 bg-gradient-to-r from-purple-50/50 to-blue-50/50 rounded-lg border border-purple-100">
                <div className="text-xl">🚀</div>
                <div className="text-xs text-gray-600">
                    <span className="font-semibold text-gray-800">TPU Direct</span> — Execute to see per-leader results
                </div>
            </div>
        );
    }

    if (isExecuting && !result) {
        return (
            <motion.div
                className="flex items-center justify-center gap-3 py-4 px-4 bg-gradient-to-r from-purple-50 to-blue-50 rounded-lg border border-purple-200"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
            >
                <motion.div
                    className="w-3 h-3 rounded-full bg-purple-500"
                    animate={{ scale: [1, 1.3, 1] }}
                    transition={{ repeat: Infinity, duration: 0.8 }}
                />
                <span className="text-sm text-purple-700 font-medium">Sending to validator leaders via QUIC...</span>
            </motion.div>
        );
    }

    if (!result) return null;

    const successCount = result.leaders.filter(l => l.success).length;
    const avgLatency = result.leaders.length > 0 
        ? Math.round(result.leaders.reduce((sum, l) => sum + l.latencyMs, 0) / result.leaders.length)
        : 0;

    return (
        <motion.div
            className="bg-gradient-to-r from-purple-50/80 to-blue-50/80 rounded-lg border border-purple-100 p-3"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
        >
            <div className="flex items-center justify-between">
                {/* Left: Leader nodes */}
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                        <span className="text-lg">🚀</span>
                        <span className="text-xs font-semibold text-gray-700">TPU Results</span>
                    </div>
                    
                    <div className="h-6 w-px bg-gray-200" />
                    
                    <div className="flex items-center gap-3">
                        {result.leaders.map((leader, index) => (
                            <TpuLeaderBadge key={leader.identity || index} leader={leader} index={index} />
                        ))}
                    </div>
                </div>

                {/* Right: Stats */}
                <div className="flex items-center gap-4 text-xs">
                    <div className="flex items-center gap-1.5">
                        <span className="text-gray-500">Leaders:</span>
                        <span className={cn(
                            'font-bold',
                            successCount === result.leaderCount ? 'text-emerald-600' : 'text-amber-600'
                        )}>
                            {successCount}/{result.leaderCount}
                        </span>
                    </div>
                    
                    <div className="h-4 w-px bg-gray-200" />
                    
                    <div className="flex items-center gap-1.5">
                        <span className="text-gray-500">Latency:</span>
                        <span className="font-bold text-gray-800">{result.latencyMs}ms</span>
                    </div>
                    
                    <div className="h-4 w-px bg-gray-200" />
                    
                    <div className="flex items-center gap-1.5">
                        <span className="text-gray-500">Avg/Leader:</span>
                        <span className="font-bold text-gray-800">{avgLatency}ms</span>
                    </div>

                    {result.retryCount > 0 && (
                        <>
                            <div className="h-4 w-px bg-gray-200" />
                            <div className="flex items-center gap-1.5">
                                <span className="text-amber-600 font-medium">
                                    {result.retryCount} retries
                                </span>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </motion.div>
    );
}
