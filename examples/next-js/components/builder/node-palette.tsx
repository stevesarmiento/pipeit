'use client';

import { useCallback } from 'react';
import { cn } from '@/lib/utils';
import { getAllNodeDefinitions } from '@/lib/builder/node-definitions';
import type { NodeCategory, NodeType } from '@/lib/builder/types';
import {
    Wallet,
    Send,
    Coins,
    PlusCircle,
    MessageSquare,
    GripVertical,
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
// Category Labels
// =============================================================================

const categoryLabels: Record<NodeCategory, string> = {
    source: 'Sources',
    transfer: 'Transfers',
    token: 'Token Operations',
    utility: 'Utilities',
    execution: 'Execution',
};

const categoryOrder: NodeCategory[] = ['source', 'transfer', 'token', 'utility', 'execution'];

// =============================================================================
// Palette Item Component
// =============================================================================

interface PaletteItemProps {
    type: NodeType;
    label: string;
    description: string;
    icon: string;
    onDragStart: (event: React.DragEvent, nodeType: NodeType) => void;
}

function PaletteItem({ type, label, description, icon, onDragStart }: PaletteItemProps) {
    const IconComponent = iconMap[icon] ?? MessageSquare;

    return (
        <div
            className={cn(
                'flex items-center gap-3 p-3 rounded-lg border border-gray-200 bg-white',
                'cursor-grab hover:border-gray-300 hover:shadow-sm transition-all',
                'active:cursor-grabbing'
            )}
            draggable
            onDragStart={(e) => onDragStart(e, type)}
        >
            <GripVertical className="w-4 h-4 text-gray-400 flex-shrink-0" />
            <IconComponent className="w-5 h-5 text-gray-600 flex-shrink-0" />
            <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-gray-900">{label}</div>
                <div className="text-xs text-gray-500 truncate">{description}</div>
            </div>
        </div>
    );
}

// =============================================================================
// Node Palette Component
// =============================================================================

export function NodePalette() {
    const nodeDefinitions = getAllNodeDefinitions();

    // Group definitions by category
    const groupedNodes = categoryOrder.reduce((acc, category) => {
        acc[category] = nodeDefinitions.filter(def => def.category === category);
        return acc;
    }, {} as Record<NodeCategory, typeof nodeDefinitions>);

    const onDragStart = useCallback((event: React.DragEvent, nodeType: NodeType) => {
        event.dataTransfer.setData('application/reactflow', nodeType);
        event.dataTransfer.effectAllowed = 'move';
    }, []);

    return (
        <div className="w-64 h-full bg-gray-50 border-r border-gray-200 flex flex-col">
            {/* Header */}
            <div className="px-4 py-3 border-b border-gray-200">
                <h2 className="text-sm font-semibold text-gray-900">Node Palette</h2>
                <p className="text-xs text-gray-500 mt-0.5">
                    Drag nodes onto the canvas
                </p>
            </div>

            {/* Node categories */}
            <div className="flex-1 overflow-y-auto p-4 space-y-6">
                {categoryOrder.map(category => {
                    const nodes = groupedNodes[category];
                    if (!nodes || nodes.length === 0) return null;

                    return (
                        <div key={category}>
                            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                                {categoryLabels[category]}
                            </h3>
                            <div className="space-y-2">
                                {nodes.map(def => (
                                    <PaletteItem
                                        key={def.type}
                                        type={def.type}
                                        label={def.label}
                                        description={def.description}
                                        icon={def.icon}
                                        onDragStart={onDragStart}
                                    />
                                ))}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Footer hint */}
            <div className="px-4 py-3 border-t border-gray-200 bg-gray-100">
                <p className="text-xs text-gray-500 text-center">
                    Connect nodes with edges to define execution order
                </p>
            </div>
        </div>
    );
}

