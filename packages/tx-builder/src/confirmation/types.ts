/**
 * Types for transaction confirmation strategies.
 *
 * @packageDocumentation
 */

import type { Signature } from '@solana/kit';
import type { Commitment } from '@solana/rpc-types';

/**
 * Confirmation strategy options.
 */
export type ConfirmationStrategy = 'blockheight' | 'timeout' | 'nonce' | 'auto';

/**
 * Configuration for transaction confirmation.
 */
export interface ConfirmationConfig {
  /**
   * Strategy for confirming transactions.
   * - 'blockheight': Race confirmation against block height expiration (recommended)
   * - 'timeout': Race confirmation against a timeout
   * - 'nonce': For durable nonce transactions, race against nonce invalidation
   * - 'auto': Automatically select based on transaction lifetime type
   */
  strategy: ConfirmationStrategy;

  /**
   * Timeout in milliseconds for 'timeout' strategy.
   * @default 60000 (60 seconds)
   */
  timeout?: number;

  /**
   * Commitment level for confirmation.
   */
  commitment?: Commitment;
}

/**
 * Result from waiting for confirmation.
 */
export interface ConfirmationResult {
  /**
   * Transaction signature.
   */
  signature: Signature;

  /**
   * Whether the transaction was confirmed.
   */
  confirmed: boolean;

  /**
   * Error if confirmation failed.
   */
  error?: Error;

  /**
   * How the confirmation was achieved/failed.
   */
  reason: 'confirmed' | 'timeout' | 'block_height_exceeded' | 'nonce_invalidated' | 'error';
}

/**
 * Options for waiting for transaction confirmation.
 */
export interface WaitForConfirmationOptions {
  /**
   * Abort signal to cancel waiting.
   */
  abortSignal?: AbortSignal;

  /**
   * Commitment level to wait for.
   */
  commitment: Commitment;

  /**
   * Transaction signature to confirm.
   */
  signature: Signature;

  /**
   * Last valid block height for blockhash-based transactions.
   */
  lastValidBlockHeight?: bigint;

  /**
   * Timeout in milliseconds.
   */
  timeout?: number;

  /**
   * Nonce value for durable nonce transactions.
   */
  nonce?: string;

  /**
   * Nonce account address for durable nonce transactions.
   */
  nonceAccountAddress?: string;
}
