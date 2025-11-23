/**
 * Transaction pipeline for orchestrating multi-step transaction flows with atomic batching.
 *
 * @packageDocumentation
 */

import { transaction, isTransactionTooLargeError } from '@pipeit/tx-builder';
import type { TransactionSigner } from '@solana/signers';
import type { Instruction } from '@solana/instructions';
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

/**
 * Context passed to each pipeline step.
 */
export interface StepContext {
  /**
   * Results from previous steps, keyed by step name.
   */
  results: Map<string, any>;

  /**
   * Transaction signer.
   */
  signer: TransactionSigner;

  /**
   * RPC client.
   */
  rpc: Rpc<GetEpochInfoApi & GetSignatureStatusesApi & SendTransactionApi & GetLatestBlockhashApi>;

  /**
   * RPC subscriptions client.
   */
  rpcSubscriptions: RpcSubscriptions<SignatureNotificationsApi & SlotNotificationsApi>;
}

/**
 * Instruction-level step that can be batched with other instruction steps.
 */
export interface InstructionStep {
  type: 'instruction';
  name: string;
  createInstruction: (ctx: StepContext) => Promise<Instruction>;
}

/**
 * Transaction-level step that executes separately.
 */
export interface TransactionStep {
  type: 'transaction';
  name: string;
  execute: (ctx: StepContext) => Promise<any>;
}

/**
 * Atomic group of instructions that must execute together.
 */
export interface AtomicGroupStep {
  type: 'atomic-group';
  name: string;
  steps: Array<{ name: string; createInstruction: (ctx: StepContext) => Promise<Instruction> }>;
}

/**
 * Discriminated union type for pipeline steps.
 */
export type PipelineStep = InstructionStep | TransactionStep | AtomicGroupStep;

/**
 * Execution strategy for pipeline.
 */
export type ExecutionStrategy = 'auto' | 'batch' | 'sequential';

/**
 * Pipeline hooks for monitoring execution.
 */
export interface PipelineHooks {
  /**
   * Called when a step starts.
   */
  onStepStart?: (step: string) => void;

  /**
   * Called when a step completes successfully.
   */
  onStepComplete?: (step: string, result: any) => void;

  /**
   * Called when a step fails.
   */
  onStepError?: (step: string, error: Error) => void;
}

/**
 * Parameters for executing a pipeline.
 */
export interface ExecuteParams {
  signer: TransactionSigner;
  rpc: Rpc<GetEpochInfoApi & GetSignatureStatusesApi & SendTransactionApi & GetLatestBlockhashApi>;
  rpcSubscriptions: RpcSubscriptions<SignatureNotificationsApi & SlotNotificationsApi>;
  strategy?: ExecutionStrategy;
  commitment?: 'processed' | 'confirmed' | 'finalized';
}

/**
 * Transaction pipeline for orchestrating multi-step flows with automatic batching.
 *
 * The pipeline supports three types of steps:
 * - **Instruction steps**: Can be automatically batched into single transactions
 * - **Transaction steps**: Execute separately, cannot be batched
 * - **Atomic groups**: Explicit groups of instructions that must execute together
 *
 * @example
 * ```ts
 * // Automatic batching of instruction steps
 * const pipeline = createPipeline()
 *   .instruction('create-metadata', async (ctx) => {
 *     return createMetadataInstruction(...);
 *   })
 *   .instruction('create-collection', async (ctx) => {
 *     const metadata = ctx.results.get('create-metadata');
 *     return createCollectionInstruction(metadata, ...);
 *   })
 *   .transaction('verify-on-chain', async (ctx) => {
 *     // This breaks batching - executes after previous batch
 *     const collection = ctx.results.get('create-collection');
 *     return await verifyCollectionOnChain(collection);
 *   });
 *
 * const results = await pipeline.execute({
 *   signer,
 *   rpc,
 *   rpcSubscriptions,
 *   strategy: 'auto' // Automatically batches instruction steps
 * });
 * ```
 *
 * @example
 * ```ts
 * // Explicit atomic group
 * const pipeline = createPipeline()
 *   .atomic('setup-account', [
 *     { name: 'create-account', createInstruction: () => createAccountIx(...) },
 *     { name: 'initialize', createInstruction: () => initializeIx(...) }
 *   ])
 *   .execute({ signer, rpc, rpcSubscriptions });
 * ```
 */
export class TransactionPipeline {
  private steps: PipelineStep[] = [];
  private hooks: PipelineHooks = {};

  /**
   * Add an instruction-level step that can be batched.
   *
   * Instruction steps return an `Instruction` that can be combined with other
   * instruction steps into a single atomic transaction.
   *
   * @param name - Name of the step (for tracking and debugging)
   * @param createInstruction - Function that creates the instruction
   * @returns The pipeline instance for chaining
   *
   * @example
   * ```ts
   * pipeline.instruction('transfer-tokens', async (ctx) => {
   *   return createTransferInstruction(...);
   * });
   * ```
   */
  instruction(name: string, createInstruction: (ctx: StepContext) => Promise<Instruction>): this {
    this.steps.push({ type: 'instruction', name, createInstruction });
    return this;
  }

