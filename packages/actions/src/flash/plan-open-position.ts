/**
 * Flash Trade open-position plan builder.
 *
 * @packageDocumentation
 */

import type { BN } from '@coral-xyz/anchor';
import type { TransactionInstruction } from '@solana/web3.js';
import { createFlashPythPriceSource } from './price-source.js';
import { web3InstructionToKit } from './convert.js';
import {
    FLASH_DEFAULT_SLIPPAGE_BPS,
    amountToNative,
    assertNoAdditionalSigners,
    assertPositiveDecimal,
    assertSupportedCollateral,
    assertTraderMatchesProvider,
    buildInstructionPlan,
    compareUsdValues,
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
    type FlashPositionSide,
    type FlashPositionRisk,
} from './types.js';

export type { FlashOpenPositionPlanOptions, FlashOpenPositionPlanResult } from './types.js';

function validateEntry(entry: FlashOpenPositionEntry): void {
    if (entry.type === 'market') {
        return;
    }
    if (entry.type === 'limit') {
        if (entry.priceUsd === undefined || entry.priceUsd === null) {
            throw new UnsupportedFlashOrderConfigError('Flash limit entries require priceUsd.');
        }
        assertPositiveDecimal(entry.priceUsd, 'limit entry price');
        return;
    }

    throw new UnsupportedFlashOrderConfigError(
        `Unsupported Flash entry type: ${String((entry as { type?: unknown }).type)}`,
    );
}

/**
 * Validates risk legs after normalizing prices to a common scale — string
 * equality misses `'150'` vs `'150.0'` — and enforces side-relative
 * ordering (long: TP above SL, and around a limit entry: TP > entry > SL).
 */
function validateRisk(
    risk: FlashPositionRisk | undefined,
    side: FlashPositionSide,
    entry: FlashOpenPositionEntry,
): void {
    if (!risk) {
        return;
    }

    for (const [label, leg] of [
        ['take-profit', risk.takeProfit],
        ['stop-loss', risk.stopLoss],
    ] as const) {
        if (!leg) {
            continue;
        }
        assertPositiveDecimal(leg.triggerPriceUsd, `${label} trigger price`);
        if (entry.type === 'limit' && (leg.sizePercent !== undefined || leg.receiveSymbol !== undefined)) {
            throw new InvalidFlashRiskConfigError(
                `Flash limit entries embed TP/SL prices in the order itself: ${label} sizePercent/receiveSymbol are not supported and would be silently ignored.`,
            );
        }
    }

    if (risk.takeProfit && risk.stopLoss) {
        const comparison = compareUsdValues(risk.takeProfit.triggerPriceUsd, risk.stopLoss.triggerPriceUsd);
        if (comparison === 0) {
            throw new InvalidFlashRiskConfigError('Flash take-profit and stop-loss trigger prices must differ.');
        }
        if (side === 'long' && comparison < 0) {
            throw new InvalidFlashRiskConfigError(
                'Flash long positions require the take-profit trigger above the stop-loss trigger.',
            );
        }
        if (side === 'short' && comparison > 0) {
            throw new InvalidFlashRiskConfigError(
                'Flash short positions require the take-profit trigger below the stop-loss trigger.',
            );
        }
    }

    if (entry.type === 'limit') {
        if (risk.takeProfit) {
            const tpVsEntry = compareUsdValues(risk.takeProfit.triggerPriceUsd, entry.priceUsd);
            if (side === 'long' ? tpVsEntry <= 0 : tpVsEntry >= 0) {
                throw new InvalidFlashRiskConfigError(
                    `Flash ${side} take-profit trigger must be ${side === 'long' ? 'above' : 'below'} the limit entry price.`,
                );
            }
        }
        if (risk.stopLoss) {
            const slVsEntry = compareUsdValues(risk.stopLoss.triggerPriceUsd, entry.priceUsd);
            if (side === 'long' ? slVsEntry >= 0 : slVsEntry <= 0) {
                throw new InvalidFlashRiskConfigError(
                    `Flash ${side} stop-loss trigger must be ${side === 'long' ? 'below' : 'above'} the limit entry price.`,
                );
            }
        }
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

/**
 * Builds an InstructionPlan that opens a Flash perps position (market) or
 * places a limit entry, optionally protected by TP/SL trigger orders.
 *
 * Notes:
 * - Plan building is NOT offline: flash-sdk sizes the position by simulating
 *   a quote through the provider's RPC connection, and may check ATA
 *   existence. The AnchorProvider must point at a live RPC endpoint.
 * - `trader.owner` must equal the provider wallet (flash-sdk signs for the
 *   provider wallet); a mismatch throws {@link FlashTraderMismatchError}.
 * - Native SOL collateral is rejected in V1 (see
 *   {@link UnsupportedFlashCollateralError}); use USDC or pre-wrapped WSOL.
 *
 * @example
 * ```ts
 * const { plan } = await getFlashOpenPositionPlan({
 *     clientConfig: { provider },
 *     trader: { owner: provider.wallet.publicKey.toBase58() },
 *     symbol: 'SOL',
 *     side: 'long',
 *     collateral: { amount: '25', symbol: 'USDC' },
 *     leverage: 5,
 *     entry: { type: 'market' },
 *     risk: {
 *         takeProfit: { triggerPriceUsd: '180' },
 *         stopLoss: { triggerPriceUsd: '140' },
 *     },
 * });
 * ```
 */
export async function getFlashOpenPositionPlan(
    options: FlashOpenPositionPlanOptions,
): Promise<FlashOpenPositionPlanResult> {
    assertPositiveDecimal(options.collateral.amount, 'collateral amount');
    assertPositiveDecimal(options.leverage, 'leverage');
    validateEntry(options.entry);
    validateRisk(options.risk, options.side, options.entry);

    const context = resolveFlashContext(options);
    assertTraderMatchesProvider(context, options.trader);
    const collateralSymbol = options.collateral.symbol ?? options.symbol;
    assertSupportedCollateral(collateralSymbol, 'collateral');

    const priceSource = options.priceSource ?? createFlashPythPriceSource({ poolConfig: context.poolConfig });
    const side = flashSideFor(options.side);
    const collateralToken = getTokenConfig(context.poolConfig, collateralSymbol);
    const collateralCustody = getCustodyConfig(context.poolConfig, collateralSymbol);
    const marketConfig = getMarketConfig(context.poolConfig, options.symbol, collateralSymbol, side);
    const collateralAmount = amountToNative(options.collateral.amount, collateralToken.decimals);
    const owner = publicKey(options.trader.owner);
    const lookupTableAddresses = await getLookupTableAddresses(context);
    // Only the target symbol's price is needed; requesting the collateral
    // price too would fail spuriously when the feed lacks the (stable)
    // collateral symbol.
    const prices = await resolvePrices(priceSource, [options.symbol]);
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
