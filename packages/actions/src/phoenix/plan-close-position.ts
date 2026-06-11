/**
 * Phoenix close-position plan builder.
 *
 * @packageDocumentation
 */

import { Side, type Authority, type Symbol as RiseSymbol } from '@ellipsis-labs/rise';
import { singleInstructionPlan } from '@solana/instruction-plans';
import type { Address } from '@solana/addresses';
import { createPhoenixActionsClient } from './client.js';
import { riseInstructionToKit } from './convert.js';
import type {
    PhoenixBaseSize,
    PhoenixClosePositionPlanOptions,
    PhoenixClosePositionPlanResult,
    PhoenixOrderSide,
    PhoenixPositionSide,
    PhoenixTraderAccountRef,
} from './types.js';
import { InvalidPhoenixPositionSideError, UnsupportedPhoenixOrderConfigError } from './types.js';

export type { PhoenixClosePositionPlanOptions, PhoenixClosePositionPlanResult } from './types.js';

function asAuthority(value: Address | string): Authority {
    return String(value) as Authority;
}

function asSymbol(value: string): RiseSymbol {
    return value as RiseSymbol;
}

function accountParams(trader: PhoenixTraderAccountRef) {
    const params: {
        authority: Authority;
        positionAuthority?: Authority;
        traderPdaIndex: number;
        traderSubaccountIndex: number;
    } = {
        authority: asAuthority(trader.authority),
        traderPdaIndex: trader.traderPdaIndex ?? 0,
        traderSubaccountIndex: trader.traderSubaccountIndex ?? 0,
    };

    if (trader.positionAuthority !== undefined) {
        params.positionAuthority = asAuthority(trader.positionAuthority);
    }

    return params;
}

function closeSideFor(positionSide: PhoenixPositionSide): { riseSide: Side; orderSide: PhoenixOrderSide } {
    if (positionSide === 'long') {
        return { riseSide: Side.Ask, orderSide: 'ask' };
    }
    if (positionSide === 'short') {
        return { riseSide: Side.Bid, orderSide: 'bid' };
    }

    throw new InvalidPhoenixPositionSideError(`Unsupported Phoenix position side: ${String(positionSide)}`);
}

function assertPositiveSize(size: PhoenixBaseSize): void {
    if (typeof size.baseUnits === 'bigint' && size.baseUnits <= 0n) {
        throw new UnsupportedPhoenixOrderConfigError('Phoenix close size baseUnits must be greater than zero.');
    }
    if (typeof size.baseUnits === 'number' && size.baseUnits <= 0) {
        throw new UnsupportedPhoenixOrderConfigError('Phoenix close size baseUnits must be greater than zero.');
    }
}

export async function getPhoenixClosePositionPlan(
    options: PhoenixClosePositionPlanOptions,
): Promise<PhoenixClosePositionPlanResult> {
    assertPositiveSize(options.size);

    const client = options.client ?? createPhoenixActionsClient(options.clientConfig);
    const trader = accountParams(options.trader);
    const closeSide = closeSideFor(options.side);
    const orderPacket = await client.orderPackets.buildMarketOrderPacket({
        symbol: asSymbol(options.symbol),
        side: closeSide.riseSide,
        baseUnits: options.size.baseUnits,
        ...(options.priceLimitUsd !== undefined && { priceLimitUsd: options.priceLimitUsd }),
        ...(options.cancelExisting !== undefined && { cancelExisting: options.cancelExisting }),
    });
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
        },
        phoenix: {
            instructions: [instruction],
            orderPacket,
        },
    };
}
