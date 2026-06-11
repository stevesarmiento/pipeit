/**
 * Tests for Phoenix cancel-order plans.
 */

import { describe, expect, it, vi } from 'vitest';
import { getPhoenixCancelAllOrdersPlan, getPhoenixCancelOrdersByIdPlan } from '../plan-cancel.js';

const PROGRAM_ADDRESS = '11111111111111111111111111111111';

function createInstruction(data: number[]) {
    return {
        programAddress: PROGRAM_ADDRESS,
        accounts: [],
        data: new Uint8Array(data),
    };
}

function createClient() {
    return {
        ixs: {
            buildCancelAll: vi.fn(async () => createInstruction([1])),
            buildCancelOrdersById: vi.fn(async () => createInstruction([2])),
        },
    };
}

describe('getPhoenixCancelAllOrdersPlan', () => {
    it('calls buildCancelAll with authority, symbol, and default indexes', async () => {
        const client = createClient();

        const result = await getPhoenixCancelAllOrdersPlan({
            client: client as never,
            trader: { authority: 'authority' },
            symbol: 'SOL-PERP',
        });

        expect(client.ixs.buildCancelAll).toHaveBeenCalledWith({
            authority: 'authority',
            symbol: 'SOL-PERP',
            traderPdaIndex: 0,
            traderSubaccountIndex: 0,
        });
        expect(result.plan.kind).toBe('single');
        expect(result.lookupTableAddresses).toEqual([]);
    });

    it('uses supplied positionAuthority', async () => {
        const client = createClient();

        await getPhoenixCancelAllOrdersPlan({
            client: client as never,
            trader: { authority: 'authority', positionAuthority: 'position-authority' },
            symbol: 'SOL-PERP',
        });

        expect(client.ixs.buildCancelAll).toHaveBeenCalledWith(
            expect.objectContaining({ positionAuthority: 'position-authority' }),
        );
    });
});

describe('getPhoenixCancelOrdersByIdPlan', () => {
    it('passes order ids unchanged', async () => {
        const client = createClient();
        const orders = [{ price: 150n, orderSequenceNumber: '42' }];

        const result = await getPhoenixCancelOrdersByIdPlan({
            client: client as never,
            trader: { authority: 'authority', traderPdaIndex: 2, traderSubaccountIndex: 3 },
            symbol: 'SOL-PERP',
            orders,
        });

        expect(client.ixs.buildCancelOrdersById).toHaveBeenCalledWith({
            authority: 'authority',
            symbol: 'SOL-PERP',
            traderPdaIndex: 2,
            traderSubaccountIndex: 3,
            orders,
        });
        expect(result.plan.kind).toBe('single');
        expect(result.order.orderCount).toBe(1);
        expect(result.lookupTableAddresses).toEqual([]);
    });
});
