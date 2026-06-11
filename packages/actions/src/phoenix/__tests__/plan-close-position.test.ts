/**
 * Tests for Phoenix close-position plans.
 */

import { Side } from '@ellipsis-labs/rise';
import { describe, expect, it, vi } from 'vitest';
import { getPhoenixClosePositionPlan } from '../plan-close-position.js';
import { InvalidPhoenixPositionSideError, UnsupportedPhoenixOrderConfigError } from '../types.js';

const PROGRAM_ADDRESS = '11111111111111111111111111111111';

function createInstruction(data: number[]) {
    return {
        programAddress: PROGRAM_ADDRESS,
        accounts: [],
        data: new Uint8Array(data),
    };
}

function createClient() {
    const packet = { packet: 'market' };

    return {
        packet,
        orderPackets: {
            buildMarketOrderPacket: vi.fn(async () => packet),
        },
        ixs: {
            placeMarketOrder: vi.fn(async () => createInstruction([1])),
        },
    };
}

describe('getPhoenixClosePositionPlan', () => {
    it('closes long positions with Side.Ask', async () => {
        const client = createClient();

        await getPhoenixClosePositionPlan({
            client: client as never,
            trader: { authority: 'authority' },
            symbol: 'SOL-PERP',
            side: 'long',
            size: { baseUnits: '0.25' },
        });

        expect(client.orderPackets.buildMarketOrderPacket).toHaveBeenCalledWith(
            expect.objectContaining({ side: Side.Ask, baseUnits: '0.25' }),
        );
    });

    it('closes short positions with Side.Bid', async () => {
        const client = createClient();

        await getPhoenixClosePositionPlan({
            client: client as never,
            trader: { authority: 'authority' },
            symbol: 'SOL-PERP',
            side: 'short',
            size: { baseUnits: 1n },
        });

        expect(client.orderPackets.buildMarketOrderPacket).toHaveBeenCalledWith(
            expect.objectContaining({ side: Side.Bid, baseUnits: 1n }),
        );
    });

    it('calls placeMarketOrder with the generated packet', async () => {
        const client = createClient();

        const result = await getPhoenixClosePositionPlan({
            client: client as never,
            trader: { authority: 'authority' },
            symbol: 'SOL-PERP',
            side: 'long',
            size: { baseUnits: '0.25' },
        });

        expect(client.ixs.placeMarketOrder).toHaveBeenCalledWith(
            expect.objectContaining({ orderPacket: client.packet }),
        );
        expect(result.plan.kind).toBe('single');
        expect(result.phoenix.orderPacket).toBe(client.packet);
    });

    it('rejects invalid side', async () => {
        await expect(
            getPhoenixClosePositionPlan({
                client: createClient() as never,
                trader: { authority: 'authority' },
                symbol: 'SOL-PERP',
                side: 'flat' as never,
                size: { baseUnits: 1n },
            }),
        ).rejects.toThrow(InvalidPhoenixPositionSideError);
    });

    it('rejects zero or negative bigint base size', async () => {
        await expect(
            getPhoenixClosePositionPlan({
                client: createClient() as never,
                trader: { authority: 'authority' },
                symbol: 'SOL-PERP',
                side: 'long',
                size: { baseUnits: 0n },
            }),
        ).rejects.toThrow(UnsupportedPhoenixOrderConfigError);
    });
});
