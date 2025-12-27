/**
 * Jupiter Metis Swap API types.
 *
 * These types match the Metis API wire format. All u64 values are kept as
 * strings in wire types so quoteResponse can be POSTed back unchanged.
 *
 * @packageDocumentation
 */

/**
 * Swap mode - how the amount should be interpreted.
 */
export type SwapMode = 'ExactIn' | 'ExactOut';

/**
 * Platform fee information from quote.
 */
export interface PlatformFee {
    amount: string;
    feeBps: number;
}

/**
 * Swap info for a single step in the route.
 */
export interface SwapInfo {
    ammKey: string;
    label?: string;
    inputMint: string;
    outputMint: string;
    inAmount: string;
    outAmount: string;
    /** @deprecated */
    feeAmount?: string;
    /** @deprecated */
    feeMint?: string;
}

/**
 * A single step in the route plan.
 */
export interface RoutePlanStep {
    swapInfo: SwapInfo;
    percent?: number | null;
    bps?: number;
}

/**
 * Quote response from GET /quote.
 * Amounts are strings to allow POSTing back unchanged.
 */
export interface QuoteResponse {
    inputMint: string;
    outputMint: string;
    inAmount: string;
    outAmount: string;
    otherAmountThreshold: string;
    swapMode: SwapMode;
    slippageBps: number;
    platformFee?: PlatformFee;
    priceImpactPct: string;
    routePlan: RoutePlanStep[];
    contextSlot?: number;
    timeTaken?: number;
}

/**
 * Parameters for requesting a quote.
 */
export interface MetisQuoteParams {
    /** Address of input mint */
    inputMint: string;
    /** Address of output mint */
    outputMint: string;
    /** Raw amount (before decimals) */
    amount: bigint;
    /** Slippage in basis points (default: 50) */
    slippageBps?: number;
    /** Swap mode (default: ExactIn) */
    swapMode?: SwapMode;
    /** Limit to specific DEXes */
    dexes?: string[];
    /** Exclude specific DEXes */
    excludeDexes?: string[];
    /** Restrict intermediate tokens to stable tokens */
    restrictIntermediateTokens?: boolean;
    /** Only use direct routes (single hop) */
    onlyDirectRoutes?: boolean;
    /** Use legacy transaction format */
    asLegacyTransaction?: boolean;
    /** Platform fee in basis points */
    platformFeeBps?: number;
    /** Max accounts hint for routing */
    maxAccounts?: number;
    /** Instruction version (V1 or V2) */
    instructionVersion?: 'V1' | 'V2';
}

/**
 * Account metadata for an instruction.
 */
export interface AccountMeta {
    pubkey: string;
    isSigner: boolean;
    isWritable: boolean;
}

/**
 * Instruction in Metis wire format.
 */
export interface MetisInstruction {
    programId: string;
    accounts: AccountMeta[];
    /** Base64-encoded instruction data */
    data: string;
}

/**
 * Priority level options for prioritization fees.
 */
export interface PriorityLevelWithMaxLamports {
    priorityLevelWithMaxLamports: {
        priorityLevel: 'medium' | 'high' | 'veryHigh';
        maxLamports: number;
        global?: boolean;
    };
}

/**
 * Jito tip options.
 */
export interface JitoTipLamports {
    jitoTipLamports: number;
}

/**
 * Jito tip with custom payer.
 */
export interface JitoTipLamportsWithPayer {
    jitoTipLamportsWithPayer: {
        lamports: number;
        payer: string;
    };
}

/**
 * Prioritization fee options (one of the variants).
 */
export type PrioritizationFeeLamports =
    | PriorityLevelWithMaxLamports
    | JitoTipLamports
    | JitoTipLamportsWithPayer
    | number;

/**
 * Request body for POST /swap-instructions.
 */
export interface SwapInstructionsRequest {
    /** User's public key */
    userPublicKey: string;
    /** Quote response from GET /quote */
    quoteResponse: QuoteResponse;
    /** Custom payer for fees and rent */
    payer?: string;
    /** Auto wrap/unwrap SOL (default: true) */
    wrapAndUnwrapSol?: boolean;
    /** Use shared program accounts */
    useSharedAccounts?: boolean;
    /** Fee collection token account */
    feeAccount?: string;
    /** Tracking public key for analytics */
    trackingAccount?: string;
    /** Priority fee configuration */
    prioritizationFeeLamports?: PrioritizationFeeLamports;
    /** Use legacy transaction format */
    asLegacyTransaction?: boolean;
    /** Custom destination token account */
    destinationTokenAccount?: string;
    /** Native SOL destination account */
    nativeDestinationAccount?: string;
    /** Dynamically estimate compute units */
    dynamicComputeUnitLimit?: boolean;
    /** Skip RPC calls for user accounts */
    skipUserAccountsRpcCalls?: boolean;
    /** Dynamic slippage (deprecated) */
    dynamicSlippage?: boolean;
    /** Custom compute unit price */
    computeUnitPriceMicroLamports?: number;
    /** Slots until transaction expires */
    blockhashSlotsToExpiry?: number;
}

/**
 * Response from POST /swap-instructions.
 */
export interface SwapInstructionsResponse {
    /** Compute budget setup instructions */
    computeBudgetInstructions: MetisInstruction[];
    /** Other instructions (e.g. Jito tips) */
    otherInstructions: MetisInstruction[];
    /** Setup instructions for token accounts */
    setupInstructions: MetisInstruction[];
    /** Token ledger instruction (if useTokenLedger) */
    tokenLedgerInstruction?: MetisInstruction;
    /** The main swap instruction */
    swapInstruction: MetisInstruction;
    /** Cleanup instruction (wrap/unwrap SOL) */
    cleanupInstruction?: MetisInstruction;
    /** Address lookup table addresses for versioned transactions */
    addressLookupTableAddresses: string[];
    /**
     * Server-side simulation error (if Jupiter attempted simulation and it failed).
     * This is informational only; you may still choose to simulate locally.
     */
    simulationError?: { error: string; errorCode: string } | null;
    /** Slot used for server-side simulation (if available). */
    simulationSlot?: number | null;
    /** Estimated compute unit limit returned by Jupiter (if available). */
    computeUnitLimit?: number;
    /** Estimated total prioritization fee in lamports (if available). */
    prioritizationFeeLamports?: number;
}

/**
 * Combined parameters for swap quote request (mirrors Titan style).
 */
export interface MetisSwapQuoteParams {
    /** Swap parameters */
    swap: {
        inputMint: string;
        outputMint: string;
        amount: bigint;
        slippageBps?: number;
        swapMode?: SwapMode;
        dexes?: string[];
        excludeDexes?: string[];
        restrictIntermediateTokens?: boolean;
        onlyDirectRoutes?: boolean;
        asLegacyTransaction?: boolean;
        platformFeeBps?: number;
        maxAccounts?: number;
        instructionVersion?: 'V1' | 'V2';
    };
    /** Transaction parameters */
    transaction: {
        userPublicKey: string;
        payer?: string;
        wrapAndUnwrapSol?: boolean;
        useSharedAccounts?: boolean;
        feeAccount?: string;
        trackingAccount?: string;
        prioritizationFeeLamports?: PrioritizationFeeLamports;
        asLegacyTransaction?: boolean;
        destinationTokenAccount?: string;
        nativeDestinationAccount?: string;
        dynamicComputeUnitLimit?: boolean;
        skipUserAccountsRpcCalls?: boolean;
        computeUnitPriceMicroLamports?: number;
        blockhashSlotsToExpiry?: number;
    };
}
