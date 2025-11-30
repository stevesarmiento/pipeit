/**
 * Transaction flow for orchestrating multi-step transaction flows with automatic batching.
 * 
 * @packageDocumentation
 */

import type { Instruction } from '@solana/instructions';
import { TransactionBuilder } from '../builder/builder.js';
import { isTransactionTooLargeError } from '../errors/predicates.js';
import type {
  FlowConfig,
  FlowContext,
  FlowHooks,
  FlowStep,
  FlowStepResult,
  InstructionStep,
  StepCreator,
} from './types.js';

/**
 * Transaction flow for orchestrating multi-step transaction flows with automatic batching.
 * 
 * The flow supports three types of steps:
 * - **Instruction steps**: Can be automatically batched into single transactions
 * - **Transaction steps**: Execute separately, cannot be batched (for custom async operations)
 * - **Atomic groups**: Explicit groups of instructions that must execute together
 * 
 * @example
 * ```ts
 * // Create a flow with automatic batching
 * const result = await createFlow({ rpc, rpcSubscriptions, signer })
 *   .step('create-account', () => createAccountInstruction(...))
 *   .step('init-metadata', (ctx) => {
 *     const prev = ctx.get('create-account');
 *     return initMetadataInstruction(prev, ...);
 *   })
 *   .atomic('swap', [
 *     () => wrapSolInstruction(...),
 *     () => swapInstruction(...),
 *   ])
 *   .onStepComplete((name, result) => console.log(`${name}: ${result.signature}`))
 *   .execute();
 * ```
 */
export class TransactionFlow {
  private steps: FlowStep[] = [];
  private hooks: FlowHooks = {};
  private config: Required<FlowConfig>;

  constructor(config: FlowConfig) {
    this.config = {
      rpc: config.rpc,
      rpcSubscriptions: config.rpcSubscriptions,
      signer: config.signer,
      strategy: config.strategy ?? 'auto',
      commitment: config.commitment ?? 'confirmed',
    };
  }

  /**
   * Add an instruction step that can be batched with other instruction steps.
   * 
   * @param name - Unique name for this step (used to retrieve results)
   * @param create - Function that creates the instruction, receives context with previous results
   * @returns The flow instance for chaining
   * 
   * @example
   * ```ts
   * flow.step('transfer', (ctx) => {
   *   return getTransferSolInstruction({
   *     source: ctx.signer,
   *     destination: recipient,
   *     amount: lamports(1_000_000n),
   *   });
   * });
   * ```
   */
  step(name: string, create: StepCreator): this {
    this.steps.push({ type: 'instruction', name, create });
    return this;
  }

  /**
   * Add a transaction step for custom async operations.
   * 
   * Transaction steps break batching - any instruction steps before them are
   * batched and executed first. Use this when you need to perform operations
   * between transaction batches (e.g., checking on-chain state).
   * 
   * @param name - Unique name for this step
   * @param execute - Function that executes the custom operation
   * @returns The flow instance for chaining
   * 
   * @example
   * ```ts
   * flow.transaction('verify-state', async (ctx) => {
   *   const prevResult = ctx.get('create-account');
   *   // Custom logic that needs the previous transaction confirmed
   *   const accountInfo = await ctx.rpc.getAccountInfo(accountAddress).send();
   *   return { signature: prevResult?.signature ?? '', verified: !!accountInfo };
   * });
   * ```
   */
  transaction(name: string, execute: (ctx: FlowContext) => Promise<FlowStepResult>): this {
    this.steps.push({ type: 'transaction', name, execute });
    return this;
  }

