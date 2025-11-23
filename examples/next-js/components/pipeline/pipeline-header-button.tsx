'use client';

import {
  PlayIcon,
  ArrowCounterClockwiseIcon,
} from '@phosphor-icons/react';
import { IconArrowCounterclockwise, IconBoltFill, IconPlayFill, IconSparkle } from 'symbols-react';
import { AnimatePresence, motion } from 'motion/react';
import { memo, useCallback, useState } from 'react';
import type { VisualPipeline } from '@/lib/visual-pipeline';
import { usePipelineState } from '@/lib/use-visual-pipeline';
import { useGillTransactionSigner, useConnectorClient } from '@solana/connector';
import { createSolanaRpc, createSolanaRpcSubscriptions } from '@solana/kit';

interface PipelineHeaderButtonProps {
  visualPipeline: VisualPipeline;
  strategy: 'auto' | 'batch' | 'sequential';
  onExecuteStart?: () => void;
  onExecuteComplete?: () => void;
  onError?: (error: Error) => void;
}

function PipelineHeaderButtonComponent({
  visualPipeline,
  strategy,
  onExecuteStart,
  onExecuteComplete,
  onError,
}: PipelineHeaderButtonProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [isPressed, setIsPressed] = useState(false);
  const pipelineState = usePipelineState(visualPipeline);
  
  const { signer, ready } = useGillTransactionSigner();
  const client = useConnectorClient();

  const isExecuting = pipelineState === 'executing';
  const isCompleted = pipelineState === 'completed';
  const isFailed = pipelineState === 'failed';
  const canReset = isCompleted || isFailed;
  const isDisabled = !ready || isExecuting;

  const runPipeline = useCallback(async () => {
    if (!visualPipeline || !signer || !client) {
      alert('Please connect your wallet first');
      return;
    }

    try {
      onExecuteStart?.();
      visualPipeline.reset();

      const rpcUrl = client.getRpcUrl();
      if (!rpcUrl) {
        throw new Error('No RPC endpoint configured');
      }

      console.log('[Pipeline] Using RPC URL:', rpcUrl);

      const rpc = createSolanaRpc(rpcUrl);
      const rpcSubscriptions = createSolanaRpcSubscriptions(rpcUrl.replace('http', 'ws'));

      await visualPipeline.execute({
        signer,
        rpc,
        rpcSubscriptions,
        strategy,
        commitment: 'confirmed',
      });
      
      onExecuteComplete?.();
    } catch (error) {
      console.error('Pipeline execution failed:', error);
      onError?.(error as Error);
    }
  }, [visualPipeline, signer, client, strategy, onExecuteStart, onExecuteComplete, onError]);

  const resetPipeline = useCallback(() => {
    visualPipeline.reset();
  }, [visualPipeline]);

  const handleAction = useCallback(() => {
    if (isDisabled || isExecuting) {
      return;
    }
    
    if (canReset) {
      resetPipeline();
    } else {
      runPipeline();
    }
  }, [isDisabled, isExecuting, canReset, resetPipeline, runPipeline]);

  const getIcon = () => {
    // Don't show hover icons when executing (can't interrupt Solana txs)
    if (isHovered && !isExecuting) {
      if (canReset) {
        return (
          <motion.div
            key="reset"
            initial={{ scale: 0, rotate: -180, filter: 'blur(10px)' }}
            animate={{ scale: 1, rotate: 0, filter: 'blur(0px)' }}
            exit={{ scale: 0, rotate: 180, filter: 'blur(10px)' }}
            transition={{ type: 'spring', stiffness: 300, damping: 20 }}
          >
            <IconArrowCounterclockwise className="fill-white" width={16} height={16} />
          </motion.div>
        );
      }
      
      return (
        <motion.div
          key="play"
          initial={{ scale: 0, rotate: -180, filter: 'blur(10px)' }}
          animate={{ scale: 1, rotate: 0, filter: 'blur(0px)' }}
          exit={{ scale: 0, rotate: 180, filter: 'blur(10px)' }}
          transition={{ type: 'spring', stiffness: 300, damping: 20 }}
        >
          <IconPlayFill className="fill-white" width={14} height={14} />
        </motion.div>
      );
    }

    return (
      <motion.div
        key="bolt"
        initial={{ scale: 0, filter: 'blur(10px)' }}
        animate={
          isExecuting
            ? { rotate: 360, scale: 1, filter: 'blur(0px)' }
            : { rotate: 0, scale: 1, filter: 'blur(0px)' }
        }
        exit={{ scale: 0, filter: 'blur(10px)' }}
        transition={
          isExecuting
            ? {
                rotate: {
                  duration: 1,
                  repeat: Infinity,
                  ease: 'circInOut',
                },
                scale: { type: 'spring', stiffness: 300, damping: 20 },
                filter: { type: 'spring', stiffness: 300, damping: 20 },
              }
            : {
                type: 'spring',
                stiffness: 300,
                damping: 20,
              }
        }
      >
        <IconSparkle className="fill-white" width={16} height={16} />
      </motion.div>
    );
  };

  const getBackgroundColor = () => {
    if (isDisabled && !isExecuting) return 'rgb(156, 163, 175)'; // gray-400 - disabled
    if (isExecuting) return 'rgb(192, 132, 252)'; // purple-400 - matches pipeline nodes
    if (isCompleted) return 'rgb(34, 197, 94)'; // green-500
    if (isFailed) return 'rgb(239, 68, 68)'; // red-500
    return 'oklch(0.442 0.0111 34.3)'; // sand-1200 - matches button default
  };

  const getGlowColor = () => {
    if (isExecuting) return 'rgba(192, 132, 252, 0.5)'; // purple glow - matches pipeline nodes
    if (isCompleted) return 'rgba(34, 197, 94, 0.5)';
    if (isFailed) return 'rgba(239, 68, 68, 0.5)';
    return 'rgba(107, 114, 128, 0.5)';
  };

  return (
    <motion.div
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onMouseDown={() => !isDisabled && setIsPressed(true)}
      onMouseUp={() => setIsPressed(false)}
      onClick={handleAction}
      className={isDisabled || isExecuting ? 'cursor-not-allowed' : 'cursor-pointer'}
      whileHover={!isDisabled && !isExecuting ? { scale: 1.05 } : {}}
      whileTap={!isDisabled && !isExecuting ? { scale: 0.95 } : {}}
    >
      <motion.div
        animate={{
          scale: isPressed ? 0.95 : 1,
          background: getBackgroundColor(),
        }}
        transition={{
          scale: { type: 'spring', stiffness: 300, damping: 20 },
          background: { duration: 0.2, ease: 'easeInOut' },
        }}
        className="w-7.5 h-7.5 rounded-md flex items-center justify-center text-white relative overflow-hidden shadow-lg"
      >
        <AnimatePresence mode="popLayout">{getIcon()}</AnimatePresence>

        {isExecuting && (
          <motion.div
            className="absolute -inset-0.5 -z-10"
            style={{
              background: `radial-gradient(circle, ${getGlowColor()} 0%, transparent 70%)`,
            }}
            animate={{
              scale: [1, 1.3, 1],
              opacity: [0.5, 0, 0.5],
            }}
            transition={{
              duration: 2,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
          />
        )}
      </motion.div>
    </motion.div>
  );
}

export const PipelineHeaderButton = memo(PipelineHeaderButtonComponent);

