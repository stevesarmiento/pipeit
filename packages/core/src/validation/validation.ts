/**
 * Transaction validation utilities.
 *
 * @packageDocumentation
 */

import type {
    TransactionMessage,
    TransactionMessageWithFeePayer,
    TransactionVersion,
} from '@solana/transaction-messages';
import { SolanaError, SOLANA_ERROR__TRANSACTION__FEE_PAYER_MISSING } from '@solana/errors';
import { getTransactionMessageSize, getTransactionMessageSizeLimit } from '@solana/transactions';
import { TransactionTooLargeError } from '../errors/index.js';

/**
 * A transaction message that is ready for size calculation.
 * Must have a fee payer set.
 */
type SizeableMessage = TransactionMessage & TransactionMessageWithFeePayer;

/**
 * Maximum serialized size of a legacy or version 0 transaction, in bytes.
 */
export const LEGACY_TRANSACTION_SIZE_LIMIT = 1232;

/**
 * Maximum serialized size of a version 1 (SIMD-0385) transaction, in bytes.
 */
export const V1_TRANSACTION_SIZE_LIMIT = 4096;

// Re-export Kit's version-aware size functions
export { getTransactionMessageSize, getTransactionMessageSizeLimit };

/**
 * @deprecated Transaction size is version-dependent (1232 bytes for legacy/v0,
 * 4096 bytes for v1). Use `getTransactionMessageSizeLimit(message)`, or the
 * `LEGACY_TRANSACTION_SIZE_LIMIT` / `V1_TRANSACTION_SIZE_LIMIT` constants.
 */
export const TRANSACTION_SIZE_LIMIT = LEGACY_TRANSACTION_SIZE_LIMIT;

/**
 * @deprecated Use `getTransactionMessageSizeLimit(message)` instead.
 */
export const MAX_TRANSACTION_SIZE = LEGACY_TRANSACTION_SIZE_LIMIT;

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
 * Validate transaction size does not exceed the maximum for its version.
 */
export function validateTransactionSize(message: SizeableMessage): void {
    const size = getTransactionMessageSize(message);
    const limit = getTransactionMessageSizeLimit(message);
    if (size > limit) {
        throw new TransactionTooLargeError(size, limit);
    }
}

/**
 * Get detailed transaction size information.
 * Useful for checking how much space is remaining before adding more instructions.
 *
 * The limit depends on the message version: 1232 bytes for legacy/v0, 4096 for v1.
 */
export function getTransactionSizeInfo(message: SizeableMessage): {
    size: number;
    limit: number;
    remaining: number;
    percentUsed: number;
    version: TransactionVersion;
} {
    const size = getTransactionMessageSize(message);
    const limit = getTransactionMessageSizeLimit(message);
    return {
        size,
        limit,
        remaining: limit - size,
        percentUsed: (size / limit) * 100,
        version: message.version,
    };
}
