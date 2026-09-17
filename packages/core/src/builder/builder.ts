/**
 * Unified transaction builder with type-safe state tracking and smart defaults.
 *
 * Features:
 * - Type-safe builder with compile-time validation
 * - Auto-blockhash fetching
 * - Auto-retry with configurable backoff
 * - Built-in validation
 * - Simulation support
 * - Export in multiple formats
 * - Compute budget (priority fees & compute limits)
 * - Comprehensive logging
 *
 * @example
 * ```ts
 * // Build message only
 * const message = await new TransactionBuilder({ rpc })
 *   .setFeePayer(address)
 *   .addInstruction(ix)
 *   .build();
 *
 * // Execute with retry
 * const signature = await new TransactionBuilder({ rpc, autoRetry: true })
 *   .setFeePayer(address)
 *   .addInstruction(ix)
 *   .execute({ rpcSubscriptions });
 *
 * // Simulate first
 * const result = await new TransactionBuilder({ rpc })
 *   .setFeePayer(address)
 *   .addInstruction(ix)
 *   .simulate();
 *
 * // Export for custom transport
 * const { data: base64Tx } = await new TransactionBuilder({ rpc })
 *   .setFeePayer(address)
 *   .addInstruction(ix)
 *   .export('base64');
 * ```
 *
 * @packageDocumentation
 */

import type { Address } from '@solana/addresses';
import type { Instruction } from '@solana/instructions';
import type { TransactionMessage } from '@solana/transaction-messages';
import type { Blockhash } from '@solana/rpc-types';
import type {
    Rpc,
    GetLatestBlockhashApi,
    GetAccountInfoApi,
    GetMultipleAccountsApi,
    GetEpochInfoApi,
    GetSignatureStatusesApi,
    SendTransactionApi,
    SimulateTransactionApi,
} from '@solana/rpc';
import type { RpcSubscriptions, SignatureNotificationsApi, SlotNotificationsApi } from '@solana/rpc-subscriptions';
import { pipe } from '@solana/functional';
import {
    createTransactionMessage,
    setTransactionMessageFeePayer,
    setTransactionMessageLifetimeUsingBlockhash,
    setTransactionMessageLifetimeUsingDurableNonce,
    appendTransactionMessageInstruction,
    setTransactionMessageComputeUnitLimit,
    setTransactionMessageComputeUnitPrice,
    setTransactionMessageLoadedAccountsDataSizeLimit,
    getTransactionMessageComputeUnitLimit,
    getTransactionMessageLoadedAccountsDataSizeLimit,
    setTransactionMessageHeapSize,
    setTransactionMessagePriorityFeeLamports,
} from '@solana/transaction-messages';
import {
    signTransactionMessageWithSigners,
    addSignersToTransactionMessage,
    type TransactionSigner,
} from '@solana/signers';
import {
    sendAndConfirmTransactionFactory,
    getSignatureFromTransaction,
    fetchAddressesForLookupTables,
    fillTransactionMessageProvisoryResourceLimits,
} from '@solana/kit';
import {
    getBase64EncodedWireTransaction,
    getTransactionEncoder,
    getTransactionMessageSize,
    getTransactionMessageSizeLimit,
    type Base64EncodedWireTransaction,
} from '@solana/transactions';
import { getBase58Decoder } from '@solana/codecs-strings';
import { SolanaError, SOLANA_ERROR__TRANSACTION__FEE_PAYER_MISSING } from '@solana/errors';
import type {
    BuilderState,
    RequiredState,
    LifetimeConstraint,
    ExecuteConfig,
    SupportedTransactionVersion,
} from '../types.js';
import { validateTransaction, validateTransactionSize } from '../validation/index.js';
import { translateVersionError } from '../errors/version-errors.js';

// Import new modules
import {
    type PriorityFeeConfig,
    type ComputeUnitConfig,
    estimatePriorityFee,
    PRIORITY_FEE_LEVELS,
    MAX_COMPUTE_UNIT_LIMIT,
    MAX_LOADED_ACCOUNTS_DATA_SIZE_LIMIT,
    DEFAULT_COMPUTE_UNIT_LIMIT,
    DEFAULT_COMPUTE_BUFFER,
    microLamportsToPriorityFeeLamports,
    createBufferedResourceLimitsEstimator,
    type PriorityFeeLevel,
} from '../compute-budget/index.js';
import { extractComputeBudgetValues, type CallerComputeBudgetValues } from '../compute-budget/normalize.js';
import { fetchNonceValue, type DurableNonceConfig } from '../nonce/index.js';
import { type AddressesByLookupTableAddress, compressTransactionMessage } from '../lookup-tables/index.js';

// Execution strategies
import { resolveExecutionConfig, executeWithStrategy } from '../execution/strategies.js';
import { createTipInstruction } from '../execution/jito.js';

// ============================================================================
// Export Types
// ============================================================================

/**
 * Supported transaction export formats.
 * - `base64`: Default RPC format, compatible with sendTransaction
 * - `base58`: Human-readable, useful for block explorers and sharing
 * - `bytes`: Raw bytes, useful for hardware wallets
 */
export type ExportFormat = 'base64' | 'base58' | 'bytes';

/**
 * Error thrown when a transaction execution fails on-chain.
 * The transaction was confirmed (included in a block) but the program returned an error.
 */
export class TransactionExecutionError extends Error {
    readonly signature: string;
    readonly err: unknown;

    constructor(signature: string, err: unknown) {
        super(`Transaction execution failed: ${JSON.stringify(err)}`);
        this.name = 'TransactionExecutionError';
        this.signature = signature;
        this.err = err;
    }
}

/**
 * Exported transaction in various formats.
 */
export type ExportedTransaction =
    | { format: 'base64'; data: Base64EncodedWireTransaction }
    | { format: 'base58'; data: string }
    | { format: 'bytes'; data: Uint8Array };

// Note: Compute budget constants and helpers are now imported from ../compute-budget/index.js

/**
 * Configuration for transaction builder.
 */
export interface TransactionBuilderConfig {
    /**
     * Transaction version.
     * - `0` (default): versioned format, 1232-byte limit, address lookup tables supported
     * - `'legacy'`: original format, 1232-byte limit, no lookup tables
     * - `1`: SIMD-0385 format, 4096-byte limit, no lookup tables. Resource
     *   limits and the priority fee live in the message config; `build()`
     *   always resolves them to concrete values (see `computeUnits`).
     */
    version?: SupportedTransactionVersion;

    /**
     * RPC client for auto-fetching blockhash when not explicitly provided.
     * If using lookupTableAddresses, the RPC must also support GetMultipleAccountsApi.
     * On version 1 it is also used to simulate for resource-limit estimation
     * (it must support SimulateTransactionApi).
     */
    rpc?: Rpc<GetLatestBlockhashApi & GetAccountInfoApi>;

