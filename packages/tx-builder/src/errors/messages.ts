/**
 * Human-readable error messages and formatting utilities.
 *
 * @packageDocumentation
 */

import {
  type PipeitErrorType,
  InsufficientFundsError,
  TransactionTooLargeError,
  SignatureRejectedError,
  AccountNotFoundError,
} from './errors.js';

/**
 * Get a human-readable error message for a Pipeit error.
 */
export function getErrorMessage(error: PipeitErrorType | Error): string {
  if (error instanceof InsufficientFundsError) {
    return `Insufficient funds: required ${error.required.toString()} lamports, available ${error.available.toString()} lamports${error.account ? ` (account: ${error.account})` : ''}`;
  }
  
  if (error instanceof TransactionTooLargeError) {
    return `Transaction too large: ${error.size} bytes exceeds maximum ${error.maxSize} bytes`;
  }
  
  if (error instanceof SignatureRejectedError) {
    return `User rejected transaction signature${error.reason ? `: ${error.reason}` : ''}`;
  }
  
  if (error instanceof AccountNotFoundError) {
    return `Account not found: ${error.account}`;
  }
  
  if (error instanceof Error) {
    return error.message;
  }
  
  return String(error);
}

/**
 * Format an error for logging/display.
 */
export function formatError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  return String(error);
}
