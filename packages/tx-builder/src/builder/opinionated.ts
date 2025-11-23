/**
 * Opinionated transaction builder with smart defaults.
 *
 * Features:
 * - Auto-retry with configurable backoff
 * - Auto-blockhash fetching
 * - Built-in validation
 * - Simulation support
 * - Comprehensive logging
 *
 * @example
 * ```ts
 * // Simple usage
 * const sig = await transaction({ autoRetry: true })
 *   .addInstruction(ix)
 *   .execute({ feePayer, rpc, rpcSubscriptions });
 *
 * // With simulation
 * const result = await transaction()
 *   .addInstruction(ix)
 *   .simulate({ feePayer, rpc });
 * console.log('Simulation logs:', result.logs);
 * ```
 * 
 * @packageDocumentation
 */

import { pipe } from '@solana/functional';
import {
  createTransactionMessage,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstruction,
} from '@solana/transaction-messages';
import { signTransactionMessageWithSigners } from '@solana/signers';
import { sendAndConfirmTransactionFactory, getSignatureFromTransaction } from '@solana/kit';
import type { TransactionSigner } from '@solana/signers';
import type { Instruction } from '@solana/instructions';
import type {
  Rpc,
  GetLatestBlockhashApi,
  GetEpochInfoApi,
  GetSignatureStatusesApi,
  SendTransactionApi,
  SimulateTransactionApi,
} from '@solana/rpc';
import type {
  RpcSubscriptions,
  SignatureNotificationsApi,
  SlotNotificationsApi,
} from '@solana/rpc-subscriptions';
import { validateTransaction, validateTransactionSize } from '../validation/index.js';

/**
 * Configuration for opinionated transaction builder.
 */
export interface TransactionBuilderConfig {
  /**
   * Auto-retry failed transactions.
   * - `true`: Use default retry (3 attempts, exponential backoff)
   * - `false`: No retry
   * - Object: Custom retry configuration
   */
  autoRetry?: boolean | { maxAttempts: number; backoff: 'linear' | 'exponential' };
  
  /**
   * Priority fee level for transactions.
   */
  priorityLevel?: 'none' | 'low' | 'medium' | 'high' | 'veryHigh';
  
  /**
   * Compute unit limit.
   * - `'auto'`: Use default (200,000)
   * - `number`: Specific limit
   */
  computeUnitLimit?: 'auto' | number;
  
  /**
   * Logging level.
   */
  logLevel?: 'silent' | 'minimal' | 'verbose';
  
  /**
   * Transaction version.
   * - `'auto'`: Auto-detect based on instructions
   * - `0`: Versioned transaction
   * - `'legacy'`: Legacy transaction
   */
  version?: 'auto' | 0 | 'legacy';
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

// Note: Priority fee presets will be implemented when compute budget instructions are added.

/**
 * Opinionated transaction builder with smart defaults.
 * Wraps Gill's functions with opinionated patterns.
 */
export class OpinionatedTransactionBuilder {
  private instructions: Instruction[] = [];
  private config: Required<Omit<TransactionBuilderConfig, 'version'>> & { version: TransactionBuilderConfig['version'] };
  
  constructor(config: TransactionBuilderConfig = {}) {
    // Opinionated defaults
    this.config = {
      autoRetry: config.autoRetry ?? { maxAttempts: 3, backoff: 'exponential' },
      priorityLevel: config.priorityLevel ?? 'medium',
      computeUnitLimit: config.computeUnitLimit ?? 'auto',
      logLevel: config.logLevel ?? 'minimal',
      version: config.version ?? 'auto',
    };
  }
  
  /**
   * Add an instruction to the transaction.
   */
  addInstruction(instruction: Instruction): this {
    this.instructions.push(instruction);
    return this;
  }
  
  /**
   * Add multiple instructions to the transaction.
   */
  addInstructions(instructions: Instruction[]): this {
    this.instructions.push(...instructions);
    return this;
  }
  
  // Note: Priority fees and compute budgets are not yet implemented in this builder.
  // These will be added in a future version using Kit's compute budget instructions.
  
