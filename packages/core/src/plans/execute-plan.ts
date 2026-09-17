/**
 * Helper to execute Kit instruction plans with TransactionBuilder features.
 *
 * @packageDocumentation
 */

import type { Address } from '@solana/addresses';
import type {
    Rpc,
    GetLatestBlockhashApi,
    GetMultipleAccountsApi,
    GetEpochInfoApi,
    GetSignatureStatusesApi,
    SendTransactionApi,
    SimulateTransactionApi,
} from '@solana/rpc';
import type { RpcSubscriptions, SignatureNotificationsApi, SlotNotificationsApi } from '@solana/rpc-subscriptions';
import {
    type InstructionPlan,
    type TransactionPlanResult,
    createTransactionPlanner,
    createTransactionPlanExecutor,
} from '@solana/instruction-plans';
import {
    pipe,
    createTransactionMessage,
    setTransactionMessageFeePayer,
    setTransactionMessageLifetimeUsingBlockhash,
    signTransactionMessageWithSigners,
    sendAndConfirmTransactionFactory,
    getSignatureFromTransaction,
    fetchAddressesForLookupTables,
    fillTransactionMessageProvisoryResourceLimits,
    estimateResourceLimitsFactory,
    estimateAndSetResourceLimitsFactory,
} from '@solana/kit';
import type { TransactionMessage, TransactionMessageWithFeePayer } from '@solana/transaction-messages';
import { addSignersToTransactionMessage, type TransactionSigner } from '@solana/signers';
import { type AddressesByLookupTableAddress, compressTransactionMessage } from '../lookup-tables/index.js';
import { createBufferedResourceLimitsEstimator } from '../compute-budget/resource-limits.js';
import { translateVersionError } from '../errors/version-errors.js';
import type { SupportedTransactionVersion } from '../types.js';

/**
 * Base RPC API required for executing instruction plans.
 */
type BaseRpcApi = GetEpochInfoApi &
    GetSignatureStatusesApi &
    SendTransactionApi &
    GetLatestBlockhashApi &
    SimulateTransactionApi;

/**
 * RPC API required when fetching lookup tables (includes GetMultipleAccountsApi).
 */
type RpcApiWithLookupFetch = BaseRpcApi & GetMultipleAccountsApi;

/**
 * Base configuration for executing an instruction plan (no ALT support).
 */
interface ExecutePlanConfigBase {
    /**
     * RPC subscriptions client.
     */
    rpcSubscriptions: RpcSubscriptions<SignatureNotificationsApi & SlotNotificationsApi>;

    /**
     * Transaction signer (used as fee payer).
     */
    signer: TransactionSigner;

    /**
     * Commitment level for confirmations. Defaults to 'confirmed'.
     */
    commitment?: 'processed' | 'confirmed' | 'finalized';

    /**
     * Optional abort signal to cancel execution.
     */
    abortSignal?: AbortSignal;

    /**
     * Transaction version the planner packs instructions into. Defaults to 0.
     *
     * Version 1 (SIMD-0385) allows up to 4096 bytes per transaction, so the
     * planner packs more instructions per message. v1 does not support address
     * lookup tables, so it cannot be combined with `lookupTableAddresses` or
     * `addressesByLookupTable`. Resource limits (compute units and loaded
     * accounts data size) are estimated by simulation before each send.
     */
    version?: SupportedTransactionVersion;

    /**
     * Maximum number of top-level instructions the planner may pack into a
     * single transaction message. Defaults to Kit's planner default (16, which
     * assumes ~3 inner instructions per top-level instruction against Solana's
     * hard limit of 64 total instructions).
     *
     * Set to 64 to pack up to the hard transaction limit.
     */
    maxInstructionsPerTransaction?: number;
}

/**
 * Configuration without any ALT support (original behavior).
 */
interface ExecutePlanConfigNoAlt extends ExecutePlanConfigBase {
    /**
     * RPC client.
     */
    rpc: Rpc<BaseRpcApi>;

    /**
     * Not used in this variant.
     */
    lookupTableAddresses?: undefined;

    /**
     * Not used in this variant.
     */
    addressesByLookupTable?: undefined;
}

/**
 * Configuration with lookup table addresses to fetch.
 * Requires RPC client with GetMultipleAccountsApi.
 */
interface ExecutePlanConfigWithLookupAddresses extends ExecutePlanConfigBase {
    /**
     * RPC client with GetMultipleAccountsApi for fetching lookup tables.
     */
    rpc: Rpc<RpcApiWithLookupFetch>;

    /**
     * Lookup tables require version 0.
     */
    version?: 0;

    /**
     * Address lookup table addresses to fetch and use for transaction compression.
     * Tables will be fetched once and used to compress all transaction messages.
     */
    lookupTableAddresses: Address[];

