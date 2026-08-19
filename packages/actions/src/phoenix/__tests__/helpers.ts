/**
 * Test helpers: a fake PhoenixClient that runs the REAL Rise packet/tick
 * math against a fabricated exchange market snapshot, so decimal and
 * tick-size bugs cannot hide behind mocks.
 */

import {
    buildLimitOrderPacketFromMarketParams,
    buildMarketOrderPacketFromMarketParams,
    type PhoenixClient,
} from '@ellipsis-labs/rise';
import { vi } from 'vitest';

export const PROGRAM_ADDRESS = '11111111111111111111111111111111';

export interface FakeMarketConfig {
    symbol?: string;
    /** Raw integer tick size in quote lots per base lot. */
    tickSize?: number;
    baseLotsDecimals?: number;
}

export function createInstruction(data: number[]) {
    return {
        programAddress: PROGRAM_ADDRESS,
        accounts: [],
        data: new Uint8Array(data),
    };
}

export function createFakePhoenixClient(config: FakeMarketConfig = {}) {
    const market = {
        symbol: config.symbol ?? 'SOL',
        assetId: 1,
        marketStatus: 'active',
        marketPubkey: PROGRAM_ADDRESS,
        splinePubkey: PROGRAM_ADDRESS,
        tickSize: config.tickSize ?? 100,
        baseLotsDecimals: config.baseLotsDecimals ?? 3,
        takerFee: 0,
        makerFee: 0,
        leverageTiers: [],
        riskFactors: {},
        fundingConfig: {},
        openInterestCapBaseLots: 0n,
        maxLiquidationSizeBaseLots: 0n,
        isolatedOnly: false,
        markPriceParameters: {},
    };
    const marketParams = { tickSize: market.tickSize, baseLotsDecimals: market.baseLotsDecimals };
    const snapshot = { markets: [market] };

    const client = {
        exchange: {
            ready: vi.fn(async () => snapshot),
            market: vi.fn((symbol: string) => (symbol === market.symbol ? market : undefined)),
            snapshot: vi.fn(() => snapshot),
        },
        orderPackets: {
            buildMarketOrderPacket: vi.fn(async ({ symbol: _symbol, ...params }: Record<string, unknown>) =>
                buildMarketOrderPacketFromMarketParams(params as never, marketParams),
            ),
            buildLimitOrderPacket: vi.fn(async ({ symbol: _symbol, ...params }: Record<string, unknown>) =>
                buildLimitOrderPacketFromMarketParams(params as never, marketParams),
            ),
        },
        ixs: {
            placeMarketOrder: vi.fn(async () => createInstruction([1])),
            placeLimitOrder: vi.fn(async () => createInstruction([2])),
            buildPlacePostOnlyOrder: vi.fn(async () => createInstruction([3])),
            buildPlacePositionConditionalOrder: vi.fn(async () => createInstruction([4])),
            buildPlaceLimitOrderWithConditionals: vi.fn(async () => createInstruction([5])),
            buildCancelAll: vi.fn(async () => createInstruction([6])),
            buildCancelOrdersById: vi.fn(async () => createInstruction([7])),
        },
        dispose: vi.fn(),
    };

    return { client, asClient: client as unknown as PhoenixClient, market, marketParams };
}
