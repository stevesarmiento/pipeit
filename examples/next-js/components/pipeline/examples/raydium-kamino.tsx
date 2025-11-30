'use client';

import { useMemo } from 'react';
import { createFlow, type FlowConfig, type FlowContext } from '@pipeit/tx-builder';
import { VisualPipeline } from '@/lib/visual-pipeline';
import {
  getIdlRegistry,
  SOL_MINT,
  USDC_MINT,
  RAYDIUM_CLMM_PROGRAM,
} from '@/lib/idl-registry';
import { address, type Address } from '@solana/kit';
import type { Rpc, GetAccountInfoApi } from '@solana/rpc';
import type { Instruction } from '@solana/instructions';

// SOL/USDC CLMM pool on mainnet
// Source: https://geckoterminal.com/solana/pools/3ucNos4NbumPLZNWztqGHNFFgkHeRMBQAVemeeomsUxv
const RAYDIUM_SOL_USDC_POOL = address('3ucNos4NbumPLZNWztqGHNFFgkHeRMBQAVemeeomsUxv');

export function useRaydiumKaminoPipeline() {
  const visualPipeline = useMemo(() => {
    const registry = getIdlRegistry();

    const flowFactory = (config: FlowConfig) => {
      // Cache the built instructions to avoid multiple RPC calls (use Promise to handle race condition)
      let cachedPromise: Promise<Instruction[]> | null = null;

      // Build all instructions (pre + main + post) from the plugin
      const buildAllInstructions = async (ctx: FlowContext): Promise<Instruction[]> => {
        if (cachedPromise) {
          return cachedPromise;
        }

        console.log('[Raydium Example] Building swap instruction with IDL...');
        
        // Store the promise immediately to prevent race conditions
        cachedPromise = (async () => {
          const result = await registry.buildInstructionWithPrePost(
            RAYDIUM_CLMM_PROGRAM,
            'swap_v2',
            {
              inputMint: address(SOL_MINT),
              outputMint: address(USDC_MINT),
              amount: 10_000_000n, // 0.01 SOL in lamports
              otherAmountThreshold: 1n, // Minimum output (adjust for slippage)
              isBaseInput: true,
              poolAddress: RAYDIUM_SOL_USDC_POOL,
            },
            {}, // Accounts auto-discovered by plugin
            {
              signer: ctx.signer.address,
              programId: RAYDIUM_CLMM_PROGRAM,
              rpc: ctx.rpc as unknown as Rpc<GetAccountInfoApi>,
            }
          );

          // Combine all instructions in order: pre -> main -> post
          const instructions = [
            ...(result.preInstructions || []),
            result.instruction,
            ...(result.postInstructions || []),
          ];

          console.log('[Raydium Example] Built instructions:', {
            preCount: result.preInstructions?.length ?? 0,
            hasMain: true,
            postCount: result.postInstructions?.length ?? 0,
            total: instructions.length,
          });

          return instructions;
        })();

        return cachedPromise;
      };

      // Helper to get instruction at index (returns no-op if out of bounds)
      const getInstruction = async (ctx: FlowContext, index: number): Promise<Instruction> => {
        const instructions = await buildAllInstructions(ctx);
        if (index < instructions.length) {
          return instructions[index];
        }
        // Return no-op memo for missing instructions
        return {
          programAddress: address('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'),
          accounts: [],
          data: new Uint8Array(Buffer.from(`no-op:${index}`, 'utf-8')),
        };
      };

      // Raydium swap with wSOL wrapping typically needs:
      // Pre: createATA (1), transfer SOL (2), syncNative (3)
      // Main: swap_v2 (4)
      // Post: closeAccount/unwrap (5)
      // We create 5 slots and fill dynamically
      return createFlow(config).atomic('raydium-swap', [
        (ctx) => getInstruction(ctx, 0),
        (ctx) => getInstruction(ctx, 1),
        (ctx) => getInstruction(ctx, 2),
        (ctx) => getInstruction(ctx, 3),
        (ctx) => getInstruction(ctx, 4),
      ]);
    };

    return new VisualPipeline('raydium-kamino', flowFactory, [
      { name: 'raydium-swap', type: 'instruction' },
    ]);
  }, []);

  return visualPipeline;
}

export const raydiumKaminoCode = `import { IdlProgramRegistry, RaydiumSwapPlugin } from '@pipeit/tx-idl'
import { createFlow } from '@pipeit/tx-builder'
import { address } from '@solana/kit'

// 1. Setup registry with Raydium plugin for auto account discovery
const registry = new IdlProgramRegistry()
registry.use(new RaydiumSwapPlugin())
registry.registerProgramFromJson(RAYDIUM_CLMM_PROGRAM, raydiumIdl)

// 2. Build swap instruction - plugin handles everything:
//    - Resolves pool state from on-chain
//    - Derives all accounts (vaults, observation state, etc.)
//    - Adds tick arrays as remaining accounts
//    - Generates wSOL wrap/unwrap instructions
const result = await registry.buildInstructionWithPrePost(
  RAYDIUM_CLMM_PROGRAM,
  'swap_v2',
  {
    inputMint: SOL_MINT,           // What you're selling
    outputMint: USDC_MINT,         // What you're buying
    amount: 10_000_000n,           // 0.01 SOL in lamports
    otherAmountThreshold: 1n,      // Min output for slippage
    isBaseInput: true,             // Amount is input amount
    poolAddress: address('3ucNos4NbumPLZNWztqGHNFFgkHeRMBQAVemeeomsUxv'),
  },
  {}, // Accounts auto-discovered by plugin!
  { signer: walletAddress, programId: RAYDIUM_CLMM_PROGRAM, rpc }
)

// 3. Execute all instructions atomically
// result.preInstructions = [createATA, transferSOL, syncNative]
// result.instruction = swap_v2 
// result.postInstructions = [closeAccount/unwrap]
await createFlow({ rpc, rpcSubscriptions, signer })
  .atomic('raydium-swap', [
    ...result.preInstructions,
    result.instruction,
    ...result.postInstructions,
  ].map(ix => () => ix))
  .execute()`;
