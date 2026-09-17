/**
 * Shared Phoenix action types.
 *
 * @packageDocumentation
 */

import type { Address } from '@solana/addresses';
import type { AccountRole } from '@solana/instructions';
import type { InstructionPlan } from '@solana/instruction-plans';
import type {
    ConditionalOrderPacket,
    ImmediateOrCancelOrderPacket,
    LimitOrderPacket,
    PhoenixClient,
    PhoenixClientConfig,
    PostOnlyOrderPacket,
} from '@ellipsis-labs/rise';

export type PhoenixMarketSymbol = string;

export type PhoenixPositionSide = 'long' | 'short';

export type PhoenixOrderSide = 'bid' | 'ask';

/**
 * Minimal structural shape of a Rise instruction accepted by
 * {@link riseInstructionToKit}.
 */
export interface RiseInstructionLike {
    programAddress?: string | Address;
    accounts?: readonly {
        address?: string | Address;
        role: AccountRole | number;
    }[];
    data?: ArrayLike<number>;
}

/**
 * Union of every Rise order packet a plan builder can produce.
 */
export type PhoenixOrderPacket =
    | ImmediateOrCancelOrderPacket
    | LimitOrderPacket
    | PostOnlyOrderPacket
    | ConditionalOrderPacket;

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
    /**
     * Raw Rise {@link OrderFlags} bitmask merged into the entry packet.
     * Combined flag values (e.g. `ReduceOnly | IsConditionalOrder`) are
     * expressed as plain numbers.
     */
    orderFlags?: number;
}

export interface PhoenixLimitEntry {
    type: 'limit';
    priceUsd: number | string | bigint;
    postOnly?: boolean;
    /**
     * Only meaningful with `postOnly: true`: slide the order to the top of
     * the book instead of rejecting when it would cross. Defaults to `false`
     * (crossing post-only orders are rejected on-chain with PostOnlyCross).
     */
    slide?: boolean;
    clientOrderId?: bigint;
    lastValidSlot?: bigint | null;
    cancelExisting?: boolean;
    /** Raw Rise {@link OrderFlags} bitmask merged into the entry packet. */
    orderFlags?: number;
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

/**
 * How risk legs were attached to the plan:
 * - `attached`: TP/SL are bundled with the limit entry and only activate once
 *   the entry order fills.
 * - `position`: TP/SL are position-level conditionals, live immediately.
 */
export type PhoenixRiskMode = 'attached' | 'position';

export interface PhoenixActionsOptions {
    /**
     * Reusable Rise client. Prefer creating one with
     * {@link createPhoenixActionsClient} and sharing it across calls; when
     * omitted, a throwaway client is created and disposed per call, which
     * re-fetches exchange metadata every time.
     */
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
        mode: PhoenixRiskMode | null;
    };
    phoenix: {
        instructions: RiseInstructionLike[];
        orderPacket: PhoenixOrderPacket;
    };
}

export interface PhoenixClosePositionPlanOptions extends PhoenixActionsOptions {
    trader: PhoenixTraderAccountRef;
    symbol: PhoenixMarketSymbol;
    side: PhoenixPositionSide;
    size: PhoenixBaseSize;
    /**
     * Most aggressive fill price. Strongly recommended: without it the close
     * is an unbounded market order.
     */
    priceLimitUsd?: number | string | bigint | null;
    cancelExisting?: boolean;
    /**
     * When `true` (the default) the close order carries
     * `OrderFlags.ReduceOnly`, so it can only reduce the existing position
     * and can never flip you into the opposite side if the requested size
     * exceeds the live position.
     */
    reduceOnly?: boolean;
    /** Raw Rise {@link OrderFlags} bitmask merged into the close packet. */
    orderFlags?: number;
}

export interface PhoenixClosePositionPlanResult {
    plan: InstructionPlan;
    lookupTableAddresses: Address[];
    order: PhoenixPlanMetadata & {
        entryType: 'market';
        reduceOnly: boolean;
    };
    phoenix: {
        instructions: RiseInstructionLike[];
        orderPacket: PhoenixOrderPacket;
    };
}

export interface PhoenixCancelAllOrdersPlanOptions extends PhoenixActionsOptions {
    trader: PhoenixTraderAccountRef;
    symbol: PhoenixMarketSymbol;
}

/**
 * Reference to a resting order to cancel. Prefer `priceInTicks` (exact):
 * the float `price` path floor-converts USD to ticks and can silently target
 * a nonexistent order id when the USD value was round-tripped from ticks.
 */
export type PhoenixCancelOrderRef =
    | {
          priceInTicks: bigint | number | string;
          price?: never;
          orderSequenceNumber: string | number | bigint;
      }
    | {
          /** @deprecated Prefer `priceInTicks` when cancelling an order from trader state. */
          price: number | bigint;
          priceInTicks?: never;
          orderSequenceNumber: string | number | bigint;
      };

export interface PhoenixCancelOrdersByIdPlanOptions extends PhoenixActionsOptions {
    trader: PhoenixTraderAccountRef;
    symbol: PhoenixMarketSymbol;
    orders: PhoenixCancelOrderRef[];
}

export interface PhoenixCancelOrdersPlanResult {
    plan: InstructionPlan;
    lookupTableAddresses: Address[];
    order: Pick<PhoenixPlanMetadata, 'symbol' | 'traderPdaIndex' | 'traderSubaccountIndex'> & {
        cancelAll: boolean;
        orderCount: number | null;
    };
    phoenix: {
        instructions: RiseInstructionLike[];
    };
}

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

export class UnknownPhoenixMarketError extends PhoenixPlanError {
    readonly symbol: string;
    readonly availableSymbols: string[];

    constructor(symbol: string, availableSymbols: string[]) {
        super(
            `Phoenix market metadata was not found for symbol: ${symbol}. ` +
                `Available markets: ${availableSymbols.length > 0 ? availableSymbols.join(', ') : '(none loaded)'}`,
        );
        this.symbol = symbol;
        this.availableSymbols = availableSymbols;
    }
}
