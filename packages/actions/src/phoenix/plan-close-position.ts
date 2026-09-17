/**
 * Phoenix close-position plan builder.
 *
 * @packageDocumentation
 */

import { OrderFlags } from '@ellipsis-labs/rise';
import { singleInstructionPlan } from '@solana/instruction-plans';
import { riseInstructionToKit } from './convert.js';
import { accountParams, asSymbol, assertNonZeroBaseLots, assertPositiveSize, closeSideFor, resolvePhoenixClient } from './shared.js';
import type { PhoenixClosePositionPlanOptions, PhoenixClosePositionPlanResult } from './types.js';

export type { PhoenixClosePositionPlanOptions, PhoenixClosePositionPlanResult } from './types.js';

/**
 * Builds an InstructionPlan that closes (part of) a Phoenix perps position
 * with an opposite-side IOC order.
 *
 * The order carries `OrderFlags.ReduceOnly` by default, so it can only
 * reduce the existing position — an oversized or stale `size` can never flip
 * you into the opposite side. Pass `reduceOnly: false` to opt out.
 *
 * `priceLimitUsd` is strongly recommended: without it, the close is an
 * unbounded market order with no slippage protection.
 *
 * @example
 * ```ts
 * const { plan } = await getPhoenixClosePositionPlan({
 *     client,
 *     trader: { authority: wallet.address },
 *     symbol: 'SOL',
 *     side: 'long',
 *     size: { baseUnits: '1.5' },
 *     priceLimitUsd: '148',
 * });
 * ```
 */
export async function getPhoenixClosePositionPlan(
    options: PhoenixClosePositionPlanOptions,
): Promise<PhoenixClosePositionPlanResult> {
    assertPositiveSize(options.size, 'close');

    const { client, shouldDispose } = resolvePhoenixClient(options);

    try {
        const trader = accountParams(options.trader);
        const closeSide = closeSideFor(options.side);
        const reduceOnly = options.reduceOnly !== false;
        const orderFlags = ((options.orderFlags ?? 0) | (reduceOnly ? OrderFlags.ReduceOnly : 0)) as OrderFlags;
        const orderPacket = await client.orderPackets.buildMarketOrderPacket({
            symbol: asSymbol(options.symbol),
            side: closeSide.riseSide,
            baseUnits: options.size.baseUnits,
            orderFlags,
            ...(options.priceLimitUsd !== undefined && { priceLimitUsd: options.priceLimitUsd }),
            ...(options.cancelExisting !== undefined && { cancelExisting: options.cancelExisting }),
        });
        assertNonZeroBaseLots(orderPacket.numBaseLots, 'close');
        const instruction = await client.ixs.placeMarketOrder({
            ...trader,
            symbol: asSymbol(options.symbol),
            orderPacket,
        });

        return {
            plan: singleInstructionPlan(riseInstructionToKit(instruction)),
            lookupTableAddresses: [],
            order: {
                symbol: options.symbol,
                side: options.side,
                orderSide: closeSide.orderSide,
                tradeSide: closeSide.orderSide,
                traderPdaIndex: trader.traderPdaIndex,
                traderSubaccountIndex: trader.traderSubaccountIndex,
                entryType: 'market',
                reduceOnly,
            },
            phoenix: {
                instructions: [instruction],
                orderPacket,
            },
        };
    } finally {
        if (shouldDispose) {
            client.dispose();
        }
    }
}