    /**
     * Auto-retry failed transactions.
     * - `true`: Use default retry (3 attempts, exponential backoff)
     * - `false`: No retry
     * - Object: Custom retry configuration
     */
    autoRetry?: boolean | { maxAttempts: number; backoff: 'linear' | 'exponential' };

    /**
     * Logging level.
     */
    logLevel?: 'silent' | 'minimal' | 'verbose';

    /**
     * Priority fee configuration.
     * - PriorityFeeLevel string: Use preset level ('none', 'low', 'medium', 'high', 'veryHigh')
     * - PriorityFeeConfig object: Use custom configuration with strategy
     *
     * Levels and `microLamports` are a price per compute unit. On legacy/v0
     * they become a SetComputeUnitPrice instruction. On version 1 the fee is a
     * total in lamports, so Pipeit converts using the final compute unit limit:
     * `lamports = ceil(limit × microLamports / 1e6)`. Pass
     * `{ strategy: 'fixed', lamports: 5_000n }` on v1 to set the total directly.
     *
     * A SetComputeUnitPrice instruction among the added instructions is
     * stripped and its price used only when this field is not set. Setting it
     * (including `'none'`) always wins.
     */
    priorityFee?: PriorityFeeLevel | PriorityFeeConfig;

    /**
     * Compute unit configuration.
     * - 'auto': legacy/v0 emit NO compute unit limit instruction and the
     *   runtime's implicit default (200,000 CU per instruction) applies.
     *   Version 1 has no implicit default (an unset limit is 0 CU), so 'auto'
     *   estimates the limit by simulation, exactly like 'simulate'.
     * - number: Use fixed compute unit limit
     * - ComputeUnitConfig object: Use custom configuration with strategy
     *
     * On version 1, `build()` never returns provisory limits: if the limits are
     * not explicit it simulates through `rpc`, and without an `rpc` it falls
     * back to `200,000 × instruction count` CU and the 64 MiB data size cap
     * (and warns), so a message you build and sign yourself is still valid.
     *
     * A SetComputeUnitLimit instruction among the added instructions is
     * stripped and its limit used only when this field is not set. Setting it
     * (including `'auto'`) always wins.
     */
    computeUnits?: 'auto' | number | ComputeUnitConfig;

    /**
     * Loaded accounts data size limit in bytes.
     *
     * Caps the total size of accounts the transaction may load, which can
     * reduce fees and improve scheduling. When omitted (default) on legacy/v0,
     * no instruction is emitted and the runtime default (64 MiB) applies.
     *
     * Version 1 has no default (an unset limit is 0 bytes and the transaction
     * fails), so when omitted Pipeit estimates it by simulation alongside the
     * compute unit limit, pads it by the configured buffer and rounds up to
     * the next 32 KiB page.
     *
     * WARNING: do not set this to an exact simulated value. Loading an account
     * that already exists costs more than loading one that does not, so if
     * anyone touches (or funds) an account between your simulation and your
     * transaction landing, an exact limit will fail at runtime. Leave headroom,
     * or let the 'simulate' compute unit strategy pad the estimated limit.
     */
    loadedAccountsDataSizeLimit?: number;

    /**
     * Address lookup table addresses to fetch and use for compression.
     * Only works with version 0 transactions. Throws when combined with
     * version 1, which does not support lookup tables.
     */
    lookupTableAddresses?: Address[];

    /**
     * Pre-fetched lookup table data.
     * Use this to avoid fetching if you already have the data.
     * Version 0 only; throws when combined with version 1.
     */
    addressesByLookupTable?: AddressesByLookupTableAddress;
}

/**
 * Result from transaction simulation.
 */
export interface SimulationResult {
    /**
     * Error if simulation failed, null otherwise.
     */
    err: unknown | null;
    /**
     * Log messages from simulation.
     */
    logs: string[] | null;
    /**
     * Compute units consumed during simulation.
     */
    unitsConsumed: bigint | undefined;
    /**
     * Return data from program execution.
     */
    returnData: any;
}

/**
 * Unified transaction builder with type-safe state tracking and smart defaults.
 */
export class TransactionBuilder<TState extends BuilderState = BuilderState> {
    private feePayer?: Address;
    private feePayerSigner?: TransactionSigner;
    private lifetime?: LifetimeConstraint;
    private instructions: Instruction[] = [];

    private config: {
        version: SupportedTransactionVersion;
        rpc: Rpc<GetLatestBlockhashApi & GetAccountInfoApi> | undefined;
        autoRetry: boolean | { maxAttempts: number; backoff: 'linear' | 'exponential' };
        logLevel: 'silent' | 'minimal' | 'verbose';
        priorityFee: PriorityFeeLevel | PriorityFeeConfig;
        computeUnits: 'auto' | number | ComputeUnitConfig;
        loadedAccountsDataSizeLimit?: number;
        lookupTableAddresses?: Address[];
        addressesByLookupTable?: AddressesByLookupTableAddress;
    };

    /**
     * Which budget fields the caller set explicitly (as opposed to the
     * constructor defaults). Explicit config beats compute budget instructions
     * found in the instruction list; defaults yield to them.
     */
    private explicitConfig: { priorityFee: boolean; computeUnits: boolean };

    constructor(config: TransactionBuilderConfig = {}) {
        this.explicitConfig = {
            priorityFee: config.priorityFee !== undefined,
            computeUnits: config.computeUnits !== undefined,
        };
        this.config = {
            version: config.version ?? 0,
            rpc: config.rpc,
            autoRetry: config.autoRetry ?? { maxAttempts: 3, backoff: 'exponential' },
            logLevel: config.logLevel ?? 'silent',
            priorityFee: config.priorityFee ?? 'medium',
            computeUnits: config.computeUnits ?? 'auto',
            ...(config.loadedAccountsDataSizeLimit !== undefined && {
                loadedAccountsDataSizeLimit: config.loadedAccountsDataSizeLimit,
            }),
            ...(config.lookupTableAddresses && { lookupTableAddresses: config.lookupTableAddresses }),
            ...(config.addressesByLookupTable && { addressesByLookupTable: config.addressesByLookupTable }),
        };

        if (this.config.version === 1 && (config.lookupTableAddresses?.length || config.addressesByLookupTable)) {
            throw new Error(
                'Address lookup tables are not supported by version 1 transactions. ' +
                    'Use version: 0, or remove lookupTableAddresses / addressesByLookupTable.',
            );
        }

        if (
            this.config.version !== 1 &&
            typeof this.config.priorityFee === 'object' &&
            this.config.priorityFee.lamports !== undefined
        ) {
            throw new Error(
                'priorityFee.lamports is only valid for version: 1 transactions. ' +
                    'Legacy and version 0 transactions price the fee per compute unit; use microLamports instead.',
            );
        }
    }

