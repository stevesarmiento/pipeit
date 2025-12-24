/**
 * Helper to execute Kit instruction plans with TransactionBuilder features.
 *
 * @packageDocumentation
 */

import type { Address } from '@solana/addresses';
import type { TransactionSigner } from '@solana/signers';
import type {
    Rpc,
    GetLatestBlockhashApi,
    GetAccountInfoApi,
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
} from '@solana/kit';
import {
    fillProvisorySetComputeUnitLimitInstruction,
    estimateComputeUnitLimitFactory,
    estimateAndUpdateProvisoryComputeUnitLimitFactory,
} from '@solana-program/compute-budget';
import {
    type AddressesByLookupTableAddress,
    fetchAddressLookupTables,
    compressTransactionMessage,
} from '../lookup-tables/index.js';

/**
 * Base RPC API required for executing instruction plans.
 */
type BaseRpcApi = GetEpochInfoApi & GetSignatureStatusesApi & SendTransactionApi & GetLatestBlockhashApi & SimulateTransactionApi;

/**
 * RPC API required when fetching lookup tables (includes GetAccountInfoApi).
 */
type RpcApiWithAccountInfo = BaseRpcApi & GetAccountInfoApi;

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
 * Requires RPC client with GetAccountInfoApi.
 */
interface ExecutePlanConfigWithLookupAddresses extends ExecutePlanConfigBase {
    /**
     * RPC client with GetAccountInfoApi for fetching lookup tables.
     */
    rpc: Rpc<RpcApiWithAccountInfo>;

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
 * - Provide `lookupTableAddresses` to fetch and use ALTs (requires `GetAccountInfoApi` on RPC)
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
    const { rpc, rpcSubscriptions, signer, commitment = 'confirmed', abortSignal } = config;

    // Resolve lookup table data once (prefetched or fetched from addresses)
    const lookupTableData = await resolveLookupTableData(config);

    // Create transaction planner with provisory CU instruction
    const planner = createTransactionPlanner({
        createTransactionMessage: async () => {
            // Fetch latest blockhash
            const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

            // Create transaction message with fee payer, blockhash, and provisory CU instruction
            return pipe(
                createTransactionMessage({ version: 0 }),
                tx => setTransactionMessageFeePayer(signer.address, tx),
                tx => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
                tx => fillProvisorySetComputeUnitLimitInstruction(tx),
            );
        },
    });

    // Plan the instructions into transactions
    const transactionPlan = await planner(plan, abortSignal ? { abortSignal } : {});

    // Create send and confirm factory
    const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });

    // Create CU estimation helpers
    const estimateCULimit = estimateComputeUnitLimitFactory({ rpc });
    const estimateAndSetCULimit = estimateAndUpdateProvisoryComputeUnitLimitFactory(estimateCULimit);

    // Create transaction executor with CU estimation and ALT compression
    const executor = createTransactionPlanExecutor({
        executeTransactionMessage: async message => {
            // Apply ALT compression before CU estimation (if lookup tables provided)
            const compressedMessage = lookupTableData
                ? compressTransactionMessage(message, lookupTableData)
                : message;

            // Estimate and update the provisory CU instruction with actual value
            const estimatedMessage = await estimateAndSetCULimit(compressedMessage);

            // Sign the transaction
            const signedTransaction = await signTransactionMessageWithSigners(estimatedMessage);

            // Send and confirm - cast to expected type since we know it has blockhash lifetime
            await sendAndConfirm(signedTransaction as Parameters<typeof sendAndConfirm>[0], { commitment });

            return {
                transaction: signedTransaction,
            };
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
async function resolveLookupTableData(
    config: ExecutePlanConfig,
): Promise<AddressesByLookupTableAddress | undefined> {
    // Use pre-fetched data if provided
    if (config.addressesByLookupTable) {
        return config.addressesByLookupTable;
    }

    // Fetch tables if addresses provided
    if (config.lookupTableAddresses && config.lookupTableAddresses.length > 0) {
        // TypeScript knows rpc has GetAccountInfoApi when lookupTableAddresses is provided
        const rpcWithAccountInfo = config.rpc as Rpc<RpcApiWithAccountInfo>;
        return fetchAddressLookupTables(
            rpcWithAccountInfo,
            config.lookupTableAddresses,
            config.commitment ?? 'confirmed',
        );
    }

    // No ALT compression
    return undefined;
}
