/**
 * Shared Flash Trade pool and planning helpers.
 *
 * @packageDocumentation
 */

import { BN } from '@coral-xyz/anchor';
import { PublicKey } from '@solana/web3.js';
import {
    Privilege,
    Side,
    USD_DECIMALS,
    uiDecimalsToNative,
    type ContractOraclePrice,
    type CustodyConfig,
    type MarketConfig,
    type OraclePrice,
    type PoolConfig,
    type Token,
} from 'flash-sdk';
import {
    type InstructionPlan,
    nonDivisibleSequentialInstructionPlan,
    singleInstructionPlan,
} from '@solana/instruction-plans';
import type { Address } from '@solana/addresses';
import { createFlashActionsClient } from './client.js';
import { web3InstructionToKit, web3LookupTableAddressesToKit } from './convert.js';
import {
    FlashClientRequiredError,
    FlashMarketConfigError,
    FlashTraderMismatchError,
    InvalidFlashAmountError,
    InvalidFlashPositionSideError,
    UnsupportedFlashAdditionalSignersError,
    UnsupportedFlashCollateralError,
    UnsupportedFlashOrderConfigError,
    type FlashActionsContext,
    type FlashActionsOptions,
    type FlashPositionSide,
    type FlashPriceSource,
    type FlashSdkInstructionResult,
    type FlashTraderRef,
} from './types.js';

export const FLASH_DEFAULT_POOL_NAME = 'Crypto.1';
export const FLASH_DEFAULT_CLUSTER = 'mainnet-beta';
/**
 * Default slippage tolerance: 0.8%. flash-sdk's `getPriceAfterSlippage` uses
 * `BPS_DECIMALS = 4` (bps / 10^4), so 80 → 0.8%. The previous default of 800
 * was an 8% tolerance — an 80% equity swing at 10x leverage.
 */
export const FLASH_DEFAULT_SLIPPAGE_BPS = 80;

export function resolveFlashContext(options: FlashActionsOptions): FlashActionsContext {
    if (options.context) {
        return options.context;
    }

    if (options.client && options.poolConfig) {
        return {
            client: options.client,
            poolConfig: options.poolConfig,
            cluster: options.cluster ?? FLASH_DEFAULT_CLUSTER,
            poolName: options.poolName ?? options.poolConfig.poolName ?? FLASH_DEFAULT_POOL_NAME,
        };
    }

    if (options.clientConfig) {
        return createFlashActionsClient(options.clientConfig);
    }

    throw new FlashClientRequiredError('Flash actions require context, client + poolConfig, or clientConfig.');
}

export function flashSideFor(side: FlashPositionSide) {
    if (side === 'long') {
        return Side.Long;
    }
    if (side === 'short') {
        return Side.Short;
    }

    throw new InvalidFlashPositionSideError(`Unsupported Flash position side: ${String(side)}`);
}

export function publicKey(value: Address | string): PublicKey {
    return new PublicKey(String(value));
}

export function getTokenConfig(poolConfig: PoolConfig, symbol: string): Token {
    let token: Token | undefined;
    try {
        token = poolConfig.getTokenFromSymbol(symbol);
    } catch {
        token = undefined;
    }

    if (!token) {
        throw new FlashMarketConfigError(`Flash pool ${poolConfig.poolName} does not contain token ${symbol}.`);
    }

    return token;
}

export function getCustodyConfig(poolConfig: PoolConfig, symbol: string): CustodyConfig {
    const custody = poolConfig.custodies.find(config => config.symbol === symbol);
    if (!custody) {
        throw new FlashMarketConfigError(`Flash pool ${poolConfig.poolName} does not contain custody ${symbol}.`);
    }

    return custody;
}

export function getMarketConfig(
    poolConfig: PoolConfig,
    targetSymbol: string,
    collateralSymbol: string,
    side: ReturnType<typeof flashSideFor>,
): MarketConfig {
    const targetCustody = getCustodyConfig(poolConfig, targetSymbol);
    const collateralCustody = getCustodyConfig(poolConfig, collateralSymbol);
    const market = poolConfig.getMarketConfig(targetCustody.custodyAccount, collateralCustody.custodyAccount, side);

    if (!market) {
        throw new FlashMarketConfigError(
            `Flash pool ${poolConfig.poolName} does not contain ${targetSymbol}/${collateralSymbol} ${Object.keys(side)[0]} market.`,
        );
    }

    return market;
}

export async function getLookupTableAddresses(context: FlashActionsContext): Promise<Address[]> {
    const result = await context.client.getOrLoadAddressLookupTable(context.poolConfig);
    return web3LookupTableAddressesToKit(result.addressLookupTables.map(table => table.key));
}

export async function resolvePrices(
    priceSource: FlashPriceSource,
    symbols: string[],
): Promise<Map<string, OraclePrice>> {
    return priceSource([...new Set(symbols)]);
}

export function requiredPrice(prices: Map<string, OraclePrice>, symbol: string): OraclePrice {
    const price = prices.get(symbol);
    if (!price) {
        throw new FlashMarketConfigError(`Flash price source did not return ${symbol}.`);
    }

    return price;
}

const DECIMAL_STRING_PATTERN = /^\d+(\.\d+)?$/;

/**
 * Normalizes and validates a user-supplied numeric value as a plain
 * non-negative decimal string. Rejects negatives, scientific notation
 * (`String(1e-7) === '1e-7'` would otherwise crash BN construction), and
 * non-numeric strings with a typed error instead of an opaque BN crash.
 */