    /**
     * Create a TransactionBuilder configured for durable nonce transactions.
     * Automatically fetches the current nonce value from the account.
     *
     * @param config - Durable nonce configuration
     * @returns TransactionBuilder with nonce lifetime already set
     *
     * @example
     * ```ts
     * const builder = await TransactionBuilder.withDurableNonce({
     *   rpc,
     *   nonceAccountAddress: address('...'),
     *   nonceAuthorityAddress: address('...'),
     * });
     *
     * await builder
     *   .setFeePayer(feePayer)
     *   .addInstruction(ix)
     *   .execute({ rpcSubscriptions });
     * ```
     */
    static async withDurableNonce(
        config: DurableNonceConfig & { rpc: Rpc<GetLatestBlockhashApi & GetAccountInfoApi> } & Omit<
                TransactionBuilderConfig,
                'rpc'
            >,
    ): Promise<TransactionBuilder<{ lifetime: true }>> {
        const { nonceAccountAddress, nonceAuthorityAddress, nonce: providedNonce, rpc, ...builderConfig } = config;

        // Fetch nonce if not provided
        const nonce = providedNonce ?? (await fetchNonceValue(rpc, nonceAccountAddress));

        // Create builder with nonce lifetime already set
        const builder = new TransactionBuilder({ rpc, ...builderConfig });
        builder.lifetime = {
            type: 'nonce',
            nonce,
            nonceAccountAddress,
            nonceAuthorityAddress,
        };

        return builder as TransactionBuilder<{ lifetime: true }>;
    }

    /**
     * Set the fee payer for the transaction using just an address.
     * Note: When using execute(), you should use setFeePayerSigner() instead
     * to properly sign the transaction.
     */
    setFeePayer<TAddress extends string>(feePayer: Address<TAddress>): TransactionBuilder<TState & { feePayer: true }> {
        const builder = this.clone();
        builder.feePayer = feePayer;
        return builder as TransactionBuilder<TState & { feePayer: true }>;
    }

    /**
     * Set the fee payer for the transaction using a signer.
     * This is the recommended method when using execute() as it properly
     * signs the transaction.
     */
    setFeePayerSigner(signer: TransactionSigner): TransactionBuilder<TState & { feePayer: true }> {
        const builder = this.clone();
        builder.feePayer = signer.address;
        builder.feePayerSigner = signer;
        return builder as TransactionBuilder<TState & { feePayer: true }>;
    }

    /**
     * Set blockhash lifetime for the transaction.
     */
    setBlockhashLifetime(
        blockhash: Blockhash,
        lastValidBlockHeight: bigint,
    ): TransactionBuilder<TState & { lifetime: true }> {
        const builder = this.clone();
        builder.lifetime = {
            type: 'blockhash',
            blockhash,
            lastValidBlockHeight,
        };
        return builder as TransactionBuilder<TState & { lifetime: true }>;
    }

    /**
     * Set durable nonce lifetime for the transaction.
     */
    setDurableNonceLifetime(
        nonce: string,
        nonceAccountAddress: Address,
        nonceAuthorityAddress: Address,
    ): TransactionBuilder<TState & { lifetime: true }> {
        const builder = this.clone();
        builder.lifetime = {
            type: 'nonce',
            nonce,
            nonceAccountAddress,
            nonceAuthorityAddress,
        };
        return builder as TransactionBuilder<TState & { lifetime: true }>;
    }

    /**
     * Add a single instruction to the transaction.
     *
     * ComputeBudget instructions (RequestHeapFrame, SetComputeUnitLimit,
     * SetComputeUnitPrice, SetLoadedAccountsDataSizeLimit) are not emitted
     * as-is: `build()` strips them and folds their values into the builder's
     * compute budget. Explicit builder config wins; otherwise the instruction's
     * value is used. Version 1 messages end up with the budget in the config
     * block only.
     */
    addInstruction(instruction: Instruction): TransactionBuilder<TState> {
        const builder = this.clone();
        builder.instructions.push(instruction);
        return builder;
    }

    /**
     * Add multiple instructions to the transaction.
     *
     * ComputeBudget instructions are normalized as described in
     * {@link TransactionBuilder.addInstruction}.
     */
    addInstructions(instructions: readonly Instruction[]): TransactionBuilder<TState> {
        const builder = this.clone();
        builder.instructions.push(...instructions);
        return builder;
    }

    /**
     * Build the transaction message.
     * Only available when all required fields (feePayer, lifetime) are set.
     *
     * If RPC was provided in constructor and lifetime not set, automatically fetches latest blockhash.
     * Automatically prepends compute budget instructions if configured.
     * Applies address lookup table compression if configured (version 0 only).
     */
    async build(this: TransactionBuilder<RequiredState>): Promise<TransactionMessage> {
        if (!this.feePayer) {
            throw new SolanaError(SOLANA_ERROR__TRANSACTION__FEE_PAYER_MISSING);
        }

        // AUTO-FETCH: If lifetime not set but RPC available, fetch latest blockhash
        if (!this.lifetime && this.config.rpc) {
            const { value } = await this.config.rpc.getLatestBlockhash().send();
            this.lifetime = {
                type: 'blockhash',
                blockhash: value.blockhash,
                lastValidBlockHeight: value.lastValidBlockHeight,
            };
        }

        if (!this.lifetime) {
            throw new Error(
                'Lifetime required. Provide blockhash via setBlockhashLifetime() or pass rpc to constructor for auto-fetch.',
            );
        }

        // Fetch lookup tables if addresses provided but data not
        let lookupTableData = this.config.addressesByLookupTable;
        if (!lookupTableData && this.config.lookupTableAddresses?.length && this.config.rpc) {
            // Cast to GetMultipleAccountsApi - users must provide an RPC that supports this when using lookupTableAddresses
            lookupTableData = await fetchAddressesForLookupTables(
                this.config.lookupTableAddresses,
                this.config.rpc as unknown as Rpc<GetMultipleAccountsApi>,
            );
        }

        // Build using Kit's functional API with pipe
        let message: any = pipe(
            createTransactionMessage({ version: this.config.version }),
            tx => setTransactionMessageFeePayer(this.feePayer!, tx),
            tx =>
                this.lifetime!.type === 'blockhash'
                    ? setTransactionMessageLifetimeUsingBlockhash(
                          {
                              blockhash: this.lifetime!.blockhash as any,
                              lastValidBlockHeight: this.lifetime!.lastValidBlockHeight,
                          },
                          tx,
                      )
                    : setTransactionMessageLifetimeUsingDurableNonce(
                          {
                              nonce: this.lifetime!.nonce as any,
                              nonceAccountAddress: this.lifetime!.nonceAccountAddress,
                              nonceAuthorityAddress: this.lifetime!.nonceAuthorityAddress,
                          },
                          tx,
                      ),
        );

        // Attach fee payer signer if available
        if (this.feePayerSigner) {
            message = addSignersToTransactionMessage([this.feePayerSigner], message);
        }

        // Caller-supplied ComputeBudget instructions are folded into the
        // builder's budget so no kind is ever emitted twice (the runtime
        // rejects duplicates) and v1 keeps its budget in the config only.
        const { instructions, callerValues } = extractComputeBudgetValues(this.instructions);

        if (this.config.version === 1) {
            // v1: resource limits and the priority fee live in the message config,
            // and the compute unit limit + loaded accounts data size are mandatory.
            message = await this.buildV1Body(message, instructions, callerValues);

            // Auto-validate before returning
            validateTransaction(message);
            validateTransactionSize(message);

            return message;
        }

        // SET COMPUTE BUDGET FIRST (if configured)
        // Kit's setters are version-agnostic: on legacy/v0 they append-or-replace
        // compute budget instructions. Running them before user instructions
        // preserves the wire order [limit, price, loaded-accounts-data-size, heap, ...user instructions].
        // Caller-supplied values were stripped above and apply only where the
        // builder has no explicit config for the field.

        // 1. Compute unit limit
        const computeUnits = await this.resolveComputeUnits(callerValues);
        if (computeUnits === TransactionBuilder.PROVISORY_CU_SENTINEL) {
            // Provisory (0 CU) limit - will be estimated via simulation during execute()
            message = fillTransactionMessageProvisoryResourceLimits(message);
        } else if (computeUnits !== null) {
            message = setTransactionMessageComputeUnitLimit(Math.min(computeUnits, MAX_COMPUTE_UNIT_LIMIT), message);
        }

        // 2. Priority fee / compute unit price
        const priorityFee = await this.resolvePriorityFee(callerValues);
        if (this.config.logLevel !== 'silent') {
            console.log(
                `[Pipeit] Priority fee: ${priorityFee.toLocaleString()} micro-lamports/CU (${(Number(priorityFee) / 1_000_000).toFixed(3)} lamports/CU)`,
            );
        }
        if (priorityFee > 0n) {
            message = setTransactionMessageComputeUnitPrice(priorityFee, message);
        }

        // 3. Loaded accounts data size limit (only when configured or caller-supplied)
        const loadedAccountsDataSizeLimit =
            this.config.loadedAccountsDataSizeLimit ?? callerValues.loadedAccountsDataSizeLimit;
        if (loadedAccountsDataSizeLimit !== undefined) {
            message = setTransactionMessageLoadedAccountsDataSizeLimit(loadedAccountsDataSizeLimit, message);
        }

        // 4. Heap frame (caller-supplied only; the builder has no heap config)
        if (callerValues.heapSize !== undefined) {
            message = setTransactionMessageHeapSize(callerValues.heapSize, message);
        }

        // Add user's instructions after compute budget instructions
        for (const instruction of instructions) {
            message = appendTransactionMessageInstruction(instruction, message);
        }

        // Apply address lookup table compression (version 0 only)
        if (lookupTableData && this.config.version === 0) {
            message = compressTransactionMessage(message, lookupTableData);
        }

        // Auto-validate before returning
        validateTransaction(message);
        validateTransactionSize(message);

        return message;
    }

