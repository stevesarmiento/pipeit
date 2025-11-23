'use client';

import { useMemo } from 'react';
import { createPipeline } from '@pipeit/tx-orchestration';
import type { StepContext } from '@pipeit/tx-orchestration';
import { VisualPipeline } from '@/lib/visual-pipeline';
import { getTransferSolInstruction } from '@solana-program/system';
import { lamports } from '@solana/kit';

/**
 * Mixed pipeline example - shows how transaction steps break batching.
 * Instruction steps batch together, but transaction steps execute separately.
 */
export function useMixedPipeline() {
  const visualPipeline = useMemo(() => {
    const pipeline = createPipeline()
      .instruction('setup-1', async (ctx: StepContext) => {
        // First batch group - self-transfer for demo
        return getTransferSolInstruction({
          source: ctx.signer,
          destination: ctx.signer.address,
          amount: lamports(BigInt(1_000_000)),
        });
      })
      .instruction('setup-2', async (ctx: StepContext) => {
        // Part of first batch - self-transfer for demo
        return getTransferSolInstruction({
          source: ctx.signer,
          destination: ctx.signer.address,
          amount: lamports(BigInt(1_000_000)),
        });
      })
      .transaction('verify-state', async (ctx: StepContext) => {
        // Breaks batching - executes separately
        // In real usage, this would check on-chain state
        await new Promise((resolve) => setTimeout(resolve, 500));
        return { verified: true };
      })
      .instruction('finalize-1', async (ctx: StepContext) => {
        // Second batch group (after transaction step) - self-transfer for demo
        return getTransferSolInstruction({
          source: ctx.signer,
          destination: ctx.signer.address,
          amount: lamports(BigInt(1_000_000)),
        });
      })
      .instruction('finalize-2', async (ctx: StepContext) => {
        // Part of second batch - self-transfer for demo
        return getTransferSolInstruction({
          source: ctx.signer,
          destination: ctx.signer.address,
          amount: lamports(BigInt(1_000_000)),
        });
      });

    return new VisualPipeline('mixed-pipeline', pipeline, [
      { name: 'setup-1', type: 'instruction' },
      { name: 'setup-2', type: 'instruction' },
      { name: 'verify-state', type: 'transaction' },
      { name: 'finalize-1', type: 'instruction' },
      { name: 'finalize-2', type: 'instruction' },
    ]);
  }, []);

  return visualPipeline;
}

export const mixedPipelineCode = `import { createPipeline } from '@pipeit/tx-orchestration';

const pipeline = createPipeline()
  .instruction('setup-1', async (ctx) => createSetupInstruction1())
  .instruction('setup-2', async (ctx) => createSetupInstruction2())
  .transaction('verify-state', async (ctx) => {
    // Transaction step breaks batching
    // Must execute separately to check on-chain state
    return await verifyOnChainState();
  })
  .instruction('finalize-1', async (ctx) => createFinalizeInstruction1())
  .instruction('finalize-2', async (ctx) => createFinalizeInstruction2());

// Results in 3 transactions:
// 1. Batch: setup-1 + setup-2
// 2. Transaction: verify-state
// 3. Batch: finalize-1 + finalize-2
await pipeline.execute({
  signer,
  rpc,
  rpcSubscriptions,
  strategy: 'auto'
});`;

