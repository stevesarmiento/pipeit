/**
 * Phoenix open-position plan builder.
 *
 * Converts high-level position intent into Rise order packets, conditional
 * risk legs, and Kit InstructionPlans.
 *
 * @packageDocumentation
 */

import {
    Direction,
    OrderFlags,
    StopLossOrderKind,
    priceUsdToTicksWithMarketParams,
    type ConditionalOrderPacket,
    type ImmediateOrCancelOrderPacket,
    type LimitOrderPacket,
    type OrderPacketMarketParams,
    type PhoenixClient,
    type PostOnlyOrderPacket,
    type Side,
    type Ticks,
    type TriggerOrderParamsInput,
} from '@ellipsis-labs/rise';
import {
    type InstructionPlan,
    nonDivisibleSequentialInstructionPlan,
    singleInstructionPlan,
} from '@solana/instruction-plans';
import { riseInstructionToKit } from './convert.js';
import {
    accountParams,
    asSymbol,
    assertNonZeroBaseLots,
    assertPositiveSize,
    closeSideFor,
    entrySideFor,
    marketParamsFor,
    resolvePhoenixClient,
} from './shared.js';
import type {
    PhoenixConditionalRiskLeg,
    PhoenixLimitEntry,
    PhoenixOpenPositionEntry,
    PhoenixOpenPositionPlanOptions,
    PhoenixOpenPositionPlanResult,
    PhoenixOrderPacket,
    PhoenixPositionRisk,
    PhoenixPositionSide,
    PhoenixRiskMode,
    RiseInstructionLike,
} from './types.js';
import { InvalidPhoenixRiskConfigError, UnsupportedPhoenixOrderConfigError } from './types.js';

export type { PhoenixOpenPositionPlanOptions, PhoenixOpenPositionPlanResult } from './types.js';

function takeProfitDirectionFor(positionSide: PhoenixPositionSide): Direction {
    return positionSide === 'long' ? Direction.GreaterThan : Direction.LessThan;
}

function stopLossDirectionFor(positionSide: PhoenixPositionSide): Direction {
    return positionSide === 'long' ? Direction.LessThan : Direction.GreaterThan;
}

function validateEntry(entry: PhoenixOpenPositionEntry): void {
    if (entry.type === 'market') {
        return;
    }
    if (entry.type === 'limit') {
        if (entry.priceUsd === undefined || entry.priceUsd === null) {
            throw new UnsupportedPhoenixOrderConfigError('Phoenix limit entries require priceUsd.');
        }
        return;
    }

    throw new UnsupportedPhoenixOrderConfigError(
        `Unsupported Phoenix entry type: ${String((entry as { type?: unknown }).type)}`,
    );
}

function validateRiskShape(risk: PhoenixPositionRisk | undefined): void {
    if (!risk) {
        return;
    }

    for (const leg of [risk.takeProfit, risk.stopLoss]) {
        if (!leg) {
            continue;
        }
        if (leg.type === 'limit' && leg.executionPriceUsd === undefined) {
            throw new InvalidPhoenixRiskConfigError('Phoenix limit risk legs require executionPriceUsd.');
        }
        if (leg.type !== 'market' && leg.type !== 'limit') {
            throw new InvalidPhoenixRiskConfigError(
                `Unsupported Phoenix risk leg type: ${String((leg as { type?: unknown }).type)}`,
            );
        }
    }
}

interface ConvertedRiskLeg {
    trigger: TriggerOrderParamsInput;
    triggerPriceTicks: Ticks;
}

function riskLegToTriggerOrder(
    leg: PhoenixConditionalRiskLeg,
    marketParams: OrderPacketMarketParams,
    tradeSide: Side,
    triggerDirection: Direction,
    label: string,
): ConvertedRiskLeg {
    const triggerPrice = priceUsdToTicksWithMarketParams(leg.triggerPriceUsd, marketParams);
    if (triggerPrice <= 0n) {
        throw new InvalidPhoenixRiskConfigError(
            `Phoenix ${label} trigger price rounds down to zero ticks for this market; increase the price.`,
        );
    }

    if (leg.type === 'market') {
        return {
            trigger: {
                triggerDirection,
                tradeSide,
                orderKind: StopLossOrderKind.IOC,
                triggerPrice,
                slippageBps: leg.slippageBps ?? null,
            },
            triggerPriceTicks: triggerPrice,
        };
    }

    const executionPrice = priceUsdToTicksWithMarketParams(leg.executionPriceUsd, marketParams);
    if (executionPrice <= 0n) {
        throw new InvalidPhoenixRiskConfigError(
            `Phoenix ${label} execution price rounds down to zero ticks for this market; increase the price.`,
        );
    }

    return {
        trigger: {
            triggerDirection,
            tradeSide,
            orderKind: StopLossOrderKind.Limit,
            triggerPrice,
            executionPrice,
        },
        triggerPriceTicks: triggerPrice,
    };
}

