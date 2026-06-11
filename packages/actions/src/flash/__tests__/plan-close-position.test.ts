/**
 * Tests for Flash close-position plans.
 */

import { BN } from '@coral-xyz/anchor';
import { PublicKey, TransactionInstruction } from '@solana/web3.js';
import { OraclePrice, Side } from 'flash-sdk';
import { describe, expect, it, vi } from 'vitest';
import { getFlashClosePositionPlan } from '../plan-close-position.js';

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

function createContext() {
    const targetCustody = {
        symbol: 'SOL',
        custodyAccount: new PublicKey('11111111111111111111111111111111'),
        decimals: 9,
    };
    const collateralCustody = {
        symbol: 'USDC',
        custodyAccount: new PublicKey('SysvarC1ock11111111111111111111111111111111'),
        decimals: 6,
    };

    return {
        cluster: 'mainnet-beta',
        poolName: 'Crypto.1',
        poolConfig: {
            poolName: 'Crypto.1',
            custodies: [targetCustody, collateralCustody],
        },
        client: {
            getOrLoadAddressLookupTable: vi.fn(async () => ({ addressLookupTables: [] })),
            getPriceAfterSlippage: vi.fn(() => ({ price: new BN(150), exponent: -2 })),
            closePosition: vi.fn(async () => ({ instructions: [instruction([1])], additionalSigners: [] })),
            decreaseSize: vi.fn(async () => ({ instructions: [instruction([2])], additionalSigners: [] })),
            getPositionKey: vi.fn(() => new PublicKey('SysvarRecentB1ockHashes11111111111111111111')),
        },
    };
}

describe('getFlashClosePositionPlan', () => {
    it('fully closes a position', async () => {
        const context = createContext();

        const result = await getFlashClosePositionPlan({
            context: context as never,
            priceSource: async () => new Map([['SOL', price()]]),
            trader: { owner: OWNER.toBase58() },
            symbol: 'SOL',
            side: 'long',
            size: { percent: 100 },
        });

        expect(context.client.closePosition).toHaveBeenCalledWith(
            'SOL',
            'SOL',
            expect.anything(),
            Side.Long,
            context.poolConfig,
            expect.anything(),
            undefined,
            undefined,
            undefined,
            undefined,
        );
        expect(result.plan.kind).toBe('single');
        expect(result.order.closeType).toBe('full');
    });

    it('partially closes a position with decreaseSize', async () => {
        const context = createContext();

        const result = await getFlashClosePositionPlan({
            context: context as never,
            priceSource: async () => new Map([['SOL', price()]]),
            trader: { owner: OWNER.toBase58() },
            symbol: 'SOL',
            collateralSymbol: 'USDC',
            side: 'short',
            size: { sizeUsd: '25' },
        });

        expect(context.client.decreaseSize).toHaveBeenCalledWith(
            'SOL',
            'USDC',
            Side.Short,
            expect.any(PublicKey),
            context.poolConfig,
            expect.anything(),
            expect.any(BN),
            expect.anything(),
        );
        expect(result.plan.kind).toBe('single');
        expect(result.order.closeType).toBe('partial');
    });
});
