'use client';

import { useCallback } from 'react';
import { cn } from '@/lib/utils';
import { useBuilderStore } from '@/lib/builder/store';
import { getNodeDefinition, STRATEGY_INFO } from '@/lib/builder/node-definitions';
import type { NodeType, BuilderNodeData, ExecutionStrategy, JitoRegion } from '@/lib/builder/types';
import { Trash2, X, Info, Zap, Shield, Rocket } from 'lucide-react';
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

interface SelectFieldProps<T extends string> {
    label: string;
    value: T;
    onChange: (value: T) => void;
    options: { value: T; label: string }[];
}

function SelectField<T extends string>({ label, value, onChange, options }: SelectFieldProps<T>) {
    return (
        <div className="space-y-1.5">
            <label className="text-xs font-medium text-gray-700">{label}</label>
            <select
                value={value}
                onChange={(e) => onChange(e.target.value as T)}
                className={cn(
                    'w-full px-3 py-2 text-sm rounded-md border border-gray-300',
                    'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent',
                    'bg-white'
                )}
            >
                {options.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                        {opt.label}
                    </option>
                ))}
            </select>
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

function ExecuteForm({ data, onUpdate }: FormProps) {
    const execData = data as {
        strategy?: ExecutionStrategy;
        jitoTipLamports?: string;
        jitoRegion?: JitoRegion;
        tpuEnabled?: boolean;
    };

    const strategy = execData.strategy ?? 'standard';
    // Only show Jito settings for economical and fast (NOT ultra - that's TPU only)
    const showJitoSettings = strategy === 'economical' || strategy === 'fast';
    const showTpuSettings = strategy === 'ultra';
    const strategyInfo = STRATEGY_INFO[strategy];

    const strategyOptions: { value: ExecutionStrategy; label: string }[] = [
        { value: 'standard', label: 'Standard RPC' },
        { value: 'economical', label: 'Jito Bundle' },
        { value: 'fast', label: 'Fast (Jito + RPC)' },
        { value: 'ultra', label: 'Ultra (TPU Direct)' },
    ];

    const regionOptions: { value: JitoRegion; label: string }[] = [
        { value: 'mainnet', label: 'Auto (Load Balanced)' },
        { value: 'ny', label: 'New York' },
        { value: 'amsterdam', label: 'Amsterdam' },
        { value: 'frankfurt', label: 'Frankfurt' },
        { value: 'tokyo', label: 'Tokyo' },
        { value: 'singapore', label: 'Singapore' },
        { value: 'slc', label: 'Salt Lake City' },
    ];

    // Get icon based on strategy
    const StrategyIcon = strategy === 'ultra' ? Rocket : strategy === 'fast' ? Zap : strategy === 'economical' ? Shield : Info;

    return (
        <div className="space-y-4">
            <SelectField
                label="Execution Strategy"
                value={strategy}
                onChange={(value) => onUpdate({ strategy: value })}
                options={strategyOptions}
            />

            {/* Strategy info card */}
            <div className={cn(
                'p-3 rounded-lg border',
                strategy === 'standard' && 'bg-gray-50 border-gray-200',
                strategy === 'economical' && 'bg-blue-50 border-blue-200',
                strategy === 'fast' && 'bg-amber-50 border-amber-200',
                strategy === 'ultra' && 'bg-purple-50 border-purple-200'
            )}>
                <div className="flex items-start gap-2">
                    <StrategyIcon className={cn(
                        'w-4 h-4 mt-0.5',
                        strategy === 'standard' && 'text-gray-500',
                        strategy === 'economical' && 'text-blue-500',
                        strategy === 'fast' && 'text-amber-500',
                        strategy === 'ultra' && 'text-purple-500'
                    )} />
                    <div className="flex-1">
                        <p className="text-xs font-medium text-gray-700">
                            {strategyInfo?.description}
                        </p>
                        <ul className="mt-1.5 space-y-0.5">
                            {strategyInfo?.features.map((feature, i) => (
                                <li key={i} className="text-xs text-gray-500 flex items-center gap-1">
                                    <span className="w-1 h-1 rounded-full bg-gray-400" />
                                    {feature}
                                </li>
                            ))}
                        </ul>
                    </div>
                </div>
            </div>

            {/* Jito settings */}
            {showJitoSettings && (
                <div className="space-y-3 pt-2 border-t border-gray-200">
                    <p className="text-xs font-medium text-gray-700">Jito Settings</p>
                    
                    <TextField
                        label="Tip Amount (lamports)"
                        value={execData.jitoTipLamports ?? '10000'}
                        onChange={(value) => onUpdate({ jitoTipLamports: value })}
                        placeholder="10000"
                        type="number"
                    />
                    <p className="text-xs text-gray-500">
                        1 SOL = 1,000,000,000 lamports. Default: 10,000 (0.00001 SOL)
                    </p>

                    <SelectField
                        label="Block Engine Region"
                        value={execData.jitoRegion ?? 'mainnet'}
                        onChange={(value) => onUpdate({ jitoRegion: value })}
                        options={regionOptions}
                    />
                </div>
            )}

            {/* TPU info */}
            {showTpuSettings && (
                <div className="space-y-2 pt-2 border-t border-gray-200">
                    <p className="text-xs font-medium text-gray-700">TPU Direct</p>
                    <p className="text-xs text-gray-500">
                        Ultra mode sends transactions directly to validator TPU ports for lowest latency.
                        Requires <code className="px-1 py-0.5 bg-gray-100 rounded text-xs">@pipeit/fastlane</code> package.
                    </p>
                </div>
            )}
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
    'execute': ExecuteForm,
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
