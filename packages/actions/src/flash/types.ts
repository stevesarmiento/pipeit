/**
 * Shared Flash Trade action types.
 *
 * @packageDocumentation
 */

import type { AnchorProvider } from '@coral-xyz/anchor';
import type { Address } from '@solana/addresses';
import type { InstructionPlan } from '@solana/instruction-plans';
import type { Cluster, PublicKey, Signer, TransactionInstruction } from '@solana/web3.js';
import type {
    ClosePositionQuoteData,
    ContractOraclePrice,
    OpenPositionQuoteData,
    PerpetualsClient,
    PerpClientOptions,
    PoolConfig,
} from 'flash-sdk';
import type { OraclePrice } from 'flash-sdk';

export type FlashMarketSymbol = string;

export type FlashTokenSymbol = string;

export type FlashPositionSide = 'long' | 'short';

/**
 * Resolves oracle prices for a set of token symbols. The default
 * implementation ({@link createFlashPythPriceSource}) reads Pyth Hermes using
 * the `pythPriceId` of each pool token.
 */
export type FlashPriceSource = (symbols: string[]) => Promise<Map<string, OraclePrice>>;

export interface FlashActionsClientConfig {
    provider: AnchorProvider;
    poolName?: string;
    cluster?: Cluster;
    opts?: PerpClientOptions;
    useExtOracleAccount?: boolean;
}

export interface FlashActionsContext {
    client: PerpetualsClient;
    poolConfig: PoolConfig;
    cluster: Cluster;
    poolName: string;
}

export interface FlashTraderRef {
    /**
     * Owner of the position. MUST match the AnchorProvider wallet of the
     * client: every flash-sdk instruction builder signs for
     * `provider.wallet.publicKey`, so a mismatching owner would silently
     * produce plans for the wrong wallet. Plan builders enforce this and
     * throw {@link FlashTraderMismatchError} on mismatch.
     */
    owner: Address | string;
}

export interface FlashCollateralAmount {
    amount: number | string | bigint;
    symbol?: FlashTokenSymbol;
}

export interface FlashMarketEntry {
    type: 'market';
    slippageBps?: number;
}

export interface FlashLimitEntry {
    type: 'limit';
    priceUsd: number | string | bigint;
    reserveSymbol?: FlashTokenSymbol;
    receiveSymbol?: FlashTokenSymbol;
}

export type FlashOpenPositionEntry = FlashMarketEntry | FlashLimitEntry;

export interface FlashRiskLeg {
    triggerPriceUsd: number | string | bigint;
    /**
     * Portion of the position covered by this leg. Only supported for
     * market entries; limit entries embed TP/SL prices in the order itself
     * and always cover the full position.
     */
    sizePercent?: number;
    /**
     * Token received when the leg executes. Only supported for market
     * entries (see {@link FlashRiskLeg.sizePercent}).
     */
    receiveSymbol?: FlashTokenSymbol;
}

export interface FlashPositionRisk {
    takeProfit?: FlashRiskLeg;
    stopLoss?: FlashRiskLeg;
}

export interface FlashActionsOptions {
    context?: FlashActionsContext;
    client?: PerpetualsClient;
    poolConfig?: PoolConfig;
    cluster?: Cluster;
    poolName?: string;
    clientConfig?: FlashActionsClientConfig;
    priceSource?: FlashPriceSource;
}

export interface FlashOpenPositionPlanOptions extends FlashActionsOptions {
    trader: FlashTraderRef;
    symbol: FlashMarketSymbol;
    side: FlashPositionSide;
    collateral: FlashCollateralAmount;
    leverage: number | string | bigint;
    entry: FlashOpenPositionEntry;
    risk?: FlashPositionRisk;
    skipBalanceChecks?: boolean;
}

export interface FlashOpenPositionPlanResult {
    plan: InstructionPlan;
    lookupTableAddresses: Address[];
    order: {
        symbol: FlashMarketSymbol;
        collateralSymbol: FlashTokenSymbol;
        side: FlashPositionSide;
        entryType: FlashOpenPositionEntry['type'];
        slippageBps: number | null;
        poolName: string;
        cluster: Cluster;
    };
    risk: {
        takeProfit: boolean;
        stopLoss: boolean;
    };
    flash: {
        instructions: TransactionInstruction[];
        quote?: OpenPositionQuoteData;
        poolName: string;
        cluster: Cluster;
    };
}

export interface FlashFullCloseSize {
    percent: 100;
}

export interface FlashPartialCloseSize {
    sizeUsd: number | string | bigint;
}

export type FlashCloseSize = FlashFullCloseSize | FlashPartialCloseSize;

