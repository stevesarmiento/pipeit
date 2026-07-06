/**
 * Tests for Phoenix cancel-order plans.
 */

import { describe, expect, it } from 'vitest';
import { getPhoenixCancelAllOrdersPlan, getPhoenixCancelOrdersByIdPlan } from '../plan-cancel.js';
import { createFakePhoenixClient } from './helpers.js';

const TRADER = { authority: 'authority' } as const;

describe('getPhoenixCancelAllOrdersPlan', () => {
    it('builds a cancel-all instruction for the trader and market', async () => {
        const { client, asClient } = createFakePhoenixClient();

        const result = await getPhoenixCancelAllOrdersPlan({ client: asClient, trader: TRADER, symbol: 'SOL' });

        expect(client.ixs.buildCancelAll).toHaveBeenCalledWith(
            expect.objectContaining({ authority: 'authority', symbol: 'SOL', traderPdaIndex: 0 }),
        );
        expect(result.order.cancelAll).toBe(true);
        expect(result.order.orderCount).toBeNull();
        expect(result.plan.kind).toBe('single');
    });

    it('does not dispose injected clients', async () => {
        const { client, asClient } = createFakePhoenixClient();

        await getPhoenixCancelAllOrdersPlan({ client: asClient, trader: TRADER, symbol: 'SOL' });

        expect(client.dispose).not.toHaveBeenCalled();
    });
});

describe('getPhoenixCancelOrdersByIdPlan', () => {
    it('forwards exact priceInTicks order refs (preferred over the deprecated float price)', async () => {
        const { client, asClient } = createFakePhoenixClient();

        const result = await getPhoenixCancelOrdersByIdPlan({
            client: asClient,
            trader: TRADER,
            symbol: 'SOL',
            orders: [
                { priceInTicks: 650n, orderSequenceNumber: '42' },
                { priceInTicks: '700', orderSequenceNumber: 43n },
            ],
        });

        expect(client.ixs.buildCancelOrdersById).toHaveBeenCalledWith(
            expect.objectContaining({
                orders: [
                    { priceInTicks: 650n, orderSequenceNumber: '42' },
                    { priceInTicks: '700', orderSequenceNumber: 43n },
                ],
            }),
        );
        expect(result.order.cancelAll).toBe(false);
        expect(result.order.orderCount).toBe(2);
    });

    it('still supports the deprecated float price path', async () => {
        const { client, asClient } = createFakePhoenixClient();

        await getPhoenixCancelOrdersByIdPlan({
            client: asClient,
            trader: TRADER,
            symbol: 'SOL',
            orders: [{ price: 65.13, orderSequenceNumber: 7 }],
        });

        expect(client.ixs.buildCancelOrdersById).toHaveBeenCalledWith(
            expect.objectContaining({ orders: [{ price: 65.13, orderSequenceNumber: 7 }] }),
        );
    });
});
