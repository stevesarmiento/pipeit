'use client';

import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { cn } from '@/lib/utils';
import { useBuilderStore, useHasAnySequence } from '@/lib/builder/store';
import type { BuilderNodeData, NodeType } from '@/lib/builder/types';
import { HANDLE_NAMES } from '@/lib/builder/types';
import { getNodeDefinition, COMMON_TOKENS } from '@/lib/builder/node-definitions';
import {
    Wallet,
    Send,
    Coins,
    PlusCircle,
    MessageSquare,
    Rocket,
} from 'lucide-react';

// =============================================================================
// Icon Mapping
// =============================================================================

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
    'wallet': Wallet,
    'send': Send,
    'coins': Coins,
    'plus-circle': PlusCircle,
    'message-square': MessageSquare,
    'rocket': Rocket,
};

// =============================================================================
// Category Colors
// =============================================================================

const categoryColors: Record<string, { bg: string; border: string; icon: string }> = {
    source: {
        bg: 'bg-purple-50',
        border: 'border-purple-300',
        icon: 'text-purple-600',
    },
    transfer: {
        bg: 'bg-blue-50',
        border: 'border-blue-300',
        icon: 'text-blue-600',
    },
    token: {
        bg: 'bg-green-50',
        border: 'border-green-300',
        icon: 'text-green-600',
    },
    utility: {
        bg: 'bg-orange-50',
        border: 'border-orange-300',
        icon: 'text-orange-600',
    },
    execution: {
        bg: 'bg-gradient-to-r from-indigo-50 to-purple-50',
        border: 'border-indigo-400',
        icon: 'text-indigo-600',
    },
};

// =============================================================================
// Base Node Component
// =============================================================================

interface BaseNodeProps {
    id: string;
    data: BuilderNodeData;
    type: NodeType;
    selected?: boolean;
}

function BaseNodeComponent({ id, data, type, selected }: BaseNodeProps) {
    const selectNode = useBuilderStore(state => state.selectNode);
    const hasAnySequence = useHasAnySequence();
    const def = getNodeDefinition(type);
    const colors = categoryColors[def.category] ?? categoryColors.utility;
    const IconComponent = iconMap[def.icon] ?? MessageSquare;

    // Determine if this node type has flow handles
    const hasFlowIn = HANDLE_NAMES.FLOW_IN in def.inputs;
    const hasFlowOut = HANDLE_NAMES.FLOW_OUT in def.outputs;
    
    // Check if this is an instruction node (not wallet or execute)
    const isInstructionNode = type !== 'wallet' && type !== 'execute';
    
    // Batch handles are shown on ALL instruction nodes if:
    // 1. The node definition includes them
    // 2. ANY vertical sequence exists in the graph (progressive disclosure)
    // Once user builds any flow, all instruction nodes get batch handles
    const hasBatchHandles = HANDLE_NAMES.BATCH_IN in def.inputs;
    const showBatchHandles = hasBatchHandles && isInstructionNode && hasAnySequence;

    return (
        <div
            className={cn(
                'relative min-w-[140px] rounded-lg border-2 shadow-sm transition-all',
                colors.bg,
                colors.border,
                selected && 'ring-2 ring-offset-2 ring-blue-500 shadow-md'
            )}
            onClick={() => selectNode(id)}
        >
            {/* Flow Input Handle - TOP (vertical sequential) */}
            {hasFlowIn && (
                <Handle
                    id={HANDLE_NAMES.FLOW_IN}
                    type="target"
                    position={Position.Top}
                    className="!w-3 !h-3 !bg-gray-400 !border-2 !border-white"
                />
            )}

            {/* Batch Input Handle - LEFT (horizontal batch) - only visible when in sequence */}
            {showBatchHandles && (
                <Handle
                    id={HANDLE_NAMES.BATCH_IN}
                    type="target"
                    position={Position.Left}
                    className="!w-2.5 !h-2.5 !bg-amber-400 !border-2 !border-white !top-1/2 !-translate-y-1/2"
                />
            )}

            {/* Node content */}
            <div className="px-3 py-2">
                {/* Header */}
                <div className="flex items-center gap-2 mb-1">
                    <IconComponent className={cn('w-4 h-4', colors.icon)} />
                    <span className="text-xs font-semibold text-gray-700">
                        {def.label}
                    </span>
                </div>

                {/* Preview of key data */}
                <NodePreview type={type} data={data} />
            </div>

            {/* Batch Output Handle - RIGHT (horizontal batch) - only visible when in sequence */}
            {showBatchHandles && (
                <Handle
                    id={HANDLE_NAMES.BATCH_OUT}
                    type="source"
                    position={Position.Right}
                    className="!w-2.5 !h-2.5 !bg-amber-400 !border-2 !border-white !top-1/2 !-translate-y-1/2"
                />
            )}

            {/* Flow Output Handle - BOTTOM (vertical sequential) */}
            {hasFlowOut && (
                <Handle
                    id={HANDLE_NAMES.FLOW_OUT}
                    type="source"
                    position={Position.Bottom}
                    className="!w-3 !h-3 !bg-gray-400 !border-2 !border-white"
                />
            )}
        </div>
    );
}