export interface FlashClosePositionPlanOptions extends FlashActionsOptions {
    trader: FlashTraderRef;
    symbol: FlashMarketSymbol;
    side: FlashPositionSide;
    size: FlashCloseSize;
    /** Collateral token of the position being closed. Defaults to `symbol`. */
    collateralSymbol?: FlashTokenSymbol;
    /**
     * Token to receive. Currently must equal `collateralSymbol` — receiving
     * a different token requires the flash-sdk `closeAndSwap` flow, which
     * this package does not wrap yet.
     */
    receiveSymbol?: FlashTokenSymbol;
    slippageBps?: number;
    /**
     * Explicit position account. Only supported for partial closes; full
     * closes always derive the position from the provider wallet.
     */
    positionAddress?: Address | string;
    createUserATA?: boolean;
    closeUsersWSOLATA?: boolean;
}

export interface FlashClosePositionPlanResult {
    plan: InstructionPlan;
    lookupTableAddresses: Address[];
    order: {
        symbol: FlashMarketSymbol;
        collateralSymbol: FlashTokenSymbol;
        receiveSymbol: FlashTokenSymbol;
        side: FlashPositionSide;
        closeType: 'full' | 'partial';
        slippageBps: number;
        poolName: string;
        cluster: Cluster;
    };
    flash: {
        instructions: TransactionInstruction[];
        quote?: ClosePositionQuoteData;
        poolName: string;
        cluster: Cluster;
    };
}

export interface FlashCancelTriggerOrderPlanOptions extends FlashActionsOptions {
    trader: FlashTraderRef;
    symbol: FlashMarketSymbol;
    side: FlashPositionSide;
    orderId: number;
    isStopLoss: boolean;
    collateralSymbol?: FlashTokenSymbol;
}

export interface FlashCancelAllTriggerOrdersPlanOptions extends FlashActionsOptions {
    trader: FlashTraderRef;
    symbol: FlashMarketSymbol;
    side: FlashPositionSide;
    collateralSymbol?: FlashTokenSymbol;
}

export interface FlashCancelTriggerOrdersPlanResult {
    plan: InstructionPlan;
    lookupTableAddresses: Address[];
    order: {
        symbol: FlashMarketSymbol;
        collateralSymbol: FlashTokenSymbol;
        side: FlashPositionSide;
        cancelAll: boolean;
        orderId: number | null;
        isStopLoss: boolean | null;
        poolName: string;
        cluster: Cluster;
    };
    flash: {
        instructions: TransactionInstruction[];
        poolName: string;
        cluster: Cluster;
    };
}

export interface FlashSdkInstructionResult {
    instructions: TransactionInstruction[];
    additionalSigners: Signer[];
}

export type FlashContractOraclePrice = ContractOraclePrice;
export type FlashPublicKey = PublicKey;

export class FlashPlanError extends Error {
    constructor(message: string) {
        super(message);
        this.name = new.target.name;
    }
}

export class InvalidFlashInstructionError extends FlashPlanError {}

export class InvalidFlashPositionSideError extends FlashPlanError {}

export class InvalidFlashRiskConfigError extends FlashPlanError {}

export class UnsupportedFlashOrderConfigError extends FlashPlanError {}

export class UnsupportedFlashAdditionalSignersError extends FlashPlanError {}

export class FlashMarketConfigError extends FlashPlanError {}

export class FlashClientRequiredError extends FlashPlanError {}

/** A numeric input (amount, price, leverage, percent) failed validation. */
export class InvalidFlashAmountError extends FlashPlanError {}

/**
 * SOL was passed as collateral / receive token. Native-SOL flows make
 * flash-sdk create an ephemeral wSOL keypair signer, which `executePlan`
 * cannot sign in V1. Use an SPL collateral (e.g. USDC) or pre-wrapped WSOL.
 */
export class UnsupportedFlashCollateralError extends FlashPlanError {}

/** `trader.owner` does not match the client's AnchorProvider wallet. */
export class FlashTraderMismatchError extends FlashPlanError {
    readonly traderOwner: string;
    readonly providerWallet: string;

    constructor(traderOwner: string, providerWallet: string) {
        super(
            `Flash trader.owner (${traderOwner}) must match the client's AnchorProvider wallet ` +
                `(${providerWallet}): flash-sdk builds every instruction for the provider wallet.`,
        );
        this.traderOwner = traderOwner;
        this.providerWallet = providerWallet;
    }
}

/** The price source request failed or returned an unusable response. */
export class FlashPriceSourceError extends FlashPlanError {
    readonly statusCode: number | undefined;
    readonly responseBody: string | undefined;

    constructor(message: string, details?: { statusCode?: number | undefined; responseBody?: string | undefined }) {
        super(message);
        this.statusCode = details?.statusCode;
        this.responseBody = details?.responseBody;
    }
}
