'use client';

import { useMemo } from 'react';
import { createFlow, type FlowConfig } from '@pipeit/core';
import { VisualPipeline } from '@/lib/visual-pipeline';
import { getTransferSolInstruction } from '@solana-program/system';
import { lamports } from '@solana/kit';

/**
 * Mixed pipeline example - shows how transaction steps break batching.
 * Instruction steps batch together, but transaction steps execute separately.
 */
export function useMixedPipeline() {
  const visualPipeline = useMemo(() => {
    const flowFactory = (config: FlowConfig) =>
      createFlow(config)
        .step('setup-1', (ctx) => {
          // First batch group - self-transfer for demo
          return getTransferSolInstruction({
            source: ctx.signer,
            destination: ctx.signer.address,
            amount: lamports(BigInt(1_000_000)),
          });
        })
        .step('setup-2', (ctx) => {
          // Part of first batch - self-transfer for demo
          return getTransferSolInstruction({
            source: ctx.signer,
            destination: ctx.signer.address,
            amount: lamports(BigInt(1_000_000)),
          });
        })
        .transaction('verify-state', async (ctx) => {
          // Breaks batching - executes separately
          // In real usage, this would check on-chain state
          await new Promise((resolve) => setTimeout(resolve, 500));
          // Return a FlowStepResult with the previous step's signature
          const prevResult = ctx.get('setup-2');
          return { signature: prevResult?.signature ?? 'verified' };
        })
        .step('finalize-1', (ctx) => {
          // Second batch group (after transaction step) - self-transfer for demo
          return getTransferSolInstruction({
            source: ctx.signer,
            destination: ctx.signer.address,
            amount: lamports(BigInt(1_000_000)),
          });
        })
        .step('finalize-2', (ctx) => {
          // Part of second batch - self-transfer for demo
          return getTransferSolInstruction({
            source: ctx.signer,
            destination: ctx.signer.address,
            amount: lamports(BigInt(1_000_000)),
          });
        });

    return new VisualPipeline('mixed-pipeline', flowFactory, [
      { name: 'setup-1', type: 'instruction' },
      { name: 'setup-2', type: 'instruction' },
      { name: 'verify-state', type: 'transaction' },
      { name: 'finalize-1', type: 'instruction' },
      { name: 'finalize-2', type: 'instruction' },
    ]);
  }, []);

  return visualPipeline;
}

export const mixedPipelineCode = `import { createFlow } from '@pipeit/core';

const result = await createFlow({ rpc, rpcSubscriptions, signer })
  .step('setup-1', (ctx) => createSetupInstruction1())
  .step('setup-2', (ctx) => createSetupInstruction2())
  .transaction('verify-state', async (ctx) => {
    // Transaction step breaks batching
    // Must execute separately to check on-chain state
    const verified = await verifyOnChainState();
    return { signature: ctx.get('setup-2')?.signature ?? '' };
  })
  .step('finalize-1', (ctx) => createFinalizeInstruction1())
  .step('finalize-2', (ctx) => createFinalizeInstruction2())
  .execute();

// Results in 3 transactions:
// 1. Batch: setup-1 + setup-2
// 2. Transaction: verify-state
// 3. Batch: finalize-1 + finalize-2`;
