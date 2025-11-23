/**
 * Human-readable error messages for transaction errors.
 *
 * @packageDocumentation
 */

import type {
  TransactionErrorType,
  InsufficientFundsError,
  SimulationFailedError,
  SignatureRejectedError,
  AccountNotFoundError,
  ProgramError,
  TransactionTooLargeError,
} from './errors';

/**
 * Get a human-readable error message for a transaction error.
 */
export function getErrorMessage(error: TransactionErrorType): string {
  switch (error.code) {
    case 'INSUFFICIENT_FUNDS': {
      const e = error as InsufficientFundsError;
      return `You don't have enough SOL. Required: ${formatLamports(e.required)}, Available: ${formatLamports(e.available)}`;
    }
    case 'BLOCKHASH_EXPIRED':
      return `Transaction expired. Please try again.`;
    case 'SIMULATION_FAILED': {
      const e = error as SimulationFailedError;
      return `Transaction would fail: ${e.programError?.message || 'Unknown error'}`;
    }
    case 'NETWORK_ERROR':
      return `Network error: ${error.message}`;
    case 'SIGNATURE_REJECTED': {
      const e = error as SignatureRejectedError;
      return `Transaction was cancelled${e.reason ? `: ${e.reason}` : ''}`;
    }
    case 'ACCOUNT_NOT_FOUND': {
      const e = error as AccountNotFoundError;
      return `Account not found: ${e.account}`;
    }
    case 'PROGRAM_ERROR': {
      const e = error as ProgramError;
      return `Program error: ${e.errorMessage}`;
    }
    case 'TRANSACTION_TOO_LARGE': {
      const e = error as TransactionTooLargeError;
      return `Transaction is too large (${e.size} bytes). Maximum size is ${e.maxSize} bytes.`;
    }
    case 'INVALID_TRANSACTION':
      return `Invalid transaction: ${error.message}`;
    default:
      return error.message;
  }
}

/**
 * Format lamports as SOL with proper decimal places.
 */
function formatLamports(lamports: bigint): string {
  const sol = Number(lamports) / 1_000_000_000;
  return `${sol.toFixed(9)} SOL`;
}

/**
 * Get user-friendly error title.
 */
export function getErrorTitle(error: TransactionErrorType): string {
  switch (error.code) {
    case 'INSUFFICIENT_FUNDS':
      return 'Insufficient Funds';
    case 'BLOCKHASH_EXPIRED':
      return 'Transaction Expired';
    case 'SIMULATION_FAILED':
      return 'Transaction Would Fail';
    case 'NETWORK_ERROR':
      return 'Network Error';
    case 'SIGNATURE_REJECTED':
      return 'Transaction Cancelled';
    case 'ACCOUNT_NOT_FOUND':
      return 'Account Not Found';
    case 'PROGRAM_ERROR':
      return 'Program Error';
    case 'TRANSACTION_TOO_LARGE':
      return 'Transaction Too Large';
    case 'INVALID_TRANSACTION':
      return 'Invalid Transaction';
    default:
      return 'Transaction Error';
  }
}

