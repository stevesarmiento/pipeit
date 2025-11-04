'use client';

import { AnimatePresence, motion, useTransform } from 'motion/react';
import { memo, useCallback, useState } from 'react';
import { useStepState } from '@/lib/use-visual-pipeline';
import type { VisualPipeline } from '@/lib/visual-pipeline';
import { cn } from '@/lib/utils';
import {
  useStepMotion,
  useRunningAnimation,
  useStateAnimations,
  useStepAnimations,
} from '@/lib/use-step-motion';
import { StepOverlay } from './step-overlay';
import { stepVariants, getStepShadow } from '@/lib/step-variants';
import { colors, effects, springs } from '@/lib/pipeline-animations';
import { GLOW_COLORS } from '@/lib/pipeline-colors';

interface TransactionStepNodeProps {
  visualPipeline: VisualPipeline;
  stepName: string;
  stepType: 'instruction' | 'transaction';
  isBatched?: boolean;
}

function TransactionStepNodeComponent({
  visualPipeline,
  stepName,
  stepType,
  isBatched = false,
}: TransactionStepNodeProps) {
  const state = useStepState(visualPipeline, stepName);
  const [isHovering, setIsHovering] = useState(false);
  const [showErrorBubble, setShowErrorBubble] = useState(false);

  const isInstruction = stepType === 'instruction';
  const isFailed = state.type === 'failed';
  const isConfirmed = state.type === 'confirmed';
  const isExecuting =
    state.type === 'building' || state.type === 'signing' || state.type === 'sending';

  // Get motion values
  const motionValues = useStepMotion();

  // Apply animations based on state
  useRunningAnimation(isExecuting, motionValues);
  useStateAnimations(state, motionValues);
  useStepAnimations(state, motionValues, isHovering, setShowErrorBubble);

  // Determine variant key
  const variantKey = state.type;

  const handleMouseEnter = useCallback(() => {
    setIsHovering(true);
    if (isFailed) setShowErrorBubble(true);
  }, [isFailed]);

  const handleMouseLeave = useCallback(() => {
    setIsHovering(false);
  }, []);

  return (
    <div className="relative flex flex-col items-center">
      <motion.div
        style={{
          width: motionValues.nodeWidth,
          height: motionValues.nodeHeight,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
        }}
      >
        <motion.div
          className={cn(
            'relative flex items-center justify-center font-mono text-xs font-medium border-2 overflow-hidden rounded-full',
            !isInstruction && 'rotate-45',
            isBatched && 'ring-2 ring-purple-300 ring-offset-2'
          )}
          variants={stepVariants}
          animate={variantKey}
          initial={false}
          style={{
            width: motionValues.nodeWidth,
            height: motionValues.nodeHeight,
            position: 'absolute',
            overflow: 'hidden',
            rotate: motionValues.rotation,
            x: motionValues.shakeX,
            y: motionValues.shakeY,
            cursor: 'auto',
            border: isFailed ? `2px solid ${colors.border.death}` : `1px solid ${colors.border.default}`,
            // Promote to its own GPU layer and limit reflows/paints
            contain: 'layout style paint',
            willChange: 'transform, filter',
            transform: 'translateZ(0)',

            filter: useTransform([motionValues.blurAmount], ([blur = 0]: Array<number>) => {
              // Cap blur radius to 2px max for better performance
              const cappedBlur = Math.min(blur, 2);

              return isFailed
                ? `blur(${cappedBlur}px) contrast(${effects.death.contrast}) brightness(${effects.death.brightness})`
                : `blur(${cappedBlur}px)`;
            }),

            // Use box-shadow for glow instead of expensive drop-shadow
            boxShadow: useTransform([motionValues.glowIntensity], ([glow = 0]: Array<number>) => {
              const cappedGlow = Math.min(glow, 8);
              const baseShadow = getStepShadow(variantKey);

              if (isFailed) {
                return cappedGlow > 0
                  ? `${baseShadow}, 0 0 ${cappedGlow * 2}px ${colors.glow.death}`
                  : baseShadow;
              }

              if (isExecuting) {
                const glowColor =
                  state.type === 'building'
                    ? GLOW_COLORS.building
                    : state.type === 'signing'
                      ? GLOW_COLORS.signing
                      : GLOW_COLORS.sending;
                return cappedGlow > 0 ? `${baseShadow}, 0 0 ${cappedGlow}px ${glowColor}` : baseShadow;
              }

              return baseShadow;
            }),
          }}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          {/* Overlay effects */}
          <StepOverlay motionValues={motionValues} isRunning={isExecuting} />

          {/* Content inside node */}
          <motion.div
            className={cn(
              'absolute inset-0 flex items-center justify-center',
              isInstruction ? '' : '-rotate-45'
            )}
            style={{
              opacity: motionValues.contentOpacity,
              scale: motionValues.contentScale,
            }}
          >
            {isExecuting ? (
              <motion.div
                className="w-2 h-2 rounded-full bg-white"
                animate={{ scale: [1, 1.5, 1] }}
                transition={{ repeat: Infinity, duration: 0.8 }}
              />
            ) : isConfirmed ? (
              <span className="text-lg">✓</span>
            ) : isFailed ? (
              <span className="text-lg">✗</span>
            ) : (
              <span className="text-xs">{stepName.slice(0, 3)}</span>
            )}
          </motion.div>
        </motion.div>
      </motion.div>

      {/* Step name label */}
      <motion.div
        className="mt-2 text-xs font-mono text-gray-500 text-center max-w-[80px] truncate"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.2 }}
      >
        {stepName}
      </motion.div>

      {/* Signature tooltip on hover */}
      <AnimatePresence>
        {isHovering && isConfirmed && state.type === 'confirmed' && (
          <motion.div
            className="absolute -top-12 left-1/2 -translate-x-1/2 bg-black/90 text-white px-2 py-1 rounded text-xs font-mono whitespace-nowrap z-10"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            {state.signature.slice(0, 8)}...
            <div className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-black/90" />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Error bubble */}
      <AnimatePresence>
        {showErrorBubble && isFailed && state.type === 'failed' && (
          <motion.div
            className="absolute -top-20 left-1/2 -translate-x-1/2 bg-red-500 text-white px-3 py-2 rounded-lg text-xs max-w-[200px] z-10 shadow-lg"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={springs.failureBubble}
          >
            <div className="font-semibold mb-1">Error</div>
            <div className="text-red-100">{state.error.message}</div>
            <div className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-red-500" />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export const TransactionStepNode = memo(TransactionStepNodeComponent) as typeof TransactionStepNodeComponent;
