/**
 * @pipeit/actions-v2 - Composable InstructionPlan factories for Solana DeFi.
 *
 * This package provides Kit-compatible InstructionPlan factories that can be:
 * - Executed directly with `@pipeit/core`'s executePlan
 * - Composed with other InstructionPlans using Kit's plan combinators
 * - Used by anyone in the Kit ecosystem
 *
 * @example
 * ```ts
 * import { getTitanSwapPlan } from '@pipeit/actions-v2/titan';
 * import { executePlan } from '@pipeit/core';
 *
 * // Get a swap plan from Titan
 * const { plan, lookupTableAddresses } = await getTitanSwapPlan({
 *   inputMint: SOL_MINT,
 *   outputMint: USDC_MINT,
 *   amount: 1_000_000_000n,
 *   user: signer.address,
 * });
 *
 * // Execute with ALT support
 * await executePlan(plan, {
 *   rpc,
 *   rpcSubscriptions,
 *   signer,
 *   lookupTableAddresses,
 * });
 * ```
 *
 * @packageDocumentation
 */

// Re-export Titan module
export * from './titan/index.js';

// Note: Metis module is NOT re-exported here to avoid naming conflicts
// (both Titan and Metis have SwapMode, RoutePlanStep, etc.)
// Import Metis directly via: import { ... } from '@pipeit/actions-v2/metis'
