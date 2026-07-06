/**
 * Tests for Flash trigger-order cancel plans.
 */

import { describe, expect, it } from 'vitest';
import { getFlashCancelAllTriggerOrdersPlan, getFlashCancelTriggerOrderPlan } from '../plan-cancel.js';
import { FlashTraderMismatchError } from '../types.js';
import { OWNER, createFakeFlashClient } from './helpers.js';

const BASE_OPTIONS = {
    trader: { owner: OWNER },
    symbol: 'SOL',
    collateralSymbol: 'USDC',
    side: 'short',
} as const;

describe('getFlashCancelTriggerOrderPlan', () => {
    it('cancels a single trigger order by id', async () => {
        const { client, context } = createFakeFlashClient();

        const result = await getFlashCancelTriggerOrderPlan({
            ...BASE_OPTIONS,
            context,
            orderId: 3,
            isStopLoss: true,
        });

        const args = client.cancelTriggerOrder.mock.calls[0];
        expect(args[0]).toBe('SOL');
        expect(args[1]).toBe('USDC');
        expect(args[3]).toBe(3);
        expect(args[4]).toBe(true);
        expect(result.order.cancelAll).toBe(false);
        expect(result.order.orderId).toBe(3);
        expect(result.plan.kind).toBe('single');
    });

    it('rejects mismatching traders', async () => {
        const { context } = createFakeFlashClient();

        await expect(
            getFlashCancelTriggerOrderPlan({
                ...BASE_OPTIONS,
                trader: { owner: 'So11111111111111111111111111111111111111112' },
                context,
                orderId: 3,
                isStopLoss: true,
            }),
        ).rejects.toThrow(FlashTraderMismatchError);
    });
});

describe('getFlashCancelAllTriggerOrdersPlan', () => {
    it('cancels all trigger orders for the position', async () => {
        const { client, context } = createFakeFlashClient();

        const result = await getFlashCancelAllTriggerOrdersPlan({ ...BASE_OPTIONS, context });

        const args = client.cancelAllTriggerOrders.mock.calls[0];
        expect(args[0]).toBe('SOL');
        expect(args[1]).toBe('USDC');
        expect(result.order.cancelAll).toBe(true);
        expect(result.order.orderId).toBeNull();
    });
});
