/**
 * Hook for providing real-time feedback on transaction size and validity.
 *
 * Debounces graph changes and runs:
 * - Size estimation via TransactionBuilder.getSizeInfo()
 * - Validation via validateGraph()
 *
 * @packageDocumentation
 */

import { useEffect, useState, useRef, useCallback } from 'react';
import { TransactionBuilder } from '@pipeit/core';
import { useBuilderStore } from './store';
import { compileGraph, validateGraph } from './compiler';
import type { CompileContext, SizeInfo, BuilderFeedback, ComputeUnitInfo } from './types';

// =============================================================================
// Constants
// =============================================================================

const DEBOUNCE_MS = 500;
const TRANSACTION_SIZE_LIMIT = 1232;

// =============================================================================
// Hook
// =============================================================================

export function useBuilderFeedback(
    compileContext: CompileContext | null
): BuilderFeedback {
    const nodes = useBuilderStore(state => state.nodes);
    const edges = useBuilderStore(state => state.edges);
    const config = useBuilderStore(state => state.config);

    const [feedback, setFeedback] = useState<BuilderFeedback>({
        isCompiling: false,
        isSimulating: false,
        sizeInfo: null,
        computeUnitInfo: null,
        simulation: null,
        error: null,
    });

    const debounceRef = useRef<NodeJS.Timeout | null>(null);

    // Compute feedback on graph changes
    const computeFeedback = useCallback(async () => {
        console.log('[Feedback] computeFeedback called, nodes:', nodes.length, 'context:', !!compileContext);
        
        if (!compileContext || nodes.length === 0) {
            setFeedback({
                isCompiling: false,
                isSimulating: false,
                sizeInfo: null,
                computeUnitInfo: null,
                simulation: null,
                error: null,
            });
            return;
        }

        // First, validate the graph
        const validationErrors = validateGraph(nodes, edges);
        console.log('[Feedback] Validation errors:', validationErrors);
        if (validationErrors.length > 0) {
            setFeedback({
                isCompiling: false,
                isSimulating: false,
                sizeInfo: null,
                computeUnitInfo: null,
                simulation: null,
                error: validationErrors[0],
            });
            return;
        }

        setFeedback(prev => ({ ...prev, isCompiling: true, error: null }));

        try {
            // Compile the graph
            const compiled = await compileGraph(nodes, edges, compileContext);
            console.log('[Feedback] Compiled instructions:', compiled.instructions.length);

            if (compiled.instructions.length === 0) {
                setFeedback({
                    isCompiling: false,
                    isSimulating: false,
                    sizeInfo: null,
                    computeUnitInfo: null,
                    simulation: null,
                    error: 'No instructions generated. Fill in the configuration fields for your nodes.',
                });
                return;
            }

            // Build transaction to get size info
            const builder = new TransactionBuilder({
                rpc: compileContext.rpc,
                priorityFee: config.priorityFee,
                computeUnits: config.computeUnits === 'auto' ? undefined : config.computeUnits,
            })
                .setFeePayerSigner(compileContext.signer)
                .addInstructions(compiled.instructions);

            // Get size info
            console.log('[Feedback] Getting size info...');
            const sizeInfo = await builder.getSizeInfo();
            console.log('[Feedback] Size info:', sizeInfo);

            // Build CU info from compiled estimates
            const DEFAULT_CU_LIMIT = 200_000;
            const estimatedCU = compiled.computeUnits ?? 0;
            const computeUnitInfo: ComputeUnitInfo | null = estimatedCU > 0
                ? {
                    estimated: estimatedCU,
                    limit: DEFAULT_CU_LIMIT,
                    percentUsed: Math.round((estimatedCU / DEFAULT_CU_LIMIT) * 100),
                }
                : null;

            console.log('[Feedback] CU info:', computeUnitInfo);

            setFeedback({
                isCompiling: false,
                isSimulating: false,
                sizeInfo: {
                    size: sizeInfo.size,
                    limit: sizeInfo.limit,
                    remaining: sizeInfo.remaining,
                    percentUsed: sizeInfo.percentUsed,
                    canFitMore: sizeInfo.canFitMore,
                },
                computeUnitInfo,
                simulation: null,
                error: null,
            });
        } catch (error) {
            console.error('[Feedback] Error:', error);
            setFeedback({
                isCompiling: false,
                isSimulating: false,
                sizeInfo: null,
                computeUnitInfo: null,
                simulation: null,
                error: error instanceof Error ? error.message : 'Unknown error',
            });
        }
    }, [nodes, edges, compileContext, config]);

    // Debounced effect
    useEffect(() => {
        if (debounceRef.current) {
            clearTimeout(debounceRef.current);
        }

        debounceRef.current = setTimeout(() => {
            computeFeedback();
        }, DEBOUNCE_MS);

        return () => {
            if (debounceRef.current) {
                clearTimeout(debounceRef.current);
            }
        };
    }, [computeFeedback]);

    return feedback;
}

