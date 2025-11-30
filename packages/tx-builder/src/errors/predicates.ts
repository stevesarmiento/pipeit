/**
 * Type guards and predicates for errors.
 *
 * @packageDocumentation
 */

import {
  isSolanaError,
  SOLANA_ERROR__BLOCK_HEIGHT_EXCEEDED,
  SOLANA_ERROR__JSON_RPC__SERVER_ERROR_SEND_TRANSACTION_PREFLIGHT_FAILURE,
} from '@solana/errors';
import {
  type PipeitErrorType,
  InsufficientFundsError,
  TransactionTooLargeError,
  SignatureRejectedError,
  AccountNotFoundError,
} from './errors.js';

/**
 * Check if error is a Pipeit-specific error.
 */
export function isPipeitError(error: unknown): error is PipeitErrorType {
  return (
    error instanceof InsufficientFundsError ||
    error instanceof TransactionTooLargeError ||
    error instanceof SignatureRejectedError ||
    error instanceof AccountNotFoundError
  );
}

/**
 * Check if error is InsufficientFundsError.
 */
export function isInsufficientFundsError(error: unknown): error is InsufficientFundsError {
  return error instanceof InsufficientFundsError;
}

/**
 * Check if error is TransactionTooLargeError.
 */
export function isTransactionTooLargeError(error: unknown): error is TransactionTooLargeError {
  return error instanceof TransactionTooLargeError;
}

/**
 * Check if error is SignatureRejectedError.
 */
export function isSignatureRejectedError(error: unknown): error is SignatureRejectedError {
  return error instanceof SignatureRejectedError;
}

/**
 * Check if error is AccountNotFoundError.
 */
export function isAccountNotFoundError(error: unknown): error is AccountNotFoundError {
  return error instanceof AccountNotFoundError;
}

/**
 * Check if error is blockhash expired using Kit's error.
 * Uses Kit's SOLANA_ERROR__BLOCK_HEIGHT_EXCEEDED.
 */
export function isBlockhashExpiredError(error: unknown): boolean {
  return isSolanaError(error, SOLANA_ERROR__BLOCK_HEIGHT_EXCEEDED);
}

/**
 * Check if error is simulation failed using Kit's error.
 * Uses Kit's SOLANA_ERROR__JSON_RPC__SERVER_ERROR_SEND_TRANSACTION_PREFLIGHT_FAILURE.
 */
export function isSimulationFailedError(error: unknown): boolean {
  return isSolanaError(error, SOLANA_ERROR__JSON_RPC__SERVER_ERROR_SEND_TRANSACTION_PREFLIGHT_FAILURE);
}

/**
 * Check if error is a network-related error.
 * Checks for common network error patterns.
 */
export function isNetworkError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  
  // Check for common network error indicators
  const message = (error as Error).message?.toLowerCase() || '';
  const code = (error as any).code || '';
  
  return (
    message.includes('network') ||
    message.includes('fetch') ||
    message.includes('timeout') ||
    message.includes('econnrefused') ||
    code === 'ECONNREFUSED' ||
    code === 'ETIMEDOUT' ||
    code === 'ENOTFOUND'
  );
}
