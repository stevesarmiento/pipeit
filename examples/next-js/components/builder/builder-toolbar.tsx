'use client';

import { useCallback, useState, useMemo } from 'react';
import { useCluster } from '@solana/connector';
import { useBuilderStore, useExecutionState } from '@/lib/builder/store';
import { compileGraph, extractExecutionConfig } from '@/lib/builder/compiler';
import { TransactionBuilder, JITO_BLOCK_ENGINES } from '@pipeit/core';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
    Play,
    FlaskConical,
    Trash2,
    CheckCircle,
    XCircle,
    Loader2,
    AlertCircle,
    Rocket,
    Zap,
    Shield,
    ChevronLeft,
} from 'lucide-react';
import Link from 'next/link';
import type { CompileContext, JitoRegion } from '@/lib/builder/types';

// =============================================================================
// Props
// =============================================================================

interface BuilderToolbarProps {
    compileContext: CompileContext | null;
    onSimulate?: () => void;
}

// =============================================================================
// Toolbar Component
// =============================================================================

export function BuilderToolbar({ compileContext, onSimulate }: BuilderToolbarProps) {
    const nodes = useBuilderStore(state => state.nodes);
    const edges = useBuilderStore(state => state.edges);
    const config = useBuilderStore(state => state.config);
    const executionState = useExecutionState();
    const setExecutionState = useBuilderStore(state => state.setExecutionState);
    const reset = useBuilderStore(state => state.reset);
    const { cluster } = useCluster();

    const [isSimulating, setIsSimulating] = useState(false);
    const [simulationResult, setSimulationResult] = useState<{
        success: boolean;
        computeUnits?: number;
        solTransfer?: string; // SOL amount as formatted string
        tokenTransfers?: Array<{ amount: string; symbol: string }>; // Token transfers
        error?: string;
    } | null>(null);

    // Count instruction nodes (not wallet or execute - those are structural)
    const instructionNodeCount = nodes.filter(
        n => n.type !== 'wallet' && n.type !== 'execute'
    ).length;

    const canExecute = instructionNodeCount > 0 && compileContext !== null;
    const isExecuting = executionState.status !== 'idle' &&
        executionState.status !== 'success' &&
        executionState.status !== 'error';

    // Extract execution config from Execute node (if present)
    const executionConfig = useMemo(() => extractExecutionConfig(nodes), [nodes]);

    // Build explorer URL based on cluster
    const getExplorerUrl = useMemo(() => {
        return (signature: string) => {
            const clusterId = cluster?.id || 'solana:mainnet';
            // Solscan uses different URL patterns
            if (clusterId === 'solana:mainnet' || clusterId.includes('mainnet')) {
                return `https://solscan.io/tx/${signature}`;
            } else if (clusterId === 'solana:devnet' || clusterId.includes('devnet')) {
                return `https://solscan.io/tx/${signature}?cluster=devnet`;
            } else if (clusterId === 'solana:testnet' || clusterId.includes('testnet')) {
                return `https://solscan.io/tx/${signature}?cluster=testnet`;
            }
            // Fallback to Solana Explorer for other clusters
            return `https://explorer.solana.com/tx/${signature}?cluster=${clusterId.replace('solana:', '')}`;
        };
    }, [cluster]);

    // Handle simulation
    const handleSimulate = useCallback(async () => {
        if (!compileContext) {
            console.log('[Builder] No compile context - wallet not connected');
            return;
        }

        console.log('[Builder] Starting simulation with', nodes.length, 'nodes');
        setIsSimulating(true);
        setSimulationResult(null);

        try {
            const compiled = await compileGraph(nodes, edges, compileContext);
            console.log('[Builder] Compiled', compiled.instructions.length, 'instructions');

            if (compiled.instructions.length === 0) {
                setSimulationResult({
                    success: false,
                    error: 'No instructions to simulate. Fill in the node configuration fields.',
                });
                setIsSimulating(false);
                return;
            }

            const builder = new TransactionBuilder({
                rpc: compileContext.rpc,
                priorityFee: config.priorityFee,
                computeUnits: config.computeUnits === 'auto' ? undefined : config.computeUnits,
            })
                .setFeePayerSigner(compileContext.signer)
                .addInstructions(compiled.instructions);

            console.log('[Builder] Running simulation (will prompt wallet for signature)...');
            const result = await builder.simulate();
            console.log('[Builder] Simulation result:', result);

            // Format SOL transfer amount if present
            let solTransfer: string | undefined;
            if (compiled.totalSolTransferLamports) {
                const solAmount = Number(compiled.totalSolTransferLamports) / 1_000_000_000;
                solTransfer = solAmount.toLocaleString(undefined, { 
                    minimumFractionDigits: 0,
                    maximumFractionDigits: 9 
                }) + ' SOL';
            }

            // Format token transfers if present
            let tokenTransfers: Array<{ amount: string; symbol: string }> | undefined;
            if (compiled.tokenTransfers && compiled.tokenTransfers.length > 0) {
                // Known token symbols
                const KNOWN_TOKENS: Record<string, string> = {
                    'So11111111111111111111111111111111111111112': 'SOL',
                    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': 'USDC',
                    'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': 'USDT',
                };
                
                tokenTransfers = compiled.tokenTransfers.map(transfer => {
                    const displayAmount = Number(transfer.amount) / Math.pow(10, transfer.decimals);
                    // Use known symbol or truncate mint for display
                    const symbol = KNOWN_TOKENS[transfer.mint] 
                        ?? (transfer.mint.length > 10 
                            ? `${transfer.mint.slice(0, 4)}...${transfer.mint.slice(-4)}`
                            : transfer.mint);
                    return {
                        amount: displayAmount.toLocaleString(undefined, {
                            minimumFractionDigits: 0,
                            maximumFractionDigits: Math.min(transfer.decimals, 6), // Cap at 6 decimals for readability
                        }),
                        symbol,
                    };
                });
            }

            setSimulationResult({
                success: result.err === null,
                computeUnits: result.unitsConsumed ? Number(result.unitsConsumed) : undefined,
                solTransfer,
                tokenTransfers,
                error: result.err ? JSON.stringify(result.err) : undefined,
            });
        } catch (error) {
            console.error('[Builder] Simulation error:', error);
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            
            // Provide more helpful error messages
            let displayError = errorMessage;
            if (errorMessage.includes('Failed to sign')) {
                displayError = 'Simulation requires wallet approval. Please approve in your wallet, or click Execute to run directly.';
            } else if (errorMessage.includes('User rejected')) {
                displayError = 'Wallet signature rejected. Simulation cancelled.';
            }
            
            setSimulationResult({
                success: false,
                error: displayError,
            });
        } finally {
            setIsSimulating(false);
        }
    }, [nodes, edges, compileContext, config]);

    // Submit transaction via TPU API route
    const submitViaTpu = async (base64Tx: string): Promise<{ delivered: boolean; latencyMs: number }> => {
        console.log('[Builder] Submitting via TPU API...');
        const response = await fetch('/api/tpu', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ transaction: base64Tx }),
        });
        
        const result = await response.json();
        console.log('[Builder] TPU result:', result);
        
        if (!response.ok || result.error) {
            throw new Error(result.error || 'TPU submission failed');
        }
        
        return result;
    };

    // Handle execution
    const handleExecute = useCallback(async () => {
        if (!compileContext) {
            console.log('[Builder] No compile context - wallet not connected');
            return;
        }

        console.log('[Builder] Starting execution with', nodes.length, 'nodes');
        console.log('[Builder] Execution strategy:', executionConfig.strategy);
        setExecutionState({ status: 'compiling' });
        setSimulationResult(null);

        try {
            const compiled = await compileGraph(nodes, edges, compileContext);
            console.log('[Builder] Compiled', compiled.instructions.length, 'instructions');

            if (compiled.instructions.length === 0) {
                setExecutionState({
                    status: 'error',
                    error: new Error('No instructions to execute. Fill in the node configuration fields.'),
                });
                return;
            }

            setExecutionState({ status: 'signing' });
            console.log('[Builder] Building and signing transaction...');

            // Build execution config based on Execute node settings
            const builderConfig = {
                rpc: compileContext.rpc,
                priorityFee: config.priorityFee,
                computeUnits: config.computeUnits === 'auto' ? 200_000 : config.computeUnits,
                autoRetry: { maxAttempts: 3, backoff: 'exponential' },
                logLevel: 'verbose',
            };

            const builder = new TransactionBuilder(builderConfig)
                .setFeePayerSigner(compileContext.signer)
                .addInstructions(compiled.instructions);

            // For ultra strategy: use TPU direct submission via native QUIC
            if (executionConfig.strategy === 'ultra' && executionConfig.tpu?.enabled) {
                console.log('[Builder] Using ULTRA strategy with TPU direct (native QUIC)');
                
                // Export signed transaction as base64
                const exported = await builder.export('base64');
                const base64Tx = exported?.data as string;
                if (!base64Tx) {
                    throw new Error('Failed to export transaction');
                }
                console.log('[Builder] Transaction exported, size:', base64Tx.length, 'chars');
                
                setExecutionState({ status: 'sending' });
                
                // Race TPU submission against standard RPC
                // TPU sends to validators directly, RPC confirms and returns signature
                const racePromises: Promise<{ signature: string; via: string }>[] = [];
                
                // TPU submission (fast delivery to validators)
                racePromises.push(
                    submitViaTpu(base64Tx).then(result => {
                        console.log('[Builder] TPU delivered:', result.delivered, 'latency:', result.latencyMs, 'ms');
                        if (!result.delivered) {
                            throw new Error('TPU delivery failed');
                        }
                        // TPU doesn't return signature, will get it from RPC
                        return { signature: 'tpu-delivered', via: 'tpu' };
                    })
                );
                
                // Standard RPC submission (to get signature confirmation)
                racePromises.push(
                    builder.execute({
                        rpcSubscriptions: compileContext.rpcSubscriptions,
                        commitment: 'confirmed',
                        skipPreflight: true,
                    }).then(sig => ({ signature: sig, via: 'rpc' }))
                );
                
                // Wait for RPC to confirm (TPU helps it land faster)
                // We need the signature from RPC
                const results = await Promise.allSettled(racePromises);
                const rpcResult = results.find(r => 
                    r.status === 'fulfilled' && r.value.via === 'rpc'
                );
                
                if (rpcResult && rpcResult.status === 'fulfilled') {
                    console.log('[Builder] Transaction confirmed via:', rpcResult.value.via);
                    setExecutionState({ status: 'success', signature: rpcResult.value.signature });
                } else {
                    // Fallback: if RPC failed, check if TPU succeeded
                    const tpuResult = results.find(r => 
                        r.status === 'fulfilled' && r.value.via === 'tpu'
                    );
                    if (tpuResult) {
                        throw new Error('TPU delivered but RPC confirmation failed. Check explorer.');
                    }
                    throw new Error('Both TPU and RPC submission failed');
                }
                return;
            }

            // For other strategies: use TransactionBuilder.execute() directly
            let executeExecution: {
                jito?: { enabled: boolean; tipLamports: bigint; blockEngineUrl: string; mevProtection: boolean };
            } | undefined = undefined;

            // Add Jito config if enabled (economical or fast strategies)
            if (executionConfig.jito?.enabled) {
                const region = executionConfig.jito.region as JitoRegion;
                executeExecution = {
                    jito: {
                        enabled: true,
                        tipLamports: executionConfig.jito.tipLamports,
                        blockEngineUrl: JITO_BLOCK_ENGINES[region] || JITO_BLOCK_ENGINES.mainnet,
                        mevProtection: true,
                    },
                };
                console.log('[Builder] Jito enabled with tip:', executionConfig.jito.tipLamports.toString(), 'lamports');
            }

            setExecutionState({ status: 'sending' });

            const signature = await builder.execute({
                rpcSubscriptions: compileContext.rpcSubscriptions,
                commitment: 'confirmed',
                skipPreflight: false,
                execution: executeExecution,
            });

            console.log('[Builder] Transaction successful:', signature);
            setExecutionState({ status: 'success', signature });
        } catch (error) {
            console.error('[Builder] Execution error:', error);
            
            // Provide more helpful error messages
            let displayError = error instanceof Error ? error : new Error('Unknown error');
            const errorMsg = displayError.message;
            
            if (errorMsg.includes('block') && errorMsg.includes('progressed')) {
                displayError = new Error('Transaction expired. Please try again - the network was slow to confirm.');
            } else if (errorMsg.includes('User rejected')) {
                displayError = new Error('Transaction rejected by wallet.');
            } else if (errorMsg.includes('insufficient funds') || errorMsg.includes('Insufficient')) {
                displayError = new Error('Insufficient funds in wallet for this transaction.');
            }
            
            setExecutionState({
                status: 'error',
                error: displayError,
            });
        }
    }, [nodes, edges, compileContext, config, executionConfig, setExecutionState]);

    // Handle clear
    const handleClear = useCallback(() => {
        reset();
        setSimulationResult(null);
    }, [reset]);

    return (
        <div className="h-14 px-4 border-b border-gray-200 bg-white flex items-center justify-between">
            {/* Left side - title */}
            <div className="flex items-center gap-4">
                <div className="flex items-center gap-1">
                    <Link 
                        href="/" 
                        className="p-1 -ml-1 rounded-md hover:bg-gray-100 transition-colors text-gray-500 hover:text-gray-900"
                    >
                        <ChevronLeft className="w-5 h-5" />
                    </Link>
                    <h1 className="text-lg font-semibold text-gray-900">
                        Transaction Builder
                    </h1>
                </div>
                <span className="text-sm text-gray-500">
                    {instructionNodeCount} instruction{instructionNodeCount !== 1 ? 's' : ''}
                </span>
                {cluster && (
                    <Badge 
                        variant="secondary"
                        className={cn(
                            cluster.id?.includes('mainnet') 
                                ? 'bg-green-100 text-green-700 border-green-200'
                                : cluster.id?.includes('devnet')
                                    ? 'bg-purple-100 text-purple-700 border-purple-200'
                                    : 'bg-gray-100 text-gray-700 border-gray-200'
                        )}
                    >
                        {cluster.label || cluster.id?.replace('solana:', '')}
                    </Badge>
                )}
                {/* Execution mode badge */}
                {executionConfig.strategy !== 'standard' && (
                    <Badge 
                        variant="secondary"
                        className={cn(
                            'flex items-center gap-1',
                            executionConfig.strategy === 'economical' && 'bg-blue-100 text-blue-700 border-blue-200',
                            executionConfig.strategy === 'fast' && 'bg-amber-100 text-amber-700 border-amber-200',
                            executionConfig.strategy === 'ultra' && 'bg-purple-100 text-purple-700 border-purple-200'
                        )}
                    >
                        {executionConfig.strategy === 'economical' && <Shield className="w-3 h-3" />}
                        {executionConfig.strategy === 'fast' && <Zap className="w-3 h-3" />}
                        {executionConfig.strategy === 'ultra' && <Rocket className="w-3 h-3" />}
                        {executionConfig.strategy === 'economical' && 'Jito'}
                        {executionConfig.strategy === 'fast' && 'Fast'}
                        {executionConfig.strategy === 'ultra' && 'TPU'}
                    </Badge>
                )}
            </div>

            {/* Right side - actions */}
            <div className="flex items-center gap-3">
                {/* Simulation result indicator */}
                {simulationResult && (
                    <div 
                        className={cn(
                            'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium max-w-md',
                            simulationResult.success
                                ? 'bg-green-100 text-green-700'
                                : 'bg-amber-100 text-amber-700'
                        )}
                        title={simulationResult.error}
                    >
                        {simulationResult.success ? (
                            <>
                                <CheckCircle className="w-3.5 h-3.5 flex-shrink-0" />
                                <span>
                                    {/* SOL transfers */}
                                    {simulationResult.solTransfer && (
                                        <span className="font-semibold">{simulationResult.solTransfer}</span>
                                    )}
                                    {/* Token transfers */}
                                    {simulationResult.tokenTransfers && simulationResult.tokenTransfers.length > 0 && (
                                        <>
                                            {simulationResult.solTransfer && ' + '}
                                            {simulationResult.tokenTransfers.map((t, i) => (
                                                <span key={i}>
                                                    {i > 0 && ', '}
                                                    <span className="font-semibold">{t.amount}</span>
                                                    <span className="opacity-75 ml-0.5">{t.symbol}</span>
                                                </span>
                                            ))}
                                        </>
                                    )}
                                    {/* Separator before CU */}
                                    {(simulationResult.solTransfer || simulationResult.tokenTransfers) && simulationResult.computeUnits && ' · '}
                                    {/* Compute units */}
                                    {simulationResult.computeUnits
                                        ? `${simulationResult.computeUnits.toLocaleString()} CU`
                                        : (!simulationResult.solTransfer && !simulationResult.tokenTransfers) ? 'Valid' : ''}
                                </span>
                            </>
                        ) : (
                            <>
                                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                                <span className="truncate">{simulationResult.error?.slice(0, 50)}{(simulationResult.error?.length ?? 0) > 50 ? '...' : ''}</span>
                            </>
                        )}
                    </div>
                )}

                {/* Execution state indicator */}
                {executionState.status === 'success' && (
                    <a
                        href={getExplorerUrl(executionState.signature)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700 hover:bg-green-200 transition-colors"
                    >
                        <CheckCircle className="w-3.5 h-3.5" />
                        <span>{executionState.signature.slice(0, 8)}...</span>
                    </a>
                )}

                {executionState.status === 'error' && (
                    <div 
                        className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-red-100 text-red-700 max-w-xs cursor-help"
                        title={executionState.error.message}
                    >
                        <XCircle className="w-3.5 h-3.5 flex-shrink-0" />
                        <span className="truncate">{executionState.error.message.slice(0, 40)}{executionState.error.message.length > 40 ? '...' : ''}</span>
                    </div>
                )}

                {/* Clear button */}
                <Button
                    variant="outline"
                    size="sm"
                    onClick={handleClear}
                    disabled={nodes.length === 0}
                >
                    <Trash2 className="w-4 h-4 mr-1.5" />
                    Clear
                </Button>

                {/* Simulate button */}
                <Button
                    variant="outline"
                    size="sm"
                    onClick={handleSimulate}
                    disabled={!canExecute || isSimulating || isExecuting}
                >
                    {isSimulating ? (
                        <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                    ) : (
                        <FlaskConical className="w-4 h-4 mr-1.5" />
                    )}
                    Simulate
                </Button>

                {/* Execute button */}
                <Button
                    size="sm"
                    onClick={handleExecute}
                    disabled={!canExecute || isExecuting}
                    className="bg-blue-600 hover:bg-blue-700"
                >
                    {isExecuting ? (
                        <>
                            <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                            {executionState.status === 'compiling' && 'Compiling...'}
                            {executionState.status === 'signing' && 'Signing...'}
                            {executionState.status === 'sending' && 'Sending...'}
                            {executionState.status === 'confirming' && 'Confirming...'}
                        </>
                    ) : (
                        <>
                            <Play className="w-4 h-4 mr-1.5" />
                            Execute
                        </>
                    )}
                </Button>
            </div>
        </div>
    );
}

