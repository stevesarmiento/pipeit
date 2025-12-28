/**
 * Titan swap plan builder.
 *
 * Converts Titan quotes to composable Kit InstructionPlans.
 *
 * @packageDocumentation
 */

import type { Address } from '@solana/addresses';
import { type InstructionPlan, sequentialInstructionPlan, singleInstructionPlan } from '@solana/instruction-plans';
import { createTitanClient, type TitanClient, type TitanClientConfig } from './client.js';
import type { SwapQuoteParams, SwapQuotes, SwapRoute, SwapMode } from './types.js';
import { titanInstructionsToKit, titanPubkeysToAddresses } from './convert.js';

/**
 * Result of selecting a route from quotes.
 */
export interface SelectedRoute {
    /** Provider ID that offered this route */
    providerId: string;
    /** The selected route */
    route: SwapRoute;
}

/**
 * Result of building a Titan swap plan.
 */
export interface TitanSwapPlanResult {
    /** The instruction plan for the swap */
    plan: InstructionPlan;
    /** Address lookup tables used by the swap (pass to executePlan) */
    lookupTableAddresses: Address[];
    /** Quote ID for reference */
    quoteId: string;
    /** Provider ID that offered the selected route */
    providerId: string;
    /** The selected route with full details */
    route: SwapRoute;
    /** Quote metadata */
    quote: {
        /** Input amount in smallest units */
        inputAmount: bigint;
        /** Expected output amount in smallest units */
        outputAmount: bigint;
        /** Swap mode used */
        swapMode: SwapMode;
    };
}

/**
 * Options for building a Titan swap plan.
 */
export interface TitanSwapPlanOptions {
    /** Titan client instance (creates new one if not provided) */
    client?: TitanClient;
    /** Titan client config (used if client not provided) */
    clientConfig?: TitanClientConfig;
    /** Specific provider ID to use (default: best available) */
    providerId?: string;
}

/**
 * Get a swap quote from Titan.
 *
 * @param client - Titan client
 * @param params - Quote parameters
 * @returns Swap quotes from all providers
 *
 * @example
 * ```ts
 * const client = createTitanClient();
 * const quotes = await getTitanSwapQuote(client, {
 *   swap: {
 *     inputMint: 'So11111111111111111111111111111111111111112',
 *     outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
 *     amount: 1_000_000_000n,
 *   },
 *   transaction: {
 *     userPublicKey: wallet.publicKey,
 *   },
 * });
 * ```
 */
export async function getTitanSwapQuote(client: TitanClient, params: SwapQuoteParams): Promise<SwapQuotes> {
    return client.getSwapQuote(params);
}

/**
 * Select the best route from a set of quotes.
 *
 * Selection logic:
 * - ExactIn: choose the route with maximum outAmount
 * - ExactOut: choose the route with minimum inAmount
 *
 * @param quotes - Swap quotes from Titan
 * @param options - Selection options
 * @returns Selected route with provider ID
 *
 * @example
 * ```ts
 * const { providerId, route } = selectTitanRoute(quotes);
 * console.log(`Best route from ${providerId}: ${route.outAmount}`);
 * ```
 */
export function selectTitanRoute(quotes: SwapQuotes, options?: { providerId?: string }): SelectedRoute {
    const providerIds = Object.keys(quotes.quotes);

    if (providerIds.length === 0) {
        throw new NoRoutesError(quotes.id);
    }

    // If specific provider requested, use it
    if (options?.providerId) {
        const route = quotes.quotes[options.providerId];
        if (!route) {
            throw new ProviderNotFoundError(options.providerId, providerIds);
        }
        return { providerId: options.providerId, route };
    }

    // Select best route based on swap mode
    const isExactIn = quotes.swapMode === 'ExactIn';

    let bestProviderId = providerIds[0];
    let bestRoute = quotes.quotes[bestProviderId];

    for (const providerId of providerIds.slice(1)) {
        const route = quotes.quotes[providerId];

        if (isExactIn) {
            // ExactIn: maximize output
            if (route.outAmount > bestRoute.outAmount) {
                bestProviderId = providerId;
                bestRoute = route;
            }
        } else {
            // ExactOut: minimize input
            if (route.inAmount < bestRoute.inAmount) {
                bestProviderId = providerId;
                bestRoute = route;
            }
        }
    }

    return { providerId: bestProviderId, route: bestRoute };
}

