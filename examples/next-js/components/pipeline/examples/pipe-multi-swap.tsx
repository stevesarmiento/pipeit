'use client';

import { useMemo } from 'react';
import { createFlow, type FlowConfig } from '@pipeit/tx-builder';
import { VisualPipeline } from '@/lib/visual-pipeline';
import { jupiter } from '@pipeit/actions/adapters';

// Token addresses
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const BONK_MINT = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';

/**
 * Example: Multi-Swap Pipeline using @pipeit/actions
 * 
 * Demonstrates the power of the Pipe API:
 * - Sequential swaps with automatic transaction management
 * - SOL → USDC, then USDC → BONK
 * - Each swap in its own transaction (Solana size limits)
 * - Flow orchestrates the sequence with proper blockhash handling
 */
export function usePipeMultiSwapPipeline() {
  const visualPipeline = useMemo(() => {
    const jupiterAdapter = jupiter();

    const flowFactory = (config: FlowConfig) =>
      createFlow(config)
        // Transaction 1: SOL → USDC
        .transaction('swap-sol-usdc', async (ctx) => {
          console.log('[Multi-Swap] Step 1: SOL → USDC');
          
          const swapAction = jupiterAdapter.swap({
            inputMint: SOL_MINT,
            outputMint: USDC_MINT,
            amount: 10_000_000n, // 0.01 SOL
            slippageBps: 50,
          });

          const result = await swapAction({
            signer: ctx.signer,
            rpc: ctx.rpc as any,
            rpcSubscriptions: ctx.rpcSubscriptions as any,
          });

          const { TransactionBuilder } = await import('@pipeit/tx-builder');
          const { address } = await import('@solana/kit');
          
          const lookupTables = result.addressLookupTableAddresses ?? [];
          const lookupTableAddrs = lookupTables.map(addr => address(addr));

          const { value: blockhash } = await (ctx.rpc as any).getLatestBlockhash().send();
          
          const signature = await new TransactionBuilder({
            rpc: ctx.rpc as any,
            computeUnits: 300_000,
            lookupTableAddresses: lookupTableAddrs.length > 0 ? lookupTableAddrs : undefined,
            priorityFee: 'high',
          })
            .setFeePayerSigner(ctx.signer)
            .setBlockhashLifetime(blockhash.blockhash, blockhash.lastValidBlockHeight)
            .addInstructions(result.instructions)
            .execute({
              rpcSubscriptions: ctx.rpcSubscriptions as any,
              commitment: 'confirmed',
            });

          console.log('[Multi-Swap] SOL → USDC complete:', signature);
          return { signature };
        })
        // Transaction 2: USDC → BONK
        .transaction('swap-usdc-bonk', async (ctx) => {
          console.log('[Multi-Swap] Step 2: USDC → BONK');
          
          const swapAction = jupiterAdapter.swap({
            inputMint: USDC_MINT,
            outputMint: BONK_MINT,
            amount: 100_000n, // 0.1 USDC
            slippageBps: 100,
          });

          const result = await swapAction({
            signer: ctx.signer,
            rpc: ctx.rpc as any,
            rpcSubscriptions: ctx.rpcSubscriptions as any,
          });

          const { TransactionBuilder } = await import('@pipeit/tx-builder');
          const { address } = await import('@solana/kit');
          
          const lookupTables = result.addressLookupTableAddresses ?? [];
          const lookupTableAddrs = lookupTables.map(addr => address(addr));

          const { value: blockhash } = await (ctx.rpc as any).getLatestBlockhash().send();
          
          const signature = await new TransactionBuilder({
            rpc: ctx.rpc as any,
            computeUnits: 300_000,
            lookupTableAddresses: lookupTableAddrs.length > 0 ? lookupTableAddrs : undefined,
            priorityFee: 'high',
          })
            .setFeePayerSigner(ctx.signer)
            .setBlockhashLifetime(blockhash.blockhash, blockhash.lastValidBlockHeight)
            .addInstructions(result.instructions)
            .execute({
              rpcSubscriptions: ctx.rpcSubscriptions as any,
              commitment: 'confirmed',
            });

          console.log('[Multi-Swap] USDC → BONK complete:', signature);
          return { signature };
        });

    return new VisualPipeline('pipe-multi-swap', flowFactory, [
      { name: 'swap-sol-usdc', type: 'transaction' },
      { name: 'swap-usdc-bonk', type: 'transaction' },
    ]);
  }, []);

  return visualPipeline;
}

export const pipeMultiSwapCode = `import { pipe } from '@pipeit/actions'
import { jupiter } from '@pipeit/actions/adapters'

// Token addresses
const SOL = 'So11111111111111111111111111111111111111112'
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const BONK = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'

// Multi-swap flow: SOL → USDC → BONK
// Each swap needs its own transaction due to size constraints
const config = {
  rpc,
  rpcSubscriptions,
  signer,
  adapters: { swap: jupiter() },
  priorityFee: 'high',
}

// Swap 1: SOL → USDC
const result1 = await pipe(config)
  .swap({
    inputMint: SOL,
    outputMint: USDC,
    amount: 10_000_000n,    // 0.01 SOL
    slippageBps: 50,
  })
  .onActionStart(() => console.log('Building SOL → USDC swap...'))
  .execute()

console.log('Swap 1:', result1.signature)

// Swap 2: USDC → BONK
const result2 = await pipe(config)
  .swap({
    inputMint: USDC,
    outputMint: BONK,
    amount: 100_000n,       // 0.1 USDC
    slippageBps: 100,
  })
  .onActionStart(() => console.log('Building USDC → BONK swap...'))
  .execute()

console.log('Swap 2:', result2.signature)`;
