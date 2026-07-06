/**
 * Flash Trade close-position plan builder.
 *
 * @packageDocumentation
 */

import type { PublicKey } from '@solana/web3.js';
import { createFlashPythPriceSource } from './price-source.js';
import { web3InstructionToKit } from './convert.js';
import {
    FLASH_DEFAULT_SLIPPAGE_BPS,
    assertNoAdditionalSigners,
    assertPositiveDecimal,
    assertSupportedCollateral,
    assertTraderMatchesProvider,
    buildInstructionPlan,
    flashPrivilegeNone,
    flashSideFor,
    getCustodyConfig,
    getLookupTableAddresses,
    decimalToScaledBn,
    publicKey,
    requiredPrice,
    resolveFlashContext,
    resolvePrices,
    usdToNative,
} from './pool.js';
import {
    UnsupportedFlashOrderConfigError,
    type FlashClosePositionPlanOptions,
    type FlashClosePositionPlanResult,
    type FlashCloseSize,
} from './types.js';

export type { FlashClosePositionPlanOptions, FlashClosePositionPlanResult } from './types.js';

function isFullClose(size: FlashCloseSize): size is { percent: 100 } {
    return 'percent' in size;
}

function validateSize(size: FlashCloseSize): void {
    if ('percent' in size) {
        // The percent path maps to flash-sdk's closePosition, which always
        // closes the entire position — accepting any other percent here
        // would silently close 100%.
        if (size.percent !== 100) {
            throw new UnsupportedFlashOrderConfigError(
                `Flash percent-based closes only support percent: 100 (got ${String(size.percent)}); use size: { sizeUsd } for partial closes.`,
            );
        }
        return;
    }

    assertPositiveDecimal(size.sizeUsd, 'close sizeUsd');
}

function positionAddressFor(options: FlashClosePositionPlanOptions): PublicKey | undefined {
    if (options.positionAddress) {
        return publicKey(options.positionAddress);
    }
    return undefined;
}

/**
 * Builds an InstructionPlan that fully or partially closes a Flash perps
 * position.
 *
 * Notes:
 * - `collateralSymbol` identifies the position (it participates in the
 *   position PDA derivation) and is also the token received on close.
 *   Receiving a different token (`receiveSymbol`) requires flash-sdk's
 *   `closeAndSwap` flow, which this package does not wrap yet — passing a
 *   different `receiveSymbol` throws instead of silently deriving the wrong
 *   position account.
 * - `trader.owner` must equal the provider wallet.
 * - Native SOL collateral is rejected in V1; use USDC or pre-wrapped WSOL.
 *
 * @example
 * ```ts
 * const { plan } = await getFlashClosePositionPlan({
 *     clientConfig: { provider },
 *     trader: { owner: provider.wallet.publicKey.toBase58() },
 *     symbol: 'SOL',
 *     collateralSymbol: 'USDC',
 *     side: 'short',
 *     size: { percent: 100 },
 * });
 * ```
 */
export async function getFlashClosePositionPlan(
    options: FlashClosePositionPlanOptions,
): Promise<FlashClosePositionPlanResult> {
    validateSize(options.size);

    const context = resolveFlashContext(options);
    assertTraderMatchesProvider(context, options.trader);

    const collateralSymbol = options.collateralSymbol ?? options.symbol;
    const receiveSymbol = options.receiveSymbol ?? collateralSymbol;
    assertSupportedCollateral(collateralSymbol, 'close collateral');
    assertSupportedCollateral(receiveSymbol, 'close receive token');

    if (receiveSymbol !== collateralSymbol) {
        throw new UnsupportedFlashOrderConfigError(
            `Flash closes currently receive the position's collateral token (${collateralSymbol}); ` +
                `receiving ${receiveSymbol} requires flash-sdk's closeAndSwap flow, which is not wrapped yet.`,
        );
    }

    const fullClose = isFullClose(options.size);
    if (fullClose && options.positionAddress !== undefined) {
        throw new UnsupportedFlashOrderConfigError(
            'Flash full closes derive the position from the provider wallet; positionAddress is only supported for partial closes.',
        );
    }

    const side = flashSideFor(options.side);
    const slippageBps = options.slippageBps ?? FLASH_DEFAULT_SLIPPAGE_BPS;
    const priceSource = options.priceSource ?? createFlashPythPriceSource({ poolConfig: context.poolConfig });
    const lookupTableAddresses = await getLookupTableAddresses(context);
    const prices = await resolvePrices(priceSource, [options.symbol]);
    const targetPrice = requiredPrice(prices, options.symbol);
    const priceWithSlippage = context.client.getPriceAfterSlippage(
        false,
        decimalToScaledBn(slippageBps, 0),
        targetPrice,
        side,
    );

    const instructionsResult = fullClose
        ? await context.client.closePosition(
              options.symbol,
              // collateralSymbol (NOT receiveSymbol): flash-sdk derives the
              // position PDA and receiving ATA from this argument.
              collateralSymbol,
              priceWithSlippage,
              side,
              context.poolConfig,
              flashPrivilegeNone(),
              undefined,
              undefined,
              options.createUserATA,
              options.closeUsersWSOLATA,
          )
        : await context.client.decreaseSize(
              options.symbol,
              collateralSymbol,
              side,
              positionAddressFor(options) ??
                  context.client.getPositionKey(
                      publicKey(options.trader.owner),
                      getCustodyConfig(context.poolConfig, options.symbol).custodyAccount,
                      getCustodyConfig(context.poolConfig, collateralSymbol).custodyAccount,
                      side,
                  ),
              context.poolConfig,
              priceWithSlippage,
              targetPrice.getTokenAmount(
                  usdToNative((options.size as { sizeUsd: number | string | bigint }).sizeUsd),
                  getCustodyConfig(context.poolConfig, options.symbol).decimals,
              ),
              flashPrivilegeNone(),
          );

    assertNoAdditionalSigners(instructionsResult, fullClose ? 'close position' : 'decrease size');
    const instructions = instructionsResult.instructions;

    return {
        plan: buildInstructionPlan(instructions.map(instruction => web3InstructionToKit(instruction))),
        lookupTableAddresses,
        order: {
            symbol: options.symbol,
            collateralSymbol,
            receiveSymbol,
            side: options.side,
            closeType: fullClose ? 'full' : 'partial',
            slippageBps,
            poolName: context.poolName,
            cluster: context.cluster,
        },
        flash: {
            instructions,
            poolName: context.poolName,
            cluster: context.cluster,
        },
    };
}
