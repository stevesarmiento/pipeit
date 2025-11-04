'use client';

import { motion, useTransform } from 'motion/react';
import { useMemo } from 'react';
import { TransactionStepNode } from './transaction-step-node';
import { BatchGroup } from './batch-group';
import type { VisualPipeline } from '@/lib/visual-pipeline';
import { usePipelineState } from '@/lib/use-visual-pipeline';
import { springs } from '@/lib/pipeline-animations';

interface PipelineVisualizationProps {
  visualPipeline: VisualPipeline;
  strategy?: 'auto' | 'batch' | 'sequential';
}

export function PipelineVisualization({
  visualPipeline,
  strategy = 'auto',
}: PipelineVisualizationProps) {
  const pipelineState = usePipelineState(visualPipeline);

  // Determine which steps are batched together (for 'auto' and 'batch' strategies)
  const batchGroups = useMemo(() => {
    if (strategy === 'sequential') {
      // No batching in sequential mode
      return [];
    }

    // Group consecutive instruction steps into batches
    const groups: string[][] = [];
    let currentBatch: string[] = [];

    visualPipeline.steps.forEach((step) => {
      if (step.type === 'instruction') {
        currentBatch.push(step.name);
      } else {
        // Transaction step breaks the batch
        if (currentBatch.length > 0) {
          groups.push([...currentBatch]);
          currentBatch = [];
        }
        // Transaction steps are not batched
      }
    });

    // Add final batch if exists
    if (currentBatch.length > 0) {
      groups.push(currentBatch);
    }

    return groups;
  }, [visualPipeline.steps, strategy]);

  // Build render items (either batch groups or individual steps)
  const renderItems = useMemo(() => {
    const items: Array<
      | { type: 'batch'; stepNames: string[]; batchIndex: number }
      | { type: 'step'; stepName: string; stepType: 'instruction' | 'transaction' }
    > = [];
    let processedSteps = new Set<string>();

    visualPipeline.steps.forEach((step) => {
      // Skip if already processed as part of a batch
      if (processedSteps.has(step.name)) return;

      // Check if step is in a batch
      const batchIndex = batchGroups.findIndex((group) => group.includes(step.name));
      const isFirstInBatch = batchIndex >= 0 && batchGroups[batchIndex]?.[0] === step.name;

      if (isFirstInBatch && batchIndex >= 0) {
        // Add batch group
        items.push({
          type: 'batch',
          stepNames: batchGroups[batchIndex],
          batchIndex,
        });
        // Mark all steps in batch as processed
        batchGroups[batchIndex].forEach((name) => processedSteps.add(name));
      } else {
        // Add individual step
        items.push({
          type: 'step',
          stepName: step.name,
          stepType: step.type,
        });
        processedSteps.add(step.name);
      }
    });

    return items;
  }, [visualPipeline.steps, batchGroups]);

  // Calculate progress
  const progress = useMemo(() => {
    const totalSteps = visualPipeline.steps.length;
    const completedSteps = visualPipeline.steps.filter((step) => {
      const state = visualPipeline.getStepState(step.name);
      return state.type === 'confirmed';
    }).length;
    return totalSteps > 0 ? completedSteps / totalSteps : 0;
  }, [visualPipeline, pipelineState]);

  return (
    <div className="w-full overflow-x-auto py-8">
      {/* Strategy indicator */}
      <motion.div
        className="mb-4 text-center"
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={springs.default}
      >
        <span className="text-xs font-mono text-gray-500">
          Strategy: <span className="font-semibold text-gray-700">{strategy}</span>
        </span>
      </motion.div>

      {/* Progress bar */}
      {pipelineState === 'executing' && (
        <motion.div
          className="mb-6 h-1 bg-gray-200 rounded-full overflow-hidden max-w-md mx-auto"
          initial={{ opacity: 0, scaleX: 0 }}
          animate={{ opacity: 1, scaleX: 1 }}
          transition={springs.default}
        >
          <motion.div
            className="h-full bg-gradient-to-r from-blue-500 to-purple-500"
            initial={{ scaleX: 0 }}
            animate={{ scaleX: progress }}
            style={{
              transformOrigin: 'left',
            }}
            transition={springs.default}
          />
        </motion.div>
      )}

      <div className="flex flex-col items-center gap-8 min-w-max px-8">
        {/* Render items */}
        {renderItems.map((item, index) => {
          // Check if previous item is completed
          const prevItem = index > 0 ? renderItems[index - 1] : null;
          const prevCompleted =
            prevItem &&
            (prevItem.type === 'batch'
              ? prevItem.stepNames.every((name) => {
                  const state = visualPipeline.getStepState(name);
                  return state.type === 'confirmed';
                })
              : visualPipeline.getStepState(prevItem.stepName).type === 'confirmed');

          return (
            <div key={index} className="flex items-center">
              {/* Arrow from previous item */}
              {index > 0 && (
                <motion.div
                  className="relative w-12 h-0.5 mx-4"
                  initial={{ scaleX: 0 }}
                  animate={{
                    scaleX: 1,
                    backgroundColor: prevCompleted ? 'rgb(74, 222, 128)' : 'rgb(209, 213, 219)',
                  }}
                  transition={{
                    delay: index * 0.1,
                    ...springs.default,
                  }}
                >
                  {/* Arrowhead */}
                  <motion.div
                    className="absolute right-0 top-1/2 -translate-y-1/2 w-0 h-0 border-t-4 border-b-4 border-l-4 border-transparent"
                    style={{
                      borderLeftColor: prevCompleted ? 'rgb(74, 222, 128)' : 'rgb(209, 213, 219)',
                    }}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: index * 0.1 + 0.2 }}
                  />
                </motion.div>
              )}

              {/* Render batch group or individual step */}
              {item.type === 'batch' ? (
                <BatchGroup
                  visualPipeline={visualPipeline}
                  stepNames={item.stepNames}
                  batchIndex={item.batchIndex}
                />
              ) : (
                <TransactionStepNode
                  visualPipeline={visualPipeline}
                  stepName={item.stepName}
                  stepType={item.stepType}
                  isBatched={false}
                />
              )}
            </div>
          );
        })}

        {/* Pipeline state indicator */}
        <motion.div
          className="mt-4 text-sm font-mono text-gray-500"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
        >
          Status: <span className="font-semibold">{pipelineState}</span>
        </motion.div>
      </div>
    </div>
  );
}
