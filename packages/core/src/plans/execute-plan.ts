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
    fetchAddressesForLookupTables,
    fillTransactionMessageProvisoryResourceLimits,
    estimateResourceLimitsFactory,
    estimateAndSetResourceLimitsFactory,
} from '@solana/kit';
import type { TransactionMessage, TransactionMessageWithFeePayer } from '@solana/transaction-messages';
import { addSignersToTransactionMessage, type TransactionSigner } from '@solana/signers';
import { type AddressesByLookupTableAddress, compressTransactionMessage } from '../lookup-tables/index.js';

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
     * Maximum number of top-level instructions the planner may pack into a
     * single transaction message. Defaults to Kit's planner default (16 as of
     * Kit v7, which assumes ~3 inner instructions per top-level instruction
     * against Solana's hard limit of 64 total instructions).
     *
     * Set to 64 to restore the pre-Kit-v7 behavior of packing up to the hard
     * transaction limit.
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
    | ExecutePlanConfigNoAlt
    | ExecutePlanConfigWithLookupAddresses
    | ExecutePlanConfigWithLookupData;

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
    const { rpc, rpcSubscriptions, signer, commitment = 'confirmed', abortSignal, maxInstructionsPerTransaction } = config;

    // Resolve lookup table data once (prefetched or fetched from addresses)
    const lookupTableData = await resolveLookupTableData(config);

    // Create transaction planner with provisory CU instruction and optional ALT compression hook
    const planner = createTransactionPlanner({
        createTransactionMessage: async () => {
            // Fetch latest blockhash
            const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

            // Create transaction message with fee payer, blockhash, and provisory resource limits
            // NOTE: widen via SupportedTransactionVersion when v1 construction lands in Kit
            // (kit 7.0.0's createTransactionMessage excludes version 1).
            return pipe(
                createTransactionMessage({ version: 0 }),
                tx => setTransactionMessageFeePayer(signer.address, tx),
                tx => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
                tx => fillTransactionMessageProvisoryResourceLimits(tx),
                // Attach signer so CU simulation + signing works (Kit requires this metadata)
                tx => addSignersToTransactionMessage([signer], tx),
            );
        },
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

    // Create resource-limit estimation helpers (compute units; loaded-accounts-data-size
    // estimation is v1-gated inside Kit, so v0 behavior is unchanged).
    // Note: an explicit user SetComputeUnitLimit of exactly 1,400,000 is treated as
    // non-explicit and re-estimated - identical to Kit's previous estimator behavior.
    const estimateAndSetResourceLimits = estimateAndSetResourceLimitsFactory(estimateResourceLimitsFactory({ rpc }));

    // Create transaction executor with resource-limit estimation and ALT compression
    const executor = createTransactionPlanExecutor({
        executeTransactionMessage: async (_context, message) => {
            // Apply ALT compression before CU estimation (if lookup tables provided)
            const compressedMessage = lookupTableData ? compressTransactionMessage(message, lookupTableData) : message;

            // Ensure signer is attached for CU simulation (and any later signing)
            const messageWithSigners = addSignersToTransactionMessage([signer], compressedMessage);

            // Estimate resource limits via simulation, replacing the provisory values
            const estimatedMessage = await estimateAndSetResourceLimits(messageWithSigners);

            // Sign the transaction
            const signedTransaction = await signTransactionMessageWithSigners(
                addSignersToTransactionMessage([signer], estimatedMessage),
            );

            // Send and confirm - cast to expected type since we know it has blockhash lifetime
            await sendAndConfirm(signedTransaction as Parameters<typeof sendAndConfirm>[0], { commitment });
            return signedTransaction;
        },
    });

    // Execute the plan
    return executor(transactionPlan, abortSignal ? { abortSignal } : {});
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
