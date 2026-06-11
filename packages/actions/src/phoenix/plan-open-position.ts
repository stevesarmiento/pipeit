/**
 * Phoenix open-position plan builder.
 *
 * Converts high-level position intent into Rise order packets, optional
 * position-level conditionals, and Kit InstructionPlans.
 *
 * @packageDocumentation
 */

import {
    Direction,
    Side,
    StopLossOrderKind,
    baseUnitsToBaseLotsWithMarketParams,
    priceUsdToTicksWithMarketParams,
    projectExchangeMarket,
    type Authority,
    type ImmediateOrCancelOrderPacket,
    type LimitOrderPacket,
    type OrderPacketMarketParams,
    type PhoenixClient,
    type PostOnlyOrderPacket,
    type Symbol as RiseSymbol,
    type Ticks,
    type TriggerOrderParamsInput,
} from '@ellipsis-labs/rise';
import { type InstructionPlan, sequentialInstructionPlan, singleInstructionPlan } from '@solana/instruction-plans';
import type { Address } from '@solana/addresses';
import { createPhoenixActionsClient } from './client.js';
import { riseInstructionToKit } from './convert.js';
import type {
    PhoenixBaseSize,
    PhoenixConditionalRiskLeg,
    PhoenixOpenPositionEntry,
    PhoenixOpenPositionPlanOptions,
    PhoenixOpenPositionPlanResult,
    PhoenixOrderSide,
    PhoenixPositionRisk,
    PhoenixPositionSide,
    PhoenixTraderAccountRef,
} from './types.js';
import {
    InvalidPhoenixPositionSideError,
    InvalidPhoenixRiskConfigError,
    UnsupportedPhoenixOrderConfigError,
} from './types.js';

export type { PhoenixOpenPositionPlanOptions, PhoenixOpenPositionPlanResult } from './types.js';

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
        payer?: Authority;
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
    if (trader.payer !== undefined) {
        params.payer = asAuthority(trader.payer);
    }

    return params;
}