    /**
     * Not used when lookupTableAddresses is provided.
     */
    addressesByLookupTable?: undefined;
}

/**
 * Configuration with pre-fetched lookup table data.
 * Does not require GetAccountInfoApi since tables are already fetched.
 */
interface ExecutePlanConfigWithLookupData extends ExecutePlanConfigBase {
    /**
     * RPC client.
     */
    rpc: Rpc<BaseRpcApi>;

    /**
     * Not used when addressesByLookupTable is provided.
     */
    lookupTableAddresses?: undefined;

    /**
     * Lookup tables require version 0.
     */
    version?: 0;

    /**
     * Pre-fetched lookup table data for transaction compression.
     * Use this to avoid fetching tables if you already have the data.
     */
    addressesByLookupTable: AddressesByLookupTableAddress;
}

/**
 * Configuration for executing an instruction plan.
 *
 * Supports optional address lookup table (ALT) compression:
 * - Provide `lookupTableAddresses` to fetch and use ALTs (requires `GetMultipleAccountsApi` on RPC)
 * - Provide `addressesByLookupTable` with pre-fetched data (no additional RPC requirements)
 * - Omit both for original behavior without ALT compression
 */
export type ExecutePlanConfig =
    ExecutePlanConfigNoAlt | ExecutePlanConfigWithLookupAddresses | ExecutePlanConfigWithLookupData;

/**
 * Execute a Kit instruction plan using TransactionBuilder features.
 *
 * This is a convenience wrapper around Kit's `createTransactionPlanner` and
 * `createTransactionPlanExecutor` that integrates with the standard Pipeit
 * configuration pattern.
 *
 * For simpler use cases or when you need dynamic instruction creation,
 * consider using {@link createFlow} instead.
 *
 * @param plan - The instruction plan to execute
 * @param config - Execution configuration
 * @returns The transaction plan result
 *
 * @example
 * ```ts
 * import { sequentialInstructionPlan, executePlan } from '@pipeit/core';
 *
 * // Create a plan with multiple instructions
 * const plan = sequentialInstructionPlan([
 *   transferInstruction1,
 *   transferInstruction2,
 *   transferInstruction3,
 * ]);
 *
 * // Execute the plan - Kit will automatically batch instructions
 * const result = await executePlan(plan, {
 *   rpc,
 *   rpcSubscriptions,
 *   signer,
 *   commitment: 'confirmed',
 * });
 * ```
 *
 * @example
 * ```ts
 * // Complex plan with parallel and sequential steps
 * import {
 *   sequentialInstructionPlan,
 *   parallelInstructionPlan,
 *   executePlan,
 * } from '@pipeit/core';
 *
 * const plan = sequentialInstructionPlan([
 *   parallelInstructionPlan([depositA, depositB]),
 *   activateVault,
 *   parallelInstructionPlan([withdrawA, withdrawB]),
 * ]);
 *
 * const result = await executePlan(plan, { rpc, rpcSubscriptions, signer });
 * ```
 */
