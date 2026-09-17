/**
 * Un-mocked tests for the Flash pool helpers: every piece of nontrivial
 * math asserts exact values, and pool/market resolution runs against the
 * REAL bundled Crypto.1 PoolConfig.
 */

import { BN } from '@coral-xyz/anchor';
import { Side } from 'flash-sdk';
import { describe, expect, it } from 'vitest';
import {
    FLASH_DEFAULT_SLIPPAGE_BPS,
    amountToNative,
    assertPositiveDecimal,
    assertSupportedCollateral,
    assertTraderMatchesProvider,
    compareUsdValues,
    decimalToScaledBn,
    getCustodyConfig,
    getMarketConfig,
    getTokenConfig,
    priceUsdToContractOraclePrice,
    sizeAmountForPercent,
    usdToNative,
} from '../pool.js';
import {
    FlashMarketConfigError,
    FlashTraderMismatchError,
    InvalidFlashAmountError,
    UnsupportedFlashCollateralError,
    UnsupportedFlashOrderConfigError,
} from '../types.js';
import { OWNER, POOL_CONFIG, createFakeFlashClient } from './helpers.js';

describe('FLASH_DEFAULT_SLIPPAGE_BPS', () => {
    it('is 0.8% (80 bps), not 8%', () => {
        // flash-sdk BPS_DECIMALS = 4, so 80 / 10^4 = 0.8%. The original 800
        // default tolerated an 8% worse fill — an 80% equity swing at 10x.
        expect(FLASH_DEFAULT_SLIPPAGE_BPS).toBe(80);
    });
});

describe('decimalToScaledBn', () => {
    it('scales decimals exactly', () => {
        expect(decimalToScaledBn('2', 4).toString()).toBe('20000');
        expect(decimalToScaledBn(5, 4).toString()).toBe('50000');
        expect(decimalToScaledBn('2.5', 4).toString()).toBe('25000');
        expect(decimalToScaledBn('0.0001', 4).toString()).toBe('1');
        expect(decimalToScaledBn(80, 0).toString()).toBe('80');
        expect(decimalToScaledBn(7n, 2).toString()).toBe('700');
    });

    it('truncates excess fractional digits', () => {
        expect(decimalToScaledBn('1.23456', 4).toString()).toBe('12345');
    });

    it('rejects scientific notation, negatives, and garbage with a typed error', () => {
        for (const value of ['1e-7', 1e-7, -1, '-1', 'abc', Number.NaN, Infinity, -2n] as const) {
            expect(() => decimalToScaledBn(value, 4)).toThrow(InvalidFlashAmountError);
        }
    });
});

describe('usdToNative', () => {
    it('scales to flash USD decimals (6)', () => {
        expect(usdToNative('25').toString()).toBe('25000000');
        expect(usdToNative('0.5').toString()).toBe('500000');
    });
});

describe('amountToNative', () => {
    it('scales by token decimals', () => {
        expect(amountToNative('25', 6).toString()).toBe('25000000');
        expect(amountToNative('1.5', 9).toString()).toBe('1500000000');
    });

    it('rejects malformed amounts', () => {
        expect(() => amountToNative('1e3', 6)).toThrow(InvalidFlashAmountError);
    });
});

describe('priceUsdToContractOraclePrice', () => {
    it('splits price and exponent exactly', () => {
        const price = priceUsdToContractOraclePrice('150.50');
        expect(price.price.toString()).toBe('15050');
        expect(price.exponent).toBe(-2);

        const whole = priceUsdToContractOraclePrice('150');
        expect(whole.price.toString()).toBe('150');
        expect(whole.exponent).toBe(0);

        const big = priceUsdToContractOraclePrice(150n);
        expect(big.price.toString()).toBe('150');
        expect(big.exponent).toBe(0);
    });

    it('rejects zero, negative, and scientific-notation prices', () => {
        for (const value of ['0', 0, -150, '1e2', 'abc'] as const) {
            expect(() => priceUsdToContractOraclePrice(value)).toThrow(InvalidFlashAmountError);
        }
    });
});

