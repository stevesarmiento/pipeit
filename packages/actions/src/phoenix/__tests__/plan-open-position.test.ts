/**
 * Tests for Phoenix open-position plans.
 *
 * All tick/lot math runs through the REAL Rise conversion functions (via
 * the fake client in helpers.ts) so tick-size regressions surface as exact
 * value mismatches instead of hiding behind mocks.
 */

import { Direction, OrderFlags, Side, StopLossOrderKind } from '@ellipsis-labs/rise';
import { describe, expect, it } from 'vitest';
import { getPhoenixOpenPositionPlan } from '../plan-open-position.js';
import {
    InvalidPhoenixRiskConfigError,
    UnknownPhoenixMarketError,
    UnsupportedPhoenixOrderConfigError,
} from '../types.js';
import { createFakePhoenixClient } from './helpers.js';

const BASE_OPTIONS = {
    trader: { authority: 'authority' },
    symbol: 'SOL',
    side: 'long',
    size: { baseUnits: '1.5' },
} as const;

describe('getPhoenixOpenPositionPlan', () => {
    it('opens long positions with Side.Bid and short with Side.Ask', async () => {
        for (const [side, expected] of [
            ['long', Side.Bid],
            ['short', Side.Ask],
        ] as const) {
            const { client, asClient } = createFakePhoenixClient();
            await getPhoenixOpenPositionPlan({
                ...BASE_OPTIONS,
                client: asClient,
                side,
                entry: { type: 'market' },
            });
            expect(client.ixs.placeMarketOrder).toHaveBeenCalledWith(
                expect.objectContaining({ orderPacket: expect.objectContaining({ side: expected }) }),
            );
        }
    });

    it('converts base units to exact base lots through the real lot math', async () => {
        const { client, asClient } = createFakePhoenixClient({ baseLotsDecimals: 3 });

        await getPhoenixOpenPositionPlan({
            ...BASE_OPTIONS,
            client: asClient,
            entry: { type: 'market' },
        });

        const packet = client.ixs.placeMarketOrder.mock.calls[0][0].orderPacket;
        expect(packet.numBaseLots).toBe(1500n);
    });

    it('converts limit prices to exact ticks through the real tick math', async () => {
        const { client, asClient } = createFakePhoenixClient({ tickSize: 100, baseLotsDecimals: 3 });

        const result = await getPhoenixOpenPositionPlan({
            ...BASE_OPTIONS,
            client: asClient,
            entry: { type: 'limit', priceUsd: '65.13' },
        });

        const packet = client.ixs.placeLimitOrder.mock.calls[0][0].orderPacket;
        expect(packet.priceInTicks).toBe(651n);
        expect(result.plan.kind).toBe('single');
    });

    it('rejects sizes that round down to zero base lots', async () => {
        const { asClient } = createFakePhoenixClient({ baseLotsDecimals: 3 });

        await expect(
            getPhoenixOpenPositionPlan({
                ...BASE_OPTIONS,
                client: asClient,
                size: { baseUnits: '0.0001' },
                entry: { type: 'market' },
            }),
        ).rejects.toThrow(UnsupportedPhoenixOrderConfigError);
    });

    describe('risk trigger conversion (tick-size regression)', () => {
        it('converts trigger prices with the RAW market tick size, not the display tick', async () => {
            // tickSize=100, baseLotsDecimals=3 → display tick would be a
            // fractional 0.1 (the old bug threw); the raw path must produce
            // exactly priceUsd * 10^3 / 100 ticks.
            const { client, asClient } = createFakePhoenixClient({ tickSize: 100, baseLotsDecimals: 3 });

            await getPhoenixOpenPositionPlan({
                ...BASE_OPTIONS,
                client: asClient,
                entry: { type: 'market' },
                risk: {
                    takeProfit: { type: 'market', triggerPriceUsd: '80' },
                    stopLoss: { type: 'market', triggerPriceUsd: '60' },
                },
            });

            const call = client.ixs.buildPlacePositionConditionalOrder.mock.calls[0][0];
            expect(call.greaterTriggerOrder.triggerPrice).toBe(800n);
            expect(call.lessTriggerOrder.triggerPrice).toBe(600n);
        });

        it('is not 1000x off on markets whose display tick is an integer', async () => {
            // tickSize=1000 → display tick is exactly 1, so the old display-
            // tick path would NOT throw but would return 65,000,000 ticks
            // instead of 65,000 — a silent 1000x error that immediately
            // trips a long's stop.
            const { client, asClient } = createFakePhoenixClient({ tickSize: 1000, baseLotsDecimals: 3 });

            await getPhoenixOpenPositionPlan({
                ...BASE_OPTIONS,
                client: asClient,
                entry: { type: 'market' },
                risk: { stopLoss: { type: 'market', triggerPriceUsd: 65_000 } },
            });

            const call = client.ixs.buildPlacePositionConditionalOrder.mock.calls[0][0];
            expect(call.lessTriggerOrder.triggerPrice).toBe(65_000n);
        });
    });

    describe('market entry risk (position-level conditionals)', () => {
        it('places a position conditional sized at 100 percent of the live position', async () => {
            const { client, asClient } = createFakePhoenixClient();

            const result = await getPhoenixOpenPositionPlan({
                ...BASE_OPTIONS,
                client: asClient,
                entry: { type: 'market' },
                risk: {
                    takeProfit: { type: 'limit', triggerPriceUsd: '80', executionPriceUsd: '80.5' },
                    stopLoss: { type: 'market', triggerPriceUsd: '60', slippageBps: 500 },
                },
            });

            const call = client.ixs.buildPlacePositionConditionalOrder.mock.calls[0][0];
            expect(call.sizePercent).toBe(100);
            expect(call.sizeBaseLots).toBeUndefined();
            expect(call.greaterTriggerOrder).toEqual(
                expect.objectContaining({
                    triggerDirection: Direction.GreaterThan,
                    tradeSide: Side.Ask,
                    orderKind: StopLossOrderKind.Limit,
                }),
            );
            expect(call.lessTriggerOrder).toEqual(
                expect.objectContaining({
                    triggerDirection: Direction.LessThan,
                    tradeSide: Side.Ask,
                    orderKind: StopLossOrderKind.IOC,
                    slippageBps: 500,
                }),
            );
            expect(result.risk.mode).toBe('position');
        });

        it('combines entry and conditional in a NON-DIVISIBLE sequential plan', async () => {
            const { asClient } = createFakePhoenixClient();

            const result = await getPhoenixOpenPositionPlan({
                ...BASE_OPTIONS,
                client: asClient,
                entry: { type: 'market' },
                risk: { stopLoss: { type: 'market', triggerPriceUsd: '60' } },
            });

            expect(result.plan.kind).toBe('sequential');
            expect((result.plan as { divisible?: boolean }).divisible).toBe(false);
        });
    });

    describe('limit entry risk (attached conditionals)', () => {
        it('bundles TP/SL with the limit order so they activate on fill', async () => {
            const { client, asClient } = createFakePhoenixClient();

            const result = await getPhoenixOpenPositionPlan({
                ...BASE_OPTIONS,
                client: asClient,
                entry: { type: 'limit', priceUsd: '70' },
                risk: {
                    takeProfit: { type: 'market', triggerPriceUsd: '80' },
                    stopLoss: { type: 'market', triggerPriceUsd: '60' },
                },
            });

            expect(client.ixs.buildPlaceLimitOrderWithConditionals).toHaveBeenCalledOnce();
            expect(client.ixs.placeLimitOrder).not.toHaveBeenCalled();
            expect(client.ixs.buildPlacePositionConditionalOrder).not.toHaveBeenCalled();

            const call = client.ixs.buildPlaceLimitOrderWithConditionals.mock.calls[0][0];
            expect(call.orderPacket.__kind).toBe('Limit');
            expect(call.orderPacket.priceInTicks).toBe(700n);
            expect(call.greaterTriggerOrder.triggerPrice).toBe(800n);
            expect(call.lessTriggerOrder.triggerPrice).toBe(600n);
            expect(result.risk.mode).toBe('attached');
            expect(result.plan.kind).toBe('single');
        });

        it('uses a PostOnly conditional packet for post-only entries', async () => {
            const { client, asClient } = createFakePhoenixClient();

            await getPhoenixOpenPositionPlan({
                ...BASE_OPTIONS,
                client: asClient,
                entry: { type: 'limit', priceUsd: '70', postOnly: true },
                risk: { stopLoss: { type: 'market', triggerPriceUsd: '60' } },
            });

            const call = client.ixs.buildPlaceLimitOrderWithConditionals.mock.calls[0][0];
            expect(call.orderPacket.__kind).toBe('PostOnly');
            expect(call.orderPacket.slide).toBe(false);
        });
    });

    describe('post-only packets', () => {
        it('builds a structurally correct PostOnlyOrderPacket (no limit-only fields)', async () => {
            const { client, asClient } = createFakePhoenixClient();

            const result = await getPhoenixOpenPositionPlan({
                ...BASE_OPTIONS,
                client: asClient,
                entry: { type: 'limit', priceUsd: '65.13', postOnly: true },
            });

            const packet = client.ixs.buildPlacePostOnlyOrder.mock.calls[0][0].orderPacket;
            expect(Object.keys(packet).sort()).toEqual([
                'cancelExisting',
                'clientOrderId',
                'lastValidSlot',
                'numBaseLots',
                'orderFlags',
                'priceInTicks',
                'side',
                'slide',
            ]);
            expect(packet.slide).toBe(false);
            expect(packet.priceInTicks).toBe(651n);
            expect(result.order.postOnly).toBe(true);
        });

        it('passes slide through', async () => {
            const { client, asClient } = createFakePhoenixClient();

            await getPhoenixOpenPositionPlan({
                ...BASE_OPTIONS,
                client: asClient,
                entry: { type: 'limit', priceUsd: '65', postOnly: true, slide: true },
            });

            expect(client.ixs.buildPlacePostOnlyOrder.mock.calls[0][0].orderPacket.slide).toBe(true);
        });
    });

    describe('validation', () => {
        it('rejects equal TP/SL triggers after tick conversion', async () => {
            const { asClient } = createFakePhoenixClient();

            await expect(
                getPhoenixOpenPositionPlan({
                    ...BASE_OPTIONS,
                    client: asClient,
                    entry: { type: 'market' },
                    risk: {
                        takeProfit: { type: 'market', triggerPriceUsd: '150' },
                        stopLoss: { type: 'market', triggerPriceUsd: '150.0' },
                    },
                }),
            ).rejects.toThrow(InvalidPhoenixRiskConfigError);
        });

        it('rejects a long TP below the SL', async () => {
            const { asClient } = createFakePhoenixClient();

            await expect(
                getPhoenixOpenPositionPlan({
                    ...BASE_OPTIONS,
                    client: asClient,
                    entry: { type: 'market' },
                    risk: {
                        takeProfit: { type: 'market', triggerPriceUsd: '60' },
                        stopLoss: { type: 'market', triggerPriceUsd: '80' },
                    },
                }),
            ).rejects.toThrow(InvalidPhoenixRiskConfigError);
        });

        it('rejects risk triggers on the wrong side of a limit entry', async () => {
            const { asClient } = createFakePhoenixClient();

            await expect(
                getPhoenixOpenPositionPlan({
                    ...BASE_OPTIONS,
                    client: asClient,
                    entry: { type: 'limit', priceUsd: '70' },
                    risk: { takeProfit: { type: 'market', triggerPriceUsd: '65' } },
                }),
            ).rejects.toThrow(InvalidPhoenixRiskConfigError);
        });

        it('rejects a long stop-loss limit whose execution price is above its trigger', async () => {
            const { asClient } = createFakePhoenixClient();

            await expect(
                getPhoenixOpenPositionPlan({
                    ...BASE_OPTIONS,
                    client: asClient,
                    entry: { type: 'market' },
                    risk: { stopLoss: { type: 'limit', triggerPriceUsd: '60', executionPriceUsd: '61' } },
                }),
            ).rejects.toThrow(InvalidPhoenixRiskConfigError);
        });

        it('rejects zero, negative, and malformed string sizes', async () => {
            for (const baseUnits of ['0', '0.000', '-1', '1e-7', 'abc', -1, 0] as const) {
                await expect(
                    getPhoenixOpenPositionPlan({
                        ...BASE_OPTIONS,
                        client: createFakePhoenixClient().asClient,
                        size: { baseUnits },
                        entry: { type: 'market' },
                    }),
                ).rejects.toThrow(UnsupportedPhoenixOrderConfigError);
            }
        });

        it('throws UnknownPhoenixMarketError with available symbols for unknown markets', async () => {
            const { asClient } = createFakePhoenixClient({ symbol: 'ETH' });

            const promise = getPhoenixOpenPositionPlan({
                ...BASE_OPTIONS,
                client: asClient,
                symbol: 'DOGE',
                entry: { type: 'market' },
                risk: { stopLoss: { type: 'market', triggerPriceUsd: '60' } },
            });

            await expect(promise).rejects.toThrow(UnknownPhoenixMarketError);
            await expect(promise).rejects.toThrow(/ETH/);
        });
    });

    it('passes trader indexes through and defaults them to 0', async () => {
        const { client, asClient } = createFakePhoenixClient();

        const result = await getPhoenixOpenPositionPlan({
            ...BASE_OPTIONS,
            client: asClient,
            trader: { authority: 'authority', traderPdaIndex: 7, traderSubaccountIndex: 8 },
            entry: { type: 'market' },
        });

        expect(client.ixs.placeMarketOrder).toHaveBeenCalledWith(
            expect.objectContaining({ traderPdaIndex: 7, traderSubaccountIndex: 8 }),
        );
        expect(result.order.traderPdaIndex).toBe(7);
        expect(result.order.traderSubaccountIndex).toBe(8);
    });

    it('merges caller order flags into the entry packet', async () => {
        const { client, asClient } = createFakePhoenixClient();

        await getPhoenixOpenPositionPlan({
            ...BASE_OPTIONS,
            client: asClient,
            entry: { type: 'market', orderFlags: OrderFlags.ReduceOnly },
        });

        const packet = client.ixs.placeMarketOrder.mock.calls[0][0].orderPacket;
        expect(packet.orderFlags & OrderFlags.ReduceOnly).toBe(OrderFlags.ReduceOnly);
    });

    it('does not dispose injected clients', async () => {
        const { client, asClient } = createFakePhoenixClient();

        await getPhoenixOpenPositionPlan({
            ...BASE_OPTIONS,
            client: asClient,
            entry: { type: 'market' },
        });

        expect(client.dispose).not.toHaveBeenCalled();
    });
});
