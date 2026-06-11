/**
 * Flash Trade open-position plan builder.
 *
 * @packageDocumentation
 */

import type { BN } from '@coral-xyz/anchor';
import type { TransactionInstruction } from '@solana/web3.js';
import { createFlashApiPriceSource } from './price-source.js';
import { web3InstructionToKit } from './convert.js';
import {
    FLASH_DEFAULT_SLIPPAGE_BPS,
    amountToNative,
    assertNoAdditionalSigners,
    buildInstructionPlan,
    flashPrivilegeNone,
    flashSideFor,
    getCustodyConfig,
    getLookupTableAddresses,
    getMarketConfig,
    getTokenConfig,
    priceUsdToContractOraclePrice,
    publicKey,
    requiredPrice,
    resolveFlashContext,
    resolvePrices,
    sizeAmountForPercent,
    ZERO_CONTRACT_ORACLE_PRICE,
    decimalToScaledBn,
} from './pool.js';
import {
    type FlashActionsContext,
    InvalidFlashRiskConfigError,
    UnsupportedFlashOrderConfigError,
    type FlashOpenPositionEntry,
    type FlashOpenPositionPlanOptions,
    type FlashOpenPositionPlanResult,
    type FlashPositionRisk,
} from './types.js';

export type { FlashOpenPositionPlanOptions, FlashOpenPositionPlanResult } from './types.js';

function assertPositiveAmount(amount: number | string | bigint): void {
    if (typeof amount === 'bigint' && amount <= 0n) {
        throw new UnsupportedFlashOrderConfigError('Flash collateral amount must be greater than zero.');
    }
    if (typeof amount === 'number' && amount <= 0) {
        throw new UnsupportedFlashOrderConfigError('Flash collateral amount must be greater than zero.');
    }
}

function validateEntry(entry: FlashOpenPositionEntry): void {
    if (entry.type === 'market') {
        return;
    }
    if (entry.type === 'limit') {
        if (entry.priceUsd === undefined || entry.priceUsd === null) {
            throw new UnsupportedFlashOrderConfigError('Flash limit entries require priceUsd.');
        }
        return;
    }

    throw new UnsupportedFlashOrderConfigError(
        `Unsupported Flash entry type: ${String((entry as { type?: unknown }).type)}`,
    );
}

function validateRisk(risk: FlashPositionRisk | undefined): void {
    if (!risk) {
        return;
    }
    if (
        risk.takeProfit &&
        risk.stopLoss &&
        String(risk.takeProfit.triggerPriceUsd) === String(risk.stopLoss.triggerPriceUsd)
    ) {
        throw new InvalidFlashRiskConfigError('Flash take-profit and stop-loss trigger prices must differ.');
    }
}

function append(instructions: TransactionInstruction[], result: { instructions: TransactionInstruction[] }): void {
    instructions.push(...result.instructions);
}

async function appendMarketRiskInstructions(
    context: FlashActionsContext,
    options: FlashOpenPositionPlanOptions,
    sizeAmount: BN,
    instructions: TransactionInstruction[],
): Promise<void> {
    if (!options.risk || (!options.risk.takeProfit && !options.risk.stopLoss)) {
        return;
    }

    const side = flashSideFor(options.side);
    const collateralSymbol = options.collateral.symbol ?? options.symbol;

    if (options.risk.takeProfit) {
        const result = await context.client.placeTriggerOrder(
            options.symbol,
            collateralSymbol,
            options.risk.takeProfit.receiveSymbol ?? collateralSymbol,
            side,
            priceUsdToContractOraclePrice(options.risk.takeProfit.triggerPriceUsd),
            sizeAmountForPercent(sizeAmount, options.risk.takeProfit.sizePercent ?? 100),
            false,
            context.poolConfig,
        );
        assertNoAdditionalSigners(result, 'take-profit trigger order');
        append(instructions, result);
    }

    if (options.risk.stopLoss) {
        const result = await context.client.placeTriggerOrder(
            options.symbol,
            collateralSymbol,
            options.risk.stopLoss.receiveSymbol ?? collateralSymbol,
            side,
            priceUsdToContractOraclePrice(options.risk.stopLoss.triggerPriceUsd),
            sizeAmountForPercent(sizeAmount, options.risk.stopLoss.sizePercent ?? 100),
            true,
            context.poolConfig,
        );
        assertNoAdditionalSigners(result, 'stop-loss trigger order');
        append(instructions, result);
    }
}