  /**
   * Add a transaction-level step that executes separately.
   *
   * Transaction steps execute a full transaction and cannot be batched.
   * They break batching groups - any instruction steps before them are batched
   * and executed first.
   *
   * @param name - Name of the step (for tracking and debugging)
   * @param execute - Function that executes the transaction
   * @returns The pipeline instance for chaining
   *
   * @example
   * ```ts
   * pipeline.transaction('verify-state', async (ctx) => {
   *   const account = ctx.results.get('create-account');
   *   // Need to check on-chain state, so must execute separately
   *   return await checkAccountExists(account);
   * });
   * ```
   */
  transaction(name: string, execute: (ctx: StepContext) => Promise<any>): this {
    this.steps.push({ type: 'transaction', name, execute });
    return this;
  }

  /**
   * Add an atomic group of instructions that must execute together.
   *
   * All instructions in the group are executed as a single transaction,
   * ensuring atomicity.
   *
   * @param name - Name of the atomic group
   * @param steps - Array of instruction steps to execute atomically
   * @returns The pipeline instance for chaining
   *
   * @example
   * ```ts
   * pipeline.atomic('setup-pool', [
   *   { name: 'create-pool', createInstruction: () => createPoolIx(...) },
   *   { name: 'initialize', createInstruction: () => initializePoolIx(...) }
   * ]);
   * ```
   */
  atomic(
    name: string,
    steps: Array<{ name: string; createInstruction: (ctx: StepContext) => Promise<Instruction> }>
  ): this {
    this.steps.push({ type: 'atomic-group', name, steps });
    return this;
  }

  /**
   * Set global hook for step completion.
   */
  onStepComplete(handler: (step: string, result: any) => void): this {
    this.hooks.onStepComplete = handler;
    return this;
  }

  /**
   * Set global hook for step start.
   */
  onStepStart(handler: (step: string) => void): this {
    this.hooks.onStepStart = handler;
    return this;
  }

  /**
   * Set global hook for step errors.
   */
  onStepError(handler: (step: string, error: Error) => void): this {
    this.hooks.onStepError = handler;
    return this;
  }

  /**
   * Execute the pipeline with the given parameters.
   *
   * @param params - Execution parameters including signer, RPC clients, and strategy
   * @returns Map of step names to their results
   *
   * @example
   * ```ts
   * const results = await pipeline.execute({
   *   signer,
   *   rpc,
   *   rpcSubscriptions,
   *   strategy: 'auto', // Automatically batch instruction steps
   *   commitment: 'confirmed'
   * });
   *
   * const signature = results.get('create-metadata');
   * ```
   */
  async execute(params: ExecuteParams): Promise<Map<string, any>> {
    const { strategy = 'auto' } = params;

    if (strategy === 'sequential') {
      return this.executeSequential(params);
    } else if (strategy === 'batch') {
      return this.executeBatched(params);
    } else {
      // 'auto' strategy: try batching, fallback to sequential if it fails
      try {
        return await this.executeBatched(params);
      } catch (error) {
        if (isTransactionTooLargeError(error)) {
          // Transaction too large - fallback to sequential
          return this.executeSequential(params);
        }
        throw error;
      }
    }
  }

  /**
   * Execute pipeline with automatic batching of instruction steps.
   *
   * Groups consecutive instruction steps into batches and executes each batch
   * as a single atomic transaction. Transaction steps and atomic groups break
   * batching and execute separately.
   */
  private async executeBatched(params: ExecuteParams): Promise<Map<string, any>> {
    const results = new Map<string, any>();
    const ctx: StepContext = {
      ...params,
      results,
    };

    let currentBatch: Array<{ step: InstructionStep; instruction: Instruction }> = [];

    for (const step of this.steps) {
      this.hooks.onStepStart?.(step.name);

      try {
        if (step.type === 'instruction') {
          // Collect instruction for batching
          const instruction = await step.createInstruction(ctx);
          currentBatch.push({ step, instruction });
        } else if (step.type === 'transaction') {
          // Execute current batch before transaction step
          if (currentBatch.length > 0) {
            await this.executeBatch(currentBatch, ctx, params);
            currentBatch = [];
          }

          // Execute transaction step
          const result = await step.execute(ctx);
          results.set(step.name, result);
          this.hooks.onStepComplete?.(step.name, result);
        } else if (step.type === 'atomic-group') {
          // Execute current batch before atomic group
          if (currentBatch.length > 0) {
            await this.executeBatch(currentBatch, ctx, params);
            currentBatch = [];
          }

          // Execute atomic group as single transaction
          const instructions = await Promise.all(
            step.steps.map((s) => s.createInstruction(ctx))
          );

          const signature = await transaction({ logLevel: 'verbose' })
            .addInstructions(instructions)
            .execute({
              feePayer: params.signer,
              rpc: params.rpc,
              rpcSubscriptions: params.rpcSubscriptions,
              commitment: params.commitment ?? 'confirmed',
            });

          // Store results for each step in the atomic group
          step.steps.forEach((s, i) => {
            results.set(s.name, { signature, instructionIndex: i });
          });

          // Store group result
          results.set(step.name, { signature, stepCount: step.steps.length });
          this.hooks.onStepComplete?.(step.name, { signature });
        }
      } catch (error) {
        this.hooks.onStepError?.(step.name, error as Error);
        throw error;
      }
    }

    // Execute any remaining batch
    if (currentBatch.length > 0) {
      await this.executeBatch(currentBatch, ctx, params);
    }

    return results;
  }