    /**
     * Version 1 body: append the user's instructions, then resolve the
     * compute unit limit, loaded accounts data size limit and priority fee into
     * the message config. A v1 message that leaves either limit unset is
     * budgeted zero and fails at execution, so this never returns provisory
     * limits.
     */
    private async buildV1Body(
        message: any,
        instructions: readonly Instruction[],
        callerValues: CallerComputeBudgetValues,
    ): Promise<any> {
        // 1. User instructions first: config carries no ordering, and any
        //    simulation below must see the complete message.
        for (const instruction of instructions) {
            message = appendTransactionMessageInstruction(instruction, message);
        }

        // 2. Explicit limits from config (or the caller's instructions where
        //    the builder has none).
        const computeUnits = await this.resolveComputeUnits(callerValues);
        if (computeUnits !== null && computeUnits !== TransactionBuilder.PROVISORY_CU_SENTINEL) {
            message = setTransactionMessageComputeUnitLimit(Math.min(computeUnits, MAX_COMPUTE_UNIT_LIMIT), message);
        }
        const loadedAccountsDataSizeLimit =
            this.config.loadedAccountsDataSizeLimit ?? callerValues.loadedAccountsDataSizeLimit;
        if (loadedAccountsDataSizeLimit !== undefined) {
            message = setTransactionMessageLoadedAccountsDataSizeLimit(loadedAccountsDataSizeLimit, message);
        }
        if (callerValues.heapSize !== undefined) {
            message = setTransactionMessageHeapSize(callerValues.heapSize, message);
        }

        // 3. Whatever is still unset becomes provisory (0) so 'auto', 'simulate'
        //    and a missing data-size limit all take the same estimation path.
        message = fillTransactionMessageProvisoryResourceLimits(message);

        try {
            // 4. Replace provisory limits with estimates (or the no-RPC fallback).
            message = await this.finalizeV1ResourceLimits(message, instructions.length);

            // 5. Priority fee, computed against the final compute unit limit.
            const computeUnitLimit = getTransactionMessageComputeUnitLimit(message) ?? 0;
            const lamports = await this.resolveV1PriorityFeeLamports(computeUnitLimit, callerValues);
            if (lamports > 0n) {
                message = setTransactionMessagePriorityFeeLamports(lamports, message);
            }
        } catch (error) {
            throw translateVersionError(error, 1);
        }

        return message;
    }

    /**
     * Ensure a version 1 message carries a non-zero compute unit limit and
     * loaded accounts data size limit.
     *
     * - Both explicit: nothing to do.
     * - RPC configured: simulate once and fill whatever is provisory. Kit only
     *   replaces provisory values, so a fixed compute unit limit is preserved
     *   and only the data size is estimated.
     * - No RPC: fall back to `200,000 × instruction count` CU (the runtime's
     *   legacy/v0 default) and the 64 MiB data size cap, and warn.
     */
    private async finalizeV1ResourceLimits(message: any, instructionCount: number): Promise<any> {
        const computeUnitLimit = getTransactionMessageComputeUnitLimit(message) ?? 0;
        const loadedAccountsDataSizeLimit = getTransactionMessageLoadedAccountsDataSizeLimit(message) ?? 0;

        if (computeUnitLimit > 0 && loadedAccountsDataSizeLimit > 0) {
            return message;
        }

        if (this.config.rpc) {
            const { computeUnits } = this.config;
            const buffer =
                (typeof computeUnits === 'object' && computeUnits.strategy === 'simulate'
                    ? computeUnits.buffer
                    : undefined) ?? DEFAULT_COMPUTE_BUFFER;
            const estimateAndSet = createBufferedResourceLimitsEstimator({
                rpc: this.config.rpc as unknown as Rpc<SimulateTransactionApi>,
                buffer,
            });
            const estimated = await estimateAndSet(message);
            if (this.config.logLevel !== 'silent') {
                console.log(
                    `[Pipeit] v1 resource limits estimated via simulation: ` +
                        `${getTransactionMessageComputeUnitLimit(estimated)} CU, ` +
                        `${getTransactionMessageLoadedAccountsDataSizeLimit(estimated)} bytes loaded accounts data`,
                );
            }
            return estimated;
        }

        let fallback = message;
        if (computeUnitLimit === 0) {
            fallback = setTransactionMessageComputeUnitLimit(
                Math.min(DEFAULT_COMPUTE_UNIT_LIMIT * Math.max(instructionCount, 1), MAX_COMPUTE_UNIT_LIMIT),
                fallback,
            );
        }
        if (loadedAccountsDataSizeLimit === 0) {
            fallback = setTransactionMessageLoadedAccountsDataSizeLimit(MAX_LOADED_ACCOUNTS_DATA_SIZE_LIMIT, fallback);
        }
        if (this.config.logLevel !== 'silent') {
            console.warn(
                '[Pipeit] Version 1 transaction built without an rpc: resource limits could not be estimated. ' +
                    `Falling back to ${getTransactionMessageComputeUnitLimit(fallback)} CU and ` +
                    `${getTransactionMessageLoadedAccountsDataSizeLimit(fallback)} bytes loaded accounts data. ` +
                    'Pass rpc to the constructor, or set computeUnits and loadedAccountsDataSizeLimit explicitly.',
            );
        }
        return fallback;
    }

