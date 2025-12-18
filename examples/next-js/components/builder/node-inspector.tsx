'use client';

import { useCallback } from 'react';
import { cn } from '@/lib/utils';
import { useBuilderStore } from '@/lib/builder/store';
import { getNodeDefinition } from '@/lib/builder/node-definitions';
import type { NodeType, BuilderNodeData } from '@/lib/builder/types';
import { Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

// =============================================================================
// Form Field Components
// =============================================================================

interface TextFieldProps {
    label: string;
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    type?: 'text' | 'number';
}

function TextField({ label, value, onChange, placeholder, type = 'text' }: TextFieldProps) {
    return (
        <div className="space-y-1.5">
            <label className="text-xs font-medium text-gray-700">{label}</label>
            <input
                type={type}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
                className={cn(
                    'w-full px-3 py-2 text-sm rounded-md border border-gray-300',
                    'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent',
                    'placeholder:text-gray-400'
                )}
            />
        </div>
    );
}

interface TextAreaFieldProps {
    label: string;
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    rows?: number;
}

function TextAreaField({ label, value, onChange, placeholder, rows = 3 }: TextAreaFieldProps) {
    return (
        <div className="space-y-1.5">
            <label className="text-xs font-medium text-gray-700">{label}</label>
            <textarea
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
                rows={rows}
                className={cn(
                    'w-full px-3 py-2 text-sm rounded-md border border-gray-300',
                    'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent',
                    'placeholder:text-gray-400 resize-none'
                )}
            />
        </div>
    );
}

// =============================================================================
// Node-Specific Forms
// =============================================================================

interface FormProps {
    data: BuilderNodeData;
    onUpdate: (data: Partial<BuilderNodeData>) => void;
}

function WalletForm({ data }: FormProps) {
    // Wallet node has no configurable fields
    return (
        <div className="text-sm text-gray-500">
            This node represents your connected wallet. No configuration needed.
        </div>
    );
}

function TransferSolForm({ data, onUpdate }: FormProps) {
    const solData = data as { amount?: string; destination?: string };

    return (
        <div className="space-y-4">
            <TextField
                label="Amount (SOL)"
                value={solData.amount ?? ''}
                onChange={(value) => onUpdate({ amount: value })}
                placeholder="0.1"
                type="number"
            />
            <TextField
                label="Destination Address"
                value={solData.destination ?? ''}
                onChange={(value) => onUpdate({ destination: value })}
                placeholder="Enter Solana address..."
            />
        </div>
    );
}

function TransferTokenForm({ data, onUpdate }: FormProps) {
    const tokenData = data as {
        mint?: string;
        amount?: string;
        destination?: string;
        decimals?: number;
    };

    return (
        <div className="space-y-4">
            <TextField
                label="Token Mint Address"
                value={tokenData.mint ?? ''}
                onChange={(value) => onUpdate({ mint: value })}
                placeholder="Enter token mint..."
            />
            <TextField
                label="Amount"
                value={tokenData.amount ?? ''}
                onChange={(value) => onUpdate({ amount: value })}
                placeholder="100"
                type="number"
            />
            <TextField
                label="Decimals"
                value={String(tokenData.decimals ?? 9)}
                onChange={(value) => onUpdate({ decimals: parseInt(value) || 9 })}
                placeholder="9"
                type="number"
            />
            <TextField
                label="Destination Address"
                value={tokenData.destination ?? ''}
                onChange={(value) => onUpdate({ destination: value })}
                placeholder="Enter recipient address..."
            />
        </div>
    );
}

function CreateAtaForm({ data, onUpdate }: FormProps) {
    const ataData = data as { mint?: string; owner?: string };

    return (
        <div className="space-y-4">
            <TextField
                label="Token Mint Address"
                value={ataData.mint ?? ''}
                onChange={(value) => onUpdate({ mint: value })}
                placeholder="Enter token mint..."
            />
            <TextField
                label="Owner Address (optional)"
                value={ataData.owner ?? ''}
                onChange={(value) => onUpdate({ owner: value })}
                placeholder="Defaults to your wallet..."
            />
        </div>
    );
}

function MemoForm({ data, onUpdate }: FormProps) {
    const memoData = data as { message?: string };

    return (
        <div className="space-y-4">
            <TextAreaField
                label="Memo Message"
                value={memoData.message ?? ''}
                onChange={(value) => onUpdate({ message: value })}
                placeholder="Enter memo text..."
                rows={4}
            />
            <p className="text-xs text-gray-500">
                This message will be stored on-chain with your transaction.
            </p>
        </div>
    );
}

// =============================================================================
// Form Registry
// =============================================================================

const formComponents: Record<NodeType, React.ComponentType<FormProps>> = {
    'wallet': WalletForm,
    'transfer-sol': TransferSolForm,
    'transfer-token': TransferTokenForm,
    'create-ata': CreateAtaForm,
    'memo': MemoForm,
};

// =============================================================================
// Node Inspector Component
// =============================================================================

export function NodeInspector() {
    // Use separate selectors for reactivity
    const nodes = useBuilderStore(state => state.nodes);
    const selectedNodeId = useBuilderStore(state => state.selectedNodeId);
    const selectNode = useBuilderStore(state => state.selectNode);
    const updateNodeData = useBuilderStore(state => state.updateNodeData);
    const removeNode = useBuilderStore(state => state.removeNode);
    
    // Find selected node from nodes array
    const selectedNode = selectedNodeId ? nodes.find(n => n.id === selectedNodeId) ?? null : null;

    const handleUpdate = useCallback((data: Partial<BuilderNodeData>) => {
        if (selectedNode) {
            updateNodeData(selectedNode.id, data);
        }
    }, [selectedNode, updateNodeData]);

    const handleDelete = useCallback(() => {
        if (selectedNode) {
            removeNode(selectedNode.id);
        }
    }, [selectedNode, removeNode]);

    const handleClose = useCallback(() => {
        selectNode(null);
    }, [selectNode]);

    // Empty state
    if (!selectedNode) {
        return (
            <div className="w-72 h-full bg-gray-50 border-l border-gray-200 flex flex-col">
                <div className="px-4 py-3 border-b border-gray-200">
                    <h2 className="text-sm font-semibold text-gray-900">Inspector</h2>
                </div>
                <div className="flex-1 flex items-center justify-center p-4">
                    <p className="text-sm text-gray-500 text-center">
                        Select a node to view and edit its properties
                    </p>
                </div>
            </div>
        );
    }

    const nodeType = selectedNode.type as NodeType;
    const def = getNodeDefinition(nodeType);
    const FormComponent = formComponents[nodeType];

    return (
        <div className="w-72 h-full bg-gray-50 border-l border-gray-200 flex flex-col">
            {/* Header */}
            <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
                <div>
                    <h2 className="text-sm font-semibold text-gray-900">{def.label}</h2>
                    <p className="text-xs text-gray-500">{def.description}</p>
                </div>
                <button
                    onClick={handleClose}
                    className="p-1 rounded hover:bg-gray-200 transition-colors"
                >
                    <X className="w-4 h-4 text-gray-500" />
                </button>
            </div>

            {/* Form */}
            <div className="flex-1 overflow-y-auto p-4">
                {FormComponent && (
                    <FormComponent
                        data={selectedNode.data}
                        onUpdate={handleUpdate}
                    />
                )}
            </div>

            {/* Actions */}
            <div className="px-4 py-3 border-t border-gray-200">
                <Button
                    variant="outline"
                    size="sm"
                    className="w-full text-red-600 hover:text-red-700 hover:bg-red-50"
                    onClick={handleDelete}
                >
                    <Trash2 className="w-4 h-4 mr-2" />
                    Delete Node
                </Button>
            </div>
        </div>
    );
}