interface ConvertedRisk {
    takeProfit: ConvertedRiskLeg | null;
    stopLoss: ConvertedRiskLeg | null;
    greaterTriggerOrder: TriggerOrderParamsInput | null;
    lessTriggerOrder: TriggerOrderParamsInput | null;
}

/**
 * Converts USD risk legs into tick-space trigger orders and validates them
 * side-relatively AFTER conversion (string-equality checks on USD inputs
 * miss `'150'` vs `'150.0'` and cannot see rounding collisions).
 */
function convertAndValidateRisk(
    options: PhoenixOpenPositionPlanOptions,
    marketParams: OrderPacketMarketParams,
    tradeSide: Side,
    entryPriceTicks: Ticks | null,
): ConvertedRisk | null {
    const risk = options.risk;
    if (!risk || (!risk.takeProfit && !risk.stopLoss)) {
        return null;
    }

    const takeProfit = risk.takeProfit
        ? riskLegToTriggerOrder(risk.takeProfit, marketParams, tradeSide, takeProfitDirectionFor(options.side), 'take-profit')
        : null;
    const stopLoss = risk.stopLoss
        ? riskLegToTriggerOrder(risk.stopLoss, marketParams, tradeSide, stopLossDirectionFor(options.side), 'stop-loss')
        : null;

    if (takeProfit && stopLoss) {
        if (takeProfit.triggerPriceTicks === stopLoss.triggerPriceTicks) {
            throw new InvalidPhoenixRiskConfigError(
                'Phoenix take-profit and stop-loss trigger prices must differ (they round to the same tick).',
            );
        }
        const tpAboveSl = takeProfit.triggerPriceTicks > stopLoss.triggerPriceTicks;
        if (options.side === 'long' && !tpAboveSl) {
            throw new InvalidPhoenixRiskConfigError(
                'Phoenix long positions require the take-profit trigger above the stop-loss trigger.',
            );
        }
        if (options.side === 'short' && tpAboveSl) {
            throw new InvalidPhoenixRiskConfigError(
                'Phoenix short positions require the take-profit trigger below the stop-loss trigger.',
            );
        }
    }

    if (entryPriceTicks !== null) {
        if (takeProfit) {
            const tpBeyondEntry =
                options.side === 'long'
                    ? takeProfit.triggerPriceTicks > entryPriceTicks
                    : takeProfit.triggerPriceTicks < entryPriceTicks;
            if (!tpBeyondEntry) {
                throw new InvalidPhoenixRiskConfigError(
                    `Phoenix ${options.side} take-profit trigger must be ${options.side === 'long' ? 'above' : 'below'} the limit entry price.`,
                );
            }
        }
        if (stopLoss) {
            const slBeforeEntry =
                options.side === 'long'
                    ? stopLoss.triggerPriceTicks < entryPriceTicks
                    : stopLoss.triggerPriceTicks > entryPriceTicks;
            if (!slBeforeEntry) {
                throw new InvalidPhoenixRiskConfigError(
                    `Phoenix ${options.side} stop-loss trigger must be ${options.side === 'long' ? 'below' : 'above'} the limit entry price.`,
                );
            }
        }
    }

    // A stop-loss limit leg whose execution price sits on the wrong side of
    // its trigger may never fill in a fast move, defeating the protection.
    if (stopLoss?.trigger.orderKind === StopLossOrderKind.Limit && stopLoss.trigger.executionPrice != null) {
        const protective =
            options.side === 'long'
                ? stopLoss.trigger.executionPrice <= stopLoss.triggerPriceTicks
                : stopLoss.trigger.executionPrice >= stopLoss.triggerPriceTicks;
        if (!protective) {
            throw new InvalidPhoenixRiskConfigError(
                `Phoenix ${options.side} stop-loss execution price must be ${options.side === 'long' ? 'at or below' : 'at or above'} its trigger price.`,
            );
        }
    }

    return {
        takeProfit,
        stopLoss,
        greaterTriggerOrder:
            takeProfit?.trigger.triggerDirection === Direction.GreaterThan
                ? takeProfit.trigger
                : stopLoss?.trigger.triggerDirection === Direction.GreaterThan
                  ? stopLoss.trigger
                  : null,
        lessTriggerOrder:
            takeProfit?.trigger.triggerDirection === Direction.LessThan
                ? takeProfit.trigger
                : stopLoss?.trigger.triggerDirection === Direction.LessThan
                  ? stopLoss.trigger
                  : null,
    };
}

