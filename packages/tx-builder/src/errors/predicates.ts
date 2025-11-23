/**
 * Type guards and predicates for transaction errors.
 *
 * @packageDocumentation
 */

import type {
  TransactionErrorType,
  InsufficientFundsError,
  BlockhashExpiredError,
  SimulationFailedError,
  NetworkError,
  SignatureRejectedError,
  AccountNotFoundError,
  ProgramError,
  TransactionTooLargeError,
  InvalidTransactionError,
} from './errors';

/**
 * Check if error is a TransactionError.
 */
export function isTransactionError(error: unknown): error is TransactionErrorType {
  if (
    error === null ||
    typeof error !== 'object' ||
    !('code' in error) ||
    typeof (error as { code: unknown }).code !== 'string'
  ) {
    return false;
  }

  const code = (error as { code: string }).code;
  return (
    code === 'INSUFFICIENT_FUNDS' ||
    code === 'BLOCKHASH_EXPIRED' ||
    code === 'SIMULATION_FAILED' ||
    code === 'NETWORK_ERROR' ||
    code === 'SIGNATURE_REJECTED' ||
    code === 'ACCOUNT_NOT_FOUND' ||
    code === 'PROGRAM_ERROR' ||
    code === 'TRANSACTION_TOO_LARGE' ||
    code === 'INVALID_TRANSACTION'
  );
}

/**
 * Check if error is InsufficientFundsError.
 */
export function isInsufficientFundsError(error: unknown): error is InsufficientFundsError {
  return (
    isTransactionError(error) &&
    error.code === 'INSUFFICIENT_FUNDS' &&
    'required' in error &&
    'available' in error
  );
}

/**
 * Check if error is BlockhashExpiredError.
 */
export function isBlockhashExpiredError(error: unknown): error is BlockhashExpiredError {
  return (
    isTransactionError(error) &&
    error.code === 'BLOCKHASH_EXPIRED' &&
    'blockhash' in error &&
    'lastValidBlockHeight' in error
  );
}

/**
 * Check if error is SimulationFailedError.
 */
export function isSimulationFailedError(error: unknown): error is SimulationFailedError {
  return (
    isTransactionError(error) &&
    error.code === 'SIMULATION_FAILED' &&
    'logs' in error
  );
}

/**
 * Check if error is NetworkError.
 */
export function isNetworkError(error: unknown): error is NetworkError {
  return (
    isTransactionError(error) &&
    error.code === 'NETWORK_ERROR'
  );
}

/**
 * Check if error is SignatureRejectedError.
 */
export function isSignatureRejectedError(error: unknown): error is SignatureRejectedError {
  return (
    isTransactionError(error) &&
    error.code === 'SIGNATURE_REJECTED'
  );
}

/**
 * Check if error is AccountNotFoundError.
 */
export function isAccountNotFoundError(error: unknown): error is AccountNotFoundError {
  return (
    isTransactionError(error) &&
    error.code === 'ACCOUNT_NOT_FOUND' &&
    'account' in error
  );
}

/**
 * Check if error is ProgramError.
 */
export function isProgramError(error: unknown): error is ProgramError {
  return (
    isTransactionError(error) &&
    error.code === 'PROGRAM_ERROR' &&
    'programId' in error &&
    'instructionIndex' in error
  );
}

/**
 * Check if error is TransactionTooLargeError.
 */
export function isTransactionTooLargeError(error: unknown): error is TransactionTooLargeError {
  return (
    isTransactionError(error) &&
    error.code === 'TRANSACTION_TOO_LARGE' &&
    'size' in error &&
    'maxSize' in error
  );
}

/**
 * Check if error is InvalidTransactionError.
 */
export function isInvalidTransactionError(error: unknown): error is InvalidTransactionError {
  return (
    isTransactionError(error) &&
    error.code === 'INVALID_TRANSACTION'
  );
}

