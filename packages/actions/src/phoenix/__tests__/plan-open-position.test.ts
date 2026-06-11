/**
 * Tests for Phoenix open-position plans.
 */

import { Direction, Side, StopLossOrderKind, type Ticks } from '@ellipsis-labs/rise';
import { describe, expect, it, vi } from 'vitest';
import { getPhoenixOpenPositionPlan } from '../plan-open-position.js';
import { InvalidPhoenixRiskConfigError, UnsupportedPhoenixOrderConfigError } from '../types.js';

vi.mock('@ellipsis-labs/rise', async importOriginal => {
    const actual = await importOriginal<typeof import('@ellipsis-labs/rise')>();

    return {
        ...actual,
        projectExchangeMarket: vi.fn(() => ({
            units: {
                tickSize: 1,
                baseLotsDecimals: 2,
            },
        })),
        priceUsdToTicksWithMarketParams: vi.fn(
            (priceUsd: number | string | bigint) => BigInt(String(priceUsd).replace('.', '')) as Ticks,
        ),
        baseUnitsToBaseLotsWithMarketParams: vi.fn((baseUnits: number | string | bigint) =>
            BigInt(String(baseUnits).replace('.', '')),
        ),
    };
});

const PROGRAM_ADDRESS = '11111111111111111111111111111111';

function createInstruction(data: number[]) {
    return {
        programAddress: PROGRAM_ADDRESS,
        accounts: [],
        data: new Uint8Array(data),
    };
}

function createClient() {
    const marketPacket = { packet: 'market' };
    const limitPacket = { packet: 'limit' };

    return {
        marketPacket,
        limitPacket,
        exchange: {
            ready: vi.fn(async () => ({})),
            market: vi.fn(() => ({})),
        },
        orderPackets: {
            buildMarketOrderPacket: vi.fn(async () => marketPacket),
            buildLimitOrderPacket: vi.fn(async () => limitPacket),
        },
        ixs: {
            placeMarketOrder: vi.fn(async () => createInstruction([1])),
            placeLimitOrder: vi.fn(async () => createInstruction([2])),
            buildPlacePostOnlyOrder: vi.fn(async () => createInstruction([3])),
            buildPlacePositionConditionalOrder: vi.fn(async () => createInstruction([4])),
        },
    };
}

