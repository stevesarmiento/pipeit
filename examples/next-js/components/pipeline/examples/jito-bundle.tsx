'use client';

import { useMemo } from 'react';
import { createFlow, type FlowConfig, createTipInstruction, JITO_DEFAULT_TIP_LAMPORTS } from '@pipeit/core';
import { VisualPipeline } from '@/lib/visual-pipeline';
import { getTransferSolInstruction } from '@solana-program/system';
import { lamports } from '@solana/kit';

/**
 * Jito Bundle example - MEV-protected transaction submission.
 *
 * Demonstrates using Jito bundles for:
 * - Guaranteed transaction ordering
 * - MEV protection from sandwich attacks
 * - Higher landing probability for time-sensitive transactions
 */
export function useJitoBundlePipeline() {
    const visualPipeline = useMemo(() => {
        const flowFactory = (config: FlowConfig) =>
            createFlow(config)
                .step('transfer-1', ctx => {
                    // First transfer - batched with other instructions
                    return getTransferSolInstruction({
                        source: ctx.signer,
                        destination: ctx.signer.address, // Self-transfer for demo
                        amount: lamports(BigInt(1_000_000)), // 0.001 SOL
                    });
                })
                .step('transfer-2', ctx => {
                    // Second transfer - batched together
                    return getTransferSolInstruction({
                        source: ctx.signer,
                        destination: ctx.signer.address,
                        amount: lamports(BigInt(1_000_000)),
                    });
                })
                .step('jito-tip', ctx => {
                    // Jito tip instruction - required for bundle submission
                    // Tips to a random Jito validator tip account
                    return createTipInstruction(
                        ctx.signer.address,
                        JITO_DEFAULT_TIP_LAMPORTS, // 10,000 lamports = 0.00001 SOL
                    );
                });

        return new VisualPipeline('jito-bundle', flowFactory, [
            { name: 'transfer-1', type: 'instruction' },
            { name: 'transfer-2', type: 'instruction' },
            { name: 'jito-tip', type: 'instruction' },
        ]);
    }, []);

    return visualPipeline;
}

export const jitoBundleCode = `import { createFlow, createTipInstruction, JITO_DEFAULT_TIP_LAMPORTS } from '@pipeit/core';
import { getTransferSolInstruction } from '@solana-program/system';
import { address, lamports } from '@solana/kit';

// Create a flow with Jito execution strategy
const result = await createFlow({
  rpc,
  rpcSubscriptions,
  signer,
  // Enable Jito bundle execution for MEV protection
  execution: {
    jito: {
      enabled: true,
      tipLamports: JITO_DEFAULT_TIP_LAMPORTS,
      region: 'mainnet', // or 'ny', 'amsterdam', 'tokyo', etc.
    },
  },
})
  .step('transfer-1', (ctx) => {
    return getTransferSolInstruction({
      source: ctx.signer,
      destination: address(recipient1),
      amount: lamports(BigInt(1_000_000)),
    });
  })
  .step('transfer-2', (ctx) => {
    return getTransferSolInstruction({
      source: ctx.signer,
      destination: address(recipient2),
      amount: lamports(BigInt(1_000_000)),
    });
  })
  .step('jito-tip', (ctx) => {
    // Add tip to Jito validator - required for bundle inclusion
    return createTipInstruction(
      ctx.signer.address,
      JITO_DEFAULT_TIP_LAMPORTS
    );
  })
  .execute();

// All instructions execute atomically in a single Jito bundle
// Protected from MEV/sandwich attacks
console.log('Bundle signature:', result.get('transfer-1')?.signature);`;
