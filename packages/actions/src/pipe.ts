/**
 * Pipe - Fluent API for composing and executing DeFi actions.
 * 
 * @example
 * ```ts
 * import { pipe } from '@pipeit/actions'
 * import { jupiter } from '@pipeit/actions/adapters'
 * 
 * await pipe({
 *   rpc,
 *   rpcSubscriptions,
 *   signer,
 *   adapters: { swap: jupiter() }
 * })
 *   .swap({ inputMint: SOL, outputMint: USDC, amount: 10_000_000n })
 *   .execute()
 * ```
 * 
 * @packageDocumentation
 */

import { createFlow, TransactionBuilder } from '@pipeit/tx-builder';
import type { Instruction } from '@solana/instructions';
import type {
  ActionContext,
  ActionExecutor,
  ActionResult,
  ExecuteOptions,
  PipeConfig,
  PipeHooks,
  PipeResult,
  SwapParams,
} from './types.js';

/**
 * Fluent builder for composing DeFi actions into atomic transactions.
 */
export class Pipe {
  private config: PipeConfig;
  private actions: ActionExecutor[] = [];
  private context: ActionContext;
  private hooks: PipeHooks = {};

  constructor(config: PipeConfig) {
    this.config = config;
    this.context = {
      signer: config.signer,
      rpc: config.rpc,
      rpcSubscriptions: config.rpcSubscriptions,
    };
  }

  /**
   * Add a custom action to the pipe.
   * 
   * @param action - Action executor function
   * @returns The pipe instance for chaining
   * 
   * @example
   * ```ts
   * pipe.add(async (ctx) => ({
   *   instructions: [myCustomInstruction],
   * }))
   * ```
   */
  add(action: ActionExecutor): this {
    this.actions.push(action);
    return this;
  }

  /**
   * Add a swap action using the configured swap adapter.
   * 
   * @param params - Swap parameters
   * @returns The pipe instance for chaining
   * @throws If no swap adapter is configured
   * 
   * @example
   * ```ts
   * pipe.swap({
   *   inputMint: 'So11111111111111111111111111111111111111112',
   *   outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
   *   amount: 10_000_000n,
   *   slippageBps: 50
   * })
   * ```
   */
  swap(params: SwapParams): this {
    if (!this.config.adapters?.swap) {
      throw new Error(
        'No swap adapter configured. Pass a swap adapter in pipe config:\n' +
        'pipe({ ..., adapters: { swap: jupiter() } })'
      );
    }

    const executor = this.config.adapters.swap.swap(params);
    this.actions.push(executor);
    return this;
  }

  /**
   * Set a hook called when an action starts executing.
   * 
   * @param handler - Function called with the action index
   * @returns The pipe instance for chaining
   * 
   * @example
   * ```ts
   * pipe
   *   .swap({ ... })
   *   .onActionStart((index) => console.log(`Starting action ${index}`))
   *   .execute()
   * ```
   */
  onActionStart(handler: (index: number) => void): this {
    this.hooks.onActionStart = handler;
    return this;
  }

  /**
   * Set a hook called when an action completes successfully.
   * 
   * @param handler - Function called with the action index and result
   * @returns The pipe instance for chaining
   * 
   * @example
   * ```ts
   * pipe
   *   .swap({ ... })
   *   .onActionComplete((index, result) => {
   *     console.log(`Action ${index} completed with ${result.instructions.length} instructions`)
   *   })
   *   .execute()
   * ```
   */
  onActionComplete(handler: (index: number, result: ActionResult) => void): this {
    this.hooks.onActionComplete = handler;
    return this;
  }

  /**
   * Set a hook called when an action fails.
   * 
   * @param handler - Function called with the action index and error
   * @returns The pipe instance for chaining
   * 
   * @example
   * ```ts
   * pipe
   *   .swap({ ... })
   *   .onActionError((index, error) => console.error(`Action ${index} failed:`, error))
   *   .execute()
   * ```
   */
  onActionError(handler: (index: number, error: Error) => void): this {
    this.hooks.onActionError = handler;
    return this;
  }