  /**
   * Simulate the transaction without sending it.
   * Useful for testing and debugging before execution.
   */
  async simulate(params: {
    feePayer: TransactionSigner;
    rpc: Rpc<GetLatestBlockhashApi & SimulateTransactionApi>;
    commitment?: 'processed' | 'confirmed' | 'finalized';
  }): Promise<SimulationResult> {
    const { feePayer, rpc, commitment = 'confirmed' } = params;
    
    // Build message with auto-blockhash
    const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
    
    const version = this.config.version === 'auto' || this.config.version === undefined ? 0 : this.config.version;
    let message: any = pipe(
      createTransactionMessage({ version }),
      (tx) => setTransactionMessageFeePayer(feePayer.address, tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx)
    );
    
    // Add instructions
    for (const instruction of this.instructions) {
      message = appendTransactionMessageInstruction(instruction, message);
    }
    
    // Sign for simulation
    const signedTransaction: any = await signTransactionMessageWithSigners(message);
    
    // Simulate using Kit's API
    const result = await rpc.simulateTransaction(signedTransaction, { 
      commitment,
      replaceRecentBlockhash: true,
    }).send();
    
    return {
      err: result.value.err,
      logs: result.value.logs,
      unitsConsumed: result.value.unitsConsumed,
      returnData: result.value.returnData,
    };
  }

  /**
   * Execute the transaction with opinionated defaults.
   */
  async execute(params: {
    feePayer: TransactionSigner;
    rpc: Rpc<GetEpochInfoApi & GetSignatureStatusesApi & SendTransactionApi & GetLatestBlockhashApi>;
    rpcSubscriptions: RpcSubscriptions<SignatureNotificationsApi & SlotNotificationsApi>;
    commitment?: 'processed' | 'confirmed' | 'finalized';
  }): Promise<string> {
    const { feePayer, rpc, rpcSubscriptions, commitment = 'confirmed' } = params;
    
    // Fetch latest blockhash
    const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
    
    // Build transaction message using Kit's functional API
    const version = this.config.version === 'auto' || this.config.version === undefined ? 0 : this.config.version;
    let message: any = pipe(
      createTransactionMessage({ version }),
      (tx) => setTransactionMessageFeePayer(feePayer.address, tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx)
    );
    
    // Add instructions
    for (const instruction of this.instructions) {
      message = appendTransactionMessageInstruction(instruction, message);
    }
    
    // Validate before sending
    validateTransaction(message);
    validateTransactionSize(message);
    
    // Sign transaction
    const signedTransaction: any = await signTransactionMessageWithSigners(message);
    
    // Use Kit's sendAndConfirmTransactionFactory
    const sendAndConfirm = sendAndConfirmTransactionFactory({ 
      rpc, 
      rpcSubscriptions 
    });
    
    // Add opinionated retry logic if enabled
    if (this.config.autoRetry) {
      return this.executeWithRetry(sendAndConfirm, signedTransaction, commitment);
    }
    
    await sendAndConfirm(signedTransaction, { commitment });
    return getSignatureFromTransaction(signedTransaction);
  }
  
  /**
   * Execute transaction with retry logic.
   */
  private async executeWithRetry(
    sendAndConfirm: ReturnType<typeof sendAndConfirmTransactionFactory>,
    transaction: any,
    commitment: 'processed' | 'confirmed' | 'finalized'
  ): Promise<string> {
    const retryConfig = this.config.autoRetry === true 
      ? { maxAttempts: 3, backoff: 'exponential' as const }
      : this.config.autoRetry;
    
    if (!retryConfig || typeof retryConfig === 'boolean') {
      throw new Error('Invalid retry configuration');
    }
    
    const { maxAttempts, backoff } = retryConfig;
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        if (this.config.logLevel !== 'silent') {
          console.log(`[Pipeit] Transaction attempt ${attempt}/${maxAttempts}`);
        }
        
        await sendAndConfirm(transaction, { commitment });
        return getSignatureFromTransaction(transaction);
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
            (error as any)?.logs ??
            (error as any)?.data?.logs ??
            (error as any)?.simulationResponse?.logs;
          if (maybeLogs) {
            const logs = Array.isArray(maybeLogs) ? maybeLogs : [String(maybeLogs)];
            console.error('[Pipeit] Simulation logs:\n' + logs.join('\n'));
          } else if (this.config.logLevel === 'verbose') {
            console.error('[Pipeit] Transaction error details (no logs found):', error);
          }
          throw error;
        }
        
        const delay = backoff === 'exponential' 
          ? Math.pow(2, attempt - 1) * 1000 
          : attempt * 1000;
        
        if (this.config.logLevel === 'verbose') {
          console.log(`[Pipeit] Retrying in ${delay}ms...`);
        }
        
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    throw new Error('Transaction failed after retries');
  }
}

/**
 * Create a new opinionated transaction builder.
 * Simple factory function for general purpose use.
 */
export function transaction(config?: TransactionBuilderConfig): OpinionatedTransactionBuilder {
  return new OpinionatedTransactionBuilder(config);
}

