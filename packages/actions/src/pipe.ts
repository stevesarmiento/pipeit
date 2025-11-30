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

import {
  TransactionBuilder,
  fetchAddressLookupTables,
  type AddressesByLookupTableAddress,
} from '@pipeit/tx-builder';
import { address } from '@solana/addresses';
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
import { NoActionsError, NoAdapterError, ActionExecutionError } from './errors.js';

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
      throw new NoAdapterError('swap');
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
   * Uses TransactionBuilder for full feature support including:
   * - Address lookup tables (ALTs) for transaction compression
   * - Priority fees and compute unit configuration
   * - Auto-retry with configurable backoff
   * 
   * @param options - Execution options (commitment, abortSignal)
   * @returns The transaction signature and action results
   * 
   * @example
   * ```ts
   * const { signature } = await pipe
   *   .swap({ inputMint: SOL, outputMint: USDC, amount: 10_000_000n })
   *   .execute({ commitment: 'confirmed' })
   * 
   * console.log('Transaction:', signature)
   * ```
   * 
   * @example With abort signal
   * ```ts
   * const controller = new AbortController();
   * setTimeout(() => controller.abort(), 30_000);
   * 
   * const { signature } = await pipe
   *   .swap({ ... })
   *   .execute({ abortSignal: controller.signal })
   * ```
   */
  async execute(options: ExecuteOptions = {}): Promise<PipeResult> {
    const { commitment = 'confirmed', abortSignal } = options;

    // Check if already aborted
    if (abortSignal?.aborted) {
      throw new Error('Execution aborted');
    }

    if (this.actions.length === 0) {
      throw new NoActionsError();
    }

    // Execute all actions to get their instructions, with hooks
    const actionResults: ActionResult[] = [];
    const allInstructions: Instruction[] = [];
    let totalComputeUnits = 0;

    for (let i = 0; i < this.actions.length; i++) {
      // Check abort before each action
      if (abortSignal?.aborted) {
        throw new Error('Execution aborted');
      }

      const action = this.actions[i];
      
      // Call onActionStart hook
      this.hooks.onActionStart?.(i);

      try {
        const result = await action(this.context);
        actionResults.push(result);
        allInstructions.push(...result.instructions);
        
        // Track compute units
        if (result.computeUnits) {
          totalComputeUnits += result.computeUnits;
        }
        
        // Call onActionComplete hook
        this.hooks.onActionComplete?.(i, result);
      } catch (error) {
        // Call onActionError hook
        this.hooks.onActionError?.(i, error as Error);
        throw new ActionExecutionError(i, error as Error);
      }
    }

    // Collect ALT addresses from all action results (deduplicated)
    const altAddresses = actionResults
      .flatMap(r => r.addressLookupTableAddresses ?? [])
      .filter((addr, i, arr) => arr.indexOf(addr) === i);

    // Fetch lookup tables if any ALTs were returned by actions
    let addressesByLookupTable: AddressesByLookupTableAddress | undefined;
    if (altAddresses.length > 0) {
      addressesByLookupTable = await fetchAddressLookupTables(
        this.config.rpc,
        altAddresses.map(a => address(a))
      );
    }

    // Check abort before execution
    if (abortSignal?.aborted) {
      throw new Error('Execution aborted');
    }

    // Determine compute units: use config, collected from actions, or undefined (let builder decide)
    const computeUnits = this.config.computeUnits === 'auto'
      ? (totalComputeUnits > 0 ? totalComputeUnits : undefined)
      : this.config.computeUnits;

    // Build and execute using TransactionBuilder with all config options
    const signature = await new TransactionBuilder({
      rpc: this.config.rpc,
      ...(computeUnits !== undefined && { computeUnits }),
      priorityFee: this.config.priorityFee ?? 'medium',
      autoRetry: this.config.autoRetry ?? { maxAttempts: 3, backoff: 'exponential' },
      logLevel: this.config.logLevel ?? 'minimal',
      ...(addressesByLookupTable && { addressesByLookupTable }),
    })
      .setFeePayerSigner(this.config.signer)
      .addInstructions(allInstructions)
      .execute({
        rpcSubscriptions: this.config.rpcSubscriptions,
        commitment,
      });

    return {
      signature,
      actionResults,
    };
  }

  /**
   * Simulate the transaction without executing.
   * Useful for checking if a transaction would succeed and estimating compute units.
   * 
   * @returns Simulation results
   * 
   * @example
   * ```ts
   * const simulation = await pipe
   *   .swap({ ... })
   *   .simulate();
   * 
   * if (simulation.success) {
   *   console.log('Estimated CU:', simulation.unitsConsumed);
   * } else {
   *   console.error('Simulation failed:', simulation.error);
   * }
   * ```
   */
  async simulate(): Promise<{
    success: boolean;
    logs: string[];
    unitsConsumed?: bigint;
    error?: unknown;
  }> {
    if (this.actions.length === 0) {
      throw new NoActionsError();
    }

    // Execute all actions to get their instructions
    const allInstructions: Instruction[] = [];
    let totalComputeUnits = 0;

    for (let i = 0; i < this.actions.length; i++) {
      try {
        const result = await this.actions[i](this.context);
        allInstructions.push(...result.instructions);
        
        if (result.computeUnits) {
          totalComputeUnits += result.computeUnits;
        }
      } catch (error) {
        throw new ActionExecutionError(i, error as Error);
      }
    }

    // Determine compute units: use config, collected from actions, or default
    const computeUnits = this.config.computeUnits === 'auto' 
      ? (totalComputeUnits > 0 ? totalComputeUnits : 400_000)
      : (this.config.computeUnits ?? (totalComputeUnits > 0 ? totalComputeUnits : 400_000));

    // Build and simulate using tx-builder with config options
    const result = await new TransactionBuilder({
      rpc: this.config.rpc,
      computeUnits,
      priorityFee: this.config.priorityFee ?? 'medium',
      logLevel: this.config.logLevel ?? 'minimal',
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
