/**
 * Phoenix cancel-order plan builders.
 *
 * @packageDocumentation
 */

import type { Authority, Symbol as RiseSymbol } from '@ellipsis-labs/rise';
import { singleInstructionPlan } from '@solana/instruction-plans';
import type { Address } from '@solana/addresses';
import { createPhoenixActionsClient } from './client.js';
import { riseInstructionToKit } from './convert.js';
import type {
    PhoenixCancelAllOrdersPlanOptions,
    PhoenixCancelOrdersByIdPlanOptions,
    PhoenixCancelOrdersPlanResult,
    PhoenixTraderAccountRef,
} from './types.js';

export type {
    PhoenixCancelAllOrdersPlanOptions,
    PhoenixCancelOrdersByIdPlanOptions,
    PhoenixCancelOrdersPlanResult,
} from './types.js';

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

export async function getPhoenixCancelAllOrdersPlan(
    options: PhoenixCancelAllOrdersPlanOptions,
): Promise<PhoenixCancelOrdersPlanResult> {
    const client = options.client ?? createPhoenixActionsClient(options.clientConfig);
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
}

export async function getPhoenixCancelOrdersByIdPlan(
    options: PhoenixCancelOrdersByIdPlanOptions,
): Promise<PhoenixCancelOrdersPlanResult> {
    const client = options.client ?? createPhoenixActionsClient(options.clientConfig);
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
}
