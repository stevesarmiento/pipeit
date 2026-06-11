/**
 * Shared Phoenix action types.
 *
 * @packageDocumentation
 */

import type { Address } from '@solana/addresses';
import type { InstructionPlan } from '@solana/instruction-plans';
import type { Direction, PhoenixClient, PhoenixClientConfig, Side, StopLossOrderKind } from '@ellipsis-labs/rise';

export type PhoenixMarketSymbol = string;

export type PhoenixPositionSide = 'long' | 'short';

export type PhoenixOrderSide = 'bid' | 'ask';

export interface PhoenixTraderAccountRef {
    authority: Address | string;
    positionAuthority?: Address | string;
    payer?: Address | string;
    traderPdaIndex?: number;
    traderSubaccountIndex?: number;
}

export interface PhoenixBaseSize {
    baseUnits: number | string | bigint;
}

export interface PhoenixMarketEntry {
    type: 'market';
    priceLimitUsd?: number | string | bigint | null;
    minBaseUnitsToFill?: number | string | bigint;
    clientOrderId?: bigint;
    lastValidSlot?: bigint | null;
    cancelExisting?: boolean;
}

export interface PhoenixLimitEntry {
    type: 'limit';
    priceUsd: number | string | bigint;
    postOnly?: boolean;
    clientOrderId?: bigint;
    lastValidSlot?: bigint | null;
    cancelExisting?: boolean;
}

export type PhoenixOpenPositionEntry = PhoenixMarketEntry | PhoenixLimitEntry;

export interface PhoenixConditionalMarketRiskLeg {
    type: 'market';
    triggerPriceUsd: number | string | bigint;
    slippageBps?: number | null;
}

export interface PhoenixConditionalLimitRiskLeg {
    type: 'limit';
    triggerPriceUsd: number | string | bigint;
    executionPriceUsd: number | string | bigint;
}

export type PhoenixConditionalRiskLeg = PhoenixConditionalMarketRiskLeg | PhoenixConditionalLimitRiskLeg;

export interface PhoenixPositionRisk {
    takeProfit?: PhoenixConditionalRiskLeg;
    stopLoss?: PhoenixConditionalRiskLeg;
}

export interface PhoenixActionsOptions {
    client?: PhoenixClient;
    clientConfig?: PhoenixClientConfig;
}

export interface PhoenixPlanMetadata {
    symbol: PhoenixMarketSymbol;
    side: PhoenixPositionSide;
    orderSide: PhoenixOrderSide;
    tradeSide: PhoenixOrderSide;
    traderPdaIndex: number;
    traderSubaccountIndex: number;
}

export interface PhoenixOpenPositionPlanOptions extends PhoenixActionsOptions {
    trader: PhoenixTraderAccountRef;
    symbol: PhoenixMarketSymbol;
    side: PhoenixPositionSide;
    size: PhoenixBaseSize;
    entry: PhoenixOpenPositionEntry;
    risk?: PhoenixPositionRisk;
}

export interface PhoenixOpenPositionPlanResult {
    plan: InstructionPlan;
    lookupTableAddresses: Address[];
    order: PhoenixPlanMetadata & {
        entryType: PhoenixOpenPositionEntry['type'];
        postOnly: boolean;
    };
    risk: {
        takeProfit: boolean;
        stopLoss: boolean;
    };
    phoenix: {
        instructions: unknown[];
        orderPacket: unknown;
    };
}

export interface PhoenixClosePositionPlanOptions extends PhoenixActionsOptions {
    trader: PhoenixTraderAccountRef;
    symbol: PhoenixMarketSymbol;
    side: PhoenixPositionSide;
    size: PhoenixBaseSize;
    priceLimitUsd?: number | string | bigint | null;
    cancelExisting?: boolean;
}

export interface PhoenixClosePositionPlanResult {
    plan: InstructionPlan;
    lookupTableAddresses: Address[];
    order: PhoenixPlanMetadata & {
        entryType: 'market';
    };
    phoenix: {
        instructions: unknown[];
        orderPacket: unknown;
    };
}

export interface PhoenixCancelAllOrdersPlanOptions extends PhoenixActionsOptions {
    trader: PhoenixTraderAccountRef;
    symbol: PhoenixMarketSymbol;
}

export interface PhoenixCancelOrdersByIdPlanOptions extends PhoenixActionsOptions {
    trader: PhoenixTraderAccountRef;
    symbol: PhoenixMarketSymbol;
    orders: Array<{
        price: number | bigint;
        orderSequenceNumber: string | number;
    }>;
}

export interface PhoenixCancelOrdersPlanResult {
    plan: InstructionPlan;
    lookupTableAddresses: Address[];
    order: Pick<PhoenixPlanMetadata, 'symbol' | 'traderPdaIndex' | 'traderSubaccountIndex'> & {
        cancelAll: boolean;
        orderCount: number | null;
    };
    phoenix: {
        instructions: unknown[];
    };
}

export type PhoenixRiseSide = Side;
export type PhoenixRiseDirection = Direction;
export type PhoenixRiseStopLossOrderKind = StopLossOrderKind;

export class PhoenixPlanError extends Error {
    constructor(message: string) {
        super(message);
        this.name = new.target.name;
    }
}

export class InvalidPhoenixPositionSideError extends PhoenixPlanError {}

export class InvalidPhoenixRiskConfigError extends PhoenixPlanError {}

export class UnsupportedPhoenixOrderConfigError extends PhoenixPlanError {}

export class InvalidPhoenixInstructionError extends PhoenixPlanError {}

export class PhoenixClientRequiredError extends PhoenixPlanError {}
