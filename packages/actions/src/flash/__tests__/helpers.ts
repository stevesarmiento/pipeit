/**
 * Test helpers: a mocked flash-sdk PerpetualsClient paired with the REAL
 * bundled `Crypto.1` PoolConfig (no network needed), so token/custody/market
 * resolution and oracle math run through real flash-sdk code.
 */

import { BN } from '@coral-xyz/anchor';
import { PublicKey } from '@solana/web3.js';
import { OraclePrice, PoolConfig } from 'flash-sdk';
import { vi } from 'vitest';
import type { FlashActionsContext, FlashPriceSource } from '../types.js';

export const OWNER = '11111111111111111111111111111111';

export const POOL_CONFIG = PoolConfig.fromIdsByName('Crypto.1', 'mainnet-beta');

export function createInstruction(data: number[] = [1]) {
    return {
        programId: new PublicKey(OWNER),
        keys: [],
        data: Buffer.from(data),
    };
}

export function sdkResult(data: number[] = [1]) {
    return { instructions: [createInstruction(data)], additionalSigners: [] };
}

export const PRICE_WITH_SLIPPAGE = { sentinel: 'price-with-slippage' };

export function createFakeFlashClient(owner: string = OWNER) {
    const client = {
        provider: { wallet: { publicKey: new PublicKey(owner) } },
        getOrLoadAddressLookupTable: vi.fn(async () => ({ addressLookupTables: [] })),
        getOpenPositionQuote: vi.fn(async () => ({ sizeAmount: new BN('1000000000') })),
        getPriceAfterSlippage: vi.fn(() => PRICE_WITH_SLIPPAGE),
        openPosition: vi.fn(async () => sdkResult([1])),
        placeLimitOrder: vi.fn(async () => sdkResult([2])),
        placeTriggerOrder: vi.fn(async () => sdkResult([3])),
        closePosition: vi.fn(async () => sdkResult([4])),
        decreaseSize: vi.fn(async () => sdkResult([5])),
        cancelTriggerOrder: vi.fn(async () => sdkResult([6])),
        cancelAllTriggerOrders: vi.fn(async () => sdkResult([7])),
        getPositionKey: vi.fn(() => new PublicKey(OWNER)),
    };

    const context: FlashActionsContext = {
        client: client as never,
        poolConfig: POOL_CONFIG,
        cluster: 'mainnet-beta',
        poolName: 'Crypto.1',
    };

    return { client, context };
}

/**
 * Price source stub returning a REAL flash-sdk OraclePrice ($150, Pyth-style
 * exponent -8) so downstream `getTokenAmount` math is exercised for real.
 */
export function createStubPriceSource(): { priceSource: FlashPriceSource; calls: string[][] } {
    const oracle = new OraclePrice({
        price: new BN('15000000000'),
        exponent: new BN('-8'),
        confidence: new BN('0'),
        timestamp: new BN('0'),
    });
    const calls: string[][] = [];
    const priceSource: FlashPriceSource = async symbols => {
        calls.push([...symbols]);
        return new Map(symbols.map(symbol => [symbol, oracle]));
    };

    return { priceSource, calls };
}
