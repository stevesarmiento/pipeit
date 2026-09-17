/**
 * Tests for Phoenix close-position plans.
 */

import { OrderFlags, Side } from '@ellipsis-labs/rise';
import { describe, expect, it } from 'vitest';
import { getPhoenixClosePositionPlan } from '../plan-close-position.js';
import { UnsupportedPhoenixOrderConfigError } from '../types.js';
import { createFakePhoenixClient } from './helpers.js';

const BASE_OPTIONS = {
    trader: { authority: 'authority' },
    symbol: 'SOL',
    side: 'long',
    size: { baseUnits: '1.5' },
} as const;

describe('getPhoenixClosePositionPlan', () => {
    it('closes longs with Side.Ask and shorts with Side.Bid', async () => {
        for (const [side, expected] of [
            ['long', Side.Ask],
            ['short', Side.Bid],
        ] as const) {
            const { client, asClient } = createFakePhoenixClient();
            await getPhoenixClosePositionPlan({ ...BASE_OPTIONS, client: asClient, side });
            const packet = client.ixs.placeMarketOrder.mock.calls[0][0].orderPacket;
            expect(packet.side).toBe(expected);
        }
    });

    it('sets OrderFlags.ReduceOnly by default so a close can never flip the position', async () => {
        const { client, asClient } = createFakePhoenixClient();

        const result = await getPhoenixClosePositionPlan({ ...BASE_OPTIONS, client: asClient });

        const packet = client.ixs.placeMarketOrder.mock.calls[0][0].orderPacket;
        expect(packet.orderFlags & OrderFlags.ReduceOnly).toBe(OrderFlags.ReduceOnly);
        expect(result.order.reduceOnly).toBe(true);
    });

    it('allows opting out with reduceOnly: false', async () => {
        const { client, asClient } = createFakePhoenixClient();

        const result = await getPhoenixClosePositionPlan({ ...BASE_OPTIONS, client: asClient, reduceOnly: false });

        const packet = client.ixs.placeMarketOrder.mock.calls[0][0].orderPacket;
        expect(packet.orderFlags & OrderFlags.ReduceOnly).toBe(0);
        expect(result.order.reduceOnly).toBe(false);
    });

    it('merges caller order flags with the reduce-only flag', async () => {
        const { client, asClient } = createFakePhoenixClient();

        await getPhoenixClosePositionPlan({
            ...BASE_OPTIONS,
            client: asClient,
            orderFlags: OrderFlags.IsConditionalOrder,
        });

        const packet = client.ixs.placeMarketOrder.mock.calls[0][0].orderPacket;
        expect(packet.orderFlags & OrderFlags.ReduceOnly).toBe(OrderFlags.ReduceOnly);
        expect(packet.orderFlags & OrderFlags.IsConditionalOrder).toBe(OrderFlags.IsConditionalOrder);
    });

    it('converts size and price limit through the real market math', async () => {
        const { client, asClient } = createFakePhoenixClient({ tickSize: 100, baseLotsDecimals: 3 });

        await getPhoenixClosePositionPlan({ ...BASE_OPTIONS, client: asClient, priceLimitUsd: '60' });

        const packet = client.ixs.placeMarketOrder.mock.calls[0][0].orderPacket;
        expect(packet.numBaseLots).toBe(1500n);
        expect(packet.priceInTicks).toBe(600n);
    });

    it('rejects sizes that round down to zero base lots', async () => {
        const { asClient } = createFakePhoenixClient({ baseLotsDecimals: 3 });

        await expect(
            getPhoenixClosePositionPlan({ ...BASE_OPTIONS, client: asClient, size: { baseUnits: '0.0001' } }),
        ).rejects.toThrow(UnsupportedPhoenixOrderConfigError);
    });

    it('rejects invalid string sizes', async () => {
        for (const baseUnits of ['0', '-2', '2e3'] as const) {
            await expect(
                getPhoenixClosePositionPlan({
                    ...BASE_OPTIONS,
                    client: createFakePhoenixClient().asClient,
                    size: { baseUnits },
                }),
            ).rejects.toThrow(UnsupportedPhoenixOrderConfigError);
        }
    });

    it('returns a single-instruction plan and does not dispose injected clients', async () => {
        const { client, asClient } = createFakePhoenixClient();

        const result = await getPhoenixClosePositionPlan({ ...BASE_OPTIONS, client: asClient });

        expect(result.plan.kind).toBe('single');
        expect(client.dispose).not.toHaveBeenCalled();
    });
});