export async function executePlan(plan: InstructionPlan, config: ExecutePlanConfig): Promise<TransactionPlanResult> {
    const {
        rpc,
        rpcSubscriptions,
        signer,
        commitment = 'confirmed',
        abortSignal,
        maxInstructionsPerTransaction,
        version = 0,
    } = config;

    if (version === 1 && (config.lookupTableAddresses?.length || config.addressesByLookupTable)) {
        throw new Error(
            'Address lookup tables are not supported by version 1 transactions. ' +
                'Use version: 0, or remove lookupTableAddresses / addressesByLookupTable.',
        );
    }

    // Resolve lookup table data once (prefetched or fetched from addresses)
    const lookupTableData = await resolveLookupTableData(config);

    // Create transaction planner with provisory resource limits and optional ALT compression hook
    const planner = createTransactionPlanner({
        createTransactionMessage: () => createPlanTransactionMessage({ rpc, signer, version, commitment }),
        // Pass through the instruction-count ceiling when provided (Kit v7 defaults to 16).
        ...(maxInstructionsPerTransaction !== undefined && { maxInstructionsPerTransaction }),
        // Apply ALT compression during planning so size checks account for compressed size.
        // This allows the planner to pack more instructions per transaction when ALTs are used.
        ...(lookupTableData && {
            onTransactionMessageUpdated: <TMessage extends TransactionMessage & TransactionMessageWithFeePayer>(
                message: TMessage,
            ): TMessage => compressTransactionMessage(message, lookupTableData),
        }),
    });

    // Plan the instructions into transactions
    const transactionPlan = await planner(plan, abortSignal ? { abortSignal } : {});

    // Create send and confirm factory
    const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });

    // Resource-limit estimation:
    // - legacy/v0: Kit's estimator as-is (compute units only; unchanged behavior).
    //   Note: an explicit SetComputeUnitLimit of exactly 1,400,000 is treated as
    //   non-explicit and re-estimated - identical to Kit's previous estimator behavior.
    // - v1: both compute units and loaded accounts data size are mandatory, so use the
    //   buffered estimator (headroom + 32 KiB page rounding) and translate "this RPC
    //   cannot simulate v1" errors into clear Pipeit errors.
    const estimateAndSetResourceLimits =
        version === 1
            ? createBufferedResourceLimitsEstimator({ rpc })
            : estimateAndSetResourceLimitsFactory(estimateResourceLimitsFactory({ rpc }));

    // Create transaction executor with resource-limit estimation and ALT compression.
    // Kit's executor expects the callback to return the result context ({ signature }).
    const executor = createTransactionPlanExecutor({
        executeTransactionMessage: async (context, message) => {
            try {
                // Apply ALT compression before CU estimation (if lookup tables provided)
                const compressedMessage = lookupTableData
                    ? compressTransactionMessage(message, lookupTableData)
                    : message;

                // Ensure signer is attached for CU simulation (and any later signing)
                const messageWithSigners = addSignersToTransactionMessage([signer], compressedMessage);

                // Estimate resource limits via simulation, replacing the provisory values.
                // No priority fee is added here: on v1 a priorityFeeLamports config entry
                // would grow the message beyond the bytes the planner reserved.
                const estimatedMessage = await estimateAndSetResourceLimits(messageWithSigners);

                // Sign the transaction
                const signedTransaction = await signTransactionMessageWithSigners(
                    addSignersToTransactionMessage([signer], estimatedMessage),
                );
                const signature = getSignatureFromTransaction(signedTransaction);
                // Record the signature before sending so a failed send still reports it.
                context.signature = signature;

                // Send and confirm - cast to expected type since we know it has blockhash lifetime
                await sendAndConfirm(signedTransaction as Parameters<typeof sendAndConfirm>[0], { commitment });
                return { ...context, signature };
            } catch (error) {
                throw version === 1 ? translateVersionError(error, 1) : error;
            }
        },
    });

    // Execute the plan
    return executor(transactionPlan, abortSignal ? { abortSignal } : {});
}

/**
 * Create the empty transaction message the planner packs instructions into:
 * fee payer, latest blockhash, provisory resource limits, and the signer
 * attached so simulation and signing work.
 *
 * Exported for testing and for callers who want to reuse the planner setup.
 *
 * @param config - RPC, fee payer signer and transaction version (default 0)
 */
export async function createPlanTransactionMessage(config: {
    rpc: Rpc<GetLatestBlockhashApi>;
    signer: TransactionSigner;
    version?: SupportedTransactionVersion;
    commitment?: 'processed' | 'confirmed' | 'finalized';
}) {
    const { rpc, signer, version = 0, commitment } = config;
    const { value: latestBlockhash } = await rpc.getLatestBlockhash(commitment ? { commitment } : {}).send();

    return pipe(
        createTransactionMessage({ version }),
        tx => setTransactionMessageFeePayer(signer.address, tx),
        tx => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
        // Reserve bytes for the resource limits the executor fills in later.
        // On v1 this is the compute unit limit and loaded accounts data size in
        // the message config; on legacy/v0 it is a provisory SetComputeUnitLimit.
        tx => fillTransactionMessageProvisoryResourceLimits(tx),
        // Attach signer so CU simulation + signing works (Kit requires this metadata)
        tx => addSignersToTransactionMessage([signer], tx),
    );
}

/**
 * Resolve lookup table data from config.
 * - If `addressesByLookupTable` is provided, use it directly.
 * - If `lookupTableAddresses` is provided, fetch the tables.
 * - Otherwise, return undefined (no ALT compression).
 */
async function resolveLookupTableData(config: ExecutePlanConfig): Promise<AddressesByLookupTableAddress | undefined> {
    // Use pre-fetched data if provided
    if (config.addressesByLookupTable) {
        return config.addressesByLookupTable;
    }

    // Fetch tables if addresses provided
    if (config.lookupTableAddresses && config.lookupTableAddresses.length > 0) {
        // TypeScript knows rpc has GetMultipleAccountsApi when lookupTableAddresses is provided
        const rpcWithLookupFetch = config.rpc as Rpc<RpcApiWithLookupFetch>;
        return fetchAddressesForLookupTables(config.lookupTableAddresses, rpcWithLookupFetch, {
            commitment: config.commitment ?? 'confirmed',
        });
    }

    // No ALT compression
    return undefined;
}
