/**
 * Flash Trade trigger-order cancellation plan builders.
 *
 * @packageDocumentation
 */

import { web3InstructionToKit } from './convert.js';
import {
    assertNoAdditionalSigners,
    assertTraderMatchesProvider,
    buildInstructionPlan,
    flashSideFor,
    getLookupTableAddresses,
    resolveFlashContext,
} from './pool.js';
import type {
    FlashCancelAllTriggerOrdersPlanOptions,
    FlashCancelTriggerOrderPlanOptions,
    FlashCancelTriggerOrdersPlanResult,
} from './types.js';

export type {
    FlashCancelAllTriggerOrdersPlanOptions,
    FlashCancelTriggerOrderPlanOptions,
    FlashCancelTriggerOrdersPlanResult,
} from './types.js';

/**
 * Builds an InstructionPlan that cancels a single Flash trigger order
 * (take-profit or stop-loss) by id.
 *
 * @example
 * ```ts
 * const { plan } = await getFlashCancelTriggerOrderPlan({
 *     clientConfig: { provider },
 *     trader: { owner: provider.wallet.publicKey.toBase58() },
 *     symbol: 'SOL',
 *     collateralSymbol: 'USDC',
 *     side: 'long',
 *     orderId: 1,
 *     isStopLoss: true,
 * });
 * ```
 */
export async function getFlashCancelTriggerOrderPlan(
    options: FlashCancelTriggerOrderPlanOptions,
): Promise<FlashCancelTriggerOrdersPlanResult> {
    const context = resolveFlashContext(options);
    assertTraderMatchesProvider(context, options.trader);
    const collateralSymbol = options.collateralSymbol ?? options.symbol;
    const side = flashSideFor(options.side);
    const lookupTableAddresses = await getLookupTableAddresses(context);
    const result = await context.client.cancelTriggerOrder(
        options.symbol,
        collateralSymbol,
        side,
        options.orderId,
        options.isStopLoss,
        context.poolConfig,
    );
    assertNoAdditionalSigners(result, 'cancel trigger order');

    return {
        plan: buildInstructionPlan(result.instructions.map(instruction => web3InstructionToKit(instruction))),
        lookupTableAddresses,
        order: {
            symbol: options.symbol,
            collateralSymbol,
            side: options.side,
            cancelAll: false,
            orderId: options.orderId,
            isStopLoss: options.isStopLoss,
            poolName: context.poolName,
            cluster: context.cluster,
        },
        flash: {
            instructions: result.instructions,
            poolName: context.poolName,
            cluster: context.cluster,
        },
    };
}

/**
 * Builds an InstructionPlan that cancels every Flash trigger order for a
 * position.
 *
 * @example
 * ```ts
 * const { plan } = await getFlashCancelAllTriggerOrdersPlan({
 *     clientConfig: { provider },
 *     trader: { owner: provider.wallet.publicKey.toBase58() },
 *     symbol: 'SOL',
 *     collateralSymbol: 'USDC',
 *     side: 'long',
 * });
 * ```
 */
export async function getFlashCancelAllTriggerOrdersPlan(
    options: FlashCancelAllTriggerOrdersPlanOptions,
): Promise<FlashCancelTriggerOrdersPlanResult> {
    const context = resolveFlashContext(options);
    assertTraderMatchesProvider(context, options.trader);
    const collateralSymbol = options.collateralSymbol ?? options.symbol;
    const side = flashSideFor(options.side);
    const lookupTableAddresses = await getLookupTableAddresses(context);
    const result = await context.client.cancelAllTriggerOrders(
        options.symbol,
        collateralSymbol,
        side,
        context.poolConfig,
    );
    assertNoAdditionalSigners(result, 'cancel all trigger orders');

    return {
        plan: buildInstructionPlan(result.instructions.map(instruction => web3InstructionToKit(instruction))),
        lookupTableAddresses,
        order: {
            symbol: options.symbol,
            collateralSymbol,
            side: options.side,
            cancelAll: true,
            orderId: null,
            isStopLoss: null,
            poolName: context.poolName,
            cluster: context.cluster,
        },
        flash: {
            instructions: result.instructions,
            poolName: context.poolName,
            cluster: context.cluster,
        },
    };
}
