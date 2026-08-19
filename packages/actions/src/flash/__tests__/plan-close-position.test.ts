/**
 * Tests for Flash close-position plans.
 */

import { BN } from '@coral-xyz/anchor';
import { PublicKey } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';
import { getFlashClosePositionPlan } from '../plan-close-position.js';
import {
    FlashTraderMismatchError,
    UnsupportedFlashCollateralError,
    UnsupportedFlashOrderConfigError,
} from '../types.js';
import { OWNER, PRICE_WITH_SLIPPAGE, createFakeFlashClient, createStubPriceSource } from './helpers.js';

const BASE_OPTIONS = {
    trader: { owner: OWNER },
    symbol: 'SOL',
    collateralSymbol: 'USDC',
    side: 'short',
} as const;

function setup() {
    const { client, context } = createFakeFlashClient();
    const { priceSource, calls } = createStubPriceSource();
    return { client, context, priceSource, priceSourceCalls: calls };
}

describe('getFlashClosePositionPlan', () => {
    it('REGRESSION: passes collateralSymbol (not receiveSymbol) into closePosition', async () => {
        // flash-sdk derives the position PDA and receiving ATA from the
        // second argument — routing receiveSymbol there closed the wrong
        // (or a nonexistent) position.
        const { client, context, priceSource } = setup();

        const result = await getFlashClosePositionPlan({
            ...BASE_OPTIONS,
            context,
            priceSource,
            size: { percent: 100 },
        });

        const args = client.closePosition.mock.calls[0];
        expect(args[0]).toBe('SOL');
        expect(args[1]).toBe('USDC');
        expect(args[2]).toBe(PRICE_WITH_SLIPPAGE);
        expect(result.order.closeType).toBe('full');
        expect(result.order.receiveSymbol).toBe('USDC');
    });

    it('rejects receiveSymbol different from collateralSymbol instead of misderiving the PDA', async () => {
        const { context, priceSource } = setup();

        await expect(
            getFlashClosePositionPlan({
                ...BASE_OPTIONS,
                context,
                priceSource,
                receiveSymbol: 'BTC',
                size: { percent: 100 },
            }),
        ).rejects.toThrow(UnsupportedFlashOrderConfigError);
    });

    it('rejects percent values other than 100 instead of silently closing everything', async () => {
        const { context, priceSource } = setup();

        await expect(
            getFlashClosePositionPlan({
                ...BASE_OPTIONS,
                context,
                priceSource,
                size: { percent: 50 } as never,
            }),
        ).rejects.toThrow(UnsupportedFlashOrderConfigError);
    });

    it('rejects positionAddress on full closes (only supported for partial)', async () => {
        const { context, priceSource } = setup();

        await expect(
            getFlashClosePositionPlan({
                ...BASE_OPTIONS,
                context,
                priceSource,
                positionAddress: OWNER,
                size: { percent: 100 },
            }),
        ).rejects.toThrow(UnsupportedFlashOrderConfigError);
    });

    it('defaults slippage to 80 bps', async () => {
        const { client, context, priceSource } = setup();

        const result = await getFlashClosePositionPlan({
            ...BASE_OPTIONS,
            context,
            priceSource,
            size: { percent: 100 },
        });

        expect((client.getPriceAfterSlippage.mock.calls[0][1] as BN).toString()).toBe('80');
        expect(result.order.slippageBps).toBe(80);
    });

    it('converts partial-close USD size to exact token amounts via the real oracle math', async () => {
        const { client, context, priceSource } = setup();

        const result = await getFlashClosePositionPlan({
            ...BASE_OPTIONS,
            context,
            priceSource,
            size: { sizeUsd: '75' },
        });

        // $75 of SOL at the stubbed $150 oracle price = 0.5 SOL = 5e8 native
        const args = client.decreaseSize.mock.calls[0];
        expect(args[6].toString()).toBe('500000000');
        expect(result.order.closeType).toBe('partial');
    });

    it('derives the partial-close position key from the real custody accounts', async () => {
        const { client, context, priceSource } = setup();

        await getFlashClosePositionPlan({
            ...BASE_OPTIONS,
            context,
            priceSource,
            size: { sizeUsd: '75' },
        });

        const [owner, targetCustody, collateralCustody] = client.getPositionKey.mock.calls[0];
        expect((owner as PublicKey).toBase58()).toBe(OWNER);
        const solCustody = context.poolConfig.custodies.find(c => c.symbol === 'SOL')?.custodyAccount;
        const usdcCustody = context.poolConfig.custodies.find(c => c.symbol === 'USDC')?.custodyAccount;
        expect((targetCustody as PublicKey).equals(solCustody as PublicKey)).toBe(true);
        expect((collateralCustody as PublicKey).equals(usdcCustody as PublicKey)).toBe(true);
    });

    it('uses an explicit positionAddress for partial closes when provided', async () => {
        const { client, context, priceSource } = setup();
        const positionAddress = 'So11111111111111111111111111111111111111112';

        await getFlashClosePositionPlan({
            ...BASE_OPTIONS,
            context,
            priceSource,
            positionAddress,
            size: { sizeUsd: '75' },
        });

        expect(client.getPositionKey).not.toHaveBeenCalled();
        expect((client.decreaseSize.mock.calls[0][3] as PublicKey).toBase58()).toBe(positionAddress);
    });

    it('rejects native SOL collateral and mismatching traders', async () => {
        const { context, priceSource } = setup();

        await expect(
            getFlashClosePositionPlan({
                ...BASE_OPTIONS,
                context,
                priceSource,
                collateralSymbol: 'SOL',
                size: { percent: 100 },
            }),
        ).rejects.toThrow(UnsupportedFlashCollateralError);

        await expect(
            getFlashClosePositionPlan({
                ...BASE_OPTIONS,
                trader: { owner: 'So11111111111111111111111111111111111111112' },
                context,
                priceSource,
                size: { percent: 100 },
            }),
        ).rejects.toThrow(FlashTraderMismatchError);
    });

    it('rejects malformed partial sizes', async () => {
        for (const sizeUsd of ['0', '-75', '7.5e1'] as const) {
            const { context, priceSource } = setup();
            await expect(
                getFlashClosePositionPlan({
                    ...BASE_OPTIONS,
                    context,
                    priceSource,
                    size: { sizeUsd },
                }),
            ).rejects.toThrow();
        }
    });
});
