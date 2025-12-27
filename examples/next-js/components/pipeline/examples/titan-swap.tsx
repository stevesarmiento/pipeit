'use client';

import { useMemo } from 'react';
import { executePlan, createFlow, type FlowConfig, type TransactionPlanResult } from '@pipeit/core';
import { VisualPipeline } from '@/lib/visual-pipeline';
import { getTitanSwapPlan } from '@pipeit/actions/titan';
import { getSignatureFromTransaction } from '@solana/kit';

// Token addresses
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

// Proxy through Next.js API route to avoid CORS (add ?region=jp1 or ?region=de1 to switch)
const TITAN_PROXY_URL = '/api/titan';

/**
 * Example: Titan Swap using @pipeit/actions
 *
 * This demonstrates using the new InstructionPlan-first approach with Titan,
 * including ALT (Address Lookup Table) support for optimal transaction packing.
 */
export function useTitanSwapPipeline() {
    const visualPipeline = useMemo(() => {
        const flowFactory = (config: FlowConfig) =>
            createFlow(config).transaction('titan-swap', async ctx => {
                // Get swap plan from Titan
                // This returns an InstructionPlan + ALT addresses
                const swapResult = await getTitanSwapPlan(
                    {
                        swap: {
                            inputMint: SOL_MINT,
                            outputMint: USDC_MINT,
                            amount: 10_000_000n, // 0.01 SOL
                            slippageBps: 50,
                        },
                        transaction: {
                            userPublicKey: ctx.signer.address,
                            createOutputTokenAccount: true,
                        },
                    },
                    {
                        clientConfig: { baseUrl: TITAN_PROXY_URL },
                    },
                );

                console.log(
                    `Titan quote: ${swapResult.quote.inputAmount} -> ${swapResult.quote.outputAmount} via ${swapResult.providerId}`,
                );

                // Execute the plan with ALT support
                // The ALTs enable optimal transaction packing and compression
                const transactionPlanResult = await executePlan(swapResult.plan, {
                    rpc: ctx.rpc as any,
                    rpcSubscriptions: ctx.rpcSubscriptions as any,
                    signer: ctx.signer,
                    commitment: 'confirmed',
                    // Pass ALT addresses for compression
                    lookupTableAddresses: swapResult.lookupTableAddresses,
                });

                const signatures = getSignaturesFromTransactionPlanResult(transactionPlanResult);
                const signature = signatures.at(-1) ?? '';

                return {
                    signature,
                    quote: swapResult.quote,
                    providerId: swapResult.providerId,
                };
            });

        return new VisualPipeline('titan-swap', flowFactory, [{ name: 'titan-swap', type: 'transaction' }]);
    }, []);

    return visualPipeline;
}

export const titanSwapCode = `import { getTitanSwapPlan, TITAN_DEMO_BASE_URLS } from '@pipeit/actions/titan'
import { executePlan } from '@pipeit/core'
import { getSignatureFromTransaction } from '@solana/kit'

// Token addresses
const SOL = 'So11111111111111111111111111111111111111112'
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'

// Server-side: use Titan directly
// const titanBaseUrl = TITAN_DEMO_BASE_URLS.us1
// Browser: proxy through your API to avoid CORS
const titanBaseUrl = '/api/titan'

// Get a swap plan from Titan
// Returns an InstructionPlan + ALT addresses for compression
const { plan, lookupTableAddresses, quote, providerId } = await getTitanSwapPlan(
  {
    swap: {
      inputMint: SOL,
      outputMint: USDC,
      amount: 10_000_000n, // 0.01 SOL in lamports
      slippageBps: 50,     // 0.5% slippage tolerance
    },
    transaction: {
      userPublicKey: signer.address,
      createOutputTokenAccount: true,
    },
  },
  {
    clientConfig: { baseUrl: titanBaseUrl },
  },
)

console.log(\`Swapping for ~\${quote.outputAmount} USDC via \${providerId}\`)

function getSignaturesFromTransactionPlanResult(result) {
  if (result.kind === 'single') {
    return result.status.kind === 'successful'
      ? [getSignatureFromTransaction(result.status.transaction)]
      : []
  }
  return result.plans.flatMap(getSignaturesFromTransactionPlanResult)
}

// Execute using Kit's InstructionPlan system with ALT support
// ALTs enable optimal transaction packing and compression
const transactionPlanResult = await executePlan(plan, {
  rpc,
  rpcSubscriptions,
  signer,
  commitment: 'confirmed',
  lookupTableAddresses, // Pass ALTs for compression
})

const signatures = getSignaturesFromTransactionPlanResult(transactionPlanResult)
console.log('Swap executed:', signatures[signatures.length - 1])`;

function getSignaturesFromTransactionPlanResult(
    result: TransactionPlanResult,
): string[] {
    if (result.kind === 'single') {
        if (result.status.kind !== 'successful') return [];
        return [getSignatureFromTransaction(result.status.transaction)];
    }

    return result.plans.flatMap(getSignaturesFromTransactionPlanResult);
}
