'use client';

import { useCallback } from 'react';
import { cn } from '@/lib/utils';
import { useBuilderStore } from '@/lib/builder/store';
import { getNodeDefinition, STRATEGY_INFO, COMMON_TOKENS } from '@/lib/builder/node-definitions';
import type { NodeType, BuilderNodeData, ExecutionStrategy, JitoRegion } from '@/lib/builder/types';
import { Trash2, X, Info, Zap, Shield, Rocket, Coins } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { TokenListElement } from '@solana/connector/react';
import { ChevronDown, Check } from 'lucide-react';

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
            <Label className="text-xs">{label}</Label>
            <Input
                type={type}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
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
            <Label className="text-xs">{label}</Label>
            <textarea
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
                rows={rows}
                className={cn(
                    'flex w-full rounded-[12px] border border-input bg-muted px-3 py-2 text-sm shadow-xs',
                    'placeholder:text-muted-foreground',
                    'focus-visible:outline-none focus-visible:border-ring focus-visible:ring-ring/30 focus-visible:ring-[3px]',
                    'disabled:cursor-not-allowed disabled:opacity-50',
                    'resize-none'
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
            <Label className="text-xs">{label}</Label>
            <Select value={value} onValueChange={(val: string) => onChange(val as T)}>
                <SelectTrigger>
                    <SelectValue placeholder="Select an option..." />
                </SelectTrigger>
                <SelectContent>
                    {options.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
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
        tokenSymbol?: string;
        tokenLogo?: string;
        tokenBalance?: string;
    };

    // Calculate amount from percentage of balance
    const setAmountFromPercent = (percent: number) => {
        const balance = parseFloat(tokenData.tokenBalance ?? '0');
        if (balance > 0) {
            const amount = (balance * percent / 100).toString();
            onUpdate({ amount });
        }
    };

    const percentPresets = [25, 50, 75, 100] as const;

    return (
        <div className="space-y-4">
            {/* Token Selector using TokenListElement */}
            <div className="space-y-1.5">
                <Label className="text-xs">Select Token</Label>
                <TokenListElement
                    render={({ tokens, isLoading }) => {
                        if (isLoading) {
                            return (
                                <div className="flex h-11 w-full items-center justify-between rounded-[12px] border border-input bg-muted px-3 py-1 text-base text-muted-foreground md:text-sm">
                                    Loading tokens...
                                </div>
                            );
                        }

                        if (tokens.length === 0) {
                            return (
                                <div className="flex h-11 w-full items-center justify-between rounded-[12px] border border-input bg-muted px-3 py-1 text-base text-muted-foreground md:text-sm">
                                    No tokens found
                                </div>
                            );
                        }

                        const selectedToken = tokenData.mint ? tokens.find(t => t.mint === tokenData.mint) : null;
                        const displayLogo = selectedToken?.logo || tokenData.tokenLogo;
                        const displaySymbol = selectedToken?.symbol || tokenData.tokenSymbol;

                        return (
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <button className="flex h-11 w-full items-center justify-between rounded-[12px] border border-input bg-muted px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none hover:border-border-medium focus:border-ring focus:ring-ring/30 focus:ring-[3px] transition-all duration-200 ease-in-out disabled:cursor-not-allowed disabled:opacity-50 md:text-sm">
                                        <span className="flex items-center gap-2">
                                            {displayLogo ? (
                                                <img
                                                    src={displayLogo}
                                                    alt={displaySymbol || 'Token'}
                                                    className="w-5 h-5 rounded-full flex-shrink-0"
                                                />
                                            ) : tokenData.mint ? (
                                                <Coins className="w-5 h-5 text-gray-500 flex-shrink-0" />
                                            ) : null}
                                            <span>{displaySymbol || 'Select a token...'}</span>
                                        </span>
                                        <ChevronDown className="h-4 w-4 opacity-50" />
                                    </button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent className="w-[280px]" align="start">
                                    {tokens.map(token => (
                                        <DropdownMenuItem
                                            key={token.mint}
                                            className="py-2 cursor-pointer"
                                            onClick={() => {
                                                onUpdate({
                                                    mint: token.mint,
                                                    decimals: token.decimals,
                                                    tokenSymbol: token.symbol,
                                                    tokenLogo: token.logo,
                                                    tokenBalance: token.formatted,
                                                });
                                            }}
                                        >
                                            <div className="flex items-center gap-2 w-full">
                                                {token.logo ? (
                                                    <img
                                                        src={token.logo}
                                                        alt={token.symbol}
                                                        className="w-5 h-5 rounded-full flex-shrink-0"
                                                    />
                                                ) : (
                                                    <Coins className="w-5 h-5 text-gray-500 flex-shrink-0" />
                                                )}
                                                <div className="flex-1 min-w-0">
                                                    <div className="font-medium text-sm">{token.symbol}</div>
                                                    <div className="text-xs text-gray-500 truncate">{token.name}</div>
                                                </div>
                                                <div className="text-right ml-2 flex-shrink-0">
                                                    <div className="text-sm font-mono">{token.formatted}</div>
                                                </div>
                                                {tokenData.mint === token.mint && (
                                                    <Check className="h-4 w-4 text-primary flex-shrink-0" />
                                                )}
                                            </div>
                                        </DropdownMenuItem>
                                    ))}
                                </DropdownMenuContent>
                            </DropdownMenu>
                        );
                    }}
                />
            </div>

            {/* Manual mint input as fallback */}
            <div className="space-y-1.5">
                <Label className="text-xs">
                    Or enter mint address manually
                </Label>
                <Input
                    type="text"
                    value={tokenData.mint ?? ''}
                    onChange={(e) => onUpdate({ mint: e.target.value, tokenSymbol: undefined, tokenLogo: undefined, tokenBalance: undefined })}
                    placeholder="Enter token mint..."
                />
            </div>

            {/* Amount with percentage presets */}
            <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                    <Label className="text-xs">Amount</Label>
                    {tokenData.tokenBalance && (
                        <span className="text-xs text-gray-500">
                            Balance: {tokenData.tokenBalance}
                        </span>
                    )}
                </div>
                
                {/* Percentage presets */}
                {tokenData.tokenBalance && parseFloat(tokenData.tokenBalance) > 0 && (
                    <div className="flex gap-1">
                        {percentPresets.map(percent => (
                            <Button
                                key={percent}
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => setAmountFromPercent(percent)}
                                className="flex-1"
                            >
                                {percent}%
                            </Button>
                        ))}
                    </div>
                )}

                <Input
                    type="number"
                    value={tokenData.amount ?? ''}
                    onChange={(e) => onUpdate({ amount: e.target.value })}
                    placeholder="100"
                />
            </div>

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

/**
 * Common token options for swap form dropdowns.
 */
const TOKEN_OPTIONS = [
    { value: COMMON_TOKENS.SOL, label: 'SOL' },
    { value: COMMON_TOKENS.USDC, label: 'USDC' },
    { value: COMMON_TOKENS.USDT, label: 'USDT' },
    { value: 'custom', label: 'Custom...' },
] as const;

/**
 * Token select field with custom mint input option.
 */
function TokenSelectField({
    label,
    value,
    onChange,
    placeholder,
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
}) {
    // Check if the current value matches a known token
    const isKnownToken = TOKEN_OPTIONS.some(
        (opt) => opt.value !== 'custom' && opt.value === value
    );
    const showCustomInput = !isKnownToken && value !== '';

    return (
        <div className="space-y-1.5">
            <Label className="text-xs">{label}</Label>
            <Select
                value={isKnownToken ? value : 'custom'}
                onValueChange={(selectedValue: string) => {
                    if (selectedValue === 'custom') {
                        onChange('');
                    } else {
                        onChange(selectedValue);
                    }
                }}
            >
                <SelectTrigger>
                    <SelectValue placeholder="Select token..." />
                </SelectTrigger>
                <SelectContent>
                    {TOKEN_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
            {(showCustomInput || (!isKnownToken && value === '')) && (
                <Input
                    type="text"
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder={placeholder ?? 'Enter token mint address...'}
                    className="mt-1.5"
                />
            )}
        </div>
    );
}

function SwapForm({ data, onUpdate }: FormProps) {
    const swapData = data as {
        inputMint?: string;
        outputMint?: string;
        amount?: string;
        slippageBps?: number;
        inputTokenSymbol?: string;
        inputTokenLogo?: string;
        inputTokenBalance?: string;
        inputTokenDecimals?: number;
        outputTokenSymbol?: string;
        outputTokenLogo?: string;
    };

    // Calculate amount from percentage of balance
    const setAmountFromPercent = (percent: number) => {
        const balance = parseFloat(swapData.inputTokenBalance ?? '0');
        if (balance > 0) {
            const amount = (balance * percent / 100).toString();
            onUpdate({ amount });
        }
    };

    const percentPresets = [25, 50, 75, 100] as const;

    return (
        <div className="space-y-4">
            {/* Input Token Selector using TokenListElement */}
            <div className="space-y-1.5">
                <Label className="text-xs">From Token</Label>
                <TokenListElement
                    render={({ tokens, isLoading }) => {
                        if (isLoading) {
                            return (
                                <div className="flex h-11 w-full items-center justify-between rounded-[12px] border border-input bg-muted px-3 py-1 text-base text-muted-foreground md:text-sm">
                                    Loading tokens...
                                </div>
                            );
                        }

                        if (tokens.length === 0) {
                            return (
                                <div className="flex h-11 w-full items-center justify-between rounded-[12px] border border-input bg-muted px-3 py-1 text-base text-muted-foreground md:text-sm">
                                    No tokens found
                                </div>
                            );
                        }

                        const selectedToken = swapData.inputMint ? tokens.find(t => t.mint === swapData.inputMint) : null;
                        const displayLogo = selectedToken?.logo || swapData.inputTokenLogo;
                        const displaySymbol = selectedToken?.symbol || swapData.inputTokenSymbol;

                        return (
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <button className="flex h-11 w-full items-center justify-between rounded-[12px] border border-input bg-muted px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none hover:border-border-medium focus:border-ring focus:ring-ring/30 focus:ring-[3px] transition-all duration-200 ease-in-out disabled:cursor-not-allowed disabled:opacity-50 md:text-sm">
                                        <span className="flex items-center gap-2">
                                            {displayLogo ? (
                                                <img
                                                    src={displayLogo}
                                                    alt={displaySymbol || 'Token'}
                                                    className="w-5 h-5 rounded-full flex-shrink-0"
                                                />
                                            ) : swapData.inputMint ? (
                                                <Coins className="w-5 h-5 text-gray-500 flex-shrink-0" />
                                            ) : null}
                                            <span>{displaySymbol || 'Select input token...'}</span>
                                        </span>
                                        <ChevronDown className="h-4 w-4 opacity-50" />
                                    </button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent className="w-[280px]" align="start">
                                    {tokens.map(token => (
                                        <DropdownMenuItem
                                            key={token.mint}
                                            className="py-2 cursor-pointer"
                                            onClick={() => {
                                                onUpdate({
                                                    inputMint: token.mint,
                                                    inputTokenSymbol: token.symbol,
                                                    inputTokenLogo: token.logo,
                                                    inputTokenBalance: token.formatted,
                                                    inputTokenDecimals: token.decimals,
                                                });
                                            }}
                                        >
                                            <div className="flex items-center gap-2 w-full">
                                                {token.logo ? (
                                                    <img
                                                        src={token.logo}
                                                        alt={token.symbol}
                                                        className="w-5 h-5 rounded-full flex-shrink-0"
                                                    />
                                                ) : (
                                                    <Coins className="w-5 h-5 text-gray-500 flex-shrink-0" />
                                                )}
                                                <div className="flex-1 min-w-0">
                                                    <div className="font-medium text-sm">{token.symbol}</div>
                                                    <div className="text-xs text-gray-500 truncate">{token.name}</div>
                                                </div>
                                                <div className="text-right ml-2 flex-shrink-0">
                                                    <div className="text-sm font-mono">{token.formatted}</div>
                                                </div>
                                                {swapData.inputMint === token.mint && (
                                                    <Check className="h-4 w-4 text-primary flex-shrink-0" />
                                                )}
                                            </div>
                                        </DropdownMenuItem>
                                    ))}
                                </DropdownMenuContent>
                            </DropdownMenu>
                        );
                    }}
                />
            </div>

            {/* Output Token Selector using TokenListElement */}
            <div className="space-y-1.5">
                <Label className="text-xs">To Token</Label>
                <TokenListElement
                    render={({ tokens, isLoading }) => {
                        if (isLoading) {
                            return (
                                <div className="flex h-11 w-full items-center justify-between rounded-[12px] border border-input bg-muted px-3 py-1 text-base text-muted-foreground md:text-sm">
                                    Loading tokens...
                                </div>
                            );
                        }

                        if (tokens.length === 0) {
                            return (
                                <div className="flex h-11 w-full items-center justify-between rounded-[12px] border border-input bg-muted px-3 py-1 text-base text-muted-foreground md:text-sm">
                                    No tokens found
                                </div>
                            );
                        }

                        const selectedToken = swapData.outputMint ? tokens.find(t => t.mint === swapData.outputMint) : null;
                        const displayLogo = selectedToken?.logo || swapData.outputTokenLogo;
                        const displaySymbol = selectedToken?.symbol || swapData.outputTokenSymbol;

                        return (
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <button className="flex h-11 w-full items-center justify-between rounded-[12px] border border-input bg-muted px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none hover:border-border-medium focus:border-ring focus:ring-ring/30 focus:ring-[3px] transition-all duration-200 ease-in-out disabled:cursor-not-allowed disabled:opacity-50 md:text-sm">
                                        <span className="flex items-center gap-2">
                                            {displayLogo ? (
                                                <img
                                                    src={displayLogo}
                                                    alt={displaySymbol || 'Token'}
                                                    className="w-5 h-5 rounded-full flex-shrink-0"
                                                />
                                            ) : swapData.outputMint ? (
                                                <Coins className="w-5 h-5 text-gray-500 flex-shrink-0" />
                                            ) : null}
                                            <span>{displaySymbol || 'Select output token...'}</span>
                                        </span>
                                        <ChevronDown className="h-4 w-4 opacity-50" />
                                    </button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent className="w-[280px]" align="start">
                                    {tokens.map(token => (
                                        <DropdownMenuItem
                                            key={token.mint}
                                            className="py-2 cursor-pointer"
                                            onClick={() => {
                                                onUpdate({
                                                    outputMint: token.mint,
                                                    outputTokenSymbol: token.symbol,
                                                    outputTokenLogo: token.logo,
                                                });
                                            }}
                                        >
                                            <div className="flex items-center gap-2 w-full">
                                                {token.logo ? (
                                                    <img
                                                        src={token.logo}
                                                        alt={token.symbol}
                                                        className="w-5 h-5 rounded-full flex-shrink-0"
                                                    />
                                                ) : (
                                                    <Coins className="w-5 h-5 text-gray-500 flex-shrink-0" />
                                                )}
                                                <div className="flex-1 min-w-0">
                                                    <div className="font-medium text-sm">{token.symbol}</div>
                                                    <div className="text-xs text-gray-500 truncate">{token.name}</div>
                                                </div>
                                                <div className="text-right ml-2 flex-shrink-0">
                                                    <div className="text-sm font-mono">{token.formatted}</div>
                                                </div>
                                                {swapData.outputMint === token.mint && (
                                                    <Check className="h-4 w-4 text-primary flex-shrink-0" />
                                                )}
                                            </div>
                                        </DropdownMenuItem>
                                    ))}
                                </DropdownMenuContent>
                            </DropdownMenu>
                        );
                    }}
                />
            </div>

            {/* Amount with percentage presets */}
            <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                    <Label className="text-xs">Amount</Label>
                    {swapData.inputTokenBalance && (
                        <span className="text-xs text-gray-500">
                            Balance: {swapData.inputTokenBalance}
                        </span>
                    )}
                </div>
                
                {/* Percentage presets */}
                {swapData.inputTokenBalance && parseFloat(swapData.inputTokenBalance) > 0 && (
                    <div className="flex gap-1">
                        {percentPresets.map(percent => (
                            <Button
                                key={percent}
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => setAmountFromPercent(percent)}
                                className="flex-1"
                            >
                                {percent}%
                            </Button>
                        ))}
                    </div>
                )}

                <Input
                    type="number"
                    value={swapData.amount ?? ''}
                    onChange={(e) => onUpdate({ amount: e.target.value })}
                    placeholder="1.0"
                />
            </div>

            <div className="space-y-1.5">
                <Label className="text-xs">
                    Slippage Tolerance
                </Label>
                <div className="flex items-center gap-2">
                    <Input
                        type="number"
                        value={((swapData.slippageBps ?? 50) / 100).toFixed(2)}
                        onChange={(e) => {
                            const percent = parseFloat(e.target.value);
                            if (!isNaN(percent)) {
                                onUpdate({ slippageBps: Math.round(percent * 100) });
                            }
                        }}
                        step="0.1"
                        min="0"
                        max="50"
                        className="w-20"
                    />
                    <span className="text-sm text-gray-500">%</span>
                </div>
                <p className="text-xs text-gray-500">
                    Default: 0.5%. Higher slippage may result in worse rates.
                </p>
            </div>

            {/* Info card */}
            <Card className="bg-blue-50 border-blue-200">
                <CardContent className="p-3">
                    <p className="text-xs text-blue-700">
                        Swaps are powered by Jupiter. Quote will be fetched at execution time for best rates.
                    </p>
                </CardContent>
            </Card>
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
            <Card className={cn(
                'rounded-lg',
                strategy === 'standard' && 'bg-gray-50 border-gray-200',
                strategy === 'economical' && 'bg-blue-50 border-blue-200',
                strategy === 'fast' && 'bg-amber-50 border-amber-200',
                strategy === 'ultra' && 'bg-purple-50 border-purple-200'
            )}>
                <CardContent className="p-3">
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
                </CardContent>
            </Card>

            {/* Jito settings */}
            {showJitoSettings && (
                <div className="space-y-3 pt-2 border-t border-gray-200">
                    <Label className="text-xs">Jito Settings</Label>
                    
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
                    <Label className="text-xs">TPU Direct</Label>
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
    'swap': SwapForm,
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

