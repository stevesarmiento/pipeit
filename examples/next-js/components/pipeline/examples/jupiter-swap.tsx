'use client';

import { useMemo } from 'react';
import { createFlow, type FlowConfig, TransactionBuilder } from '@pipeit/core';
import { VisualPipeline } from '@/lib/visual-pipeline';
import {
    createMetisClient,
    metisInstructionToKit,
    type QuoteResponse,
    type SwapInstructionsResponse,
} from '@pipeit/actions-v2/metis';
import { address } from '@solana/kit';

// Token addresses
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

// Proxy through Next.js API route to inject API key server-side
const JUPITER_PROXY_URL = '/api/jupiter';

/**
 * Example: Jupiter Swap using @pipeit/actions-v2/metis
 *
 * This demonstrates using the Metis module to get swap instructions,
 * then executing them via TransactionBuilder with full control.
 */
export function useJupiterSwapPipeline() {
    const visualPipeline = useMemo(() => {
        const metisClient = createMetisClient({
            baseUrl: JUPITER_PROXY_URL,
        });

        const flowFactory = (config: FlowConfig) =>
            createFlow(config).transaction('jupiter-swap', async ctx => {
                const userPublicKey = ctx.signer.address;

                // Step 1: Get quote from Jupiter
                const quoteResponse: QuoteResponse = await metisClient.getQuote({
                    inputMint: SOL_MINT,
                    outputMint: USDC_MINT,
                    amount: 10_000_000n, // 0.01 SOL
                    slippageBps: 100, // 1% slippage for safety
                });

                console.log(
                    `Jupiter quote: ${quoteResponse.inAmount} -> ${quoteResponse.outAmount} (${quoteResponse.swapMode})`,
                );

                // Step 2: Get swap instructions
                const swapInstructions: SwapInstructionsResponse = await metisClient.getSwapInstructions({
                    quoteResponse,
                    userPublicKey,
                    wrapAndUnwrapSol: true,
                    // Prefer shared accounts so Jupiter can handle intermediate token accounts when needed.
                    useSharedAccounts: true,
                });

                console.log('Swap instructions:', swapInstructions);
                const simulationError = (swapInstructions as unknown as { simulationError?: unknown }).simulationError;
                if (simulationError) {
                    console.warn(
                        '[Jupiter] swap-instructions returned simulationError. ' +
                            'Continuing with local simulation via TransactionBuilder.',
                        simulationError,
                    );
                }

                // Step 3: Convert all instructions to Kit format
                // IMPORTANT: Do NOT include Jupiter's computeBudgetInstructions here.
                // TransactionBuilder will simulate + set CU limit and priority fee itself.
                const allInstructions = [
                    ...swapInstructions.otherInstructions.map(metisInstructionToKit),
                    ...swapInstructions.setupInstructions.map(metisInstructionToKit),
                    ...(swapInstructions.tokenLedgerInstruction
                        ? [metisInstructionToKit(swapInstructions.tokenLedgerInstruction)]
                        : []),
                    metisInstructionToKit(swapInstructions.swapInstruction),
                    ...(swapInstructions.cleanupInstruction
                        ? [metisInstructionToKit(swapInstructions.cleanupInstruction)]
                        : []),
                ];

                // Convert lookup table addresses
                const lookupTableAddresses = swapInstructions.addressLookupTableAddresses.map(
                    addr => address(addr),
                );

                console.log('Total instructions:', allInstructions.length);
                console.log('Lookup tables:', lookupTableAddresses);

                // Step 4: Build and execute transaction
                async function executeSwapOnce(): Promise<string> {
                    return new TransactionBuilder({
                        rpc: ctx.rpc as any,
                        // Simulate to set CU limit (and surface simulation logs if it fails).
                        computeUnits: { strategy: 'simulate', buffer: 1.1 },
                        // Fixed high priority fee so it lands before blockhash expiry.
                        // 200_000 microLamports/CU = 0.2 lamports/CU.
                        priorityFee: { strategy: 'fixed', microLamports: 200_000 },
                        // Don't retry the same blockhash internally; we rebuild on expiry below.
                        autoRetry: false,
                        lookupTableAddresses: lookupTableAddresses.length > 0 ? lookupTableAddresses : undefined,
                    })
                        .setFeePayerSigner(ctx.signer)
                        .addInstructions(allInstructions)
                        .execute({
                            rpcSubscriptions: ctx.rpcSubscriptions as any,
                            commitment: 'confirmed',
                            // We've already simulated for CU; skipping preflight reduces latency.
                            skipPreflight: true,
                        });
                }

                let signature: string;
                try {
                    signature = await executeSwapOnce();
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    // If the blockhash expired before landing, rebuild + retry once with a fresh blockhash.
                    if (message.includes('progressed past the last block')) {
                        signature = await executeSwapOnce();
                    } else {
                        throw error;
                    }
                }

                console.log('Swap executed:', signature);

                return {
                    signature,
                    quote: {
                        inputAmount: BigInt(quoteResponse.inAmount),
                        outputAmount: BigInt(quoteResponse.outAmount),
                        swapMode: quoteResponse.swapMode,
                    },
                };
            });

        return new VisualPipeline('jupiter-swap', flowFactory, [{ name: 'jupiter-swap', type: 'transaction' }]);
    }, []);

    return visualPipeline;
}

export const jupiterSwapCode = `import { createMetisClient, metisInstructionToKit } from '@pipeit/actions-v2/metis'
import { TransactionBuilder } from '@pipeit/core'
import { address } from '@solana/kit'

// Token addresses
const SOL = 'So11111111111111111111111111111111111111112'
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'

// Create client with API key
const client = createMetisClient({
  apiKey: 'your-api-key', // from https://portal.jup.ag
})

// Step 1: Get quote
const quote = await client.getQuote({
  inputMint: SOL,
  outputMint: USDC,
  amount: 10_000_000n, // 0.01 SOL
  slippageBps: 100,    // 1% slippage
})

// Step 2: Get swap instructions
const swapIxs = await client.getSwapInstructions({
  quoteResponse: quote,
  userPublicKey: signer.address,
  wrapAndUnwrapSol: true,
  useSharedAccounts: true,
})

// Step 3: Convert instructions to Kit format
const instructions = [
  ...swapIxs.otherInstructions.map(metisInstructionToKit),
  ...swapIxs.setupInstructions.map(metisInstructionToKit),
  metisInstructionToKit(swapIxs.swapInstruction),
  ...(swapIxs.cleanupInstruction ? [metisInstructionToKit(swapIxs.cleanupInstruction)] : []),
]

const lookupTableAddresses = swapIxs.addressLookupTableAddresses.map(address)

// Step 4: Execute with TransactionBuilder
const signature = await new TransactionBuilder({
  rpc,
  computeUnits: { strategy: 'simulate', buffer: 1.1 },
  priorityFee: { strategy: 'fixed', microLamports: 200_000 },
  lookupTableAddresses,
})
  .setFeePayerSigner(signer)
  .addInstructions(instructions)
  .execute({ rpcSubscriptions, commitment: 'confirmed', skipPreflight: true })

console.log('Swap executed:', signature)`;
