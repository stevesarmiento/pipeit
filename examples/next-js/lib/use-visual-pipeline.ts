'use client';

import { useSyncExternalStore } from 'react';
import type { VisualPipeline, StepState } from './visual-pipeline';

/**
 * Hook to subscribe to a specific step's state changes.
 * Similar to useVisualEffectState in Visual Effect.
 */
export function useStepState(visualPipeline: VisualPipeline, stepName: string): StepState {
    return useSyncExternalStore(
        listener => visualPipeline.subscribe(listener),
        () => visualPipeline.getStepState(stepName),
        () => visualPipeline.getStepState(stepName),
    );
}

/**
 * Hook to subscribe to the overall pipeline state.
 */
export function usePipelineState(visualPipeline: VisualPipeline): VisualPipeline['state'] {
    return useSyncExternalStore(
        listener => visualPipeline.subscribe(listener),
        () => visualPipeline.state,
        () => visualPipeline.state,
    );
}

/**
 * Hook to get execution metrics.
 */
export function usePipelineMetrics(visualPipeline: VisualPipeline) {
    return useSyncExternalStore(
        listener => visualPipeline.subscribe(listener),
        () => ({
            duration: visualPipeline.getExecutionDuration(),
            totalCost: visualPipeline.getTotalCost(),
        }),
        () => ({
            duration: visualPipeline.getExecutionDuration(),
            totalCost: visualPipeline.getTotalCost(),
        }),
    );
}
