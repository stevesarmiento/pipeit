/**
 * Tests for Flash trigger-order cancel plans.
 */

import { PublicKey, TransactionInstruction } from '@solana/web3.js';
import { Side } from 'flash-sdk';
import { describe, expect, it, vi } from 'vitest';
import { getFlashCancelAllTriggerOrdersPlan, getFlashCancelTriggerOrderPlan } from '../plan-cancel.js';

const PROGRAM_ID = new PublicKey('11111111111111111111111111111111');

function instruction(data: number[]) {
    return new TransactionInstruction({ programId: PROGRAM_ID, keys: [], data: Buffer.from(data) });
}

function createContext() {
    return {
        cluster: 'mainnet-beta',
        poolName: 'Crypto.1',
        poolConfig: { poolName: 'Crypto.1' },
        client: {
            getOrLoadAddressLookupTable: vi.fn(async () => ({ addressLookupTables: [] })),
            cancelTriggerOrder: vi.fn(async () => ({ instructions: [instruction([1])], additionalSigners: [] })),
            cancelAllTriggerOrders: vi.fn(async () => ({ instructions: [instruction([2])], additionalSigners: [] })),
        },
    };
}

describe('Flash trigger cancel plans', () => {
    it('cancels one trigger order', async () => {
        const context = createContext();

        const result = await getFlashCancelTriggerOrderPlan({
            context: context as never,
            trader: { owner: 'owner' },
            symbol: 'SOL',
            side: 'long',
            orderId: 4,
            isStopLoss: true,
        });

        expect(context.client.cancelTriggerOrder).toHaveBeenCalledWith(
            'SOL',
            'SOL',
            Side.Long,
            4,
            true,
            context.poolConfig,
        );
        expect(result.plan.kind).toBe('single');
        expect(result.order.orderId).toBe(4);
    });

    it('cancels all trigger orders', async () => {
        const context = createContext();

        const result = await getFlashCancelAllTriggerOrdersPlan({
            context: context as never,
            trader: { owner: 'owner' },
            symbol: 'SOL',
            collateralSymbol: 'USDC',
            side: 'short',
        });

        expect(context.client.cancelAllTriggerOrders).toHaveBeenCalledWith(
            'SOL',
            'USDC',
            Side.Short,
            context.poolConfig,
        );
        expect(result.plan.kind).toBe('single');
        expect(result.order.cancelAll).toBe(true);
    });
});
