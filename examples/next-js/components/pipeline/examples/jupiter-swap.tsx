'use client';

import { useMemo } from 'react';
import { createFlow, type FlowConfig } from '@pipeit/core';
import { VisualPipeline } from '@/lib/visual-pipeline';
import { jupiter } from '@pipeit/actions/adapters';

// Token addresses
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

/**
 * Example: Jupiter Swap using @pipeit/actions adapter
 * 
 * This demonstrates using the Jupiter adapter to get swap instructions,
 * then executing them via the Flow API.
 */
export function useJupiterSwapPipeline() {
  const visualPipeline = useMemo(() => {
    // Create Jupiter adapter
    const jupiterAdapter = jupiter();

    const flowFactory = (config: FlowConfig) =>
      createFlow(config).transaction('jupiter-swap', async (ctx) => {
        // Call Jupiter adapter to get swap instructions
        const swapAction = jupiterAdapter.swap({
          inputMint: SOL_MINT,
          outputMint: USDC_MINT,
          amount: 10_000_000n, // 0.01 SOL
          slippageBps: 50,
        });

        // Execute the action to get instructions
        const result = await swapAction({
          signer: ctx.signer,
          rpc: ctx.rpc as any,
          rpcSubscriptions: ctx.rpcSubscriptions as any,
        });

        // Use TransactionBuilder to execute all Jupiter instructions
        const { TransactionBuilder } = await import('@pipeit/core');
        
        // Get lookup table addresses from Jupiter response
        const lookupTableAddresses = result.addressLookupTableAddresses ?? [];
        
        const signature = await new TransactionBuilder({
          rpc: ctx.rpc as any,
          computeUnits: (result as any).computeUnits ?? 400_000,
          // Use lookup tables to compress the transaction
          lookupTableAddresses: lookupTableAddresses.length > 0 ? lookupTableAddresses as any : undefined,
        })
          .setFeePayerSigner(ctx.signer)
          .addInstructions(result.instructions)
          .execute({
            rpcSubscriptions: ctx.rpcSubscriptions as any,
            commitment: 'confirmed',
          });

        return { signature };
      });

    return new VisualPipeline('jupiter-swap', flowFactory, [
      { name: 'jupiter-swap', type: 'transaction' },
    ]);
  }, []);

  return visualPipeline;
}

export const jupiterSwapCode = `import { pipe } from '@pipeit/actions'
import { jupiter } from '@pipeit/actions/adapters'

// Token addresses
const SOL = 'So11111111111111111111111111111111111111112'
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'

// Swap 0.01 SOL for USDC using Jupiter
const result = await pipe({
  rpc,
  rpcSubscriptions,
  signer,
  adapters: { swap: jupiter() }
})
  .swap({
    inputMint: SOL,
    outputMint: USDC,
    amount: 10_000_000n, // 0.01 SOL in lamports
    slippageBps: 50,     // 0.5% slippage tolerance
  })
  .execute()

console.log('Swap executed:', result.signature)`;
