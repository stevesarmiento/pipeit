/**
 * Shared internal helpers for the Phoenix plan builders.
 *
 * @packageDocumentation
 */

import type { Authority, OrderPacketMarketParams, PhoenixClient, Side, Symbol as RiseSymbol } from '@ellipsis-labs/rise';
import { Side as RiseSide } from '@ellipsis-labs/rise';
import type { Address } from '@solana/addresses';
import { createPhoenixActionsClient } from './client.js';
import type { PhoenixActionsOptions, PhoenixBaseSize, PhoenixOrderSide, PhoenixPositionSide, PhoenixTraderAccountRef } from './types.js';
import {
    InvalidPhoenixPositionSideError,
    UnknownPhoenixMarketError,
    UnsupportedPhoenixOrderConfigError,
} from './types.js';

export function asAuthority(value: Address | string): Authority {
    return String(value) as Authority;
}

export function asSymbol(value: string): RiseSymbol {
    return value as RiseSymbol;
}

export interface PhoenixAccountParams {
    authority: Authority;
    positionAuthority?: Authority;
    payer?: Authority;
    traderPdaIndex: number;
    traderSubaccountIndex: number;
}

export function accountParams(trader: PhoenixTraderAccountRef): PhoenixAccountParams {
    const params: PhoenixAccountParams = {
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

export function entrySideFor(positionSide: PhoenixPositionSide): { riseSide: Side; orderSide: PhoenixOrderSide } {
    if (positionSide === 'long') {
        return { riseSide: RiseSide.Bid, orderSide: 'bid' };
    }
    if (positionSide === 'short') {
        return { riseSide: RiseSide.Ask, orderSide: 'ask' };
    }

    throw new InvalidPhoenixPositionSideError(`Unsupported Phoenix position side: ${String(positionSide)}`);
}

export function closeSideFor(positionSide: PhoenixPositionSide): { riseSide: Side; orderSide: PhoenixOrderSide } {
    if (positionSide === 'long') {
        return { riseSide: RiseSide.Ask, orderSide: 'ask' };
    }
    if (positionSide === 'short') {
        return { riseSide: RiseSide.Bid, orderSide: 'bid' };
    }

    throw new InvalidPhoenixPositionSideError(`Unsupported Phoenix position side: ${String(positionSide)}`);
}

const DECIMAL_STRING_PATTERN = /^\d+(\.\d+)?$/;

/**
 * Validates that a user-provided size is a strictly positive decimal in any
 * of the accepted runtime representations, including strings (which the
 * previous implementation silently let through unvalidated).
 */
export function assertPositiveSize(size: PhoenixBaseSize, label: string): void {
    const value = size.baseUnits;

    if (typeof value === 'bigint') {
        if (value <= 0n) {
            throw new UnsupportedPhoenixOrderConfigError(`Phoenix ${label} size baseUnits must be greater than zero.`);
        }
        return;
    }

    if (typeof value === 'number') {
        if (!Number.isFinite(value) || value <= 0) {
            throw new UnsupportedPhoenixOrderConfigError(
                `Phoenix ${label} size baseUnits must be a finite number greater than zero.`,
            );
        }
        if (!DECIMAL_STRING_PATTERN.test(String(value))) {
            throw new UnsupportedPhoenixOrderConfigError(
                `Phoenix ${label} size baseUnits must be a plain decimal (got ${String(value)}); pass a string for very small or very large values.`,
            );
        }
        return;
    }

    if (typeof value === 'string') {
        if (!DECIMAL_STRING_PATTERN.test(value)) {
            throw new UnsupportedPhoenixOrderConfigError(
                `Phoenix ${label} size baseUnits must be a plain positive decimal string (got "${value}").`,
            );
        }
        if (Number(value) <= 0) {
            throw new UnsupportedPhoenixOrderConfigError(`Phoenix ${label} size baseUnits must be greater than zero.`);
        }
        return;
    }

    throw new UnsupportedPhoenixOrderConfigError(
        `Phoenix ${label} size baseUnits must be a number, string, or bigint.`,
    );
}

/**
 * Guards against sizes that floor to zero base lots during lot conversion
 * (e.g. `'0.0001'` on a market with 3 base-lot decimals), which would
 * otherwise fail on-chain with an opaque error.
 */
export function assertNonZeroBaseLots(numBaseLots: bigint, label: string): void {
    if (numBaseLots <= 0n) {
        throw new UnsupportedPhoenixOrderConfigError(
            `Phoenix ${label} size rounds down to zero base lots for this market; increase the size.`,
        );
    }
}

/**
 * Resolves the raw integer market parameters required by Rise's tick/lot
 * converters.
 *
 * IMPORTANT: this must use the raw `market.tickSize` (quote lots per base
 * lot), NOT the projected display tick size — the display tick is a
 * fractional USD value and produces prices up to 1000x off (or throws) when
 * fed into `priceUsdToTicksWithMarketParams`.
 */
export async function marketParamsFor(client: PhoenixClient, symbol: string): Promise<OrderPacketMarketParams> {
    await client.exchange.ready();
    const market = client.exchange.market(symbol);

    if (!market) {
        const availableSymbols = client.exchange
            .snapshot()
            .markets.map(m => m.symbol)
            .sort();
        throw new UnknownPhoenixMarketError(symbol, availableSymbols);
    }

    return {
        tickSize: market.tickSize,
        baseLotsDecimals: market.baseLotsDecimals,
    };
}

export interface ResolvedPhoenixClient {
    client: PhoenixClient;
    /** True when the client was created internally and must be disposed by the caller. */
    shouldDispose: boolean;
}

/**
 * Resolves the Rise client for a plan builder call. Internally-created
 * clients are flagged for disposal so plan builders can release their HTTP,
 * cache, and RPC resources in a `finally` block.
 */
export function resolvePhoenixClient(options: PhoenixActionsOptions): ResolvedPhoenixClient {
    if (options.client) {
        return { client: options.client, shouldDispose: false };
    }

    return { client: createPhoenixActionsClient(options.clientConfig), shouldDispose: true };
}
