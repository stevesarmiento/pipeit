'use client';

import { motion } from 'motion/react';
import { cn } from '@/lib/utils';
import type { TpuSubmissionResult } from './examples/tpu-direct';

/**
 * Round indicator dot - shows progress through send rounds.
 */
function RoundDot({ filled, index }: { filled: boolean; index: number }) {
    return (
        <motion.div
            className={cn(
                'w-2.5 h-2.5 rounded-full',
                filled ? 'bg-emerald-500' : 'bg-gray-200',
            )}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: index * 0.03 }}
        />
    );
}

interface TpuResultsPanelProps {
    result: TpuSubmissionResult | null;
    isExecuting?: boolean;
}

/**
 * TPU Results Panel - Shows continuous resubmission stats.
 */
export function TpuResultsPanel({ result, isExecuting }: TpuResultsPanelProps) {
    if (!result && !isExecuting) {
        return (
            <div className="flex items-center justify-center">
                <div className="flex items-center gap-4 py-3 px-5 bg-gray-50 rounded border border-gray-100">
                    <div className="flex items-center gap-1.5">
                        {Array.from({ length: 8 }).map((_, i) => (
                            <div key={i} className="w-2.5 h-2.5 rounded-full bg-gray-200" />
                        ))}
                    </div>
                    <div className="text-xs text-gray-400 font-medium">
                        TPU Direct — awaiting execution
                    </div>
                </div>
            </div>
        );
    }

    if (isExecuting && !result) {
        return (
            <div className="flex items-center justify-center">
                <motion.div
                    className="flex items-center gap-4 py-3 px-5 bg-gray-50 rounded border border-gray-100"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                >
                    <div className="flex items-center gap-1.5">
                        {Array.from({ length: 8 }).map((_, i) => (
                            <motion.div
                                key={i}
                                className="w-2.5 h-2.5 rounded-full bg-gray-300"
                                animate={{ opacity: [0.3, 1, 0.3] }}
                                transition={{ repeat: Infinity, duration: 1, delay: i * 0.1 }}
                            />
                        ))}
                    </div>
                    <span className="text-xs text-gray-500 font-medium">Sending via QUIC...</span>
                </motion.div>
            </div>
        );
    }

    if (!result) return null;

    const rounds = result.rounds ?? 0;
    const totalLeaders = result.totalLeadersSent ?? result.leaderCount ?? 0;
    const isConfirmed = result.confirmed ?? result.delivered ?? false;

    // Show filled dots based on rounds (max 8)
    const filledCount = Math.min(rounds, 8);

    return (
        <div className="flex items-center justify-center">
            <motion.div
                className="flex items-center gap-5 py-3 px-5 bg-gray-50 rounded border border-gray-100"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
            >
                {/* Rounds visualization */}
                <div className="flex items-center gap-1.5">
                    {Array.from({ length: 8 }).map((_, i) => (
                        <RoundDot key={i} filled={i < filledCount} index={i} />
                    ))}
                </div>

                {/* Stats */}
                <div className="flex items-center gap-5 text-xs font-medium">
                    <div className="flex items-center gap-1.5">
                        <span className="text-gray-400">Status</span>
                        <span className={isConfirmed ? 'text-emerald-600' : 'text-amber-600'}>
                            {isConfirmed ? 'Confirmed' : 'Pending'}
                        </span>
                    </div>

                    <div className="flex items-center gap-1.5">
                        <span className="text-gray-400">Rounds</span>
                        <span className="text-gray-700">{rounds}</span>
                    </div>

                    <div className="flex items-center gap-1.5">
                        <span className="text-gray-400">Leaders</span>
                        <span className="text-gray-700">{totalLeaders}</span>
                    </div>

                    <div className="flex items-center gap-1.5">
                        <span className="text-gray-400">Time</span>
                        <span className="text-gray-700">
                            {result.latencyMs > 1000 
                                ? `${(result.latencyMs / 1000).toFixed(1)}s`
                                : `${result.latencyMs}ms`
                            }
                        </span>
                    </div>
                </div>
            </motion.div>
        </div>
    );
}
