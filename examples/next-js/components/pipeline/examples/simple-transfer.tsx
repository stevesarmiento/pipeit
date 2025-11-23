'use client';

import { useMemo } from 'react';
import { createPipeline } from '@pipeit/tx-orchestration';
import type { StepContext } from '@pipeit/tx-orchestration';
import { VisualPipeline } from '@/lib/visual-pipeline';
import { getTransferSolInstruction } from '@solana-program/system';
import { lamports } from '@solana/kit';

/**
 * Simple transfer example - single instruction, single transaction.
 * Baseline example showing basic pipeline usage.
 */
export function useSimpleTransferPipeline() {
  const visualPipeline = useMemo(() => {
    const pipeline = createPipeline().instruction('transfer-sol', async (ctx: StepContext) => {
      // Self-transfer example (transferring to own address) - valid for demos
      // In real usage, recipient and amount would come from props
      const recipient = ctx.signer.address; // Self-transfer (always valid)
      const amount = lamports(BigInt(1_000_000)); // 0.001 SOL

      return getTransferSolInstruction({
        source: ctx.signer,
        destination: recipient,
        amount,
      });
    });

    return new VisualPipeline('simple-transfer', pipeline, [
      { name: 'transfer-sol', type: 'instruction' },
    ]);
  }, []);

  return visualPipeline;
}

export const simpleTransferCode = `import { createPipeline } from '@pipeit/tx-orchestration';
import { getTransferSolInstruction } from '@solana-program/system';
import { address, lamports } from '@solana/kit';

const pipeline = createPipeline()
  .instruction('transfer-sol', async (ctx) => {
    return getTransferSolInstruction({
      source: ctx.signer,
      destination: address(recipientAddress),
      amount: lamports(BigInt(amount * LAMPORTS_PER_SOL)),
    });
  });

await pipeline.execute({
  signer,
  rpc,
  rpcSubscriptions,
  strategy: 'auto'
});`;