  /**
   * Execute all actions in the pipe as a single atomic transaction.
   * Uses Flow internally for automatic batching and error handling.
   * 
   * @param options - Execution options (strategy, commitment)
   * @returns The transaction signature and action results
   * 
   * @example
   * ```ts
   * const { signature } = await pipe
   *   .swap({ inputMint: SOL, outputMint: USDC, amount: 10_000_000n })
   *   .execute({ strategy: 'auto', commitment: 'confirmed' })
   * 
   * console.log('Transaction:', signature)
   * ```
   */
  async execute(options: ExecuteOptions = {}): Promise<PipeResult> {
    const { strategy = 'auto', commitment = 'confirmed' } = options;

    if (this.actions.length === 0) {
      throw new Error('No actions to execute. Add at least one action to the pipe.');
    }

    // Execute all actions to get their instructions, with hooks
    const actionResults: ActionResult[] = [];
    const allInstructions: Instruction[] = [];

    for (let i = 0; i < this.actions.length; i++) {
      const action = this.actions[i];
      
      // Call onActionStart hook
      this.hooks.onActionStart?.(i);

      try {
        const result = await action(this.context);
        actionResults.push(result);
        allInstructions.push(...result.instructions);
        
        // Call onActionComplete hook
        this.hooks.onActionComplete?.(i, result);
      } catch (error) {
        // Call onActionError hook
        this.hooks.onActionError?.(i, error as Error);
        throw error;
      }
    }

    // Use Flow for execution (gets automatic batching, hooks, error handling)
    const flow = createFlow({
      rpc: this.config.rpc,
      rpcSubscriptions: this.config.rpcSubscriptions,
      signer: this.config.signer,
      strategy,
      commitment,
    });

    // Add all instructions as an atomic group
    flow.atomic('pipe', allInstructions.map((ix) => () => ix));

    const results = await flow.execute();
    const signature = results.get('pipe')?.signature ?? '';

    return {
      signature,
      actionResults,
    };
  }

  /**
   * Simulate the transaction without executing.
   * Useful for checking if a transaction would succeed.
   * 
   * @returns Simulation results
   */
  async simulate(): Promise<{
    success: boolean;
    logs: string[];
    unitsConsumed?: bigint;
    error?: unknown;
  }> {
    if (this.actions.length === 0) {
      throw new Error('No actions to simulate. Add at least one action to the pipe.');
    }

    // Execute all actions to get their instructions
    const allInstructions: Instruction[] = [];
    let totalComputeUnits = 0;

    for (const action of this.actions) {
      const result = await action(this.context);
      allInstructions.push(...result.instructions);
      
      if (result.computeUnits) {
        totalComputeUnits += result.computeUnits;
      }
    }

    // Build and simulate using tx-builder (Flow doesn't have simulate)
    const result = await new TransactionBuilder({
      rpc: this.config.rpc,
      computeUnits: totalComputeUnits > 0 ? totalComputeUnits : 400_000,
    })
      .setFeePayerSigner(this.config.signer)
      .addInstructions(allInstructions)
      .simulate();

    // Build response object, conditionally adding optional properties
    const response: {
      success: boolean;
      logs: string[];
      unitsConsumed?: bigint;
      error?: unknown;
    } = {
      success: result.err === null,
      logs: result.logs ?? [],
    };

    if (result.unitsConsumed !== undefined) {
      response.unitsConsumed = result.unitsConsumed;
    }

    if (result.err !== null) {
      response.error = result.err;
    }

    return response;
  }
}

/**
 * Create a new pipe for composing DeFi actions.
 * 
 * @param config - Pipe configuration including RPC clients, signer, and adapters
 * @returns A new Pipe instance
 * 
 * @example
 * ```ts
 * import { pipe } from '@pipeit/actions'
 * import { jupiter } from '@pipeit/actions/adapters'
 * import { SOL, USDC } from '@pipeit/actions/tokens'
 * 
 * const result = await pipe({
 *   rpc,
 *   rpcSubscriptions,
 *   signer,
 *   adapters: { swap: jupiter() }
 * })
 *   .swap({ inputMint: SOL, outputMint: USDC, amount: 10_000_000n })
 *   .execute()
 * 
 * console.log('Swap executed:', result.signature)
 * ```
 */
export function pipe(config: PipeConfig): Pipe {
  return new Pipe(config);
}
