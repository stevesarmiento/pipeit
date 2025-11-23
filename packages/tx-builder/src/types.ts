/**
 * Core types for transaction building.
 *
 * @packageDocumentation
 */

import type { Address } from '@solana/addresses';
import type { Instruction } from '@solana/instructions';
import type { TransactionMessage } from '@solana/transaction-messages';
import type { Rpc, GetLatestBlockhashApi } from '@solana/rpc';

/**
 * State tracking for transaction builder.
 * Used to ensure required fields are set before building.
 */
export interface BuilderState {
  feePayer?: boolean;
  lifetime?: boolean;
}

/**
 * Required state for a complete transaction.
 */
export type RequiredState = {
  feePayer: true;
  lifetime: true;
};

/**
 * Configuration for transaction builder.
 */
export interface BuilderConfig {
  /**
   * Transaction version (0 for versioned transactions, 'legacy' for legacy).
   */
  version?: 0 | 'legacy';
  /**
   * RPC client for auto-fetching blockhash when not explicitly provided.
   */
  rpc?: Rpc<GetLatestBlockhashApi>;
}

/**
 * Lifetime constraint for transaction (blockhash or nonce).
 */
export type LifetimeConstraint =
  | { type: 'blockhash'; blockhash: string; lastValidBlockHeight: bigint }
  | {
      type: 'nonce';
      nonce: string;
      nonceAccountAddress: Address;
      nonceAuthorityAddress: Address;
    };

/**
 * Result of building a transaction.
 */
export interface BuildResult {
  /**
   * The built transaction message.
   */
  message: TransactionMessage;
  /**
   * Instructions included in the transaction.
   */
  instructions: readonly Instruction[];
  /**
   * Estimated size of the transaction in bytes.
   */
  estimatedSize?: number;
}