    /**
     * Resolve the total priority fee (lamports) for a version 1 message.
     * An explicit `priorityFee.lamports` wins; otherwise the per-CU price is
     * converted using the final compute unit limit.
     */
    private async resolveV1PriorityFeeLamports(
        computeUnitLimit: number,
        callerValues: CallerComputeBudgetValues,
    ): Promise<bigint> {
        const { priorityFee } = this.config;

        if (!this.explicitConfig.priorityFee && callerValues.computeUnitPriceMicroLamports !== undefined) {
            const lamports = microLamportsToPriorityFeeLamports(
                callerValues.computeUnitPriceMicroLamports,
                computeUnitLimit,
            );
            if (this.config.logLevel !== 'silent') {
                console.log(
                    `[Pipeit] Priority fee: ${lamports.toLocaleString()} lamports total ` +
                        `(${callerValues.computeUnitPriceMicroLamports.toLocaleString()} micro-lamports/CU from instruction × ${computeUnitLimit.toLocaleString()} CU)`,
                );
            }
            return lamports;
        }

        if (typeof priorityFee === 'object') {
            if (priorityFee.strategy === 'none') return 0n;
            if (priorityFee.lamports !== undefined) {
                if (this.config.logLevel !== 'silent') {
                    console.log(
                        `[Pipeit] Priority fee: ${priorityFee.lamports.toLocaleString()} lamports total (explicit)`,
                    );
                }
                return priorityFee.lamports;
            }
        }

        const microLamportsPerCU = await this.resolveConfiguredPriorityFee();
        const lamports = microLamportsToPriorityFeeLamports(microLamportsPerCU, computeUnitLimit);
        if (this.config.logLevel !== 'silent') {
            console.log(
                `[Pipeit] Priority fee: ${lamports.toLocaleString()} lamports total ` +
                    `(${microLamportsPerCU.toLocaleString()} micro-lamports/CU × ${computeUnitLimit.toLocaleString()} CU)`,
            );
        }
        return lamports;
    }

    /**
     * Resolve the per-CU priority fee (micro-lamports) based on configuration.
     * A caller-supplied SetComputeUnitPrice is used only when `priorityFee`
     * was not configured explicitly.
     */
    private async resolvePriorityFee(callerValues?: CallerComputeBudgetValues): Promise<bigint> {
        if (!this.explicitConfig.priorityFee && callerValues?.computeUnitPriceMicroLamports !== undefined) {
            return callerValues.computeUnitPriceMicroLamports;
        }
        return BigInt(await this.resolveConfiguredPriorityFee());
    }

    /**
     * Resolve the configured per-CU priority fee (micro-lamports), ignoring
     * caller-supplied instructions.
     */
    private async resolveConfiguredPriorityFee(): Promise<number> {
        const { priorityFee } = this.config;

        // String level (preset)
        if (typeof priorityFee === 'string') {
            return PRIORITY_FEE_LEVELS[priorityFee] ?? 0;
        }

        // Config object
        if (priorityFee.strategy === 'none') {
            return 0;
        }

        if (priorityFee.strategy === 'fixed') {
            return priorityFee.microLamports ?? 0;
        }

        // Percentile strategy - requires RPC
        if (priorityFee.strategy === 'percentile' && this.config.rpc) {
            const estimate = await estimatePriorityFee(this.config.rpc as any, priorityFee);
            return estimate.microLamports;
        }

        // Fallback to medium
        return PRIORITY_FEE_LEVELS.medium;
    }

    /**
     * Sentinel value indicating provisory CU instruction should be used.
     * The actual CU limit will be estimated via simulation during execute().
     */
    private static readonly PROVISORY_CU_SENTINEL = -1;

    /**
     * Check if the current compute units config uses the simulate strategy.
     */
    private isSimulateCUStrategy(): boolean {
        const { computeUnits } = this.config;
        if (typeof computeUnits === 'object' && computeUnits.strategy === 'simulate') {
            return true;
        }
        return false;
    }

    /**
     * Estimate resource limits via simulation and set them on the message,
     * replacing the provisory (0 CU) limit added during build().
     *
     * Legacy/v0 only (v1 resolves its limits inside build()). Applies the
     * configured `buffer` multiplier (default 1.1) when the 'simulate'
     * strategy is in use; Kit only sets the compute unit limit here since
     * loaded-accounts-data-size estimation is v1-gated inside Kit.
     */
    private async applyEstimatedResourceLimits(message: any): Promise<any> {
        const { computeUnits } = this.config;
        const buffer =
            typeof computeUnits === 'object' && computeUnits.strategy === 'simulate'
                ? (computeUnits.buffer ?? DEFAULT_COMPUTE_BUFFER)
                : 1;

        const estimateAndSet = createBufferedResourceLimitsEstimator({
            rpc: this.config.rpc as unknown as Rpc<SimulateTransactionApi>,
            buffer,
        });
        return await estimateAndSet(message);
    }

    /**
     * Resolve compute units based on configuration.
     * Returns null if no compute unit instruction should be added.
     * Returns PROVISORY_CU_SENTINEL if a provisory instruction should be added
     * (will be updated via simulation during execute()).
     */
    private async resolveComputeUnits(callerValues?: CallerComputeBudgetValues): Promise<number | null> {
        const { computeUnits } = this.config;

        // A caller-supplied limit applies only when computeUnits was not configured
        if (!this.explicitConfig.computeUnits && callerValues?.computeUnitLimit !== undefined) {
            return callerValues.computeUnitLimit;
        }

        // 'auto' = no explicit instruction
        if (computeUnits === 'auto') {
            return null;
        }

        // Fixed number
        if (typeof computeUnits === 'number') {
            return computeUnits;
        }

        // Config object
        if (computeUnits.strategy === 'auto') {
            return null;
        }

        if (computeUnits.strategy === 'fixed') {
            return computeUnits.units ?? 200_000;
        }

        // Simulate strategy - use provisory pattern
        // The actual CU limit will be estimated via simulation during execute()
        if (computeUnits.strategy === 'simulate') {
            return TransactionBuilder.PROVISORY_CU_SENTINEL;
        }

        return null;
    }

