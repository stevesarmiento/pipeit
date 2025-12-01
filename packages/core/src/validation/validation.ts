/**
 * Transaction validation utilities.
 *
 * @packageDocumentation
 */

import type { TransactionMessage, TransactionMessageWithFeePayer } from '@solana/transaction-messages';
import { SolanaError, SOLANA_ERROR__TRANSACTION__FEE_PAYER_MISSING } from '@solana/errors';
import { getTransactionMessageSize, TRANSACTION_SIZE_LIMIT } from '@solana/transactions';
import { TransactionTooLargeError } from '../errors/index.js';

/**
 * A transaction message that is ready for size calculation.
 * Must have a fee payer set.
 */
type SizeableMessage = TransactionMessage & TransactionMessageWithFeePayer;

// Re-export Kit's size constants and functions
export { TRANSACTION_SIZE_LIMIT, getTransactionMessageSize };

/**
 * @deprecated Use TRANSACTION_SIZE_LIMIT from @solana/transactions instead
 */
export const MAX_TRANSACTION_SIZE = TRANSACTION_SIZE_LIMIT;

/**
 * Validate that a transaction message has all required fields.
 */
export function validateTransaction(message: TransactionMessage): void {
  // Check fee payer
  if (!('feePayer' in message) || !message.feePayer) {
    throw new SolanaError(SOLANA_ERROR__TRANSACTION__FEE_PAYER_MISSING);
  }

  // Check lifetime constraint
  if (!('lifetimeConstraint' in message) || !message.lifetimeConstraint) {
    throw new Error('Transaction is missing lifetime constraint (blockhash or nonce)');
  }
}

/**
 * @deprecated Use getTransactionMessageSize from @solana/transactions instead
 */
export function estimateTransactionSize(message: SizeableMessage): number {
  return getTransactionMessageSize(message);
}

/**
 * Validate transaction size does not exceed maximum.
 */
export function validateTransactionSize(message: SizeableMessage): void {
  const size = getTransactionMessageSize(message);
  if (size > TRANSACTION_SIZE_LIMIT) {
    throw new TransactionTooLargeError(size, TRANSACTION_SIZE_LIMIT);
  }
}

/**
 * Get detailed transaction size information.
 * Useful for checking how much space is remaining before adding more instructions.
 */
export function getTransactionSizeInfo(message: SizeableMessage): {
  size: number;
  limit: number;
  remaining: number;
  percentUsed: number;
} {
  const size = getTransactionMessageSize(message);
  return {
    size,
    limit: TRANSACTION_SIZE_LIMIT,
    remaining: TRANSACTION_SIZE_LIMIT - size,
    percentUsed: (size / TRANSACTION_SIZE_LIMIT) * 100,
  };
}
