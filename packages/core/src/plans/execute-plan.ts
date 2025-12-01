/**
 * Helper to execute Kit instruction plans with TransactionBuilder features.
 * 
 * @packageDocumentation
 */

import type { TransactionSigner } from '@solana/signers';
import type {
  Rpc,
  GetLatestBlockhashApi,
  GetEpochInfoApi,
  GetSignatureStatusesApi,
  SendTransactionApi,
} from '@solana/rpc';
import type {
  RpcSubscriptions,
  SignatureNotificationsApi,
  SlotNotificationsApi,
} from '@solana/rpc-subscriptions';
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

/**
 * Configuration for executing an instruction plan.
 */
export interface ExecutePlanConfig {
  /**
   * RPC client.
   */
  rpc: Rpc<GetEpochInfoApi & GetSignatureStatusesApi & SendTransactionApi & GetLatestBlockhashApi>;

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
export async function executePlan(
  plan: InstructionPlan,
  config: ExecutePlanConfig
): Promise<TransactionPlanResult> {
  const { rpc, rpcSubscriptions, signer, commitment = 'confirmed', abortSignal } = config;

  // Create transaction planner
  const planner = createTransactionPlanner({
    createTransactionMessage: async () => {
      // Fetch latest blockhash
      const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

      // Create transaction message with fee payer and blockhash
      return pipe(
        createTransactionMessage({ version: 0 }),
        (tx) => setTransactionMessageFeePayer(signer.address, tx),
        (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx)
      );
    },
  });

  // Plan the instructions into transactions
  const transactionPlan = await planner(plan, abortSignal ? { abortSignal } : {});

  // Create send and confirm factory
  const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });

  // Create transaction executor
  const executor = createTransactionPlanExecutor({
    executeTransactionMessage: async (message) => {
      // Sign the transaction
      const signedTransaction = await signTransactionMessageWithSigners(message);

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