/**
 * Builds a proper {@link PostOnlyOrderPacket} from a limit packet using its
 * named fields only — `LimitOrderPacket` and `PostOnlyOrderPacket` are
 * structurally different, so spreading one into the other leaks limit-only
 * fields and silently drops future required post-only fields.
 */
function toPostOnlyPacket(packet: LimitOrderPacket, slide: boolean): PostOnlyOrderPacket {
    return {
        side: packet.side,
        priceInTicks: packet.priceInTicks,
        numBaseLots: packet.numBaseLots,
        clientOrderId: packet.clientOrderId,
        slide,
        lastValidSlot: packet.lastValidSlot,
        orderFlags: packet.orderFlags,
        cancelExisting: packet.cancelExisting,
    };
}

async function buildLimitEntryPacket(
    client: PhoenixClient,
    options: PhoenixOpenPositionPlanOptions,
    entry: PhoenixLimitEntry,
    riseSide: Side,
): Promise<LimitOrderPacket | PostOnlyOrderPacket> {
    const limitOrderPacket = await client.orderPackets.buildLimitOrderPacket({
        symbol: asSymbol(options.symbol),
        side: riseSide,
        priceUsd: entry.priceUsd,
        baseUnits: options.size.baseUnits,
        ...(entry.clientOrderId !== undefined && { clientOrderId: entry.clientOrderId }),
        ...(entry.lastValidSlot !== undefined && { lastValidSlot: entry.lastValidSlot }),
        ...(entry.orderFlags !== undefined && { orderFlags: entry.orderFlags as OrderFlags }),
        ...(entry.cancelExisting !== undefined && { cancelExisting: entry.cancelExisting }),
    });

    if (entry.postOnly) {
        return toPostOnlyPacket(limitOrderPacket, entry.slide ?? false);
    }

    return limitOrderPacket;
}

/**
 * Builds an InstructionPlan that opens (or works an order into) a Phoenix
 * perps position, optionally protected by take-profit / stop-loss legs.
 *
 * Risk-leg semantics:
 * - Market entries place the entry order plus a position-level conditional
 *   order sized at 100% of the live position (`risk.mode === 'position'`).
 *   Both instructions are combined in a non-divisible plan so the entry can
 *   never land without its protection.
 * - Limit entries bundle the TP/SL with the order itself via Rise's
 *   place-limit-order-with-conditionals instruction (`risk.mode ===
 *   'attached'`), so the risk legs only activate once the entry fills.
 *
 * Prerequisites: the trader must already be registered on Phoenix perps with
 * collateral deposited (see Rise's `buildRegisterTrader` /
 * `buildCreateConditionalOrdersAccount`); otherwise the transaction fails
 * on-chain.
 *
 * @example
 * ```ts
 * const client = createPhoenixActionsClient();
 * try {
 *     const { plan } = await getPhoenixOpenPositionPlan({
 *         client,
 *         trader: { authority: wallet.address },
 *         symbol: 'SOL',
 *         side: 'long',
 *         size: { baseUnits: '1.5' },
 *         entry: { type: 'market', priceLimitUsd: '155' },
 *         risk: {
 *             takeProfit: { type: 'market', triggerPriceUsd: '180' },
 *             stopLoss: { type: 'market', triggerPriceUsd: '140' },
 *         },
 *     });
 * } finally {
 *     client.dispose();
 * }
 * ```
 */