function entrySideFor(positionSide: PhoenixPositionSide): { riseSide: Side; orderSide: PhoenixOrderSide } {
    if (positionSide === 'long') {
        return { riseSide: Side.Bid, orderSide: 'bid' };
    }
    if (positionSide === 'short') {
        return { riseSide: Side.Ask, orderSide: 'ask' };
    }

    throw new InvalidPhoenixPositionSideError(`Unsupported Phoenix position side: ${String(positionSide)}`);
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

function takeProfitDirectionFor(positionSide: PhoenixPositionSide): Direction {
    return positionSide === 'long' ? Direction.GreaterThan : Direction.LessThan;
}

function stopLossDirectionFor(positionSide: PhoenixPositionSide): Direction {
    return positionSide === 'long' ? Direction.LessThan : Direction.GreaterThan;
}

function assertPositiveSize(size: PhoenixBaseSize): void {
    if (typeof size.baseUnits === 'bigint' && size.baseUnits <= 0n) {
        throw new UnsupportedPhoenixOrderConfigError('Phoenix open size baseUnits must be greater than zero.');
    }
    if (typeof size.baseUnits === 'number' && size.baseUnits <= 0) {
        throw new UnsupportedPhoenixOrderConfigError('Phoenix open size baseUnits must be greater than zero.');
    }
}

function validateEntry(entry: PhoenixOpenPositionEntry): void {
    if (entry.type === 'market') {
        return;
    }
    if (entry.type === 'limit') {
        if (entry.priceUsd === undefined || entry.priceUsd === null) {
            throw new UnsupportedPhoenixOrderConfigError('Phoenix limit entries require priceUsd.');
        }
        return;
    }

    throw new UnsupportedPhoenixOrderConfigError(
        `Unsupported Phoenix entry type: ${String((entry as { type?: unknown }).type)}`,
    );
}

function samePrice(a: number | string | bigint, b: number | string | bigint): boolean {
    return String(a) === String(b);
}

function validateRisk(risk: PhoenixPositionRisk | undefined): void {
    if (!risk) {
        return;
    }

    for (const leg of [risk.takeProfit, risk.stopLoss]) {
        if (!leg) {
            continue;
        }
        if (leg.type === 'limit' && leg.executionPriceUsd === undefined) {
            throw new InvalidPhoenixRiskConfigError('Phoenix limit risk legs require executionPriceUsd.');
        }
        if (leg.type !== 'market' && leg.type !== 'limit') {
            throw new InvalidPhoenixRiskConfigError(
                `Unsupported Phoenix risk leg type: ${String((leg as { type?: unknown }).type)}`,
            );
        }
    }

    if (risk.takeProfit && risk.stopLoss && samePrice(risk.takeProfit.triggerPriceUsd, risk.stopLoss.triggerPriceUsd)) {
        throw new InvalidPhoenixRiskConfigError('Phoenix take-profit and stop-loss trigger prices must differ.');
    }
}

function buildPlan(instructions: ReturnType<typeof riseInstructionToKit>[]): InstructionPlan {
    if (instructions.length === 1) {
        return singleInstructionPlan(instructions[0]);
    }

    return sequentialInstructionPlan(instructions.map(ix => singleInstructionPlan(ix)));
}

async function marketParamsFor(client: PhoenixClient, symbol: string): Promise<OrderPacketMarketParams> {
    await client.exchange.ready();
    const market = client.exchange.market(symbol);

    if (!market) {
        throw new InvalidPhoenixRiskConfigError(`Phoenix market metadata was not found for symbol: ${symbol}`);
    }

    const projected = projectExchangeMarket(market);
    return {
        tickSize: projected.units.tickSize,
        baseLotsDecimals: projected.units.baseLotsDecimals,
    };
}

function priceToTicks(priceUsd: number | string | bigint, marketParams: OrderPacketMarketParams): Ticks {
    return priceUsdToTicksWithMarketParams(priceUsd, marketParams);
}

function riskLegToTriggerOrder(
    leg: PhoenixConditionalRiskLeg,
    marketParams: OrderPacketMarketParams,
    tradeSide: Side,
    triggerDirection: Direction,
): TriggerOrderParamsInput {
    const triggerPrice = priceToTicks(leg.triggerPriceUsd, marketParams);

    if (leg.type === 'market') {
        return {
            triggerDirection,
            tradeSide,
            orderKind: StopLossOrderKind.IOC,
            triggerPrice,
            slippageBps: leg.slippageBps ?? null,
        };
    }

    return {
        triggerDirection,
        tradeSide,
        orderKind: StopLossOrderKind.Limit,
        triggerPrice,
        executionPrice: priceToTicks(leg.executionPriceUsd, marketParams),
    };
}

async function buildRiskInstruction(
    client: PhoenixClient,
    options: PhoenixOpenPositionPlanOptions,
    trader: ReturnType<typeof accountParams>,
    tradeSide: Side,
) {
    if (!options.risk || (!options.risk.takeProfit && !options.risk.stopLoss)) {
        return null;
    }

    const marketParams = await marketParamsFor(client, options.symbol);
    const takeProfit = options.risk.takeProfit
        ? riskLegToTriggerOrder(options.risk.takeProfit, marketParams, tradeSide, takeProfitDirectionFor(options.side))
        : null;
    const stopLoss = options.risk.stopLoss
        ? riskLegToTriggerOrder(options.risk.stopLoss, marketParams, tradeSide, stopLossDirectionFor(options.side))
        : null;
    const greaterTriggerOrder =
        takeProfit?.triggerDirection === Direction.GreaterThan
            ? takeProfit
            : stopLoss?.triggerDirection === Direction.GreaterThan
              ? stopLoss
              : null;
    const lessTriggerOrder =
        takeProfit?.triggerDirection === Direction.LessThan
            ? takeProfit
            : stopLoss?.triggerDirection === Direction.LessThan
              ? stopLoss
              : null;

    return client.ixs.buildPlacePositionConditionalOrder({
        ...trader,
        symbol: asSymbol(options.symbol),
        greaterTriggerOrder,
        lessTriggerOrder,
        sizeBaseLots: baseUnitsToBaseLotsWithMarketParams(options.size.baseUnits, marketParams),
    });
}

export async function getPhoenixOpenPositionPlan(
    options: PhoenixOpenPositionPlanOptions,
): Promise<PhoenixOpenPositionPlanResult> {
    assertPositiveSize(options.size);
    validateEntry(options.entry);
    validateRisk(options.risk);

    const client = options.client ?? createPhoenixActionsClient(options.clientConfig);
    const trader = accountParams(options.trader);
    const entrySide = entrySideFor(options.side);
    const closeSide = closeSideFor(options.side);
    let orderPacket: ImmediateOrCancelOrderPacket | LimitOrderPacket | PostOnlyOrderPacket;
    let entryInstruction: Parameters<typeof riseInstructionToKit>[0];

    if (options.entry.type === 'market') {
        orderPacket = await client.orderPackets.buildMarketOrderPacket({
            symbol: asSymbol(options.symbol),
            side: entrySide.riseSide,
            baseUnits: options.size.baseUnits,
            ...(options.entry.priceLimitUsd !== undefined && { priceLimitUsd: options.entry.priceLimitUsd }),
            ...(options.entry.minBaseUnitsToFill !== undefined && {
                minBaseUnitsToFill: options.entry.minBaseUnitsToFill,
            }),
            ...(options.entry.clientOrderId !== undefined && { clientOrderId: options.entry.clientOrderId }),
            ...(options.entry.lastValidSlot !== undefined && { lastValidSlot: options.entry.lastValidSlot }),
            ...(options.entry.cancelExisting !== undefined && { cancelExisting: options.entry.cancelExisting }),
        });
        entryInstruction = await client.ixs.placeMarketOrder({
            ...trader,
            symbol: asSymbol(options.symbol),
            orderPacket,
        });
    } else {
        const limitOrderPacket = await client.orderPackets.buildLimitOrderPacket({
            symbol: asSymbol(options.symbol),
            side: entrySide.riseSide,
            priceUsd: options.entry.priceUsd,
            baseUnits: options.size.baseUnits,
            ...(options.entry.clientOrderId !== undefined && { clientOrderId: options.entry.clientOrderId }),
            ...(options.entry.lastValidSlot !== undefined && { lastValidSlot: options.entry.lastValidSlot }),
            ...(options.entry.cancelExisting !== undefined && { cancelExisting: options.entry.cancelExisting }),
        });
        if (options.entry.postOnly) {
            const postOnlyOrderPacket = {
                ...limitOrderPacket,
                slide: false,
            } as PostOnlyOrderPacket;
            orderPacket = postOnlyOrderPacket;
            entryInstruction = await client.ixs.buildPlacePostOnlyOrder({
                ...trader,
                symbol: asSymbol(options.symbol),
                orderPacket: postOnlyOrderPacket,
            });
        } else {
            orderPacket = limitOrderPacket;
            entryInstruction = await client.ixs.placeLimitOrder({
                ...trader,
                symbol: asSymbol(options.symbol),
                orderPacket: limitOrderPacket,
            });
        }
    }

    const riskInstruction = await buildRiskInstruction(client, options, trader, closeSide.riseSide);
    const phoenixInstructions = riskInstruction ? [entryInstruction, riskInstruction] : [entryInstruction];
    const kitInstructions = phoenixInstructions.map(instruction => riseInstructionToKit(instruction));

    return {
        plan: buildPlan(kitInstructions),
        lookupTableAddresses: [],
        order: {
            symbol: options.symbol,
            side: options.side,
            orderSide: entrySide.orderSide,
            tradeSide: closeSide.orderSide,
            traderPdaIndex: trader.traderPdaIndex,
            traderSubaccountIndex: trader.traderSubaccountIndex,
            entryType: options.entry.type,
            postOnly: options.entry.type === 'limit' ? options.entry.postOnly === true : false,
        },
        risk: {
            takeProfit: options.risk?.takeProfit !== undefined,
            stopLoss: options.risk?.stopLoss !== undefined,
        },
        phoenix: {
            instructions: phoenixInstructions,
            orderPacket,
        },
    };
}
