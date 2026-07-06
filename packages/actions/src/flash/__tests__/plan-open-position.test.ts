/**
 * Tests for Flash open-position plans.
 *
 * Uses the REAL bundled Crypto.1 PoolConfig for token/custody/market
 * resolution, and asserts exact BN values instead of expect.anything().
 */

import { BN } from '@coral-xyz/anchor';
import { describe, expect, it } from 'vitest';
import { getFlashOpenPositionPlan } from '../plan-open-position.js';
import {
    FlashMarketConfigError,
    FlashTraderMismatchError,
    InvalidFlashAmountError,
    InvalidFlashRiskConfigError,
    UnsupportedFlashCollateralError,
} from '../types.js';
import { OWNER, PRICE_WITH_SLIPPAGE, createFakeFlashClient, createStubPriceSource } from './helpers.js';

// Crypto.1 shorts collateralize with USDC (longs use the target token,
// which is native SOL for SOL longs — unsupported in V1).
const BASE_OPTIONS = {
    trader: { owner: OWNER },
    symbol: 'SOL',
    side: 'short',
    collateral: { amount: '25', symbol: 'USDC' },
    leverage: 5,
} as const;

function setup() {
    const { client, context } = createFakeFlashClient();
    const { priceSource, calls } = createStubPriceSource();
    return { client, context, priceSource, priceSourceCalls: calls };
}

