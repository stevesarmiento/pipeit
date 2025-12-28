/**
 * Jupiter Metis Swap API integration.
 *
 * Provides InstructionPlan factories for swaps via Jupiter's Metis Swap API.
 *
 * @packageDocumentation
 */

// Client
export {
    createMetisClient,
    METIS_DEFAULT_BASE_URL,
    MetisApiError,
    type MetisClient,
    type MetisClientConfig,
} from './client.js';

// Types
export type {
    SwapMode,
    PlatformFee,
    SwapInfo,
    RoutePlanStep,
    QuoteResponse,
    MetisQuoteParams,
    AccountMeta,
    MetisInstruction,
    PriorityLevelWithMaxLamports,
    JitoTipLamports,
    JitoTipLamportsWithPayer,
    PrioritizationFeeLamports,
    SwapInstructionsRequest,
    SwapInstructionsResponse,
    MetisSwapQuoteParams,
} from './types.js';

// Plan builders
export {
    getMetisSwapPlan,
    getMetisSwapQuote,
    getMetisSwapInstructionPlanFromResponse,
    NoSwapInstructionError,
    type MetisSwapPlanResult,
    type MetisSwapPlanOptions,
} from './plan-swap.js';

// Conversion utilities
export {
    metisInstructionToKit,
    metisInstructionsToKit,
    metisLookupTablesToAddresses,
    decodeBase64,
} from './convert.js';
