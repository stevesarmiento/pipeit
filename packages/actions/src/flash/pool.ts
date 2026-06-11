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
import { type InstructionPlan, sequentialInstructionPlan, singleInstructionPlan } from '@solana/instruction-plans';
import type { Address } from '@solana/addresses';
import { createFlashActionsClient } from './client.js';
import { web3InstructionToKit, web3LookupTableAddressesToKit } from './convert.js';
import {
    FlashClientRequiredError,
    FlashMarketConfigError,
    InvalidFlashPositionSideError,
    UnsupportedFlashAdditionalSignersError,
    UnsupportedFlashOrderConfigError,
    type FlashActionsContext,
    type FlashActionsOptions,
    type FlashPositionSide,
    type FlashPriceSource,
    type FlashSdkInstructionResult,
} from './types.js';

export const FLASH_DEFAULT_POOL_NAME = 'Crypto.1';
export const FLASH_DEFAULT_CLUSTER = 'mainnet-beta';
export const FLASH_DEFAULT_SLIPPAGE_BPS = 800;

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
    try {
        return poolConfig.getTokenFromSymbol(symbol);
    } catch {
        throw new FlashMarketConfigError(`Flash pool ${poolConfig.poolName} does not contain token ${symbol}.`);
    }
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

export function amountToNative(amount: number | string | bigint, decimals: number): BN {
    return uiDecimalsToNative(String(amount), decimals);
}

export function decimalToScaledBn(value: number | string | bigint, decimals: number): BN {
    if (typeof value === 'bigint') {
        return new BN(value.toString()).mul(new BN(10).pow(new BN(decimals)));
    }

    const raw = String(value);
    const [whole = '0', fraction = ''] = raw.split('.');
    const normalizedFraction = fraction.padEnd(decimals, '0').slice(0, decimals);
    return new BN(`${whole}${normalizedFraction}`.replace(/^(-?)0+(?=\d)/, '$1'));
}

export function usdToNative(value: number | string | bigint): BN {
    return decimalToScaledBn(value, USD_DECIMALS);
}

export function priceUsdToContractOraclePrice(value: number | string | bigint): ContractOraclePrice {
    if (typeof value === 'bigint') {
        return {
            price: new BN(value.toString()),
            exponent: 0,
        };
    }

    const raw = String(value);
    const [whole = '0', fraction = ''] = raw.split('.');
    return {
        price: new BN(`${whole}${fraction}`.replace(/^(-?)0+(?=\d)/, '$1')),
        exponent: -fraction.length,
    };
}

export const ZERO_CONTRACT_ORACLE_PRICE: ContractOraclePrice = {
    price: new BN(0),
    exponent: 0,
};

export function sizeAmountForPercent(sizeAmount: BN, percent = 100): BN {
    if (percent <= 0 || percent > 100) {
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

export function buildInstructionPlan(instructions: ReturnType<typeof web3InstructionToKit>[]): InstructionPlan {
    if (instructions.length === 1) {
        return singleInstructionPlan(instructions[0]);
    }

    return sequentialInstructionPlan(instructions.map(instruction => singleInstructionPlan(instruction)));
}

export function flashPrivilegeNone() {
    return Privilege.None;
}