describe('getFlashOpenPositionPlan', () => {
    it('quotes with exact native collateral and BPS-scaled leverage', async () => {
        const { client, context, priceSource } = setup();

        await getFlashOpenPositionPlan({
            ...BASE_OPTIONS,
            context,
            priceSource,
            entry: { type: 'market' },
        });

        const [collateralAmount, leverage] = client.getOpenPositionQuote.mock.calls[0];
        expect((collateralAmount as BN).toString()).toBe('25000000'); // 25 USDC @ 6 decimals
        expect((leverage as BN).toString()).toBe('50000'); // 5x @ BPS_POWER 10^4
    });

    it('defaults market slippage to 80 bps (0.8%), not 800', async () => {
        const { client, context, priceSource } = setup();

        const result = await getFlashOpenPositionPlan({
            ...BASE_OPTIONS,
            context,
            priceSource,
            entry: { type: 'market' },
        });

        const slippage = client.getPriceAfterSlippage.mock.calls[0][1] as BN;
        expect(slippage.toString()).toBe('80');
        expect(result.order.slippageBps).toBe(80);
    });

    it('passes explicit slippage through and hands the guarded price to openPosition', async () => {
        const { client, context, priceSource } = setup();

        await getFlashOpenPositionPlan({
            ...BASE_OPTIONS,
            context,
            priceSource,
            entry: { type: 'market', slippageBps: 25 },
        });

        expect((client.getPriceAfterSlippage.mock.calls[0][1] as BN).toString()).toBe('25');
        const openArgs = client.openPosition.mock.calls[0];
        expect(openArgs[0]).toBe('SOL');
        expect(openArgs[1]).toBe('USDC');
        expect(openArgs[2]).toBe(PRICE_WITH_SLIPPAGE);
    });

    it('fetches only the target symbol price (collateral price is unused)', async () => {
        const { context, priceSource, priceSourceCalls } = setup();

        await getFlashOpenPositionPlan({
            ...BASE_OPTIONS,
            context,
            priceSource,
            entry: { type: 'market' },
        });

        expect(priceSourceCalls).toEqual([['SOL']]);
    });

    it('encodes trigger prices as exact contract oracle prices', async () => {
        const { client, context, priceSource } = setup();

        await getFlashOpenPositionPlan({
            ...BASE_OPTIONS,
            context,
            priceSource,
            entry: { type: 'market' },
            risk: {
                takeProfit: { triggerPriceUsd: '140.25' }, // short TP below entry
                stopLoss: { triggerPriceUsd: '160.5' },
            },
        });

        const tpArgs = client.placeTriggerOrder.mock.calls[0];
        expect(tpArgs[4].price.toString()).toBe('14025');
        expect(tpArgs[4].exponent).toBe(-2);
        expect(tpArgs[6]).toBe(false); // isStopLoss

        const slArgs = client.placeTriggerOrder.mock.calls[1];
        expect(slArgs[4].price.toString()).toBe('1605');
        expect(slArgs[4].exponent).toBe(-1);
        expect(slArgs[6]).toBe(true);
    });

    it('applies sizePercent to trigger order sizes with exact math', async () => {
        const { client, context, priceSource } = setup();

        await getFlashOpenPositionPlan({
            ...BASE_OPTIONS,
            context,
            priceSource,
            entry: { type: 'market' },
            risk: { takeProfit: { triggerPriceUsd: '140', sizePercent: 50 } },
        });

        // quote.sizeAmount is 1_000_000_000 in the fake client
        expect(client.placeTriggerOrder.mock.calls[0][5].toString()).toBe('500000000');
    });

    it('combines entry and trigger instructions in a NON-DIVISIBLE plan', async () => {
        const { context, priceSource } = setup();

        const result = await getFlashOpenPositionPlan({
            ...BASE_OPTIONS,
            context,
            priceSource,
            entry: { type: 'market' },
            risk: { stopLoss: { triggerPriceUsd: '160' } },
        });

        expect(result.plan.kind).toBe('sequential');
        expect((result.plan as { divisible?: boolean }).divisible).toBe(false);
        expect(result.flash.instructions).toHaveLength(2);
    });

    it('embeds TP/SL prices in limit orders', async () => {
        const { client, context, priceSource } = setup();

        await getFlashOpenPositionPlan({
            ...BASE_OPTIONS,
            context,
            priceSource,
            entry: { type: 'limit', priceUsd: '155' },
            risk: {
                takeProfit: { triggerPriceUsd: '140' },
                stopLoss: { triggerPriceUsd: '160.5' },
            },
        });

        expect(client.placeTriggerOrder).not.toHaveBeenCalled();
        const limitArgs = client.placeLimitOrder.mock.calls[0];
        expect(limitArgs[5].price.toString()).toBe('155'); // limit price
        expect(limitArgs[8].price.toString()).toBe('1605'); // stop-loss
        expect(limitArgs[9].price.toString()).toBe('140'); // take-profit
    });

    describe('validation', () => {
        it('rejects trader owners that do not match the provider wallet', async () => {
            const { context, priceSource } = setup();

            await expect(
                getFlashOpenPositionPlan({
                    ...BASE_OPTIONS,
                    trader: { owner: 'So11111111111111111111111111111111111111112' },
                    context,
                    priceSource,
                    entry: { type: 'market' },
                }),
            ).rejects.toThrow(FlashTraderMismatchError);
        });

        it('rejects native SOL collateral with an actionable error', async () => {
            const { context, priceSource } = setup();

            await expect(
                getFlashOpenPositionPlan({
                    ...BASE_OPTIONS,
                    context,
                    priceSource,
                    side: 'long',
                    collateral: { amount: '1.0', symbol: 'SOL' },
                    entry: { type: 'market' },
                }),
            ).rejects.toThrow(UnsupportedFlashCollateralError);
        });

        it('rejects market/collateral/side combos missing from the real pool', async () => {
            const { context, priceSource } = setup();

            // Crypto.1 has no SOL long with USDC collateral.
            await expect(
                getFlashOpenPositionPlan({
                    ...BASE_OPTIONS,
                    context,
                    priceSource,
                    side: 'long',
                    entry: { type: 'market' },
                }),
            ).rejects.toThrow(FlashMarketConfigError);
        });

        it('rejects equal TP/SL triggers even with different formatting', async () => {
            const { context, priceSource } = setup();

            await expect(
                getFlashOpenPositionPlan({
                    ...BASE_OPTIONS,
                    context,
                    priceSource,
                    entry: { type: 'market' },
                    risk: {
                        takeProfit: { triggerPriceUsd: '150' },
                        stopLoss: { triggerPriceUsd: '150.0' },
                    },
                }),
            ).rejects.toThrow(InvalidFlashRiskConfigError);
        });

        it('rejects short TP above SL', async () => {
            const { context, priceSource } = setup();

            await expect(
                getFlashOpenPositionPlan({
                    ...BASE_OPTIONS,
                    context,
                    priceSource,
                    entry: { type: 'market' },
                    risk: {
                        takeProfit: { triggerPriceUsd: '160' },
                        stopLoss: { triggerPriceUsd: '140' },
                    },
                }),
            ).rejects.toThrow(InvalidFlashRiskConfigError);
        });

        it('rejects risk triggers on the wrong side of a limit entry', async () => {
            const { context, priceSource } = setup();

            await expect(
                getFlashOpenPositionPlan({
                    ...BASE_OPTIONS,
                    context,
                    priceSource,
                    entry: { type: 'limit', priceUsd: '150' },
                    risk: { takeProfit: { triggerPriceUsd: '155' } }, // short TP must be below entry
                }),
            ).rejects.toThrow(InvalidFlashRiskConfigError);
        });

        it('rejects sizePercent/receiveSymbol on limit-entry risk legs instead of ignoring them', async () => {
            const { context, priceSource } = setup();

            await expect(
                getFlashOpenPositionPlan({
                    ...BASE_OPTIONS,
                    context,
                    priceSource,
                    entry: { type: 'limit', priceUsd: '155' },
                    risk: { takeProfit: { triggerPriceUsd: '140', sizePercent: 50 } },
                }),
            ).rejects.toThrow(InvalidFlashRiskConfigError);
        });

        it('rejects zero, negative, and malformed amounts with typed errors', async () => {
            for (const amount of ['0', '-5', '1e-3', 'abc', 0, -1] as const) {
                const { context, priceSource } = setup();
                await expect(
                    getFlashOpenPositionPlan({
                        ...BASE_OPTIONS,
                        context,
                        priceSource,
                        collateral: { amount, symbol: 'USDC' },
                        entry: { type: 'market' },
                    }),
                ).rejects.toThrow(InvalidFlashAmountError);
            }
        });
    });
});
