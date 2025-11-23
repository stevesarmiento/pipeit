'use client';

import { useMemo } from 'react';
import { createPipeline } from '@pipeit/tx-orchestration';
import type { StepContext } from '@pipeit/tx-orchestration';
import { VisualPipeline } from '@/lib/visual-pipeline';
import { getTransferSolInstruction } from '@solana-program/system';
import { lamports } from '@solana/kit';

/**
 * Batched transfers example - 3 transfer instructions batched into 1 transaction.
 * Shows the cost savings and atomicity benefits of batching.
 */
export function useBatchedTransfersPipeline() {
  const visualPipeline = useMemo(() => {
    // Use self-transfers (to signer's own address) for demo purposes
    // In real usage, these would be different recipient addresses
    const pipeline = createPipeline()
      .instruction('transfer-1', async (ctx: StepContext) => {
        return getTransferSolInstruction({
          source: ctx.signer,
          destination: ctx.signer.address, // Self-transfer
          amount: lamports(BigInt(1_000_000)),
        });
      })
      .instruction('transfer-2', async (ctx: StepContext) => {
        return getTransferSolInstruction({
          source: ctx.signer,
          destination: ctx.signer.address, // Self-transfer
          amount: lamports(BigInt(2_000_000)),
        });
      })
      .instruction('transfer-3', async (ctx: StepContext) => {
        return getTransferSolInstruction({
          source: ctx.signer,
          destination: ctx.signer.address, // Self-transfer
          amount: lamports(BigInt(3_000_000)),
        });
      });

    return new VisualPipeline('batched-transfers', pipeline, [
      { name: 'transfer-1', type: 'instruction' },
      { name: 'transfer-2', type: 'instruction' },
      { name: 'transfer-3', type: 'instruction' },
    ]);
  }, []);

  return visualPipeline;
}

export const batchedTransfersCode = `import { createPipeline } from '@pipeit/tx-orchestration';
import { getTransferSolInstruction } from '@solana-program/system';
import { address, lamports } from '@solana/kit';

const pipeline = createPipeline()
  .instruction('transfer-1', async (ctx) => 
    getTransferSolInstruction({
      source: ctx.signer,
      destination: address(recipient1),
      amount: lamports(BigInt(1_000_000)),
    })
  )
  .instruction('transfer-2', async (ctx) => 
    getTransferSolInstruction({
      source: ctx.signer,
      destination: address(recipient2),
      amount: lamports(BigInt(2_000_000)),
    })
  )
  .instruction('transfer-3', async (ctx) => 
    getTransferSolInstruction({
      source: ctx.signer,
      destination: address(recipient3),
      amount: lamports(BigInt(3_000_000)),
    })
  );

// Auto-batches all 3 instructions into 1 transaction
await pipeline.execute({
  signer,
  rpc,
  rpcSubscriptions,
  strategy: 'auto' // Batches into 1 tx, saves 66% on fees
});`;

