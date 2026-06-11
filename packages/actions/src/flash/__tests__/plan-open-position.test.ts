/**
 * Tests for Flash open-position plans.
 */

import { BN } from '@coral-xyz/anchor';
import { PublicKey, TransactionInstruction } from '@solana/web3.js';
import { OraclePrice, Side } from 'flash-sdk';
import { describe, expect, it, vi } from 'vitest';
import { getFlashOpenPositionPlan } from '../plan-open-position.js';
import { InvalidFlashRiskConfigError, UnsupportedFlashAdditionalSignersError } from '../types.js';

const PROGRAM_ID = new PublicKey('11111111111111111111111111111111');
const OWNER = new PublicKey('SysvarRent111111111111111111111111111111111');

function instruction(data: number[]) {
    return new TransactionInstruction({ programId: PROGRAM_ID, keys: [], data: Buffer.from(data) });
}

function price() {
    return new OraclePrice({
        price: new BN('15000000000'),
        exponent: new BN(-8),
        confidence: new BN(0),
        timestamp: new BN(1),
    });
}

function priceSource() {
    return vi.fn(async (symbols: string[]) => new Map(symbols.map(symbol => [symbol, price()])));
}

function createContext() {
    const targetCustody = { symbol: 'SOL', custodyAccount: new PublicKey('11111111111111111111111111111111') };
    const collateralCustody = {
        symbol: 'USDC',
        custodyAccount: new PublicKey('SysvarC1ock11111111111111111111111111111111'),
    };
    const poolConfig = {
        poolName: 'Crypto.1',
        custodies: [targetCustody, collateralCustody],
        getTokenFromSymbol: vi.fn((symbol: string) => ({ symbol, decimals: symbol === 'SOL' ? 9 : 6 })),
        getMarketConfig: vi.fn(() => ({ marketAccount: new PublicKey('SysvarRent111111111111111111111111111111111') })),
    };
    const quote = { sizeAmount: new BN(1000) };

    return {
        quote,
        cluster: 'mainnet-beta',
        poolName: 'Crypto.1',
        poolConfig,
        client: {
            getOrLoadAddressLookupTable: vi.fn(async () => ({ addressLookupTables: [] })),
            getOpenPositionQuote: vi.fn(async () => quote),
            getPriceAfterSlippage: vi.fn(() => ({ price: new BN(150), exponent: -2 })),
            openPosition: vi.fn(async () => ({ instructions: [instruction([1])], additionalSigners: [] })),
            placeLimitOrder: vi.fn(async () => ({ instructions: [instruction([2])], additionalSigners: [] })),
            placeTriggerOrder: vi.fn(async () => ({ instructions: [instruction([3])], additionalSigners: [] })),
        },
    };
}

