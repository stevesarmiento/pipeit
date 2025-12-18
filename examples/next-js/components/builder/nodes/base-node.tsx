'use client';

import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { cn } from '@/lib/utils';
import { useBuilderStore } from '@/lib/builder/store';
import type { BuilderNodeData, NodeType, BuilderNode } from '@/lib/builder/types';
import { getNodeDefinition } from '@/lib/builder/node-definitions';
import {
    Wallet,
    Send,
    Coins,
    PlusCircle,
    MessageSquare,
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
    const def = getNodeDefinition(type);
    const colors = categoryColors[def.category] ?? categoryColors.utility;
    const IconComponent = iconMap[def.icon] ?? MessageSquare;

    const hasInputs = Object.keys(def.inputs).length > 0;
    const hasOutputs = Object.keys(def.outputs).length > 0;

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
            {/* Input handles */}
            {hasInputs && (
                <Handle
                    type="target"
                    position={Position.Left}
                    className="!w-3 !h-3 !bg-gray-400 !border-2 !border-white"
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

            {/* Output handles */}
            {hasOutputs && (
                <Handle
                    type="source"
                    position={Position.Right}
                    className="!w-3 !h-3 !bg-gray-400 !border-2 !border-white"
                />
            )}
        </div>
    );
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
            const tokenData = data as { amount?: string; mint?: string };
            return (
                <div className="text-[10px] text-gray-500 space-y-0.5">
                    {tokenData.amount && (
                        <div>{tokenData.amount} tokens</div>
                    )}
                    {tokenData.mint && (
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

        default:
            return null;
    }
}

export const BaseNode = memo(BaseNodeComponent);
