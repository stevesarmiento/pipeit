/**
 * Signer utilities - re-exports from Kit with Pipeit conveniences.
 *
 * This module provides convenient access to Kit's signer types and utilities,
 * enabling signers to be embedded in instruction account metas for automatic
 * transaction signing.
 *
 * @packageDocumentation
 */

// Re-export Kit's signer account meta types
export type {
  AccountSignerMeta,
  InstructionWithSigners,
  TransactionMessageWithSigners,
} from '@solana/signers';

// Re-export Kit's signer extraction utilities
export {
  getSignersFromInstruction,
  getSignersFromTransactionMessage,
} from '@solana/signers';

// Re-export common signer types
export type {
  TransactionSigner,
  TransactionPartialSigner,
  TransactionModifyingSigner,
  TransactionSendingSigner,
  KeyPairSigner,
} from '@solana/signers';

// Re-export signer factories
export {
  generateKeyPairSigner,
  createSignerFromKeyPair,
  createKeyPairSignerFromBytes,
  createNoopSigner,
} from '@solana/signers';

// Re-export type guards
export {
  isTransactionSigner,
  isTransactionPartialSigner,
  isTransactionModifyingSigner,
  isTransactionSendingSigner,
} from '@solana/signers';