export async function getPhoenixOpenPositionPlan(
    options: PhoenixOpenPositionPlanOptions,
): Promise<PhoenixOpenPositionPlanResult> {
    assertPositiveSize(options.size, 'open');
    validateEntry(options.entry);
    validateRiskShape(options.risk);

    const { client, shouldDispose } = resolvePhoenixClient(options);

    try {
        const trader = accountParams(options.trader);
        const entrySide = entrySideFor(options.side);
        const closeSide = closeSideFor(options.side);
        const hasRisk = Boolean(options.risk && (options.risk.takeProfit || options.risk.stopLoss));
        const marketParams = hasRisk ? await marketParamsFor(client, options.symbol) : null;

        let orderPacket: PhoenixOrderPacket;
        let riskMode: PhoenixRiskMode | null = null;
        const phoenixInstructions: RiseInstructionLike[] = [];

        if (options.entry.type === 'market') {
            const marketPacket: ImmediateOrCancelOrderPacket = await client.orderPackets.buildMarketOrderPacket({
                symbol: asSymbol(options.symbol),
                side: entrySide.riseSide,
                baseUnits: options.size.baseUnits,
                ...(options.entry.priceLimitUsd !== undefined && { priceLimitUsd: options.entry.priceLimitUsd }),
                ...(options.entry.minBaseUnitsToFill !== undefined && {
                    minBaseUnitsToFill: options.entry.minBaseUnitsToFill,
                }),
                ...(options.entry.clientOrderId !== undefined && { clientOrderId: options.entry.clientOrderId }),
                ...(options.entry.lastValidSlot !== undefined && { lastValidSlot: options.entry.lastValidSlot }),
                ...(options.entry.orderFlags !== undefined && {
                    orderFlags: options.entry.orderFlags as OrderFlags,
                }),
                ...(options.entry.cancelExisting !== undefined && { cancelExisting: options.entry.cancelExisting }),
            });
            assertNonZeroBaseLots(marketPacket.numBaseLots, 'open');
            orderPacket = marketPacket;

            const entryInstruction = await client.ixs.placeMarketOrder({
                ...trader,
                symbol: asSymbol(options.symbol),
                orderPacket: marketPacket,
            });
            phoenixInstructions.push(entryInstruction);

            if (marketParams) {
                const risk = convertAndValidateRisk(options, marketParams, closeSide.riseSide, null);
                if (risk) {
                    riskMode = 'position';
                    // sizePercent (not a fixed lot count) so the conditional
                    // tracks the actual position size, including partial fills
                    // and later changes.
                    const riskInstruction = await client.ixs.buildPlacePositionConditionalOrder({
                        ...trader,
                        symbol: asSymbol(options.symbol),
                        greaterTriggerOrder: risk.greaterTriggerOrder,
                        lessTriggerOrder: risk.lessTriggerOrder,
                        sizePercent: 100,
                    });
                    phoenixInstructions.push(riskInstruction);
                }
            }
        } else {
            const entryPacket = await buildLimitEntryPacket(client, options, options.entry, entrySide.riseSide);
            assertNonZeroBaseLots(entryPacket.numBaseLots, 'open');
            orderPacket = entryPacket;

            const risk = marketParams
                ? convertAndValidateRisk(options, marketParams, closeSide.riseSide, entryPacket.priceInTicks)
                : null;

            if (risk) {
                // Attached conditionals: the TP/SL only activate once the
                // entry order fills. Position-level conditionals would be
                // live immediately and could fire against a zero or partial
                // position while the limit entry rests on the book.
                riskMode = 'attached';
                const conditionalPacket: ConditionalOrderPacket = options.entry.postOnly
                    ? { __kind: 'PostOnly', ...(entryPacket as PostOnlyOrderPacket) }
                    : { __kind: 'Limit', ...(entryPacket as LimitOrderPacket) };
                const instruction = await client.ixs.buildPlaceLimitOrderWithConditionals({
                    ...trader,
                    symbol: asSymbol(options.symbol),
                    orderPacket: conditionalPacket,
                    greaterTriggerOrder: risk.greaterTriggerOrder,
                    lessTriggerOrder: risk.lessTriggerOrder,
                });
                orderPacket = conditionalPacket;
                phoenixInstructions.push(instruction);
            } else if (options.entry.postOnly) {
                const instruction = await client.ixs.buildPlacePostOnlyOrder({
                    ...trader,
                    symbol: asSymbol(options.symbol),
                    orderPacket: entryPacket as PostOnlyOrderPacket,
                });
                phoenixInstructions.push(instruction);
            } else {
                const instruction = await client.ixs.placeLimitOrder({
                    ...trader,
                    symbol: asSymbol(options.symbol),
                    orderPacket: entryPacket as LimitOrderPacket,
                });
                phoenixInstructions.push(instruction);
            }
        }

        return {
            plan: buildOpenPlan(phoenixInstructions),
            lookupTableAddresses: [],
            order: {
                symbol: options.symbol,
                side: options.side,
                orderSide: entrySide.orderSide,
                tradeSide: closeSide.orderSide,
                traderPdaIndex: trader.traderPdaIndex,
                traderSubaccountIndex: trader.traderSubaccountIndex,
                entryType: options.entry.type,
                postOnly: options.entry.type === 'limit' ? options.entry.postOnly === true : false,
            },
            risk: {
                takeProfit: options.risk?.takeProfit !== undefined,
                stopLoss: options.risk?.stopLoss !== undefined,
                mode: riskMode,
            },
            phoenix: {
                instructions: phoenixInstructions,
                orderPacket,
            },
        };
    } finally {
        if (shouldDispose) {
            client.dispose();
        }
    }
}

/**
 * Entry + risk instructions must land in the same transaction: a divisible
 * plan could execute the entry and then fail the conditional, leaving a
 * naked position with no stop.
 */
function buildOpenPlan(instructions: RiseInstructionLike[]): InstructionPlan {
    const kitInstructions = instructions.map(instruction => riseInstructionToKit(instruction));
    if (kitInstructions.length === 1) {
        return singleInstructionPlan(kitInstructions[0]);
    }

    return nonDivisibleSequentialInstructionPlan(kitInstructions);
}
