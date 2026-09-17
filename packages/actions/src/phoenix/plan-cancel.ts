/**
 * Phoenix cancel-order plan builders.
 *
 * @packageDocumentation
 */

import { singleInstructionPlan } from '@solana/instruction-plans';
import { riseInstructionToKit } from './convert.js';
import { accountParams, asSymbol, resolvePhoenixClient } from './shared.js';
import type {
    PhoenixCancelAllOrdersPlanOptions,
    PhoenixCancelOrdersByIdPlanOptions,
    PhoenixCancelOrdersPlanResult,
} from './types.js';

export type {
    PhoenixCancelAllOrdersPlanOptions,
    PhoenixCancelOrdersByIdPlanOptions,
    PhoenixCancelOrdersPlanResult,
} from './types.js';

/**
 * Builds an InstructionPlan that cancels every resting order for the trader
 * on the given market.
 *
 * @example
 * ```ts
 * const { plan } = await getPhoenixCancelAllOrdersPlan({
 *     client,
 *     trader: { authority: wallet.address },
 *     symbol: 'SOL',
 * });
 * ```
 */
export async function getPhoenixCancelAllOrdersPlan(
    options: PhoenixCancelAllOrdersPlanOptions,
): Promise<PhoenixCancelOrdersPlanResult> {
    const { client, shouldDispose } = resolvePhoenixClient(options);

    try {
        const trader = accountParams(options.trader);
        const instruction = await client.ixs.buildCancelAll({
            ...trader,
            symbol: asSymbol(options.symbol),
        });

        return {
            plan: singleInstructionPlan(riseInstructionToKit(instruction)),
            lookupTableAddresses: [],
            order: {
                symbol: options.symbol,
                traderPdaIndex: trader.traderPdaIndex,
                traderSubaccountIndex: trader.traderSubaccountIndex,
                cancelAll: true,
                orderCount: null,
            },
            phoenix: {
                instructions: [instruction],
            },
        };
    } finally {
        if (shouldDispose) {
            client.dispose();
        }
    }
}

/**
 * Builds an InstructionPlan that cancels specific resting orders by id.
 *
 * Identify orders with `priceInTicks` (exact) whenever the tick price is
 * available — the deprecated float `price` path floor-converts USD to ticks
 * and can silently target a nonexistent order id when the USD value was
 * itself round-tripped from ticks.
 *
 * @example
 * ```ts
 * const { plan } = await getPhoenixCancelOrdersByIdPlan({
 *     client,
 *     trader: { authority: wallet.address },
 *     symbol: 'SOL',
 *     orders: [{ priceInTicks: 65000n, orderSequenceNumber: '42' }],
 * });
 * ```
 */
export async function getPhoenixCancelOrdersByIdPlan(
    options: PhoenixCancelOrdersByIdPlanOptions,
): Promise<PhoenixCancelOrdersPlanResult> {
    const { client, shouldDispose } = resolvePhoenixClient(options);

    try {
        const trader = accountParams(options.trader);
        const instruction = await client.ixs.buildCancelOrdersById({
            ...trader,
            symbol: asSymbol(options.symbol),
            orders: options.orders,
        });

        return {
            plan: singleInstructionPlan(riseInstructionToKit(instruction)),
            lookupTableAddresses: [],
            order: {
                symbol: options.symbol,
                traderPdaIndex: trader.traderPdaIndex,
                traderSubaccountIndex: trader.traderSubaccountIndex,
                cancelAll: false,
                orderCount: options.orders.length,
            },
            phoenix: {
                instructions: [instruction],
            },
        };
    } finally {
        if (shouldDispose) {
            client.dispose();
        }
    }
}
