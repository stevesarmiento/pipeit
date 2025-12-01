/**
 * Simulation middleware for transactions.
 *
 * @packageDocumentation
 */

import type { TransactionMessage } from '@solana/transaction-messages';
import type { Middleware } from './types.js';

/**
 * Options for simulation middleware.
 */
export interface SimulationOptions {
  /**
   * Whether to skip preflight checks.
   */
  skipPreflight?: boolean;
  /**
   * Commitment level for simulation.
   */
  commitment?: 'processed' | 'confirmed' | 'finalized';
  /**
   * Replace signatures for simulation.
   */
  replaceRecentBlockhash?: boolean;
}

/**
 * Create simulation middleware.
 */
export function withSimulation(options: SimulationOptions = {}): Middleware {
  return async (tx, context, next) => {
    if (!('instructions' in tx)) {
      // Not a transaction message, skip simulation
      return next();
    }

    const rpc = context.rpc;
    if (!rpc) {
      throw new Error('RPC required for simulation');
    }

    try {
      // Simulate transaction
      // Note: Rpc type needs to include SimulateTransactionApi for this to work
      // For now, using type assertion - users should ensure their Rpc includes simulation methods
      const rpcWithSimulation = rpc as typeof rpc & {
        simulateTransaction: (
          tx: TransactionMessage,
          config?: {
            commitment?: 'processed' | 'confirmed' | 'finalized';
            replaceRecentBlockhash?: boolean;
            sigVerify?: boolean;
          }
        ) => { send: () => Promise<{ value: { err: unknown; logs?: string[] } }> };
      };

      const result = await rpcWithSimulation.simulateTransaction(tx as TransactionMessage, {
        commitment: options.commitment ?? 'confirmed',
        replaceRecentBlockhash: options.replaceRecentBlockhash ?? true,
        sigVerify: !options.skipPreflight,
      }).send();

      if (result.value.err) {
        return {
          success: false,
          error: new Error(`Simulation failed: ${JSON.stringify(result.value.err)}`),
        };
      }

      // Simulation passed, continue with actual execution
      return next();
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  };
}