describe('getFlashOpenPositionPlan', () => {
    it('opens a market long with Side.Long', async () => {
        const context = createContext();

        const result = await getFlashOpenPositionPlan({
            context: context as never,
            priceSource: priceSource(),
            trader: { owner: OWNER.toBase58() },
            symbol: 'SOL',
            side: 'long',
            collateral: { amount: '1', symbol: 'USDC' },
            leverage: '2',
            entry: { type: 'market' },
        });

        expect(context.client.getOpenPositionQuote).toHaveBeenCalledWith(
            expect.any(BN),
            expect.any(BN),
            expect.anything(),
            context.poolConfig,
            expect.anything(),
            expect.objectContaining({ symbol: 'USDC' }),
            undefined,
            null,
            null,
            OWNER,
            null,
            null,
        );
        expect(context.client.getPriceAfterSlippage).toHaveBeenCalledWith(
            true,
            expect.any(BN),
            expect.anything(),
            Side.Long,
        );
        expect(context.client.openPosition).toHaveBeenCalledWith(
            'SOL',
            'USDC',
            expect.anything(),
            expect.any(BN),
            context.quote.sizeAmount,
            Side.Long,
            context.poolConfig,
            expect.anything(),
            undefined,
            undefined,
            undefined,
        );
        expect(result.plan.kind).toBe('single');
    });

    it('opens a market short with Side.Short', async () => {
        const context = createContext();

        await getFlashOpenPositionPlan({
            context: context as never,
            priceSource: priceSource(),
            trader: { owner: OWNER.toBase58() },
            symbol: 'SOL',
            side: 'short',
            collateral: { amount: '1', symbol: 'USDC' },
            leverage: '2',
            entry: { type: 'market' },
        });

        expect(context.client.openPosition).toHaveBeenCalledWith(
            expect.anything(),
            expect.anything(),
            expect.anything(),
            expect.anything(),
            expect.anything(),
            Side.Short,
            expect.anything(),
            expect.anything(),
            undefined,
            undefined,
            undefined,
        );
    });

    it('appends take-profit and stop-loss trigger orders for market entries', async () => {
        const context = createContext();

        const result = await getFlashOpenPositionPlan({
            context: context as never,
            priceSource: priceSource(),
            trader: { owner: OWNER.toBase58() },
            symbol: 'SOL',
            side: 'long',
            collateral: { amount: '1', symbol: 'USDC' },
            leverage: '2',
            entry: { type: 'market' },
            risk: {
                takeProfit: { triggerPriceUsd: '165', sizePercent: 50 },
                stopLoss: { triggerPriceUsd: '142' },
            },
        });

        expect(context.client.placeTriggerOrder).toHaveBeenCalledTimes(2);
        expect(context.client.placeTriggerOrder).toHaveBeenNthCalledWith(
            1,
            'SOL',
            'USDC',
            'USDC',
            Side.Long,
            expect.objectContaining({ price: expect.any(BN) }),
            expect.any(BN),
            false,
            context.poolConfig,
        );
        expect(context.client.placeTriggerOrder).toHaveBeenNthCalledWith(
            2,
            'SOL',
            'USDC',
            'USDC',
            Side.Long,
            expect.objectContaining({ price: expect.any(BN) }),
            expect.any(BN),
            true,
            context.poolConfig,
        );
        expect(result.plan.kind).toBe('sequential');
    });

    it('places a limit order and maps TP/SL prices', async () => {
        const context = createContext();

        await getFlashOpenPositionPlan({
            context: context as never,
            priceSource: priceSource(),
            trader: { owner: OWNER.toBase58() },
            symbol: 'SOL',
            side: 'long',
            collateral: { amount: '1', symbol: 'USDC' },
            leverage: '2',
            entry: { type: 'limit', priceUsd: '150.50', reserveSymbol: 'USDC', receiveSymbol: 'USDC' },
            risk: {
                takeProfit: { triggerPriceUsd: '165.25' },
                stopLoss: { triggerPriceUsd: '142.75' },
            },
        });

        expect(context.client.placeLimitOrder).toHaveBeenCalledWith(
            'SOL',
            'USDC',
            'USDC',
            'USDC',
            Side.Long,
            expect.objectContaining({ exponent: -2 }),
            expect.any(BN),
            context.quote.sizeAmount,
            expect.objectContaining({ exponent: -2 }),
            expect.objectContaining({ exponent: -2 }),
            context.poolConfig,
            undefined,
        );
    });

    it('rejects non-empty additional signers', async () => {
        const context = createContext();
        context.client.openPosition.mockResolvedValueOnce({
            instructions: [instruction([1])],
            additionalSigners: [{ publicKey: OWNER }],
        });

        await expect(
            getFlashOpenPositionPlan({
                context: context as never,
                priceSource: priceSource(),
                trader: { owner: OWNER.toBase58() },
                symbol: 'SOL',
                side: 'long',
                collateral: { amount: '1', symbol: 'USDC' },
                leverage: '2',
                entry: { type: 'market' },
            }),
        ).rejects.toThrow(UnsupportedFlashAdditionalSignersError);
    });

    it('rejects matching TP and SL trigger prices', async () => {
        await expect(
            getFlashOpenPositionPlan({
                context: createContext() as never,
                priceSource: priceSource(),
                trader: { owner: OWNER.toBase58() },
                symbol: 'SOL',
                side: 'long',
                collateral: { amount: '1', symbol: 'USDC' },
                leverage: '2',
                entry: { type: 'market' },
                risk: {
                    takeProfit: { triggerPriceUsd: '150' },
                    stopLoss: { triggerPriceUsd: '150' },
                },
            }),
        ).rejects.toThrow(InvalidFlashRiskConfigError);
    });
});
