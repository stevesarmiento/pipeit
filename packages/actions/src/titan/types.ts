/**
 * Titan API types.
 *
 * These types match the Titan API v1 wire format after MessagePack decoding.
 * All u64 values are decoded as bigint using useBigInt64: true.
 *
 * @packageDocumentation
 */

/**
 * Swap mode - how the amount should be interpreted.
 */
export type SwapMode = 'ExactIn' | 'ExactOut';

/**
 * Titan wire format for a public key (32 bytes).
 */
export type TitanPubkey = Uint8Array;

/**
 * Titan wire format for account metadata.
 * Uses short field names to save space.
 */
export interface TitanAccountMeta {
    /** Public key */
    p: TitanPubkey;
    /** Is signer */
    s: boolean;
    /** Is writable */
    w: boolean;
}

/**
 * Titan wire format for an instruction.
 * Uses short field names to save space.
 */
export interface TitanInstruction {
    /** Program ID */
    p: TitanPubkey;
    /** Accounts */
    a: TitanAccountMeta[];
    /** Data */
    d: Uint8Array;
}

/**
 * Parameters for swap portion of a quote request.
 */
export interface SwapParams {
    /** Address of input mint for the swap */
    inputMint: TitanPubkey | string;
    /** Address of output mint for the swap */
    outputMint: TitanPubkey | string;
    /** Raw number of tokens to swap, not scaled by decimals */
    amount: bigint;
    /** Swap mode (ExactIn or ExactOut), defaults to ExactIn */
    swapMode?: SwapMode;
    /** Allowed slippage in basis points */
    slippageBps?: number;
    /** If set, constrain quotes to the given set of DEXes */
    dexes?: string[];
    /** If set, exclude the following DEXes */
    excludeDexes?: string[];
    /** If true, only direct routes between input and output */
    onlyDirectRoutes?: boolean;
    /** If set, limit quotes to the given set of provider IDs */
    providers?: string[];
}

/**
 * Parameters for transaction generation.
 */
export interface TransactionParams {
    /** Public key of the user requesting the swap */
    userPublicKey: TitanPubkey | string;
    /** If true, close the input token account as part of the transaction */
    closeInputTokenAccount?: boolean;
    /** If true, an idempotent ATA will be created for output token */
    createOutputTokenAccount?: boolean;
    /** The address of a token account for the output mint to collect fees */
    feeAccount?: TitanPubkey | string;
    /** Fee amount to take, in basis points */
    feeBps?: number;
    /** Whether the fee should be taken from input mint */
    feeFromInputMint?: boolean;
    /** Address of token account for swap output */
    outputAccount?: TitanPubkey | string;
}

/**
 * Combined swap quote request parameters.
 */
export interface SwapQuoteParams {
    /** Swap parameters */
    swap: SwapParams;
    /** Transaction parameters */
    transaction: TransactionParams;
}

/**
 * A single step in a swap route.
 */
export interface RoutePlanStep {
    /** Which AMM is being executed on at this step */
    ammKey: TitanPubkey;
    /** Label for the protocol being used */
    label: string;
    /** Address of the input mint for this swap */
    inputMint: TitanPubkey;
    /** Address of the output mint for this swap */
    outputMint: TitanPubkey;
    /** How many input tokens are expected to go through this step */
    inAmount: bigint;
    /** How many output tokens are expected to come out of this step */
    outAmount: bigint;
    /** Proportion in parts per billion allocated to this pool */
    allocPpb: number;
    /** Address of the mint in which the fee is charged */
    feeMint?: TitanPubkey;
    /** The amount of tokens charged as a fee for this swap */
    feeAmount?: bigint;
    /** Context slot for the pool data, if known */
    contextSlot?: bigint;
}

/**
 * Platform fee information.
 */
export interface PlatformFee {
    /** Amount of tokens taken as a fee */
    amount: bigint;
    /** Fee percentage, in basis points */
    fee_bps: number;
}

/**
 * A complete swap route from a provider.
 */
export interface SwapRoute {
    /** How many input tokens are expected */
    inAmount: bigint;
    /** How many output tokens are expected */
    outAmount: bigint;
    /** Amount of slippage incurred, in basis points */
    slippageBps: number;
    /** Platform fee information */
    platformFee?: PlatformFee;
    /** Steps that comprise this route */
    steps: RoutePlanStep[];
    /** Instructions needed to execute the route (may be empty if transaction provided) */
    instructions: TitanInstruction[];
    /** Address lookup tables necessary to load */
    addressLookupTables: TitanPubkey[];
    /** Context slot for the route */
    contextSlot?: bigint;
    /** Amount of time taken to generate the quote in nanoseconds */
    timeTakenNs?: bigint;
    /** If this route expires, the time at which it expires (millisecond UNIX timestamp) */
    expiresAtMs?: bigint;
    /** If this route expires by slot, the last valid slot */
    expiresAfterSlot?: bigint;
    /** Number of compute units expected */
    computeUnits?: bigint;
    /** Recommended compute units for safe execution */
    computeUnitsSafe?: bigint;
    /** Transaction for the user to sign, if instructions not provided */
    transaction?: Uint8Array;
    /** Provider-specific reference ID for this quote */
    referenceId?: string;
}

/**
 * A set of quotes for a swap transaction.
 */
export interface SwapQuotes {
    /** Unique identifier for the quote */
    id: string;
    /** Address of the input mint */
    inputMint: TitanPubkey;
    /** Address of the output mint */
    outputMint: TitanPubkey;
    /** Swap mode used for the quotes */
    swapMode: SwapMode;
    /** Amount used for the quotes */
    amount: bigint;
    /** Mapping of provider identifier to their quoted route */
    quotes: Record<string, SwapRoute>;
}

/**
 * Version information for the server.
 */
export interface VersionInfo {
    major: number;
    minor: number;
    patch: number;
}

/**
 * Server settings bounds.
 */
export interface BoundedValueWithDefault<T> {
    min: T;
    max: T;
    default: T;
}

/**
 * Quote update settings.
 */
export interface QuoteUpdateSettings {
    intervalMs: BoundedValueWithDefault<bigint>;
    numQuotes: BoundedValueWithDefault<number>;
}

/**
 * Swap settings.
 */
export interface SwapSettings {
    slippageBps: BoundedValueWithDefault<number>;
    onlyDirectRoutes: boolean;
    addSizeConstraint: boolean;
}

/**
 * Transaction settings.
 */
export interface TransactionSettings {
    closeInputTokenAccount: boolean;
    createOutputTokenAccount: boolean;
}

/**
 * Connection settings.
 */
export interface ConnectionSettings {
    concurrentStreams: number;
}

/**
 * Server settings.
 */
export interface ServerSettings {
    quoteUpdate: QuoteUpdateSettings;
    swap: SwapSettings;
    transaction: TransactionSettings;
    connection: ConnectionSettings;
}

/**
 * Server info response.
 */
export interface ServerInfo {
    protocolVersion: VersionInfo;
    settings: ServerSettings;
}

/**
 * Provider kind.
 */
export type ProviderKind = 'DexAggregator' | 'RFQ';

/**
 * Provider information.
 */
export interface ProviderInfo {
    id: string;
    name: string;
    kind: ProviderKind;
    iconUri48?: string;
}

/**
 * Venue information.
 */
export interface VenueInfo {
    labels: string[];
    programIds?: TitanPubkey[];
}
