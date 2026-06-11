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
    sizePercent?: number;
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
    collateralSymbol?: FlashTokenSymbol;
    receiveSymbol?: FlashTokenSymbol;
    slippageBps?: number;
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

export class FlashPriceSourceError extends FlashPlanError {}

export class FlashClientRequiredError extends FlashPlanError {}
