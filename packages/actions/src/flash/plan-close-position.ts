/**
 * Flash Trade close-position plan builder.
 *
 * @packageDocumentation
 */

import type { PublicKey } from '@solana/web3.js';
import { createFlashApiPriceSource } from './price-source.js';
import { web3InstructionToKit } from './convert.js';
import {
    FLASH_DEFAULT_SLIPPAGE_BPS,
    assertNoAdditionalSigners,
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
import { type FlashClosePositionPlanOptions, type FlashClosePositionPlanResult } from './types.js';

export type { FlashClosePositionPlanOptions, FlashClosePositionPlanResult } from './types.js';

function isFullClose(size: FlashClosePositionPlanOptions['size']): size is { percent: 100 } {
    return 'percent' in size;
}

function positionAddressFor(options: FlashClosePositionPlanOptions): PublicKey | undefined {
    if (options.positionAddress) {
        return publicKey(options.positionAddress);
    }
    return undefined;
}

export async function getFlashClosePositionPlan(
    options: FlashClosePositionPlanOptions,
): Promise<FlashClosePositionPlanResult> {
    const context = resolveFlashContext(options);
    const priceSource = options.priceSource ?? createFlashApiPriceSource();
    const side = flashSideFor(options.side);
    const collateralSymbol = options.collateralSymbol ?? options.symbol;
    const receiveSymbol = options.receiveSymbol ?? collateralSymbol;
    const slippageBps = options.slippageBps ?? FLASH_DEFAULT_SLIPPAGE_BPS;
    const lookupTableAddresses = await getLookupTableAddresses(context);
    const prices = await resolvePrices(priceSource, [options.symbol]);
    const targetPrice = requiredPrice(prices, options.symbol);
    const priceWithSlippage = context.client.getPriceAfterSlippage(
        false,
        decimalToScaledBn(slippageBps, 0),
        targetPrice,
        side,
    );

    const instructionsResult = isFullClose(options.size)
        ? await context.client.closePosition(
              options.symbol,
              receiveSymbol,
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
                  usdToNative(options.size.sizeUsd),
                  getCustodyConfig(context.poolConfig, options.symbol).decimals,
              ),
              flashPrivilegeNone(),
          );

    assertNoAdditionalSigners(instructionsResult, isFullClose(options.size) ? 'close position' : 'decrease size');
    const instructions = instructionsResult.instructions;

    return {
        plan: buildInstructionPlan(instructions.map(instruction => web3InstructionToKit(instruction))),
        lookupTableAddresses,
        order: {
            symbol: options.symbol,
            collateralSymbol,
            receiveSymbol,
            side: options.side,
            closeType: isFullClose(options.size) ? 'full' : 'partial',
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