  /**
   * Add an atomic group of instructions that must execute together in one transaction.
   * 
   * All instructions in the group are executed as a single transaction,
   * ensuring atomicity. If any instruction fails, the entire group fails.
   * 
   * @param name - Unique name for this atomic group
   * @param creates - Array of functions that create instructions
   * @returns The flow instance for chaining
   * 
   * @example
   * ```ts
   * flow.atomic('swap', [
   *   (ctx) => wrapSolInstruction(...),
   *   (ctx) => swapInstruction(...),
   *   (ctx) => unwrapSolInstruction(...),
   * ]);
   * ```
   */
  atomic(name: string, creates: StepCreator[]): this {
    this.steps.push({ type: 'atomic-group', name, creates });
    return this;
  }

  /**
   * Set a hook called when a step starts executing.
   */
  onStepStart(handler: (name: string) => void): this {
    this.hooks.onStepStart = handler;
    return this;
  }

  /**
   * Set a hook called when a step completes successfully.
   */
  onStepComplete(handler: (name: string, result: FlowStepResult) => void): this {
    this.hooks.onStepComplete = handler;
    return this;
  }

  /**
   * Set a hook called when a step fails.
   */
  onStepError(handler: (name: string, error: Error) => void): this {
    this.hooks.onStepError = handler;
    return this;
  }

  /**
   * Execute the flow and return results for all steps.
   * 
   * @returns Map of step names to their results
   * 
   * @example
   * ```ts
   * const results = await flow.execute();
   * const signature = results.get('transfer')?.signature;
   * ```
   */
  async execute(): Promise<Map<string, FlowStepResult>> {
    const { strategy } = this.config;

    if (strategy === 'sequential') {
      return this.executeSequential();
    } else if (strategy === 'batch') {
      return this.executeBatched();
    } else {
      // 'auto' strategy: try batching, fallback to sequential if it fails
      try {
        return await this.executeBatched();
      } catch (error) {
        if (isTransactionTooLargeError(error)) {
          return this.executeSequential();
        }
        throw error;
      }
    }
  }

  /**
   * Create the flow context with access to results and helper methods.
   */
  private createContext(results: Map<string, FlowStepResult>): FlowContext {
    return {
      results,
      signer: this.config.signer,
      rpc: this.config.rpc,
      rpcSubscriptions: this.config.rpcSubscriptions,
      get: (stepName: string) => results.get(stepName),
    };
  }

  /**
   * Execute flow with automatic batching of instruction steps.
   */
  private async executeBatched(): Promise<Map<string, FlowStepResult>> {
    const results = new Map<string, FlowStepResult>();
    const ctx = this.createContext(results);

    let currentBatch: Array<{ step: InstructionStep; instruction: Instruction }> = [];

    for (const step of this.steps) {
      this.hooks.onStepStart?.(step.name);

      try {
        if (step.type === 'instruction') {
          // Collect instruction for batching
          const instruction = await step.create(ctx);
          currentBatch.push({ step, instruction });
        } else if (step.type === 'transaction') {
          // Execute current batch before transaction step
          if (currentBatch.length > 0) {
            await this.executeBatch(currentBatch, ctx);
            currentBatch = [];
          }

          // Execute transaction step
          const result = await step.execute(ctx);
          results.set(step.name, result);
          this.hooks.onStepComplete?.(step.name, result);
        } else if (step.type === 'atomic-group') {
          // Execute current batch before atomic group
          if (currentBatch.length > 0) {
            await this.executeBatch(currentBatch, ctx);
            currentBatch = [];
          }

          // Execute atomic group as single transaction
          const instructions = await Promise.all(
            step.creates.map((create) => create(ctx))
          );

          const signature = await new TransactionBuilder({
            rpc: this.config.rpc,
            logLevel: 'verbose',
            // Set higher compute budget for atomic groups (DeFi swaps can need 300k+ CU)
            computeUnits: 400_000,
          })
            .setFeePayerSigner(this.config.signer)
            .addInstructions(instructions)
            .execute({
              rpcSubscriptions: this.config.rpcSubscriptions,
              commitment: this.config.commitment,
            });

          const result: FlowStepResult = { signature };
          results.set(step.name, result);
          this.hooks.onStepComplete?.(step.name, result);
        }
      } catch (error) {
        this.hooks.onStepError?.(step.name, error as Error);
        throw error;
      }
    }

    // Execute any remaining batch
    if (currentBatch.length > 0) {
      await this.executeBatch(currentBatch, ctx);
    }

    return results;
  }

