/**
 * Metis swap plan builder.
 *
 * Converts Metis quotes and swap instructions to composable Kit InstructionPlans.
 *
 * @packageDocumentation
 */

import type { Address } from '@solana/addresses';
import { type InstructionPlan, sequentialInstructionPlan, singleInstructionPlan } from '@solana/instruction-plans';
import { createMetisClient, type MetisClient, type MetisClientConfig } from './client.js';
import type {
    MetisSwapQuoteParams,
    QuoteResponse,
    SwapInstructionsRequest,
    SwapInstructionsResponse,
    SwapMode,
} from './types.js';
import { metisInstructionToKit, metisLookupTablesToAddresses } from './convert.js';

/**
 * Result of building a Metis swap plan.
 */
export interface MetisSwapPlanResult {
    /** The instruction plan for the swap */
    plan: InstructionPlan;
    /** Address lookup tables used by the swap (pass to executePlan) */
    lookupTableAddresses: Address[];
    /** Quote metadata */
    quote: {
        /** Input amount in smallest units */
        inputAmount: bigint;
        /** Expected output amount in smallest units */
        outputAmount: bigint;
        /** Swap mode used */
        swapMode: SwapMode;
        /** Slippage in basis points */
        slippageBps: number;
        /** Price impact percentage */
        priceImpactPct: string;
    };
    /** Original quote response (for debugging) */
    quoteResponse: QuoteResponse;
    /** Original swap instructions response (for debugging) */
    swapInstructionsResponse: SwapInstructionsResponse;
}

/**
 * Options for building a Metis swap plan.
 */
export interface MetisSwapPlanOptions {
    /** Metis client instance (creates new one if not provided) */
    client?: MetisClient;
    /** Metis client config (used if client not provided) */
    clientConfig?: MetisClientConfig;
}

/**
 * Get a swap quote from Metis.
 *
 * @param client - Metis client
 * @param params - Quote parameters
 * @returns Quote response
 *
 * @example
 * ```ts
 * const client = createMetisClient({ apiKey: 'your-key' });
 * const quote = await getMetisSwapQuote(client, {
 *   inputMint: 'So11111111111111111111111111111111111111112',
 *   outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
 *   amount: 1_000_000_000n,
 * });
 * ```
 */
export async function getMetisSwapQuote(
    client: MetisClient,
    params: MetisSwapQuoteParams['swap'],
): Promise<QuoteResponse> {
    return client.getQuote(params);
}

/**
 * Build an InstructionPlan from Metis swap instructions response.
 *
 * Instructions are assembled in this order:
 * 1. otherInstructions (e.g. Jito tips)
 * 2. setupInstructions (ATA creation)
 * 3. tokenLedgerInstruction (if present)
 * 4. swapInstruction
 * 5. cleanupInstruction (if present)
 *
 * NOTE: computeBudgetInstructions are NOT included because executePlan
 * handles compute budget automatically. Including them would cause
 * "duplicate instruction" errors.
 *
 * @param response - Swap instructions response from Metis
 * @returns Kit InstructionPlan
 *
 * @example
 * ```ts
 * const plan = getMetisSwapInstructionPlanFromResponse(swapInstructionsResponse);
 * await executePlan(plan, { rpc, rpcSubscriptions, signer });
 * ```
 */
export function getMetisSwapInstructionPlanFromResponse(response: SwapInstructionsResponse): InstructionPlan {
    // NOTE: We intentionally skip computeBudgetInstructions because
    // executePlan handles compute budget estimation automatically.
    // Including Jupiter's compute budget instructions would cause
    // "Transaction contains a duplicate instruction" errors.
    const allInstructions = [...response.otherInstructions, ...response.setupInstructions];

    // Add optional tokenLedgerInstruction if present
    if (response.tokenLedgerInstruction) {
        allInstructions.push(response.tokenLedgerInstruction);
    }

    // Add the main swap instruction
    allInstructions.push(response.swapInstruction);

    // Add optional cleanup instruction if present
    if (response.cleanupInstruction) {
        allInstructions.push(response.cleanupInstruction);
    }

    if (allInstructions.length === 0) {
        throw new NoSwapInstructionError();
    }

    const kitInstructions = allInstructions.map(metisInstructionToKit);

    if (kitInstructions.length === 1) {
        return singleInstructionPlan(kitInstructions[0]);
    }

    // Multiple instructions are sequential
    return sequentialInstructionPlan(kitInstructions.map(ix => singleInstructionPlan(ix)));
}