describe('getPhoenixOpenPositionPlan', () => {
    it('opens long positions with Side.Bid', async () => {
        const client = createClient();

        await getPhoenixOpenPositionPlan({
            client: client as never,
            trader: { authority: 'authority' },
            symbol: 'SOL-PERP',
            side: 'long',
            size: { baseUnits: '0.25' },
            entry: { type: 'market' },
        });

        expect(client.orderPackets.buildMarketOrderPacket).toHaveBeenCalledWith(
            expect.objectContaining({ side: Side.Bid }),
        );
    });

    it('opens short positions with Side.Ask', async () => {
        const client = createClient();

        await getPhoenixOpenPositionPlan({
            client: client as never,
            trader: { authority: 'authority' },
            symbol: 'SOL-PERP',
            side: 'short',
            size: { baseUnits: '0.25' },
            entry: { type: 'market' },
        });

        expect(client.orderPackets.buildMarketOrderPacket).toHaveBeenCalledWith(
            expect.objectContaining({ side: Side.Ask }),
        );
    });

    it('builds and places market entries', async () => {
        const client = createClient();

        const result = await getPhoenixOpenPositionPlan({
            client: client as never,
            trader: { authority: 'authority' },
            symbol: 'SOL-PERP',
            side: 'long',
            size: { baseUnits: '0.25' },
            entry: { type: 'market', priceLimitUsd: '155' },
        });

        expect(client.orderPackets.buildMarketOrderPacket).toHaveBeenCalledWith(
            expect.objectContaining({ baseUnits: '0.25', priceLimitUsd: '155' }),
        );
        expect(client.ixs.placeMarketOrder).toHaveBeenCalledWith(
            expect.objectContaining({ orderPacket: client.marketPacket }),
        );
        expect(result.plan.kind).toBe('single');
    });

    it('builds and places limit entries', async () => {
        const client = createClient();

        await getPhoenixOpenPositionPlan({
            client: client as never,
            trader: { authority: 'authority' },
            symbol: 'SOL-PERP',
            side: 'long',
            size: { baseUnits: '0.25' },
            entry: { type: 'limit', priceUsd: '150.50' },
        });

        expect(client.orderPackets.buildLimitOrderPacket).toHaveBeenCalledWith(
            expect.objectContaining({ priceUsd: '150.50' }),
        );
        expect(client.ixs.placeLimitOrder).toHaveBeenCalledWith(
            expect.objectContaining({ orderPacket: client.limitPacket }),
        );
    });

    it('uses buildPlacePostOnlyOrder for post-only limits', async () => {
        const client = createClient();

        const result = await getPhoenixOpenPositionPlan({
            client: client as never,
            trader: { authority: 'authority' },
            symbol: 'SOL-PERP',
            side: 'long',
            size: { baseUnits: '0.25' },
            entry: { type: 'limit', priceUsd: '150.50', postOnly: true },
        });

        expect(client.ixs.buildPlacePostOnlyOrder).toHaveBeenCalledWith(
            expect.objectContaining({ orderPacket: expect.objectContaining({ packet: 'limit', slide: false }) }),
        );
        expect(result.order.postOnly).toBe(true);
    });

    it('defaults indexes to 0', async () => {
        const client = createClient();

        await getPhoenixOpenPositionPlan({
            client: client as never,
            trader: { authority: 'authority' },
            symbol: 'SOL-PERP',
            side: 'long',
            size: { baseUnits: '0.25' },
            entry: { type: 'market' },
        });

        expect(client.ixs.placeMarketOrder).toHaveBeenCalledWith(
            expect.objectContaining({ traderPdaIndex: 0, traderSubaccountIndex: 0 }),
        );
    });

    it('passes configured indexes through', async () => {
        const client = createClient();

        const result = await getPhoenixOpenPositionPlan({
            client: client as never,
            trader: { authority: 'authority', traderPdaIndex: 7, traderSubaccountIndex: 8 },
            symbol: 'SOL-PERP',
            side: 'long',
            size: { baseUnits: '0.25' },
            entry: { type: 'market' },
        });

        expect(client.ixs.placeMarketOrder).toHaveBeenCalledWith(
            expect.objectContaining({ traderPdaIndex: 7, traderSubaccountIndex: 8 }),
        );
        expect(result.order.traderPdaIndex).toBe(7);
        expect(result.order.traderSubaccountIndex).toBe(8);
    });

    it('returns entry plus conditional instruction when stop-loss is set', async () => {
        const client = createClient();

        const result = await getPhoenixOpenPositionPlan({
            client: client as never,
            trader: { authority: 'authority' },
            symbol: 'SOL-PERP',
            side: 'long',
            size: { baseUnits: '0.25' },
            entry: { type: 'market' },
            risk: {
                stopLoss: { type: 'market', triggerPriceUsd: '142.00', slippageBps: 1000 },
            },
        });

        expect(result.plan.kind).toBe('sequential');
        expect(client.ixs.buildPlacePositionConditionalOrder).toHaveBeenCalledOnce();
        expect(result.risk.stopLoss).toBe(true);
    });

    it('maps long TP greater-than and long SL less-than', async () => {
        const client = createClient();

        await getPhoenixOpenPositionPlan({
            client: client as never,
            trader: { authority: 'authority' },
            symbol: 'SOL-PERP',
            side: 'long',
            size: { baseUnits: '0.25' },
            entry: { type: 'market' },
            risk: {
                takeProfit: { type: 'limit', triggerPriceUsd: '165.00', executionPriceUsd: '164.75' },
                stopLoss: { type: 'market', triggerPriceUsd: '142.00', slippageBps: 1000 },
            },
        });

        expect(client.ixs.buildPlacePositionConditionalOrder).toHaveBeenCalledWith(
            expect.objectContaining({
                greaterTriggerOrder: expect.objectContaining({
                    triggerDirection: Direction.GreaterThan,
                    tradeSide: Side.Ask,
                    orderKind: StopLossOrderKind.Limit,
                }),
                lessTriggerOrder: expect.objectContaining({
                    triggerDirection: Direction.LessThan,
                    tradeSide: Side.Ask,
                    orderKind: StopLossOrderKind.IOC,
                    slippageBps: 1000,
                }),
            }),
        );
    });

    it('maps short TP less-than and short SL greater-than', async () => {
        const client = createClient();

        await getPhoenixOpenPositionPlan({
            client: client as never,
            trader: { authority: 'authority' },
            symbol: 'SOL-PERP',
            side: 'short',
            size: { baseUnits: '0.25' },
            entry: { type: 'market' },
            risk: {
                takeProfit: { type: 'market', triggerPriceUsd: '140.00' },
                stopLoss: { type: 'limit', triggerPriceUsd: '166.00', executionPriceUsd: '166.25' },
            },
        });

        expect(client.ixs.buildPlacePositionConditionalOrder).toHaveBeenCalledWith(
            expect.objectContaining({
                greaterTriggerOrder: expect.objectContaining({
                    triggerDirection: Direction.GreaterThan,
                    tradeSide: Side.Bid,
                    orderKind: StopLossOrderKind.Limit,
                }),
                lessTriggerOrder: expect.objectContaining({
                    triggerDirection: Direction.LessThan,
                    tradeSide: Side.Bid,
                    orderKind: StopLossOrderKind.IOC,
                }),
            }),
        );
    });

    it('rejects malformed risk configs', async () => {
        await expect(
            getPhoenixOpenPositionPlan({
                client: createClient() as never,
                trader: { authority: 'authority' },
                symbol: 'SOL-PERP',
                side: 'long',
                size: { baseUnits: '0.25' },
                entry: { type: 'market' },
                risk: {
                    takeProfit: { type: 'market', triggerPriceUsd: '150' },
                    stopLoss: { type: 'market', triggerPriceUsd: '150' },
                },
            }),
        ).rejects.toThrow(InvalidPhoenixRiskConfigError);
    });

    it('rejects zero or negative base size', async () => {
        await expect(
            getPhoenixOpenPositionPlan({
                client: createClient() as never,
                trader: { authority: 'authority' },
                symbol: 'SOL-PERP',
                side: 'long',
                size: { baseUnits: -1 },
                entry: { type: 'market' },
            }),
        ).rejects.toThrow(UnsupportedPhoenixOrderConfigError);
    });
});