/**
 * Build an InstructionPlan from a Titan swap route.
 *
 * @param route - Selected swap route
 * @returns Kit InstructionPlan
 *
 * @example
 * ```ts
 * const plan = getTitanSwapInstructionPlanFromRoute(route);
 * await executePlan(plan, { rpc, rpcSubscriptions, signer });
 * ```
 */
export function getTitanSwapInstructionPlanFromRoute(route: SwapRoute): InstructionPlan {
    const instructions = titanInstructionsToKit(route.instructions);

    if (instructions.length === 0) {
        throw new NoInstructionsError();
    }

    if (instructions.length === 1) {
        return singleInstructionPlan(instructions[0]);
    }

    // Multiple instructions are sequential (setup → swap → cleanup)
    return sequentialInstructionPlan(instructions.map(ix => singleInstructionPlan(ix)));
}

/**
 * Get a complete Titan swap plan from quote parameters.
 *
 * This is the main entry point that combines:
 * 1. Fetching a quote from Titan
 * 2. Selecting the best route
 * 3. Building an InstructionPlan
 * 4. Extracting ALT addresses for executePlan
 *
 * @param params - Quote parameters
 * @param options - Plan building options
 * @returns Complete swap plan result
 *
 * @example
 * ```ts
 * import { getTitanSwapPlan } from '@pipeit/actions/titan';
 * import { executePlan } from '@pipeit/core';
 *
 * const { plan, lookupTableAddresses, quote } = await getTitanSwapPlan({
 *   swap: {
 *     inputMint: 'So11111111111111111111111111111111111111112',
 *     outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
 *     amount: 1_000_000_000n, // 1 SOL
 *     slippageBps: 50, // 0.5%
 *   },
 *   transaction: {
 *     userPublicKey: signer.address,
 *     createOutputTokenAccount: true,
 *   },
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
 * const swapResult = await getTitanSwapPlan({ ... });
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
export async function getTitanSwapPlan(
    params: SwapQuoteParams,
    options?: TitanSwapPlanOptions,
): Promise<TitanSwapPlanResult> {
    // Get or create client
    const client = options?.client ?? createTitanClient(options?.clientConfig);

    // Fetch quote
    const quotes = await getTitanSwapQuote(client, params);

    // Select best route
    const selectOptions = options?.providerId ? { providerId: options.providerId } : undefined;
    const { providerId, route } = selectTitanRoute(quotes, selectOptions);

    // Build instruction plan
    const plan = getTitanSwapInstructionPlanFromRoute(route);

    // Extract ALT addresses
    const lookupTableAddresses = titanPubkeysToAddresses(route.addressLookupTables);

    return {
        plan,
        lookupTableAddresses,
        quoteId: quotes.id,
        providerId,
        route,
        quote: {
            inputAmount: route.inAmount,
            outputAmount: route.outAmount,
            swapMode: quotes.swapMode,
        },
    };
}

/**
 * Error thrown when no routes are available for a swap.
 */
export class NoRoutesError extends Error {
    readonly quoteId: string;

    constructor(quoteId: string) {
        super(`No routes available for quote ${quoteId}`);
        this.name = 'NoRoutesError';
        this.quoteId = quoteId;
    }
}

/**
 * Error thrown when a requested provider is not found.
 */
export class ProviderNotFoundError extends Error {
    readonly providerId: string;
    readonly availableProviders: string[];

    constructor(providerId: string, availableProviders: string[]) {
        super(`Provider ${providerId} not found. Available: ${availableProviders.join(', ')}`);
        this.name = 'ProviderNotFoundError';
        this.providerId = providerId;
        this.availableProviders = availableProviders;
    }
}

/**
 * Error thrown when a route has no instructions.
 */
export class NoInstructionsError extends Error {
    constructor() {
        super('Route has no instructions. The route may only provide a pre-built transaction.');
        this.name = 'NoInstructionsError';
    }
}