export async function getFlashOpenPositionPlan(
    options: FlashOpenPositionPlanOptions,
): Promise<FlashOpenPositionPlanResult> {
    assertPositiveAmount(options.collateral.amount);
    validateEntry(options.entry);
    validateRisk(options.risk);

    const context = resolveFlashContext(options);
    const priceSource = options.priceSource ?? createFlashApiPriceSource();
    const side = flashSideFor(options.side);
    const collateralSymbol = options.collateral.symbol ?? options.symbol;
    const collateralToken = getTokenConfig(context.poolConfig, collateralSymbol);
    const collateralCustody = getCustodyConfig(context.poolConfig, collateralSymbol);
    const marketConfig = getMarketConfig(context.poolConfig, options.symbol, collateralSymbol, side);
    const collateralAmount = amountToNative(options.collateral.amount, collateralToken.decimals);
    const owner = publicKey(options.trader.owner);
    const lookupTableAddresses = await getLookupTableAddresses(context);
    const prices = await resolvePrices(priceSource, [options.symbol, collateralSymbol]);
    const targetPrice = requiredPrice(prices, options.symbol);
    const slippageBps =
        options.entry.type === 'market' ? (options.entry.slippageBps ?? FLASH_DEFAULT_SLIPPAGE_BPS) : null;
    const limitPrice = options.entry.type === 'limit' ? priceUsdToContractOraclePrice(options.entry.priceUsd) : null;
    const takeProfitPrice = options.risk?.takeProfit
        ? priceUsdToContractOraclePrice(options.risk.takeProfit.triggerPriceUsd)
        : null;
    const stopLossPrice = options.risk?.stopLoss
        ? priceUsdToContractOraclePrice(options.risk.stopLoss.triggerPriceUsd)
        : null;

    const quote = await context.client.getOpenPositionQuote(
        collateralAmount,
        decimalToScaledBn(options.leverage, 4),
        marketConfig,
        context.poolConfig,
        flashPrivilegeNone(),
        collateralCustody,
        undefined,
        null,
        limitPrice,
        owner,
        takeProfitPrice,
        stopLossPrice,
    );

    const instructions: TransactionInstruction[] = [];

    if (options.entry.type === 'market') {
        const openResult = await context.client.openPosition(
            options.symbol,
            collateralSymbol,
            context.client.getPriceAfterSlippage(
                true,
                decimalToScaledBn(slippageBps ?? FLASH_DEFAULT_SLIPPAGE_BPS, 0),
                targetPrice,
                side,
            ),
            collateralAmount,
            quote.sizeAmount,
            side,
            context.poolConfig,
            flashPrivilegeNone(),
            undefined,
            undefined,
            options.skipBalanceChecks,
        );
        assertNoAdditionalSigners(openResult, 'open position');
        append(instructions, openResult);
        await appendMarketRiskInstructions(context, options, quote.sizeAmount, instructions);
    } else {
        const result = await context.client.placeLimitOrder(
            options.symbol,
            collateralSymbol,
            options.entry.reserveSymbol ?? collateralSymbol,
            options.entry.receiveSymbol ?? collateralSymbol,
            side,
            limitPrice ?? ZERO_CONTRACT_ORACLE_PRICE,
            collateralAmount,
            quote.sizeAmount,
            stopLossPrice ?? ZERO_CONTRACT_ORACLE_PRICE,
            takeProfitPrice ?? ZERO_CONTRACT_ORACLE_PRICE,
            context.poolConfig,
            options.skipBalanceChecks,
        );
        assertNoAdditionalSigners(result, 'limit order');
        append(instructions, result);
    }

    return {
        plan: buildInstructionPlan(instructions.map(instruction => web3InstructionToKit(instruction))),
        lookupTableAddresses,
        order: {
            symbol: options.symbol,
            collateralSymbol,
            side: options.side,
            entryType: options.entry.type,
            slippageBps,
            poolName: context.poolName,
            cluster: context.cluster,
        },
        risk: {
            takeProfit: options.risk?.takeProfit !== undefined,
            stopLoss: options.risk?.stopLoss !== undefined,
        },
        flash: {
            instructions,
            quote,
            poolName: context.poolName,
            cluster: context.cluster,
        },
    };
}
