/**
 * Message packing utilities for fitting instructions within transaction size limits.
 *
 * These utilities help you pack as many instructions as possible into a single
 * transaction, and identify which instructions need to be sent in follow-up
 * transactions.
 *
 * @packageDocumentation
 */

import type { Instruction } from '@solana/instructions';
import type { TransactionMessage, TransactionMessageWithFeePayer } from '@solana/transaction-messages';
import { appendTransactionMessageInstruction } from '@solana/transaction-messages';
import { getTransactionMessageSize, TRANSACTION_SIZE_LIMIT } from '@solana/transactions';

/**
 * A transaction message that is ready for size calculation.
 * Must have a fee payer set.
 */
export type SizeableTransactionMessage = TransactionMessage & TransactionMessageWithFeePayer;

/**
 * Result of packing instructions into a transaction message.
 */
export interface PackResult<T extends SizeableTransactionMessage = SizeableTransactionMessage> {
  /** Instructions that fit in the message */
  packed: Instruction[];
  /** Instructions that did not fit (overflow) */
  overflow: Instruction[];
  /** The message with packed instructions */
  message: T;
  /** Size information */
  sizeInfo: {
    size: number;
    limit: number;
    remaining: number;
  };
}

/**
 * Pack as many instructions as possible into a transaction message.
 *
 * This function iterates through the provided instructions and adds them
 * to the message until no more can fit within the transaction size limit.
 * It returns both the packed instructions and any overflow that didn't fit.
 *
 * @param baseMessage - The transaction message to pack instructions into (must have fee payer set)
 * @param instructions - Array of instructions to pack
 * @param options - Optional configuration
 * @returns PackResult with packed/overflow instructions and updated message
 *
 * @example
 * ```ts
 * const result = packInstructions(baseMessage, [ix1, ix2, ix3, ix4, ix5]);
 *
 * // First transaction with packed instructions
 * const tx1 = result.message;
 *
 * // Send overflow in next transaction
 * if (result.overflow.length > 0) {
 *   const result2 = packInstructions(newBaseMessage, result.overflow);
 *   const tx2 = result2.message;
 * }
 * ```
 */
export function packInstructions<T extends SizeableTransactionMessage>(
  baseMessage: T,
  instructions: Instruction[],
  options?: {
    /** Reserve bytes for future instructions (default: 0) */
    reserveBytes?: number;
  }
): PackResult<T> {
  const reserveBytes = options?.reserveBytes ?? 0;
  const effectiveLimit = TRANSACTION_SIZE_LIMIT - reserveBytes;

  const packed: Instruction[] = [];
  let message = baseMessage as SizeableTransactionMessage;

  for (const instruction of instructions) {
    const testMessage = appendTransactionMessageInstruction(instruction, message);
    const testSize = getTransactionMessageSize(testMessage as SizeableTransactionMessage);

    if (testSize <= effectiveLimit) {
      packed.push(instruction);
      message = testMessage as SizeableTransactionMessage;
    } else {
      // This instruction doesn't fit, stop here
      break;
    }
  }

  const overflow = instructions.slice(packed.length);
  const size = getTransactionMessageSize(message);

  return {
    packed,
    overflow,
    message: message as T,
    sizeInfo: {
      size,
      limit: TRANSACTION_SIZE_LIMIT,
      remaining: TRANSACTION_SIZE_LIMIT - size,
    },
  };
}

/**
 * Check if an instruction can fit in a transaction message.
 *
 * @param message - The transaction message to check against (must have fee payer set)
 * @param instruction - The instruction to check
 * @returns true if the instruction can fit, false otherwise
 *
 * @example
 * ```ts
 * if (canFitInstruction(message, newInstruction)) {
 *   message = appendTransactionMessageInstruction(newInstruction, message);
 * } else {
 *   // Need to create a new transaction
 * }
 * ```
 */
export function canFitInstruction(
  message: SizeableTransactionMessage,
  instruction: Instruction
): boolean {
  const testMessage = appendTransactionMessageInstruction(instruction, message);
  return getTransactionMessageSize(testMessage as SizeableTransactionMessage) <= TRANSACTION_SIZE_LIMIT;
}

/**
 * Get remaining bytes available in a transaction message.
 *
 * @param message - The transaction message to check (must have fee payer set)
 * @returns Number of bytes remaining before hitting the size limit
 *
 * @example
 * ```ts
 * const remaining = getRemainingBytes(message);
 * console.log(`Can add approximately ${remaining} more bytes`);
 * ```
 */
export function getRemainingBytes(message: SizeableTransactionMessage): number {
  return TRANSACTION_SIZE_LIMIT - getTransactionMessageSize(message);
}

/**
 * Split an array of instructions into multiple chunks, each fitting within
 * the transaction size limit when added to a base message.
 *
 * This is useful for batching large sets of instructions across multiple
 * transactions.
 *
 * @param createBaseMessage - Factory function to create fresh base messages (must have fee payer set)
 * @param instructions - All instructions to split
 * @returns Array of instruction arrays, each fitting in one transaction
 *
 * @example
 * ```ts
 * const chunks = splitInstructionsIntoChunks(
 *   () => createBaseMessage(),
 *   manyInstructions
 * );
 *
 * for (const chunk of chunks) {
 *   const message = createBaseMessage();
 *   for (const ix of chunk) {
 *     message = appendTransactionMessageInstruction(ix, message);
 *   }
 *   await sendTransaction(message);
 * }
 * ```
 */
export function splitInstructionsIntoChunks<T extends SizeableTransactionMessage>(
  createBaseMessage: () => T,
  instructions: Instruction[]
): Instruction[][] {
  const chunks: Instruction[][] = [];
  let remaining = [...instructions];

  while (remaining.length > 0) {
    const baseMessage = createBaseMessage();
    const result = packInstructions(baseMessage, remaining);

    if (result.packed.length === 0) {
      // Single instruction is too large to fit
      throw new Error(
        `Instruction at index ${instructions.length - remaining.length} is too large to fit in a transaction`
      );
    }

    chunks.push(result.packed);
    remaining = result.overflow;
  }

  return chunks;
}
