/**
 * Flash Trade trigger-order cancellation plan builders.
 *
 * @packageDocumentation
 */

import { web3InstructionToKit } from './convert.js';
import {
    assertNoAdditionalSigners,
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

export async function getFlashCancelTriggerOrderPlan(
    options: FlashCancelTriggerOrderPlanOptions,
): Promise<FlashCancelTriggerOrdersPlanResult> {
    const context = resolveFlashContext(options);
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

export async function getFlashCancelAllTriggerOrdersPlan(
    options: FlashCancelAllTriggerOrdersPlanOptions,
): Promise<FlashCancelTriggerOrdersPlanResult> {
    const context = resolveFlashContext(options);
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