export function toDecimalString(value: number | string | bigint, label: string): string {
    if (typeof value === 'bigint') {
        if (value < 0n) {
            throw new InvalidFlashAmountError(`Flash ${label} must not be negative (got ${value.toString()}).`);
        }
        return value.toString();
    }

    if (typeof value === 'number' && !Number.isFinite(value)) {
        throw new InvalidFlashAmountError(`Flash ${label} must be a finite number (got ${String(value)}).`);
    }

    const raw = String(value);
    if (!DECIMAL_STRING_PATTERN.test(raw)) {
        throw new InvalidFlashAmountError(
            `Flash ${label} must be a plain non-negative decimal (got "${raw}"); pass a string for very small or very large values.`,
        );
    }

    return raw;
}

/** Validates that a numeric input is a strictly positive plain decimal. */
export function assertPositiveDecimal(value: number | string | bigint, label: string): void {
    const raw = toDecimalString(value, label);
    if (!/[1-9]/.test(raw)) {
        throw new InvalidFlashAmountError(`Flash ${label} must be greater than zero.`);
    }
}

export function amountToNative(amount: number | string | bigint, decimals: number): BN {
    return uiDecimalsToNative(toDecimalString(amount, 'amount'), decimals);
}

export function decimalToScaledBn(value: number | string | bigint, decimals: number): BN {
    if (typeof value === 'bigint') {
        toDecimalString(value, 'value');
        return new BN(value.toString()).mul(new BN(10).pow(new BN(decimals)));
    }

    const raw = toDecimalString(value, 'value');
    const [whole = '0', fraction = ''] = raw.split('.');
    const normalizedFraction = fraction.padEnd(decimals, '0').slice(0, decimals);
    return new BN(`${whole}${normalizedFraction}`.replace(/^0+(?=\d)/, ''));
}

export function usdToNative(value: number | string | bigint): BN {
    return decimalToScaledBn(value, USD_DECIMALS);
}

export function priceUsdToContractOraclePrice(value: number | string | bigint): ContractOraclePrice {
    assertPositiveDecimal(value, 'price');

    if (typeof value === 'bigint') {
        return {
            price: new BN(value.toString()),
            exponent: 0,
        };
    }

    const raw = toDecimalString(value, 'price');
    const [whole = '0', fraction = ''] = raw.split('.');
    return {
        price: new BN(`${whole}${fraction}`.replace(/^0+(?=\d)/, '')),
        // `0 - length` (not `-length`) so whole numbers yield +0, not -0.
        exponent: 0 - fraction.length,
    };
}

/**
 * Compares two USD decimal inputs at a fixed scale, so `'150'`, `'150.0'`,
 * and `150` compare equal. Returns -1, 0, or 1.
 */
export function compareUsdValues(a: number | string | bigint, b: number | string | bigint): number {
    const scaledA = decimalToScaledBn(a, 12);
    const scaledB = decimalToScaledBn(b, 12);
    return scaledA.cmp(scaledB);
}

export const ZERO_CONTRACT_ORACLE_PRICE: ContractOraclePrice = {
    price: new BN(0),
    exponent: 0,
};

export function sizeAmountForPercent(sizeAmount: BN, percent = 100): BN {
    if (typeof percent !== 'number' || !Number.isFinite(percent) || percent <= 0 || percent > 100) {
        throw new UnsupportedFlashOrderConfigError('Flash risk sizePercent must be greater than 0 and at most 100.');
    }

    return sizeAmount.mul(new BN(Math.round(percent * 100))).div(new BN(10_000));
}

export function assertNoAdditionalSigners(result: FlashSdkInstructionResult, label: string): void {
    if (result.additionalSigners.length > 0) {
        throw new UnsupportedFlashAdditionalSignersError(
            `Flash ${label} returned ${result.additionalSigners.length} additional signer(s), which executePlan cannot sign in V1.`,
        );
    }
}

/**
 * Rejects native SOL early with an actionable error. flash-sdk handles SOL
 * collateral by creating an ephemeral wSOL Keypair signer, which
 * `executePlan` cannot sign in V1 — without this guard the failure surfaces
 * as a generic additional-signers error at the end of plan building.
 */
export function assertSupportedCollateral(symbol: string, label: string): void {
    if (symbol === 'SOL') {
        throw new UnsupportedFlashCollateralError(
            `Flash ${label} does not support native SOL in V1 (flash-sdk requires an ephemeral wSOL signer). ` +
                'Use an SPL token such as USDC, or pre-wrapped WSOL.',
        );
    }
}

/**
 * flash-sdk builds every instruction for `provider.wallet.publicKey`; a
 * mismatching `trader.owner` would silently produce plans that fail
 * signature verification or route funds to the wrong wallet's ATAs.
 */
export function assertTraderMatchesProvider(context: FlashActionsContext, trader: FlashTraderRef): void {
    const providerWallet = context.client.provider.wallet.publicKey.toBase58();
    const traderOwner = String(trader.owner);
    if (traderOwner !== providerWallet) {
        throw new FlashTraderMismatchError(traderOwner, providerWallet);
    }
}

/**
 * flash-sdk instruction groups (ATA create → open/close → wSOL teardown,
 * entry → trigger orders) must land in a single transaction, so multi-
 * instruction plans are non-divisible.
 */
export function buildInstructionPlan(instructions: ReturnType<typeof web3InstructionToKit>[]): InstructionPlan {
    if (instructions.length === 1) {
        return singleInstructionPlan(instructions[0]);
    }

    return nonDivisibleSequentialInstructionPlan(instructions);
}

export function flashPrivilegeNone() {
    return Privilege.None;
}
