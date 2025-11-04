'use client';

import { motion, useSpring, useTransform } from 'motion/react';
import { TransactionStepNode } from './transaction-step-node';
import type { VisualPipeline } from '@/lib/visual-pipeline';
import { useStepState } from '@/lib/use-visual-pipeline';
import { springs } from '@/lib/pipeline-animations';
import { useMemo } from 'react';

interface BatchGroupProps {
  visualPipeline: VisualPipeline;
  stepNames: string[];
  batchIndex: number;
}

export function BatchGroup({ visualPipeline, stepNames, batchIndex }: BatchGroupProps) {
  // Get signature from first step (all steps in batch share same signature)
  const firstStepState = useStepState(visualPipeline, stepNames[0]);
  const signature = firstStepState.type === 'confirmed' ? firstStepState.signature : null;
  const cost = firstStepState.type === 'confirmed' ? firstStepState.cost : 0;
  const sequentialCost = stepNames.length * 0.000005; // Cost if executed sequentially
  const savings = sequentialCost - cost;

  // Check if batch is executing
  const isExecuting = stepNames.some((name) => {
    const stepState = visualPipeline.getStepState(name);
    return (
      stepState.type === 'building' ||
      stepState.type === 'signing' ||
      stepState.type === 'sending'
    );
  });

  const isCompleted = stepNames.every((name) => {
    const stepState = visualPipeline.getStepState(name);
    return stepState.type === 'confirmed';
  });

  // Animated cost savings counter
  const animatedSavings = useSpring(0, springs.default);
  const animatedSavingsPercent = useSpring(0, springs.default);

  useMemo(() => {
    if (savings > 0) {
      animatedSavings.set(savings);
      animatedSavingsPercent.set((savings / sequentialCost) * 100);
    }
  }, [savings, sequentialCost, animatedSavings, animatedSavingsPercent]);

  const displaySavings = useTransform(animatedSavings, (v) => v.toFixed(9));
  const displayPercent = useTransform(animatedSavingsPercent, (v) => v.toFixed(0));

  return (
    <motion.div
      className="relative border-2 border-dashed border-purple-400 rounded-lg p-4 bg-purple-50/50"
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{
        opacity: 1,
        scale: 1,
        borderColor: isExecuting
          ? 'rgba(147, 51, 234, 0.8)' // purple-600
          : isCompleted
            ? 'rgba(147, 51, 234, 0.6)' // purple-500
            : 'rgba(192, 132, 252, 0.6)', // purple-400
      }}
      transition={{ duration: 0.3 }}
      style={{
        boxShadow: isExecuting
          ? '0 0 24px rgba(147, 51, 234, 0.3)'
          : isCompleted
            ? '0 0 16px rgba(147, 51, 234, 0.2)'
            : 'none',
      }}
    >
      {/* Batch header */}
      <motion.div
        className="absolute -top-3 left-4 bg-purple-100 px-2 py-0.5 rounded text-xs font-mono text-purple-700 border border-purple-300"
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        Batch {batchIndex + 1} ({stepNames.length} instructions)
      </motion.div>

      {/* Steps in batch */}
      <div className="flex items-center justify-center gap-4 mt-2">
        {stepNames.map((stepName, index) => {
          const step = visualPipeline.steps.find((s) => s.name === stepName);
          const stepState = visualPipeline.getStepState(stepName);
          const isStepCompleted = stepState.type === 'confirmed';

          return (
            <motion.div
              key={stepName}
              className="flex items-center"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{
                opacity: 1,
                scale: 1,
              }}
              transition={{
                delay: index * 0.1,
                ...springs.default,
              }}
            >
              <TransactionStepNode
                visualPipeline={visualPipeline}
                stepName={stepName}
                stepType={step?.type || 'instruction'}
                isBatched={true}
              />
              {index < stepNames.length - 1 && (
                <motion.div
                  className="w-8 h-0.5 bg-purple-400 mx-2"
                  initial={{ scaleX: 0 }}
                  animate={{
                    scaleX: 1,
                    backgroundColor: isStepCompleted ? 'rgba(147, 51, 234, 0.8)' : 'rgba(192, 132, 252, 0.6)',
                  }}
                  transition={{
                    delay: index * 0.1 + 0.2,
                    duration: 0.3,
                  }}
                />
              )}
            </motion.div>
          );
        })}
      </div>

      {/* Batch info footer */}
      {signature && (
        <motion.div
          className="mt-4 text-center space-y-1"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5, ...springs.default }}
        >
          <div className="text-xs font-mono text-gray-600">
            Signature: {signature.slice(0, 8)}...
          </div>
          {savings > 0 && (
            <motion.div
              className="text-xs text-green-600 font-medium"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.7 }}
            >
              Saved{' '}
              <motion.span>{displaySavings}</motion.span> SOL (
              <motion.span>{displayPercent}</motion.span>%)
            </motion.div>
          )}
        </motion.div>
      )}

      {/* Success shimmer effect */}
      {isCompleted && (
        <motion.div
          className="absolute inset-0 rounded-lg pointer-events-none"
          initial={{ opacity: 0 }}
          animate={{
            opacity: [0, 0.3, 0],
          }}
          transition={{
            duration: 1.5,
            repeat: Infinity,
            repeatDelay: 2,
          }}
          style={{
            background:
              'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.3) 50%, transparent 100%)',
          }}
        />
      )}
    </motion.div>
  );
}