  /**
   * Execute a batch of instruction steps as a single transaction.
   */
  private async executeBatch(
    batch: Array<{ step: InstructionStep; instruction: Instruction }>,
    ctx: StepContext,
    params: ExecuteParams
  ): Promise<void> {
    const instructions = batch.map((b) => b.instruction);

    try {
      const signature = await transaction({ logLevel: 'verbose' })
        .addInstructions(instructions)
        .execute({
          feePayer: params.signer,
          rpc: params.rpc,
          rpcSubscriptions: params.rpcSubscriptions,
          commitment: params.commitment ?? 'confirmed',
        });

      // Store results for each step in the batch
      batch.forEach((b, i) => {
        ctx.results.set(b.step.name, { signature, instructionIndex: i });
        this.hooks.onStepComplete?.(b.step.name, { signature, instructionIndex: i });
      });
    } catch (error) {
      // If transaction too large, try splitting batch
      if (isTransactionTooLargeError(error) && batch.length > 1) {
        // Split batch in half and retry
        const mid = Math.floor(batch.length / 2);
        const firstHalf = batch.slice(0, mid);
        const secondHalf = batch.slice(mid);

        await this.executeBatch(firstHalf, ctx, params);
        await this.executeBatch(secondHalf, ctx, params);
      } else {
        // Re-throw if can't split or splitting didn't help
        throw error;
      }
    }
  }

  /**
   * Execute pipeline sequentially, one step at a time.
   *
   * Instruction steps are executed individually as separate transactions.
   * This is the fallback strategy when batching fails or is not desired.
   */
  private async executeSequential(params: ExecuteParams): Promise<Map<string, any>> {
    const results = new Map<string, any>();
    const ctx: StepContext = {
      ...params,
      results,
    };

    for (const step of this.steps) {
      this.hooks.onStepStart?.(step.name);

      try {
        if (step.type === 'instruction') {
          // Execute instruction as individual transaction
          const instruction = await step.createInstruction(ctx);
          const signature = await transaction({ logLevel: 'verbose' })
            .addInstruction(instruction)
            .execute({
              feePayer: params.signer,
              rpc: params.rpc,
              rpcSubscriptions: params.rpcSubscriptions,
              commitment: params.commitment ?? 'confirmed',
            });

          results.set(step.name, { signature });
          this.hooks.onStepComplete?.(step.name, { signature });
        } else if (step.type === 'transaction') {
          // Execute transaction step
          const result = await step.execute(ctx);
          results.set(step.name, result);
          this.hooks.onStepComplete?.(step.name, result);
        } else if (step.type === 'atomic-group') {
          // Execute atomic group as single transaction
          const instructions = await Promise.all(
            step.steps.map((s) => s.createInstruction(ctx))
          );

          const signature = await transaction()
            .addInstructions(instructions)
            .execute({
              feePayer: params.signer,
              rpc: params.rpc,
              rpcSubscriptions: params.rpcSubscriptions,
              commitment: params.commitment ?? 'confirmed',
            });

          // Store results for each step in the atomic group
          step.steps.forEach((s, i) => {
            results.set(s.name, { signature, instructionIndex: i });
          });

          results.set(step.name, { signature, stepCount: step.steps.length });
          this.hooks.onStepComplete?.(step.name, { signature });
        }
      } catch (error) {
        this.hooks.onStepError?.(step.name, error as Error);
        throw error;
      }
    }

    return results;
  }
}

/**
 * Create a new transaction pipeline.
 *
 * @example
 * ```ts
 * const pipeline = createPipeline()
 *   .instruction('step1', async (ctx) => createInstruction1())
 *   .instruction('step2', async (ctx) => createInstruction2())
 *   .execute({ signer, rpc, rpcSubscriptions });
 * ```
 */
export function createPipeline(): TransactionPipeline {
  return new TransactionPipeline();
}