// =============================================================================
// Helper Functions
// =============================================================================

function getDisplaySymbol(mint: string | undefined, tokenSymbol: string | undefined): string | null {
    if (tokenSymbol) return tokenSymbol;
    if (!mint) return null;
    if (mint === COMMON_TOKENS.SOL) return 'SOL';
    if (mint === COMMON_TOKENS.USDC) return 'USDC';
    if (mint === COMMON_TOKENS.USDT) return 'USDT';
    return mint.slice(0, 4) + '...';
}

// =============================================================================
// Node Preview (shows key data in the node)
// =============================================================================

interface NodePreviewProps {
    type: NodeType;
    data: BuilderNodeData;
}

function NodePreview({ type, data }: NodePreviewProps) {
    switch (type) {
        case 'wallet':
            return (
                <div className="text-[10px] text-gray-500 truncate max-w-[120px]">
                    Connected
                </div>
            );

        case 'transfer-sol': {
            const solData = data as { amount?: string; destination?: string };
            return (
                <div className="text-[10px] text-gray-500 space-y-0.5">
                    {solData.amount && (
                        <div>{solData.amount} SOL</div>
                    )}
                    {solData.destination && (
                        <div className="truncate max-w-[120px]">
                            → {solData.destination.slice(0, 8)}...
                        </div>
                    )}
                    {!solData.amount && !solData.destination && (
                        <div className="italic">Configure...</div>
                    )}
                </div>
            );
        }

        case 'transfer-token': {
            const tokenData = data as { amount?: string; mint?: string; tokenSymbol?: string };
            return (
                <div className="text-[10px] text-gray-500 space-y-0.5">
                    {tokenData.amount && tokenData.tokenSymbol && (
                        <div>{tokenData.amount} {tokenData.tokenSymbol}</div>
                    )}
                    {tokenData.amount && !tokenData.tokenSymbol && (
                        <div>{tokenData.amount} tokens</div>
                    )}
                    {!tokenData.amount && tokenData.tokenSymbol && (
                        <div>{tokenData.tokenSymbol}</div>
                    )}
                    {!tokenData.amount && !tokenData.tokenSymbol && tokenData.mint && (
                        <div className="truncate max-w-[120px]">
                            {tokenData.mint.slice(0, 8)}...
                        </div>
                    )}
                    {!tokenData.amount && !tokenData.mint && (
                        <div className="italic">Configure...</div>
                    )}
                </div>
            );
        }

        case 'swap': {
            const swapData = data as { 
                amount?: string; 
                inputMint?: string; 
                outputMint?: string;
                inputTokenSymbol?: string;
                outputTokenSymbol?: string;
            };
            const fromSymbol = getDisplaySymbol(swapData.inputMint, swapData.inputTokenSymbol);
            const toSymbol = getDisplaySymbol(swapData.outputMint, swapData.outputTokenSymbol);
            return (
                <div className="text-[10px] text-gray-500 space-y-0.5">
                    {swapData.amount && fromSymbol && toSymbol && (
                        <div>{swapData.amount} {fromSymbol} → {toSymbol}</div>
                    )}
                    {swapData.amount && fromSymbol && !toSymbol && (
                        <div>{swapData.amount} {fromSymbol}</div>
                    )}
                    {!swapData.amount && fromSymbol && toSymbol && (
                        <div>{fromSymbol} → {toSymbol}</div>
                    )}
                    {!swapData.amount && !fromSymbol && !toSymbol && (
                        <div className="italic">Configure...</div>
                    )}
                </div>
            );
        }

        case 'create-ata': {
            const ataData = data as { mint?: string };
            return (
                <div className="text-[10px] text-gray-500">
                    {ataData.mint ? (
                        <div className="truncate max-w-[120px]">
                            {ataData.mint.slice(0, 8)}...
                        </div>
                    ) : (
                        <div className="italic">Configure...</div>
                    )}
                </div>
            );
        }

        case 'memo': {
            const memoData = data as { message?: string };
            return (
                <div className="text-[10px] text-gray-500 truncate max-w-[120px]">
                    {memoData.message ? (
                        `"${memoData.message.slice(0, 20)}${memoData.message.length > 20 ? '...' : ''}"`
                    ) : (
                        <span className="italic">Configure...</span>
                    )}
                </div>
            );
        }

        case 'execute': {
            const execData = data as { strategy?: string };
            const strategyLabels: Record<string, string> = {
                standard: 'Standard RPC',
                economical: 'Jito Bundle',
                fast: 'Fast (Jito + RPC)',
                ultra: 'TPU Direct',
            };
            return (
                <div className="text-[10px] text-gray-500 font-medium">
                    {strategyLabels[execData.strategy ?? 'standard'] ?? 'Standard'}
                </div>
            );
        }

        default:
            return null;
    }
}

export const BaseNode = memo(BaseNodeComponent);

