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
// Meter Component
// =============================================================================

interface MeterProps {
    label: string;
    labelWidth?: string;
    value: number;
    limit: number;
    percentUsed: number;
    suffix?: string;
    formatValue?: (value: number) => string;
}

function Meter({ label, labelWidth = 'w-8', value, limit, percentUsed, suffix, formatValue }: MeterProps) {
    const isWarning = percentUsed > 80;
    const isDanger = percentUsed > 95;
    const formattedValue = formatValue ? formatValue(value) : value.toLocaleString();
    const formattedLimit = formatValue ? formatValue(limit) : limit.toLocaleString();

    return (
        <div className="flex items-center gap-3">
            <span className={cn('text-xs text-gray-500', labelWidth)}>{label}</span>
            <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden min-w-16">
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
                'text-xs font-mono text-right whitespace-nowrap',
                isDanger
                    ? 'text-red-600'
                    : isWarning
                        ? 'text-yellow-600'
                        : 'text-gray-600'
            )}>
                {formattedValue} / {formattedLimit}{suffix ? ` ${suffix}` : ''}
            </span>
        </div>
    );
}

// =============================================================================
// Feedback Panel Component
// =============================================================================

export function FeedbackPanel({ feedback }: FeedbackPanelProps) {
    const { isCompiling, sizeInfo, computeUnitInfo, error } = feedback;

    return (
        <div className="h-10 px-4 border-t border-gray-200 bg-gray-50 flex items-center gap-6">
            {/* Loading state */}
            {isCompiling && (
                <div className="flex items-center gap-2 text-gray-500">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span className="text-xs">Analyzing transaction...</span>
                </div>
            )}

            {/* Size meter */}
            {!isCompiling && sizeInfo && (
                <div className="flex-1 max-w-xs">
                    <Meter
                        label="Size"
                        value={sizeInfo.size}
                        limit={sizeInfo.limit}
                        percentUsed={sizeInfo.percentUsed}
                        suffix="B"
                    />
                </div>
            )}

            {/* CU meter */}
            {!isCompiling && computeUnitInfo && (
                <div className="flex-1 max-w-xs">
                    <Meter
                        label="CU"
                        value={computeUnitInfo.estimated}
                        limit={computeUnitInfo.limit}
                        percentUsed={computeUnitInfo.percentUsed}
                        formatValue={(v) => `~${(v / 1000).toFixed(0)}k`}
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
                            <span>Ready</span>
                        </>
                    ) : (
                        <>
                            <AlertCircle className="w-3.5 h-3.5" />
                            <span>Too large</span>
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
