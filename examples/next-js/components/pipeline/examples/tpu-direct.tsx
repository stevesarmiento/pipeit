'use client';

import { useMemo } from 'react';
import { createFlow, type FlowConfig } from '@pipeit/core';
import { VisualPipeline } from '@/lib/visual-pipeline';

/**
 * Example: Direct TPU Submission
 * 
 * Demonstrates using the TPU native client to send transactions
 * directly to validator QUIC endpoints, bypassing RPC queues.
 */
export function useTpuDirectPipeline() {
  const visualPipeline = useMemo(() => {
    const flowFactory = (config: FlowConfig) =>
      createFlow({
        ...config,
        execution: {
          tpu: {
            enabled: true,
            fanout: 2, // Send to 2 upcoming leaders
            apiRoute: '/api/tpu',
          },
        },
      }).transaction('tpu-transfer', async (ctx) => {
        const { getTransferSolInstruction } = await import('@solana-program/system');
        const { address, lamports } = await import('@solana/kit');

        // Create a simple transfer instruction (send to self - no SOL lost)
        const instruction = getTransferSolInstruction({
          source: ctx.signer,
          destination: ctx.signer.address, // Send back to self
          amount: lamports(1000n), // 0.000001 SOL
        });

        // Use TransactionBuilder with TPU execution
        const { TransactionBuilder } = await import('@pipeit/core');
        
        const signature = await new TransactionBuilder({
          rpc: ctx.rpc,
          priorityFee: 'medium',
        })
          .setFeePayerSigner(ctx.signer)
          .addInstruction(instruction)
          .execute({
            rpcSubscriptions: ctx.rpcSubscriptions,
            commitment: 'confirmed',
            execution: {
              tpu: {
                enabled: true,
                fanout: 2,
                apiRoute: '/api/tpu',
              },
            },
          });

        return { signature };
      });

    return new VisualPipeline('tpu-direct', flowFactory, [
      { name: 'tpu-transfer', type: 'transaction' },
    ]);
  }, []);

  return visualPipeline;
}

export const tpuDirectCode = `import { createFlow } from '@pipeit/core'
import { getTransferSolInstruction } from '@solana-program/system'
import { address, lamports } from '@solana/kit'

// Execute with direct TPU submission
const result = await createFlow({
  rpc,
  rpcSubscriptions,
  signer,
  execution: {
    tpu: {
      enabled: true,        // Enable TPU submission
      fanout: 2,            // Send to 2 upcoming leaders
      apiRoute: '/api/tpu', // Browser API endpoint
      priorityFee: 'medium',
    }
  }
})
  .transaction('fast-transfer', async (ctx) => {
    // Transfer to self - only pays tx fee, no SOL lost
    const instruction = getTransferSolInstruction({
      source: ctx.signer,
      destination: ctx.signer.address,
      amount: lamports(1000n),
    })
    
    const { TransactionBuilder } = await import('@pipeit/core')
    
    const signature = await new TransactionBuilder({
      rpc: ctx.rpc,
      priorityFee: 'medium',
    })
      .setFeePayerSigner(ctx.signer)
      .addInstruction(instruction)
      .execute({
        rpcSubscriptions: ctx.rpcSubscriptions,
        commitment: 'confirmed',
        execution: {
          tpu: {
            enabled: true,
            fanout: 2,
            apiRoute: '/api/tpu',
            priorityFee: 'medium',
          },
        },
      })

    return { signature }
  })
  .execute()

console.log('Transaction sent via TPU:', result.signature)`;

