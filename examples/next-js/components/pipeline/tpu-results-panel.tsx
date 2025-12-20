'use client';

import { motion } from 'motion/react';
import { cn } from '@/lib/utils';
import type { TpuSubmissionResult, LeaderResult } from './examples/tpu-direct';

/**
 * Round indicator dot with tooltip showing leaders for that round.
 */
function RoundDot({ 
    filled, 
    index, 
    leaders 
}: { 
    filled: boolean; 
    index: number;
    leaders?: LeaderResult[];
}) {
    const hasLeaders = leaders && leaders.length > 0;
    
    return (
        <div className="relative group">
            <motion.div
                className={cn(
                    'w-4 h-4 rounded-full cursor-default',
                    filled ? 'bg-emerald-500' : 'bg-gray-200',
                )}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: index * 0.02 }}
            />
            
            {/* Tooltip */}
            {hasLeaders && (
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
                    <div className="bg-gray-900 text-white text-[10px] rounded px-2 py-1.5 whitespace-nowrap">
                        <div className="font-medium text-gray-300 mb-1">Round {index + 1}</div>
                        {leaders.map((l, i) => (
                            <div key={i} className="flex items-center gap-1.5">
                                <span className={l.success ? 'text-emerald-400' : 'text-amber-400'}>
                                    {l.success ? '●' : '○'}
                                </span>
                                <span className="font-mono">{l.identity.slice(0, 8)}...</span>
                                <span className="text-gray-400">{l.latencyMs}ms</span>
                            </div>
                        ))}
                    </div>
                    <div className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900" />
                </div>
            )}
        </div>
    );
}

interface TpuResultsPanelProps {
    result: TpuSubmissionResult | null;
    isExecuting?: boolean;
}

/**
 * Chunk leaders into rounds based on fanout.
 */
function chunkLeaders(leaders: LeaderResult[], rounds: number): LeaderResult[][] {
    if (rounds === 0 || leaders.length === 0) return [];
    const perRound = Math.ceil(leaders.length / rounds);
    const chunks: LeaderResult[][] = [];
    for (let i = 0; i < rounds; i++) {
        chunks.push(leaders.slice(i * perRound, (i + 1) * perRound));
    }
    return chunks;
}

/**
 * TPU Results Panel - Shows continuous resubmission stats.
 */
export function TpuResultsPanel({ result, isExecuting }: TpuResultsPanelProps) {
    if (!result && !isExecuting) {
        return (
            <div className="flex justify-center">
                <div className="flex flex-col items-center gap-3 py-4 px-6 bg-gray-50 rounded border border-gray-100">
                    <div className="grid grid-cols-4 gap-1.5">
                        {Array.from({ length: 16 }).map((_, i) => (
                            <div key={i} className="w-4 h-4 rounded-full bg-gray-200" />
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
            <div className="flex justify-center">
                <motion.div
                    className="flex flex-col items-center gap-3 py-4 px-6 bg-gray-50 rounded border border-gray-100"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                >
                    <div className="grid grid-cols-4 gap-1.5">
                        {Array.from({ length: 16 }).map((_, i) => (
                            <motion.div
                                key={i}
                                className="w-4 h-4 rounded-full bg-gray-300"
                                animate={{ opacity: [0.3, 1, 0.3] }}
                                transition={{ repeat: Infinity, duration: 1.2, delay: i * 0.06 }}
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
    const leaders = result.leaders ?? [];

    // Chunk leaders into rounds
    const leadersByRound = chunkLeaders(leaders, rounds);

    // Show filled dots based on rounds (max 16)
    const filledCount = Math.min(rounds, 16);

    return (
        <div className="flex justify-center">
            <motion.div
                className="flex flex-col items-center gap-3 py-4 px-6 bg-gray-50 rounded border border-gray-100"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
            >
                {/* 4x4 grid */}
                <div className="grid grid-cols-4 gap-1.5">
                    {Array.from({ length: 16 }).map((_, i) => (
                        <RoundDot 
                            key={i} 
                            filled={i < filledCount} 
                            index={i}
                            leaders={leadersByRound[i]}
                        />
                    ))}
                </div>

                {/* Stats row */}
                <div className="flex items-center gap-4 text-xs font-medium">
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
