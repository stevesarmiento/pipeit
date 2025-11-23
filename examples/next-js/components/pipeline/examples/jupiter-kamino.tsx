'use client';

import { useMemo } from 'react';
import { createPipeline } from '@pipeit/tx-orchestration';
import type { StepContext } from '@pipeit/tx-orchestration';
import { VisualPipeline } from '@/lib/visual-pipeline';
import {
  getIdlRegistry,
  SOL_MINT,
  USDC_MINT,
  JUPITER_V6_PROGRAM,
  KAMINO_LENDING_PROGRAM,
} from '@/lib/idl-registry';
import { address } from '@solana/kit';
import type { Rpc, GetAccountInfoApi } from '@solana/rpc';
import type { Instruction, AccountMeta, AccountRole } from '@solana/instructions';

/**
 * Helper to parse Jupiter setup instructions into Instruction objects
 */
function parseJupiterInstruction(jupiterIx: any): Instruction {
  return {
    programAddress: address(jupiterIx.programId),
    accounts: jupiterIx.accounts.map((acc: any) => ({
      address: address(typeof acc === 'string' ? acc : acc.pubkey),
      role: acc.isWritable 
        ? (acc.isSigner ? AccountRole.WRITABLE_SIGNER : AccountRole.WRITABLE)
        : (acc.isSigner ? AccountRole.READONLY_SIGNER : AccountRole.READONLY),
    })) as AccountMeta<string>[],
    data: Uint8Array.from(atob(jupiterIx.data), c => c.charCodeAt(0)),
  } as Instruction;
}

export function useJupiterKaminoPipeline() {
  const visualPipeline = useMemo(() => {
    const registry = getIdlRegistry();

    const pipeline = createPipeline()
      // Step 1: Swap 0.05 SOL → USDC on Jupiter (simple IDL approach)
      .instruction('jupiter-swap', async (ctx: StepContext) => {
        // Fetch Jupiter quote
        let quote: any;
        try {
          const quoteParams = new URLSearchParams({
            inputMint: SOL_MINT,
            outputMint: USDC_MINT,
            amount: '50000000', // 0.05 SOL
            slippageBps: '100',
          });
          
          const response = await fetch(`/api/jupiter/quote?${quoteParams}`);
          if (response.ok) {
            quote = await response.json();
          }
        } catch (error) {
          console.warn('Jupiter quote unavailable:', error);
          quote = { routePlan: [], outAmount: '0' };
        }

        return await registry.buildInstruction(
          JUPITER_V6_PROGRAM,
          'shared_accounts_route',
          {
            inputMint: SOL_MINT,
            outputMint: USDC_MINT,
            amountIn: 50_000_000n,
            slippageBps: 100,
            routePlan: quote?.routePlan || [],
            quotedOutAmount: BigInt(quote?.outAmount || '0'),
            platformFeeBps: 0,
            quoteResponse: quote,
          },
          {}, // Accounts auto-discovered by JupiterSwapPlugin
          {
            signer: ctx.signer.address,
            programId: JUPITER_V6_PROGRAM,
            rpc: ctx.rpc as unknown as Rpc<GetAccountInfoApi>,
          }
        );
      })

      // Step 2: Deposit USDC to Kamino
      .instruction('kamino-deposit', async (ctx: StepContext) => {
        // Get swap result to know how much USDC we received
        const swapResult = ctx.results.get('jupiter-swap');

        return await registry.buildInstruction(
          KAMINO_LENDING_PROGRAM,
          'depositReserveLiquidity',
          {
            mint: address(USDC_MINT),
            liquidityAmount: swapResult?.outAmount || 10_000_000n, // Use swap output or fallback
          },
          {}, // Accounts auto-discovered by KaminoLendingPlugin!
          {
            signer: ctx.signer.address,
            programId: KAMINO_LENDING_PROGRAM,
            rpc: ctx.rpc as unknown as Rpc<GetAccountInfoApi>,
          }
        );
      });

    return new VisualPipeline('jupiter-kamino', pipeline, [
      { name: 'jupiter-swap', type: 'instruction' },
      { name: 'kamino-deposit', type: 'instruction' },
    ]);
  }, []);

  return visualPipeline;
}

export const jupiterKaminoCode = `import { IdlProgramRegistry, JupiterSwapPlugin, KaminoLendingPlugin } from '@pipeit/tx-idl'
import { createPipeline } from '@pipeit/tx-orchestration'
import { address } from '@solana/kit'

// Setup registry with plugins
const registry = new IdlProgramRegistry()
registry.use(new JupiterSwapPlugin())
registry.use(new KaminoLendingPlugin())

await registry.registerProgramFromJson(JUPITER_V6, jupiterIdl)
await registry.registerProgramFromJson(KAMINO, kaminoIdl)

// Build pipeline
const pipeline = createPipeline()
  .instruction('swap', async (ctx) => {
    // Fetch Jupiter quote for routePlan and quotedOutAmount
    const quote = await fetch(
      \`https://quote-api.jup.ag/v6/quote?inputMint=\${SOL_MINT}&outputMint=\${USDC_MINT}&amount=100000000&slippageBps=100\`
    ).then(r => r.json())
    
    return await registry.buildInstruction(
      JUPITER_V6,
      'shared_accounts_route',
      {
        inputMint: SOL_MINT,
        outputMint: USDC_MINT,
        amountIn: 100_000_000n, // 0.1 SOL
        slippageBps: 100,
        routePlan: quote.routePlan,
        quotedOutAmount: BigInt(quote.outAmount),
        platformFeeBps: 0,
      },
      {}, // Accounts auto-discovered by JupiterSwapPlugin!
      { signer: ctx.signer.address, programId: JUPITER_V6, rpc: ctx.rpc }
    )
  })
  .instruction('deposit', async (ctx) => {
    const swapResult = ctx.results.get('swap')
    return await registry.buildInstruction(
      KAMINO,
      'depositReserveLiquidity',
      { 
        mint: address(USDC_MINT), 
        liquidityAmount: swapResult?.outAmount || 10_000_000n 
      },
      {}, // Accounts auto-discovered by KaminoLendingPlugin!
      { signer: ctx.signer.address, programId: KAMINO, rpc: ctx.rpc }
    )
  })

// Execute: 2 transactions (can't batch - deposit depends on swap output)
await pipeline.execute({ signer, rpc, rpcSubscriptions, strategy: 'auto' })`;