    /**
     * Simulate the transaction without sending it.
     * Useful for testing and debugging before execution.
     *
     * Note: Requires feePayer to be set and RPC in config.
     */
    async simulate(params?: { commitment?: 'processed' | 'confirmed' | 'finalized' }): Promise<SimulationResult> {
        const commitment = params?.commitment ?? 'confirmed';

        if (!this.feePayer) {
            throw new SolanaError(SOLANA_ERROR__TRANSACTION__FEE_PAYER_MISSING);
        }

        if (!this.config.rpc) {
            throw new Error('RPC required for simulation. Pass rpc in constructor.');
        }

        // Build message using the unified build method
        const message = await (this as any).build();

        // Sign for simulation
        const signedTransaction: any = await signTransactionMessageWithSigners(message);

        // Simulate using Kit's API
        const rpcWithSim = this.config.rpc as unknown as Rpc<SimulateTransactionApi>;
        const result = await rpcWithSim
            .simulateTransaction(signedTransaction, {
                commitment,
                replaceRecentBlockhash: true,
            })
            .send();

        return {
            err: result.value.err,
            logs: result.value.logs,
            unitsConsumed: result.value.unitsConsumed,
            returnData: result.value.returnData,
        };
    }

    /**
     * Sign and export the transaction in specified format WITHOUT sending.
     *
     * Use this when you want to:
     * - Send via custom transport or different RPC
     * - Store signed transactions for batch sending
     * - Use with hardware wallets
     * - Generate QR codes for mobile wallets
     * - Pass transactions to other systems
     *
     * @param format - Export format: 'base64' (default), 'base58', or 'bytes'
     * @returns Serialized signed transaction
     *
     * @example
     * ```ts
     * // Export for custom RPC
     * const { data: base64Tx } = await builder.export('base64');
     * await customRpc.sendTransaction(base64Tx, { encoding: 'base64' });
     *
     * // Export for hardware wallet
     * const { data: bytes } = await builder.export('bytes');
     * await ledger.signTransaction(bytes);
     *
     * // Export for QR code
     * const { data: base58Tx } = await builder.export('base58');
     * displayQRCode(base58Tx);
     * ```
     */
    async export(format: ExportFormat = 'base64'): Promise<ExportedTransaction> {
        if (!this.feePayer) {
            throw new SolanaError(SOLANA_ERROR__TRANSACTION__FEE_PAYER_MISSING);
        }

        if (!this.config.rpc) {
            throw new Error('RPC required for export. Pass rpc in constructor.');
        }

        // Build message using the unified build method
        let message = await (this as any).build();

        // If using simulate strategy on legacy/v0, estimate and replace the
        // provisory resource limits (v1 already resolved them inside build()).
        if (this.config.version !== 1 && this.isSimulateCUStrategy()) {
            message = await this.applyEstimatedResourceLimits(message);
        }

        // Sign transaction
        const signedTransaction: any = await signTransactionMessageWithSigners(message);

        // Serialize in requested format
        switch (format) {
            case 'base64': {
                const base64 = getBase64EncodedWireTransaction(signedTransaction);
                return { format: 'base64', data: base64 };
            }
            case 'base58': {
                const encoder = getTransactionEncoder();
                const bytes = encoder.encode(signedTransaction);
                const base58Decoder = getBase58Decoder();
                const base58 = base58Decoder.decode(new Uint8Array(bytes));
                return { format: 'base58', data: base58 };
            }
            case 'bytes': {
                const encoder = getTransactionEncoder();
                const bytes = encoder.encode(signedTransaction);
                return { format: 'bytes', data: new Uint8Array(bytes) };
            }
        }
    }

    /**
     * Execute the transaction with smart defaults.
     *
     * Supports advanced sending options like skipPreflight and maxRetries,
     * as well as execution strategies for Jito bundles and parallel submission.
     *
     * Note: Requires feePayer to be set and RPC in config.
     *
     * @example
     * ```ts
     * // Basic execution
     * const sig = await builder.execute({ rpcSubscriptions });
     *
     * // With execution strategy preset
     * const sig = await builder.execute({
     *   rpcSubscriptions,
     *   execution: 'fast', // Jito + parallel for max speed
     * });
     *
     * // With custom execution config
     * const sig = await builder.execute({
     *   rpcSubscriptions,
     *   execution: {
     *     jito: { enabled: true, tipLamports: 50_000n },
     *     parallel: { enabled: true, endpoints: ['https://my-rpc.com'] },
     *   },
     * });
     *
     * // With sending options
     * const sig = await builder.execute({
     *   rpcSubscriptions,
     *   skipPreflight: false,
     *   skipPreflightOnRetry: true,
     *   maxRetries: 5,
     *   preflightCommitment: 'confirmed',
     * });
     * ```
     */
    async execute(
        params: {
            rpcSubscriptions: RpcSubscriptions<SignatureNotificationsApi & SlotNotificationsApi>;
        } & ExecuteConfig,
    ): Promise<string> {
        try {
            return await this.executeInternal(params);
        } catch (error) {
            // Surface "this endpoint cannot handle v1" failures with a clear message.
            throw this.config.version === 1 ? translateVersionError(error, 1) : error;
        }
    }

