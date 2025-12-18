'use client';

import { cn } from '@/lib/utils';
import type { BuilderFeedback } from '@/lib/builder/types';
import { AlertCircle, CheckCircle, Loader2 } from 'lucide-react';

// =============================================================================
// Props
// =============================================================================

interface FeedbackPanelProps {
    feedback: BuilderFeedback;
}

// =============================================================================
// Size Meter Component
// =============================================================================

interface SizeMeterProps {
    size: number;
    limit: number;
    percentUsed: number;
}

function SizeMeter({ size, limit, percentUsed }: SizeMeterProps) {
    const isWarning = percentUsed > 80;
    const isDanger = percentUsed > 95;

    return (
        <div className="flex items-center gap-3">
            <span className="text-xs text-gray-500 w-8">Size</span>
            <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                <div
                    className={cn(
                        'h-full transition-all duration-300',
                        isDanger
                            ? 'bg-red-500'
                            : isWarning
                                ? 'bg-yellow-500'
                                : 'bg-green-500'
                    )}
                    style={{ width: `${Math.min(percentUsed, 100)}%` }}
                />
            </div>
            <span className={cn(
                'text-xs font-mono w-24 text-right',
                isDanger
                    ? 'text-red-600'
                    : isWarning
                        ? 'text-yellow-600'
                        : 'text-gray-600'
            )}>
                {size} / {limit}
            </span>
        </div>
    );
}

// =============================================================================
// Feedback Panel Component
// =============================================================================

export function FeedbackPanel({ feedback }: FeedbackPanelProps) {
    const { isCompiling, sizeInfo, error } = feedback;

    return (
        <div className="h-10 px-4 border-t border-gray-200 bg-gray-50 flex items-center gap-6">
            {/* Loading state */}
            {isCompiling && (
                <div className="flex items-center gap-2 text-gray-500">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span className="text-xs">Analyzing transaction...</span>
                </div>
            )}

            {/* Size info */}
            {!isCompiling && sizeInfo && (
                <div className="flex-1 max-w-md">
                    <SizeMeter
                        size={sizeInfo.size}
                        limit={sizeInfo.limit}
                        percentUsed={sizeInfo.percentUsed}
                    />
                </div>
            )}

            {/* Status indicator */}
            {!isCompiling && sizeInfo && (
                <div className={cn(
                    'flex items-center gap-1.5 text-xs',
                    sizeInfo.canFitMore ? 'text-green-600' : 'text-red-600'
                )}>
                    {sizeInfo.canFitMore ? (
                        <>
                            <CheckCircle className="w-3.5 h-3.5" />
                            <span>Ready to simulate</span>
                        </>
                    ) : (
                        <>
                            <AlertCircle className="w-3.5 h-3.5" />
                            <span>Transaction too large</span>
                        </>
                    )}
                </div>
            )}

            {/* Error/info state */}
            {!isCompiling && error && (
                <div className="flex items-center gap-2 text-amber-600">
                    <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                    <span className="text-xs truncate max-w-lg">{error}</span>
                </div>
            )}

            {/* Empty state */}
            {!isCompiling && !sizeInfo && !error && (
                <span className="text-xs text-gray-400">
                    Add nodes and configure them to see transaction details
                </span>
            )}
        </div>
    );
}
