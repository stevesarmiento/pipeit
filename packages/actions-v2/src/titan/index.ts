/**
 * Titan DEX aggregator integration.
 *
 * Provides InstructionPlan factories for swaps via Titan's API.
 *
 * @packageDocumentation
 */

// Client
export { createTitanClient, type TitanClient, type TitanClientConfig } from './client.js';

// Types
export type {
    SwapQuoteParams,
    SwapQuotes,
    SwapRoute,
    RoutePlanStep,
    SwapMode,
} from './types.js';

// Plan builders
export {
    getTitanSwapPlan,
    getTitanSwapQuote,
    selectTitanRoute,
    getTitanSwapInstructionPlanFromRoute,
    type TitanSwapPlanResult,
    type TitanSwapPlanOptions,
} from './plan-swap.js';

// Conversion utilities
export { titanInstructionToKit, titanPubkeyToAddress, encodeBase58 } from './convert.js';