    private async executeInternal(
        params: {
            rpcSubscriptions: RpcSubscriptions<SignatureNotificationsApi & SlotNotificationsApi>;
        } & ExecuteConfig,
    ): Promise<string> {
        const {
            rpcSubscriptions,
            commitment = 'confirmed',
            skipPreflight = false,
            skipPreflightOnRetry = true,
            preflightCommitment = 'confirmed',
            maxRetries,
            execution,
        } = params;

        if (!this.feePayer) {
            throw new SolanaError(SOLANA_ERROR__TRANSACTION__FEE_PAYER_MISSING);
        }

        if (!this.config.rpc) {
            throw new Error('RPC required for execute. Pass rpc in constructor.');
        }

        const rpc = this.config.rpc as unknown as Rpc<
            GetEpochInfoApi & GetSignatureStatusesApi & SendTransactionApi & GetLatestBlockhashApi
        >;

        // Resolve execution strategy
        const executionConfig = resolveExecutionConfig(execution);

        // If Jito is enabled, we need to add the tip instruction before building
        // Clone the builder to avoid mutating the original
        let builderToUse: TransactionBuilder<TState> = this;

        if (executionConfig.jito.enabled && executionConfig.jito.tipLamports > 0n) {
            builderToUse = this.clone();
            const tipInstruction = createTipInstruction(this.feePayer, executionConfig.jito.tipLamports);
            builderToUse.instructions.push(tipInstruction);

            if (this.config.logLevel !== 'silent') {
                console.log(`[Pipeit] Adding Jito tip: ${executionConfig.jito.tipLamports} lamports`);
            }
        }

        // Build message using the unified build method
        let message = await (builderToUse as any).build();

        // If using simulate strategy on legacy/v0, estimate and replace the
        // provisory resource limits (v1 already resolved them inside build()).
        if (this.config.version !== 1 && builderToUse.isSimulateCUStrategy()) {
            message = await builderToUse.applyEstimatedResourceLimits(message);

            if (this.config.logLevel !== 'silent') {
                console.log(`[Pipeit] Estimated compute units via simulation`);
            }
        }

        // Sign transaction
        const signedTransaction: any = await signTransactionMessageWithSigners(message);

        // Get base64 encoded transaction for execution strategies
        const base64Tx = getBase64EncodedWireTransaction(signedTransaction);

        // Check if we should use execution strategies (Jito, parallel, or TPU enabled)
        const useExecutionStrategy =
            executionConfig.jito.enabled || executionConfig.parallel.enabled || executionConfig.tpu.enabled;

        if (useExecutionStrategy) {
            // Use execution strategy
            if (this.config.logLevel !== 'silent') {
                const strategyName = executionConfig.tpu.enabled
                    ? 'TPU Direct'
                    : executionConfig.jito.enabled && executionConfig.parallel.enabled
                      ? 'Jito + Parallel'
                      : executionConfig.jito.enabled
                        ? 'Jito'
                        : 'Parallel';
                console.log(`[Pipeit] Using ${strategyName} execution strategy`);
            }

            // Extract RPC URL from the RPC client
            // Note: We need to get the URL somehow - for now, assume it's available
            // In practice, users should provide endpoints in parallel config
            const rpcUrl = this.getRpcUrl();

            const result = await executeWithStrategy(base64Tx, executionConfig, {
                ...(rpcUrl && { rpcUrl }),
                feePayer: this.feePayer,
                ...(params.abortSignal && { abortSignal: params.abortSignal }),
            });

            // For TPU with continuous resubmission, confirmation happens server-side
            if (result.landedVia === 'tpu') {
                if (this.config.logLevel !== 'silent') {
                    if (result.confirmed) {
                        console.log(
                            `[Pipeit] ✅ Transaction CONFIRMED on-chain via TPU!\n` +
                                `         Rounds: ${result.rounds ?? 'N/A'}, Leaders sent: ${result.leaderCount ?? 'N/A'}\n` +
                                `         Latency: ${result.latencyMs ?? 'N/A'}ms`,
                        );
                    } else {
                        console.warn(
                            `[Pipeit] ⚠️ TPU submission completed but transaction NOT confirmed.\n` +
                                `         Rounds: ${result.rounds ?? 'N/A'}, Leaders sent: ${result.leaderCount ?? 'N/A'}\n` +
                                `         Signature: ${result.signature}\n` +
                                `         The transaction may still land - check explorer.`,
                        );
                    }
                }

                // Return signature - for TPU, confirmation already happened server-side
                return result.signature;
            }

            // For non-TPU strategies (Jito, parallel), use standard confirmation
            if (this.config.logLevel !== 'silent') {
                console.log(
                    `[Pipeit] Transaction sent via ${result.landedVia}${result.latencyMs ? ` in ${result.latencyMs}ms` : ''}`,
                );
            }

            // Confirm via WebSocket subscription
            try {
                await this.confirmTransaction(result.signature, rpcSubscriptions, commitment);
                if (this.config.logLevel !== 'silent') {
                    console.log(`[Pipeit] ✅ Transaction confirmed via WebSocket subscription`);
                }
            } catch (confirmError) {
                throw confirmError;
            }

            // Verify transaction execution status (catch false positives)
            await this.verifyTransactionSuccess(rpc, result.signature);

            return result.signature;
        }

        // Standard execution path (no Jito, no parallel)
        const sendAndConfirm = sendAndConfirmTransactionFactory({
            rpc,
            rpcSubscriptions,
        });

        // Add retry logic if enabled
        if (this.config.autoRetry) {
            return this.executeWithRetry(sendAndConfirm, signedTransaction, commitment, rpc, {
                skipPreflightOnRetry,
                preflightCommitment,
            });
        }

        // Prepare send options (avoid undefined for exactOptionalPropertyTypes)
        const sendOptions: Parameters<typeof sendAndConfirm>[1] = {
            commitment,
            ...(skipPreflight && { skipPreflight }),
            ...(!skipPreflight && { preflightCommitment }),
            ...(maxRetries !== undefined && { maxRetries: BigInt(maxRetries) }),
        };

        await sendAndConfirm(signedTransaction, sendOptions);
        const signature = getSignatureFromTransaction(signedTransaction);

        // Verify transaction execution status (catch false positives)
        await this.verifyTransactionSuccess(rpc, signature);

        return signature;
    }

    /**
     * Get the RPC URL from the configured RPC client.
     * This is a best-effort extraction - may not work for all RPC client types.
     */
    private getRpcUrl(): string | undefined {
        // The RPC client from @solana/rpc doesn't expose the URL directly
        // Users should configure parallel.endpoints if they want parallel submission
        // For now, return undefined and let the execution strategy handle it
        return undefined;
    }

    /**
     * Confirm a transaction signature using WebSocket subscriptions.
     */
    private async confirmTransaction(
        signature: string,
        rpcSubscriptions: RpcSubscriptions<SignatureNotificationsApi & SlotNotificationsApi>,
        commitment: 'processed' | 'confirmed' | 'finalized',
    ): Promise<void> {
        // Subscribe to signature notifications
        const notifications = await rpcSubscriptions
            .signatureNotifications(signature as any, { commitment })
            .subscribe({ abortSignal: AbortSignal.timeout(60_000) });

        // Wait for confirmation
        for await (const notification of notifications) {
            if (notification.value.err) {
                throw new TransactionExecutionError(signature, notification.value.err);
            }
            // Transaction confirmed
            return;
        }
    }