describe('compareUsdValues', () => {
    it('treats formatting variants of the same value as equal', () => {
        expect(compareUsdValues('150', '150.0')).toBe(0);
        expect(compareUsdValues(150, '150.000')).toBe(0);
    });

    it('orders values correctly', () => {
        expect(compareUsdValues('150.5', '150')).toBe(1);
        expect(compareUsdValues('149.999999', 150)).toBe(-1);
    });
});

describe('sizeAmountForPercent', () => {
    it('computes exact percentages with floor division', () => {
        expect(sizeAmountForPercent(new BN(1000), 100).toString()).toBe('1000');
        expect(sizeAmountForPercent(new BN(1000), 50).toString()).toBe('500');
        expect(sizeAmountForPercent(new BN(1000), 33.33).toString()).toBe('333');
    });

    it('rejects out-of-range and malformed percents', () => {
        for (const percent of [0, -1, 101, Number.NaN] as const) {
            expect(() => sizeAmountForPercent(new BN(1000), percent)).toThrow(UnsupportedFlashOrderConfigError);
        }
    });
});

describe('assertPositiveDecimal', () => {
    it('accepts positive plain decimals', () => {
        for (const value of ['1', '0.5', 5, 2n, '10.25'] as const) {
            expect(() => assertPositiveDecimal(value, 'amount')).not.toThrow();
        }
    });

    it('rejects zero and zero-like strings', () => {
        for (const value of ['0', '0.000', 0, 0n] as const) {
            expect(() => assertPositiveDecimal(value, 'amount')).toThrow(InvalidFlashAmountError);
        }
    });
});

describe('assertSupportedCollateral', () => {
    it('rejects native SOL with an actionable error', () => {
        expect(() => assertSupportedCollateral('SOL', 'collateral')).toThrow(UnsupportedFlashCollateralError);
        expect(() => assertSupportedCollateral('SOL', 'collateral')).toThrow(/USDC|WSOL/);
    });

    it('accepts SPL tokens', () => {
        for (const symbol of ['USDC', 'WSOL', 'JitoSOL', 'BTC'] as const) {
            expect(() => assertSupportedCollateral(symbol, 'collateral')).not.toThrow();
        }
    });
});

describe('assertTraderMatchesProvider', () => {
    it('accepts a trader that matches the provider wallet', () => {
        const { context } = createFakeFlashClient();
        expect(() => assertTraderMatchesProvider(context, { owner: OWNER })).not.toThrow();
    });

    it('rejects a mismatching trader with structured fields', () => {
        const { context } = createFakeFlashClient();
        const other = 'So11111111111111111111111111111111111111112';

        try {
            assertTraderMatchesProvider(context, { owner: other });
            expect.unreachable('should have thrown');
        } catch (error) {
            expect(error).toBeInstanceOf(FlashTraderMismatchError);
            expect((error as FlashTraderMismatchError).traderOwner).toBe(other);
            expect((error as FlashTraderMismatchError).providerWallet).toBe(OWNER);
        }
    });
});

describe('real Crypto.1 PoolConfig resolution (bundled fixture, no network)', () => {
    it('resolves token and custody configs for SOL and USDC', () => {
        expect(getTokenConfig(POOL_CONFIG, 'SOL').decimals).toBe(9);
        expect(getTokenConfig(POOL_CONFIG, 'USDC').decimals).toBe(6);
        expect(getCustodyConfig(POOL_CONFIG, 'SOL').decimals).toBe(9);
        expect(getCustodyConfig(POOL_CONFIG, 'USDC').decimals).toBe(6);
    });

    it('throws typed errors for unknown symbols', () => {
        expect(() => getTokenConfig(POOL_CONFIG, 'DOGE')).toThrow(FlashMarketConfigError);
        expect(() => getCustodyConfig(POOL_CONFIG, 'DOGE')).toThrow(FlashMarketConfigError);
    });

    it('resolves the SOL/USDC short market', () => {
        expect(getMarketConfig(POOL_CONFIG, 'SOL', 'USDC', Side.Short)).toBeTruthy();
    });

    it('rejects market/collateral/side combinations that do not exist on the pool', () => {
        // Longs on Crypto.1 collateralize with the target token (or
        // JitoSOL), not USDC — a SOL/USDC long has no market config.
        expect(() => getMarketConfig(POOL_CONFIG, 'SOL', 'USDC', Side.Long)).toThrow(FlashMarketConfigError);
    });
});
