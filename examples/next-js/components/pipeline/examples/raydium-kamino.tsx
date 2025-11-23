'use client';

import { useMemo } from 'react';
import { createPipeline } from '@pipeit/tx-orchestration';
import type { StepContext } from '@pipeit/tx-orchestration';
import { VisualPipeline } from '@/lib/visual-pipeline';
import {
  getIdlRegistry,
  SOL_MINT,
  USDC_MINT,
  RAYDIUM_CLMM_PROGRAM,
  KAMINO_LENDING_PROGRAM,
} from '@/lib/idl-registry';
import { address } from '@solana/kit';
import type { Rpc, GetAccountInfoApi } from '@solana/rpc';

export function useRaydiumKaminoPipeline() {
  const visualPipeline = useMemo(() => {
    const registry = getIdlRegistry();

    // Plugin automatically handles wSOL wrapping/unwrapping
    // Use atomic group to combine pre + main + post instructions into one transaction
    // Cache the result to avoid multiple calls
    let cachedResult: {
      instruction: any;
      preInstructions?: any[];
      postInstructions?: any[];
    } | null = null;

    // Helper to build and cache all instructions
    const buildAllInstructions = async (ctx: StepContext) => {
      if (!cachedResult) {
        cachedResult = await registry.buildInstructionWithPrePost(
          RAYDIUM_CLMM_PROGRAM,
          'swap_v2',
          {
            // Use the ACTUAL mints from the pool, not standard SOL/USDC
            // This pool uses these specific token mints:
            inputMint: address(SOL_MINT), // Wrapped SOL
            outputMint: address(USDC_MINT), // USDC
            amount: 50_000_000n, // 0.05 tokens (adjust decimals as needed)
            otherAmountThreshold: 1_000n, // Min output
            isBaseInput: true,
            // Raydium CLMM pool
            poolAddress: address('3ucNos4NbumPLZNWztqGHNFFgkHeRMBQAVemeeomsUxv'),
          },
          {},
          {
            signer: ctx.signer.address,
            programId: RAYDIUM_CLMM_PROGRAM,
            rpc: ctx.rpc as unknown as Rpc<GetAccountInfoApi>,
          }
        );
      }
      const allInstructions = [
        ...(cachedResult.preInstructions || []),
        cachedResult.instruction,
        ...(cachedResult.postInstructions || []),
      ];
      return { instructions: allInstructions, preCount: cachedResult.preInstructions?.length || 0 };
    };

    // Create atomic group with steps for each instruction
    // wSOL wrapping typically has 3 pre-instructions (create ATA, transfer, sync)
    // and potentially 1 post-instruction (unwrap)
    const pipeline = createPipeline().atomic('wrap-and-swap', [
      {
        name: 'wrap-sol-1',
        createInstruction: async (ctx: StepContext) => {
          const { instructions } = await buildAllInstructions(ctx);
          return instructions[0];
        },
      },
      {
        name: 'wrap-sol-2',
        createInstruction: async (ctx: StepContext) => {
          const { instructions } = await buildAllInstructions(ctx);
          return instructions[1];
        },
      },
      {
        name: 'wrap-sol-3',
        createInstruction: async (ctx: StepContext) => {
          const { instructions } = await buildAllInstructions(ctx);
          return instructions[2];
        },
      },
      {
        name: 'raydium-swap',
        createInstruction: async (ctx: StepContext) => {
          const { instructions, preCount } = await buildAllInstructions(ctx);
          // Main instruction is at index = preCount
          return instructions[preCount];
        },
      },
      {
        name: 'unwrap-sol',
        createInstruction: async (ctx: StepContext) => {
          const { instructions, preCount } = await buildAllInstructions(ctx);
          // Post-instruction is at index = preCount + 1
          const postIndex = preCount + 1;
          // If no post-instruction exists, we need to return a no-op instruction
          // to avoid duplicate main instruction which causes errors
          if (instructions[postIndex]) {
            return instructions[postIndex];
          }
          // Return a memo instruction as no-op (harmless)
          const MEMO_PROGRAM = address('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
          return {
            programAddress: MEMO_PROGRAM,
            accounts: [],
            data: new Uint8Array(Buffer.from('no-op: no unwrap needed', 'utf-8')),
          };
        },
      },
    ]);

    return new VisualPipeline('raydium-kamino', pipeline, [
      { name: 'wrap-and-swap', type: 'instruction' },
    ]);
  }, []);

  return visualPipeline;
}

export const raydiumKaminoCode = `import { IdlProgramRegistry, RaydiumSwapPlugin, KaminoLendingPlugin } from '@pipeit/tx-idl'
import { createPipeline } from '@pipeit/tx-orchestration'
import { address } from '@solana/kit'

// Setup registry with plugins
const registry = new IdlProgramRegistry()
registry.use(new RaydiumSwapPlugin())
registry.use(new KaminoLendingPlugin())

await registry.registerProgramFromJson(RAYDIUM_CLMM_PROGRAM, raydiumIdl)
await registry.registerProgramFromJson(KAMINO_LENDING_PROGRAM, kaminoIdl)

// Build pipeline
const pipeline = createPipeline()
  // Wrap SOL + Swap in ONE transaction for efficiency
  .transaction('wrap-and-swap', async (ctx) => {
    const instructions = []
    
    // 1. Check if wSOL ATA exists, create if needed
    const wsolAta = address('...')  // Derive from signer + wSOL mint
    const ataInfo = await ctx.rpc.getAccountInfo(wsolAta, { encoding: 'base64' }).send()
    if (!ataInfo.value) {
      instructions.push(createAtaInstruction(...))
    }
    
    // 2. Transfer native SOL to wrap it
    instructions.push(transferSolInstruction(...))
    
    // 3. Sync native balance
    instructions.push(syncNativeInstruction(...))
    
    // 4. Swap wSOL → USDC using Raydium CLMM (pure IDL!)
    const swapIx = await registry.buildInstruction(
      RAYDIUM_CLMM_PROGRAM,
      'swap_v2',
      {
        inputMint: SOL_MINT,
        outputMint: USDC_MINT,
        amount: 50_000_000n,
        otherAmountThreshold: 1_000n,
        sqrtPriceLimitX64: 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFn,
        isBaseInput: true,
        poolAddress: address('2QdhepnKRTLjjSqPL1PtKNwqrUkoLee5Gqs8bvZhRdMv'),
      },
      {}, // All accounts auto-discovered!
      { signer: ctx.signer.address, programId: RAYDIUM_CLMM_PROGRAM, rpc: ctx.rpc }
    )
    instructions.push(swapIx)
    
    return instructions  // All 4 instructions in 1 atomic transaction!
  })
  .transaction('kamino-deposit', async (ctx) => {
    const depositIx = await registry.buildInstruction(
      KAMINO_LENDING_PROGRAM,
      'depositReserveLiquidity',
      { mint: address(USDC_MINT), liquidityAmount: 10_000_000n },
      {},
      { signer: ctx.signer.address, programId: KAMINO_LENDING_PROGRAM, rpc: ctx.rpc }
    )
    return [depositIx]
  })

// Execute: 2 transactions total (wrap+swap batched, then kamino)
await pipeline.execute({ signer, rpc, rpcSubscriptions })`;

