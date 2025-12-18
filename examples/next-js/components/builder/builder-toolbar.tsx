'use client';

import { useCallback, useState, useMemo } from 'react';
import { useCluster } from '@solana/connector';
import { useBuilderStore, useExecutionState } from '@/lib/builder/store';
import { compileGraph } from '@/lib/builder/compiler';
import { TransactionBuilder } from '@pipeit/core';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
    Play,
    FlaskConical,
    Trash2,
    CheckCircle,
    XCircle,
    Loader2,
    AlertCircle,
} from 'lucide-react';
import type { CompileContext } from '@/lib/builder/types';

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
        error?: string;
    } | null>(null);

    const canExecute = nodes.length > 0 && compileContext !== null;
    const isExecuting = executionState.status !== 'idle' &&
        executionState.status !== 'success' &&
        executionState.status !== 'error';

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

            setSimulationResult({
                success: result.err === null,
                computeUnits: result.unitsConsumed ? Number(result.unitsConsumed) : undefined,
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

    // Handle execution
    const handleExecute = useCallback(async () => {
        if (!compileContext) {
            console.log('[Builder] No compile context - wallet not connected');
            return;
        }

        console.log('[Builder] Starting execution with', nodes.length, 'nodes');
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

            const signature = await new TransactionBuilder({
                rpc: compileContext.rpc,
                priorityFee: config.priorityFee,
                computeUnits: config.computeUnits === 'auto' ? 200_000 : config.computeUnits,
                autoRetry: { maxAttempts: 3, backoff: 'exponential' },
                logLevel: 'verbose',
            })
                .setFeePayerSigner(compileContext.signer)
                .addInstructions(compiled.instructions)
                .execute({
                    rpcSubscriptions: compileContext.rpcSubscriptions,
                    commitment: 'confirmed',
                    skipPreflight: false,
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
    }, [nodes, edges, compileContext, config, setExecutionState]);

    // Handle clear
    const handleClear = useCallback(() => {
        reset();
        setSimulationResult(null);
    }, [reset]);

    return (
        <div className="h-14 px-4 border-b border-gray-200 bg-white flex items-center justify-between">
            {/* Left side - title */}
            <div className="flex items-center gap-4">
                <h1 className="text-lg font-semibold text-gray-900">
                    Transaction Builder
                </h1>
                <span className="text-sm text-gray-500">
                    {nodes.length} node{nodes.length !== 1 ? 's' : ''}
                </span>
                {cluster && (
                    <span className={cn(
                        'px-2 py-0.5 rounded text-xs font-medium',
                        cluster.id?.includes('mainnet') 
                            ? 'bg-green-100 text-green-700'
                            : cluster.id?.includes('devnet')
                                ? 'bg-purple-100 text-purple-700'
                                : 'bg-gray-100 text-gray-700'
                    )}>
                        {cluster.label || cluster.id?.replace('solana:', '')}
                    </span>
                )}
            </div>

            {/* Right side - actions */}
            <div className="flex items-center gap-3">
                {/* Simulation result indicator */}
                {simulationResult && (
                    <div 
                        className={cn(
                            'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium max-w-sm',
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
                                    {simulationResult.computeUnits
                                        ? `${simulationResult.computeUnits.toLocaleString()} CU`
                                        : 'Valid'}
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
