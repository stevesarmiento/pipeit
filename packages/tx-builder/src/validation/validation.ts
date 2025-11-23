/**
 * Transaction validation utilities.
 *
 * @packageDocumentation
 */

import type { TransactionMessage } from '@solana/transaction-messages';
import { InvalidTransactionError, TransactionTooLargeError } from '../errors/index.js';

/**
 * Maximum transaction size in bytes.
 */
export const MAX_TRANSACTION_SIZE = 1232;

/**
 * Validate that a transaction message has all required fields.
 */
export function validateTransaction(message: TransactionMessage): void {
  const missingFields: string[] = [];

  if (!('feePayer' in message) || !message.feePayer) {
    missingFields.push('feePayer');
  }

  if (!('lifetimeConstraint' in message) || !message.lifetimeConstraint) {
    missingFields.push('lifetimeConstraint');
  }

  if (missingFields.length > 0) {
    throw new InvalidTransactionError(
      `Transaction is missing required fields: ${missingFields.join(', ')}`,
      missingFields
    );
  }
}

/**
 * Estimate transaction size in bytes.
 * This is a rough estimate and may not be exact.
 */
export function estimateTransactionSize(message: TransactionMessage): number {
  // Base overhead for transaction structure
  let size = 100;

  // Add size for each instruction
  if ('instructions' in message && message.instructions) {
    for (const instruction of message.instructions) {
      size += 100; // Base instruction overhead
      if ('data' in instruction && instruction.data) {
        size += instruction.data.length;
      }
      if ('accounts' in instruction && instruction.accounts) {
        size += instruction.accounts.length * 32; // Account address size
      }
    }
  }

  // Add size for address lookup tables if present
  if ('version' in message && message.version === 0) {
    // V0 transactions can have address lookup tables
    size += 50; // Rough estimate
  }

  return size;
}

/**
 * Validate transaction size does not exceed maximum.
 */
export function validateTransactionSize(message: TransactionMessage): void {
  const size = estimateTransactionSize(message);
  if (size > MAX_TRANSACTION_SIZE) {
    throw new TransactionTooLargeError(size, MAX_TRANSACTION_SIZE);
  }
}






