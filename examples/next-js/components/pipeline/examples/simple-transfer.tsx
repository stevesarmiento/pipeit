'use client';

import { useMemo } from 'react';
import { createFlow, type FlowConfig } from '@pipeit/core';
import { VisualPipeline } from '@/lib/visual-pipeline';
import { getTransferSolInstruction } from '@solana-program/system';
import { lamports } from '@solana/kit';

/**
 * Simple transfer example - single instruction, single transaction.
 * Baseline example showing basic flow usage.
 */
export function useSimpleTransferPipeline() {
  const visualPipeline = useMemo(() => {
    const flowFactory = (config: FlowConfig) =>
      createFlow(config).step('transfer-sol', (ctx) => {
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

    return new VisualPipeline('simple-transfer', flowFactory, [
      { name: 'transfer-sol', type: 'instruction' },
    ]);
  }, []);

  return visualPipeline;
}

export const simpleTransferCode = `import { createFlow } from '@pipeit/core';
import { getTransferSolInstruction } from '@solana-program/system';
import { address, lamports } from '@solana/kit';

const result = await createFlow({ rpc, rpcSubscriptions, signer })
  .step('transfer-sol', (ctx) => {
    return getTransferSolInstruction({
      source: ctx.signer,
      destination: address(recipientAddress),
      amount: lamports(BigInt(amount * LAMPORTS_PER_SOL)),
    });
  })
  .execute();

console.log('Signature:', result.get('transfer-sol')?.signature);`;