    /**
     * Verify that a transaction executed successfully (no program errors).
     * This catches false positives where a transaction is confirmed but failed execution.
     *
     * Uses `searchTransactionHistory: true` to perform a ledger lookup instead of relying
     * on the RPC's in-memory cache. Retries with exponential backoff if the status is null
     * (not yet available), throwing only after all attempts are exhausted.
     */
    private async verifyTransactionSuccess(
        rpc: Rpc<GetSignatureStatusesApi>,
        signature: string,
        options?: {
            /** Maximum number of retry attempts (default: 12) */
            maxAttempts?: number;
            /** Initial delay in milliseconds before first retry (default: 1000) */
            initialDelayMs?: number;
            /** Maximum delay in milliseconds between retries (default: 8000) */
            maxDelayMs?: number;
        },
    ): Promise<void> {
        const {
            maxAttempts = 12, // Increased from 5 - gives more time for RPC to index
            initialDelayMs = 1000, // Increased from 500 - start with longer delay
            maxDelayMs = 8000, // Increased from 4000 - longer max delay for slow RPCs
        } = options ?? {};

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            const { value: statuses } = await rpc
                .getSignatureStatuses([signature as any], {
                    searchTransactionHistory: true,
                })
                .send();

            const status = statuses[0];

            // If we got a definitive status, check for errors
            if (status !== null) {
                if (status.err) {
                    throw new TransactionExecutionError(signature, status.err);
                }
                // Transaction executed successfully
                return;
            }

            // Status is null - not yet available in ledger
            if (attempt === maxAttempts) {
                // Exhausted all attempts without getting a definitive status
                throw new Error(
                    `Unable to verify transaction status after ${maxAttempts} attempts. ` +
                        `Signature: ${signature}. The transaction may have landed but status could not be confirmed.`,
                );
            }

            // Calculate delay with exponential backoff, capped at maxDelayMs
            const delay = Math.min(initialDelayMs * Math.pow(2, attempt - 1), maxDelayMs);

            if (this.config.logLevel === 'verbose') {
                console.log(
                    `[Pipeit] Transaction status not yet available, retrying in ${delay}ms (attempt ${attempt}/${maxAttempts})`,
                );
            }

            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    /**
     * Get current transaction size information.
     * Useful before calling build() to check if more instructions can fit.
     * The limit depends on the version: 1232 bytes for legacy/v0, 4096 for v1.
     *
     * Note: This builds the message to calculate accurate size.
     * Requires feePayer to be set and RPC in config for auto-blockhash.
     *
     * @example
     * ```ts
     * const info = await builder.getSizeInfo();
     * console.log(`Using ${info.percentUsed.toFixed(1)}% of transaction space`);
     * console.log(`${info.remaining} bytes remaining`);
     * ```
     */
    async getSizeInfo(): Promise<{
        size: number;
        limit: number;
        remaining: number;
        percentUsed: number;
        canFitMore: boolean;
    }> {
        // Build message to get accurate size
        const message = await (this as any).build();
        const size = getTransactionMessageSize(message);
        // Version-aware: 1232 bytes for legacy/v0, 4096 bytes for v1.
        const limit = getTransactionMessageSizeLimit(message);
        return {
            size,
            limit,
            remaining: limit - size,
            percentUsed: (size / limit) * 100,
            canFitMore: size < limit,
        };
    }

    /**
     * Execute transaction with retry logic.
     */
    private async executeWithRetry(
        sendAndConfirm: ReturnType<typeof sendAndConfirmTransactionFactory>,
        transaction: any,
        commitment: 'processed' | 'confirmed' | 'finalized',
        rpc: Rpc<GetSignatureStatusesApi>,
        options?: {
            skipPreflightOnRetry?: boolean;
            preflightCommitment?: 'processed' | 'confirmed' | 'finalized';
        },
    ): Promise<string> {
        const retryConfig =
            this.config.autoRetry === true
                ? { maxAttempts: 3, backoff: 'exponential' as const }
                : this.config.autoRetry;

        if (!retryConfig || typeof retryConfig === 'boolean') {
            throw new Error('Invalid retry configuration');
        }

        const { maxAttempts, backoff } = retryConfig;
        const { skipPreflightOnRetry = true, preflightCommitment = 'confirmed' } = options ?? {};

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                if (this.config.logLevel !== 'silent') {
                    console.log(`[Pipeit] Transaction attempt ${attempt}/${maxAttempts}`);
                }

                // Skip preflight on retry attempts if enabled
                const shouldSkipPreflight = attempt > 1 && skipPreflightOnRetry;
                const sendOptions: Parameters<typeof sendAndConfirm>[1] = {
                    commitment,
                    ...(shouldSkipPreflight && { skipPreflight: true }),
                    ...(!shouldSkipPreflight && { preflightCommitment }),
                };

                await sendAndConfirm(transaction, sendOptions);
                const signature = getSignatureFromTransaction(transaction);

                // Verify transaction execution status (catch false positives)
                await this.verifyTransactionSuccess(rpc, signature);

                return signature;
            } catch (error) {
                if (attempt === maxAttempts) {
                    if (this.config.logLevel === 'verbose') {
                        console.error(`[Pipeit] Transaction failed after ${maxAttempts} attempts:`, error);
                        const cause = (error as any)?.cause;
                        if (cause) {
                            console.error('[Pipeit] Error cause:', cause);
                            const causeLogs =
                                (cause as any)?.logs ??
                                (cause as any)?.data?.logs ??
                                (cause as any)?.simulationResponse?.logs;
                            if (causeLogs) {
                                const logs = Array.isArray(causeLogs) ? causeLogs : [String(causeLogs)];
                                console.error('[Pipeit] Cause logs:\n' + logs.join('\n'));
                            }
                        }
                        const context = (error as any)?.context ?? (error as any)?.data;
                        if (context) {
                            console.error('[Pipeit] Error context:', context);
                        }
                    }
                    const maybeLogs =
                        (error as any)?.logs ?? (error as any)?.data?.logs ?? (error as any)?.simulationResponse?.logs;
                    if (maybeLogs) {
                        const logs = Array.isArray(maybeLogs) ? maybeLogs : [String(maybeLogs)];
                        console.error('[Pipeit] Simulation logs:\n' + logs.join('\n'));
                    } else if (this.config.logLevel === 'verbose') {
                        console.error('[Pipeit] Transaction error details (no logs found):', error);
                    }
                    throw error;
                }

                const delay = backoff === 'exponential' ? Math.pow(2, attempt - 1) * 1000 : attempt * 1000;

                if (this.config.logLevel === 'verbose') {
                    console.log(`[Pipeit] Retrying in ${delay}ms...`);
                }

                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }

        throw new Error('Transaction failed after retries');
    }

    /**
     * Clone the builder for immutability.
     */
    private clone(): TransactionBuilder<TState> {
        const builder = new TransactionBuilder<TState>({
            version: this.config.version,
            ...(this.config.rpc && { rpc: this.config.rpc }),
            autoRetry: this.config.autoRetry,
            logLevel: this.config.logLevel,
            priorityFee: this.config.priorityFee,
            computeUnits: this.config.computeUnits,
            ...(this.config.loadedAccountsDataSizeLimit !== undefined && {
                loadedAccountsDataSizeLimit: this.config.loadedAccountsDataSizeLimit,
            }),
            ...(this.config.lookupTableAddresses && { lookupTableAddresses: this.config.lookupTableAddresses }),
            ...(this.config.addressesByLookupTable && { addressesByLookupTable: this.config.addressesByLookupTable }),
        });
        // The constructor above saw resolved defaults; restore what was explicit.
        builder.explicitConfig = { ...this.explicitConfig };
        if (this.feePayer !== undefined) {
            builder.feePayer = this.feePayer;
        }
        if (this.feePayerSigner !== undefined) {
            builder.feePayerSigner = this.feePayerSigner;
        }
        if (this.lifetime !== undefined) {
            builder.lifetime = this.lifetime;
        }
        builder.instructions = [...this.instructions];
        return builder;
    }
}