/**
 * Get a complete Metis swap plan from quote parameters.
 *
 * This is the main entry point that combines:
 * 1. Fetching a quote from Metis
 * 2. Fetching swap instructions
 * 3. Building an InstructionPlan
 * 4. Extracting ALT addresses for executePlan
 *
 * @param params - Quote and transaction parameters
 * @param options - Plan building options
 * @returns Complete swap plan result
 *
 * @example
 * ```ts
 * import { getMetisSwapPlan } from '@pipeit/actions/metis';
 * import { executePlan } from '@pipeit/core';
 *
 * const { plan, lookupTableAddresses, quote } = await getMetisSwapPlan({
 *   swap: {
 *     inputMint: 'So11111111111111111111111111111111111111112',
 *     outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
 *     amount: 1_000_000_000n, // 1 SOL
 *     slippageBps: 50, // 0.5%
 *   },
 *   transaction: {
 *     userPublicKey: signer.address,
 *   },
 * }, {
 *   clientConfig: { apiKey: 'your-api-key' },
 * });
 *
 * console.log(`Swapping for ~${quote.outputAmount} output tokens`);
 *
 * await executePlan(plan, {
 *   rpc,
 *   rpcSubscriptions,
 *   signer,
 *   lookupTableAddresses,
 * });
 * ```
 *
 * @example Composing with other plans
 * ```ts
 * import { sequentialInstructionPlan } from '@solana/instruction-plans';
 *
 * const swapResult = await getMetisSwapPlan({ ... });
 * const transferPlan = singleInstructionPlan(transferInstruction);
 *
 * const combinedPlan = sequentialInstructionPlan([
 *   swapResult.plan,
 *   transferPlan,
 * ]);
 *
 * // Combine ALTs from all sources
 * const allAltAddresses = [
 *   ...swapResult.lookupTableAddresses,
 *   ...otherAltAddresses,
 * ];
 *
 * await executePlan(combinedPlan, {
 *   rpc,
 *   rpcSubscriptions,
 *   signer,
 *   lookupTableAddresses: allAltAddresses,
 * });
 * ```
 */
export async function getMetisSwapPlan(
    params: MetisSwapQuoteParams,
    options?: MetisSwapPlanOptions,
): Promise<MetisSwapPlanResult> {
    // Get or create client
    const client = options?.client ?? createMetisClient(options?.clientConfig);

    // Fetch quote
    const quoteResponse = await getMetisSwapQuote(client, params.swap);

    // Build swap instructions request with only defined properties
    const tx = params.transaction;
    const swapInstructionsRequest: SwapInstructionsRequest = {
        quoteResponse,
        userPublicKey: tx.userPublicKey,
        ...(tx.payer !== undefined && { payer: tx.payer }),
        ...(tx.wrapAndUnwrapSol !== undefined && { wrapAndUnwrapSol: tx.wrapAndUnwrapSol }),
        ...(tx.useSharedAccounts !== undefined && { useSharedAccounts: tx.useSharedAccounts }),
        ...(tx.feeAccount !== undefined && { feeAccount: tx.feeAccount }),
        ...(tx.trackingAccount !== undefined && { trackingAccount: tx.trackingAccount }),
        ...(tx.prioritizationFeeLamports !== undefined && { prioritizationFeeLamports: tx.prioritizationFeeLamports }),
        ...(tx.asLegacyTransaction !== undefined && { asLegacyTransaction: tx.asLegacyTransaction }),
        ...(tx.destinationTokenAccount !== undefined && { destinationTokenAccount: tx.destinationTokenAccount }),
        ...(tx.nativeDestinationAccount !== undefined && { nativeDestinationAccount: tx.nativeDestinationAccount }),
        ...(tx.dynamicComputeUnitLimit !== undefined && { dynamicComputeUnitLimit: tx.dynamicComputeUnitLimit }),
        ...(tx.skipUserAccountsRpcCalls !== undefined && { skipUserAccountsRpcCalls: tx.skipUserAccountsRpcCalls }),
        ...(tx.computeUnitPriceMicroLamports !== undefined && {
            computeUnitPriceMicroLamports: tx.computeUnitPriceMicroLamports,
        }),
        ...(tx.blockhashSlotsToExpiry !== undefined && { blockhashSlotsToExpiry: tx.blockhashSlotsToExpiry }),
    };

    // Fetch swap instructions
    const swapInstructionsResponse = await client.getSwapInstructions(swapInstructionsRequest);

    // Build instruction plan
    const plan = getMetisSwapInstructionPlanFromResponse(swapInstructionsResponse);

    // Extract ALT addresses
    const lookupTableAddresses = metisLookupTablesToAddresses(swapInstructionsResponse.addressLookupTableAddresses);

    return {
        plan,
        lookupTableAddresses,
        quote: {
            inputAmount: BigInt(quoteResponse.inAmount),
            outputAmount: BigInt(quoteResponse.outAmount),
            swapMode: quoteResponse.swapMode,
            slippageBps: quoteResponse.slippageBps,
            priceImpactPct: quoteResponse.priceImpactPct,
        },
        quoteResponse,
        swapInstructionsResponse,
    };
}

/**
 * Error thrown when swap instructions are missing.
 */
export class NoSwapInstructionError extends Error {
    constructor() {
        super('No swap instruction found in response.');
        this.name = 'NoSwapInstructionError';
    }
}