  /**
   * Execute a batch of instruction steps as a single transaction.
   */
  private async executeBatch(
    batch: Array<{ step: InstructionStep; instruction: Instruction }>,
    ctx: FlowContext
  ): Promise<void> {
    const instructions = batch.map((b) => b.instruction);

    try {
      const signature = await new TransactionBuilder({
        rpc: this.config.rpc,
        logLevel: 'verbose',
      })
        .setFeePayerSigner(this.config.signer)
        .addInstructions(instructions)
        .execute({
          rpcSubscriptions: this.config.rpcSubscriptions,
          commitment: this.config.commitment,
        });

      // Store results for each step in the batch
      batch.forEach((b, i) => {
        const result: FlowStepResult = { signature, instructionIndex: i };
        ctx.results.set(b.step.name, result);
        this.hooks.onStepComplete?.(b.step.name, result);
      });
    } catch (error) {
      // If transaction too large, try splitting batch
      if (isTransactionTooLargeError(error) && batch.length > 1) {
        const mid = Math.floor(batch.length / 2);
        const firstHalf = batch.slice(0, mid);
        const secondHalf = batch.slice(mid);

        await this.executeBatch(firstHalf, ctx);
        await this.executeBatch(secondHalf, ctx);
      } else {
        throw error;
      }
    }
  }

  /**
   * Execute flow sequentially, one step at a time.
   */
  private async executeSequential(): Promise<Map<string, FlowStepResult>> {
    const results = new Map<string, FlowStepResult>();
    const ctx = this.createContext(results);

    for (const step of this.steps) {
      this.hooks.onStepStart?.(step.name);

      try {
        if (step.type === 'instruction') {
          const instruction = await step.create(ctx);
          const signature = await new TransactionBuilder({
            rpc: this.config.rpc,
            logLevel: 'verbose',
          })
            .setFeePayerSigner(this.config.signer)
            .addInstruction(instruction)
            .execute({
              rpcSubscriptions: this.config.rpcSubscriptions,
              commitment: this.config.commitment,
            });

          const result: FlowStepResult = { signature };
          results.set(step.name, result);
          this.hooks.onStepComplete?.(step.name, result);
        } else if (step.type === 'transaction') {
          const result = await step.execute(ctx);
          results.set(step.name, result);
          this.hooks.onStepComplete?.(step.name, result);
        } else if (step.type === 'atomic-group') {
          const instructions = await Promise.all(
            step.creates.map((create) => create(ctx))
          );

          const signature = await new TransactionBuilder({
            rpc: this.config.rpc,
            // Set higher compute budget for atomic groups (DeFi swaps can need 300k+ CU)
            computeUnits: 400_000,
          })
            .setFeePayerSigner(this.config.signer)
            .addInstructions(instructions)
            .execute({
              rpcSubscriptions: this.config.rpcSubscriptions,
              commitment: this.config.commitment,
            });

          const result: FlowStepResult = { signature };
          results.set(step.name, result);
          this.hooks.onStepComplete?.(step.name, result);
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
 * Create a new transaction flow for orchestrating multi-step transaction flows.
 * 
 * @param config - Flow configuration including RPC clients and signer
 * @returns A new TransactionFlow instance
 * 
 * @example
 * ```ts
 * const result = await createFlow({ rpc, rpcSubscriptions, signer })
 *   .step('transfer', () => getTransferSolInstruction({
 *     source: signer,
 *     destination: recipient,
 *     amount: lamports(1_000_000n),
 *   }))
 *   .execute();
 * 
 * console.log('Signature:', result.get('transfer')?.signature);
 * ```
 */
export function createFlow(config: FlowConfig): TransactionFlow {
  return new TransactionFlow(config);
}

