/**
 * Transaction error diagnostics - extract detailed, human-readable error information.
 *
 * @packageDocumentation
 */

import {
  isSolanaError,
  SOLANA_ERROR__BLOCK_HEIGHT_EXCEEDED,
  SOLANA_ERROR__TRANSACTION__FEE_PAYER_MISSING,
  SOLANA_ERROR__TRANSACTION__SIGNATURES_MISSING,
  SOLANA_ERROR__JSON_RPC__SERVER_ERROR_SEND_TRANSACTION_PREFLIGHT_FAILURE,
  SOLANA_ERROR__INSTRUCTION_ERROR__CUSTOM,
  SOLANA_ERROR__INSTRUCTION_ERROR__INSUFFICIENT_FUNDS,
  SOLANA_ERROR__INSTRUCTION_ERROR__INVALID_ACCOUNT_DATA,
  SOLANA_ERROR__INSTRUCTION_ERROR__INVALID_INSTRUCTION_DATA,
  SOLANA_ERROR__INSTRUCTION_ERROR__MISSING_REQUIRED_SIGNATURE,
  SOLANA_ERROR__INSTRUCTION_ERROR__ACCOUNT_ALREADY_INITIALIZED,
  SOLANA_ERROR__INSTRUCTION_ERROR__UNINITIALIZED_ACCOUNT,
  SOLANA_ERROR__INSTRUCTION_ERROR__PROGRAM_FAILED_TO_COMPLETE,
} from '@solana/errors';

/**
 * Detailed error diagnosis result.
 */
export interface ErrorDiagnosis {
  /** Short error category */
  category: ErrorCategory;
  /** Human-readable summary */
  summary: string;
  /** Detailed explanation */
  details: string;
  /** Suggested action to fix */
  suggestion: string;
  /** Program address if applicable */
  programAddress?: string | undefined;
  /** Instruction index if applicable */
  instructionIndex?: number | undefined;
  /** Custom error code if applicable */
  errorCode?: number | undefined;
  /** Simulation logs if available */
  logs?: string[] | undefined;
  /** Original error for debugging */
  originalError: unknown;
}

/**
 * Error categories for quick identification.
 */
export type ErrorCategory =
  | 'blockhash_expired'
  | 'insufficient_funds'
  | 'missing_signature'
  | 'simulation_failed'
  | 'program_error'
  | 'invalid_account'
  | 'invalid_data'
  | 'network_error'
  | 'user_rejected'
  | 'unknown';

/**
 * Diagnose a transaction error and return detailed, actionable information.
 *
 * @example
 * ```ts
 * try {
 *   await builder.execute({ rpcSubscriptions });
 * } catch (error) {
 *   const diagnosis = diagnoseError(error);
 *   console.error(diagnosis.summary);
 *   console.error(diagnosis.suggestion);
 *   if (diagnosis.logs) {
 *     console.error('Logs:', diagnosis.logs.join('\n'));
 *   }
 * }
 * ```
 */
export function diagnoseError(error: unknown): ErrorDiagnosis {
  // Extract logs from various error shapes
  const logs = extractLogs(error);

  // Blockhash expired
  if (isSolanaError(error, SOLANA_ERROR__BLOCK_HEIGHT_EXCEEDED)) {
    return {
      category: 'blockhash_expired',
      summary: 'Transaction expired - blockhash no longer valid',
      details: 'The transaction took too long to confirm and the blockhash expired. Solana blockhashes are valid for approximately 60-90 seconds.',
      suggestion: 'Retry the transaction with a fresh blockhash. If using TransactionBuilder, it will automatically fetch a new blockhash.',
      logs,
      originalError: error,
    };
  }

  // Fee payer missing
  if (isSolanaError(error, SOLANA_ERROR__TRANSACTION__FEE_PAYER_MISSING)) {
    return {
      category: 'invalid_account',
      summary: 'Transaction has no fee payer',
      details: 'Every Solana transaction requires a fee payer account to cover transaction fees.',
      suggestion: 'Call .setFeePayer(address) on the TransactionBuilder before executing.',
      logs,
      originalError: error,
    };
  }

  // Signatures missing
  if (isSolanaError(error, SOLANA_ERROR__TRANSACTION__SIGNATURES_MISSING)) {
    return {
      category: 'missing_signature',
      summary: 'Transaction is missing required signatures',
      details: 'One or more accounts that need to sign the transaction have not signed it.',
      suggestion: 'Ensure all required signers are provided. Check that the signer matches the fee payer and any other signing accounts.',
      logs,
      originalError: error,
    };
  }

  // Simulation/preflight failure - most common
  if (isSolanaError(error, SOLANA_ERROR__JSON_RPC__SERVER_ERROR_SEND_TRANSACTION_PREFLIGHT_FAILURE)) {
    return diagnoseSimulationError(error, logs);
  }

  // Custom program error
  if (isSolanaError(error, SOLANA_ERROR__INSTRUCTION_ERROR__CUSTOM)) {
    const context = (error as any).context || {};
    return {
      category: 'program_error',
      summary: `Program error: custom error code ${context.code ?? 'unknown'}`,
      details: `A program returned a custom error. Instruction index: ${context.index ?? 'unknown'}, Error code: ${context.code ?? 'unknown'}`,
      suggestion: 'Check the program documentation for error code meanings. Review the instruction parameters and account states.',
      instructionIndex: context.index,
      errorCode: context.code,
      logs,
      originalError: error,
    };
  }

  // Insufficient funds (instruction level)
  if (isSolanaError(error, SOLANA_ERROR__INSTRUCTION_ERROR__INSUFFICIENT_FUNDS)) {
    return {
      category: 'insufficient_funds',
      summary: 'Insufficient funds for transaction',
      details: 'An account does not have enough SOL or tokens to complete this transaction.',
      suggestion: 'Check account balances. Ensure the source account has enough funds plus transaction fees (~0.000005 SOL).',
      logs,
      originalError: error,
    };
  }

  // Missing signature (instruction level)
  if (isSolanaError(error, SOLANA_ERROR__INSTRUCTION_ERROR__MISSING_REQUIRED_SIGNATURE)) {
    const context = (error as any).context || {};
    return {
      category: 'missing_signature',
      summary: 'Instruction requires a signature that was not provided',
      details: `Instruction at index ${context.index ?? 'unknown'} requires a signer that did not sign the transaction.`,
      suggestion: 'Check which accounts are marked as signers in the instruction and ensure they all sign.',
      instructionIndex: context.index,
      logs,
      originalError: error,
    };
  }

  // Invalid account data
  if (isSolanaError(error, SOLANA_ERROR__INSTRUCTION_ERROR__INVALID_ACCOUNT_DATA)) {
    return {
      category: 'invalid_account',
      summary: 'Invalid account data',
      details: 'An account contains invalid or unexpected data for this operation.',
      suggestion: 'Verify account addresses are correct and the account is in the expected state.',
      logs,
      originalError: error,
    };
  }

  // Invalid instruction data
  if (isSolanaError(error, SOLANA_ERROR__INSTRUCTION_ERROR__INVALID_INSTRUCTION_DATA)) {
    return {
      category: 'invalid_data',
      summary: 'Invalid instruction data',
      details: 'The instruction data is malformed or contains invalid parameters.',
      suggestion: 'Check instruction parameters match what the program expects.',
      logs,
      originalError: error,
    };
  }

  // Account already initialized
  if (isSolanaError(error, SOLANA_ERROR__INSTRUCTION_ERROR__ACCOUNT_ALREADY_INITIALIZED)) {
    return {
      category: 'invalid_account',
      summary: 'Account already initialized',
      details: 'Trying to initialize an account that has already been initialized.',
      suggestion: 'This account already exists. Use a different address or skip initialization.',
      logs,
      originalError: error,
    };
  }

  // Uninitialized account
  if (isSolanaError(error, SOLANA_ERROR__INSTRUCTION_ERROR__UNINITIALIZED_ACCOUNT)) {
    return {
      category: 'invalid_account',
      summary: 'Account not initialized',
      details: 'The account has not been initialized yet but the instruction expects it to be.',
      suggestion: 'Initialize the account first before using it in this instruction.',
      logs,
      originalError: error,
    };
  }

  // Program failed to complete
  if (isSolanaError(error, SOLANA_ERROR__INSTRUCTION_ERROR__PROGRAM_FAILED_TO_COMPLETE)) {
    return {
      category: 'program_error',
      summary: 'Program failed to complete',
      details: 'The program encountered an error and could not complete execution. This could be due to compute limits or an internal program error.',
      suggestion: 'Try increasing compute budget. Check program logs for details.',
      logs,
      originalError: error,
    };
  }

  // User rejection (wallet)
  if (isUserRejection(error)) {
    return {
      category: 'user_rejected',
      summary: 'Transaction rejected by user',
      details: 'The user declined to sign the transaction in their wallet.',
      suggestion: 'The user must approve the transaction in their wallet to proceed.',
      logs,
      originalError: error,
    };
  }

  // Network error
  if (isNetworkError(error)) {
    return {
      category: 'network_error',
      summary: 'Network connection error',
      details: 'Could not connect to the Solana network.',
      suggestion: 'Check your internet connection and RPC endpoint. The RPC may be down or rate-limited.',
      logs,
      originalError: error,
    };
  }

  // Unknown error - try to extract useful info
  return {
    category: 'unknown',
    summary: extractErrorMessage(error),
    details: 'An unexpected error occurred.',
    suggestion: 'Check the logs below for more details. If the issue persists, try a different RPC endpoint.',
    logs,
    originalError: error,
  };
}

/**
 * Diagnose simulation/preflight errors in detail.
 */
function diagnoseSimulationError(error: unknown, logs?: string[]): ErrorDiagnosis {
  const context = (error as any).context || {};
  const cause = (error as any).cause || {};

  // Try to extract more specific error from cause
  if (cause && isSolanaError(cause, SOLANA_ERROR__INSTRUCTION_ERROR__CUSTOM)) {
    const causeContext = cause.context || {};
    return {
      category: 'program_error',
      summary: `Simulation failed: program error code ${causeContext.code ?? 'unknown'}`,
      details: `Transaction simulation failed. A program returned error code ${causeContext.code ?? 'unknown'} at instruction ${causeContext.index ?? 'unknown'}.`,
      suggestion: 'Check the program documentation for this error code. Review instruction accounts and data.',
      instructionIndex: causeContext.index,
      errorCode: causeContext.code,
      logs,
      originalError: error,
    };
  }

  // Check logs for common patterns
  const logString = (logs || []).join('\n').toLowerCase();

  if (logString.includes('insufficient') || logString.includes('not enough')) {
    return {
      category: 'insufficient_funds',
      summary: 'Simulation failed: insufficient funds',
      details: 'Transaction simulation failed due to insufficient funds in one or more accounts.',
      suggestion: 'Check that all source accounts have enough balance for the transaction.',
      logs,
      originalError: error,
    };
  }

  if (logString.includes('already in use') || logString.includes('already initialized')) {
    return {
      category: 'invalid_account',
      summary: 'Simulation failed: account already exists',
      details: 'Transaction simulation failed because an account is already initialized.',
      suggestion: 'Use a different account address or check if this operation was already performed.',
      logs,
      originalError: error,
    };
  }

  if (logString.includes('invalid program') || logString.includes('not executable')) {
    return {
      category: 'program_error',
      summary: 'Simulation failed: invalid program',
      details: 'The program ID is invalid or the program is not deployed.',
      suggestion: 'Verify the program address is correct and deployed on this network.',
      logs,
      originalError: error,
    };
  }

  // Generic simulation failure
  return {
    category: 'simulation_failed',
    summary: 'Transaction simulation failed',
    details: context.message || 'The transaction failed during simulation. Check the logs for details.',
    suggestion: 'Review the simulation logs below to identify the failing instruction.',
    logs,
    originalError: error,
  };
}

/**
 * Extract logs from various error shapes.
 */
function extractLogs(error: unknown): string[] | undefined {
  if (!error || typeof error !== 'object') return undefined;

  const e = error as any;

  // Direct logs
  if (Array.isArray(e.logs)) return e.logs;

  // Nested in data
  if (e.data?.logs && Array.isArray(e.data.logs)) return e.data.logs;

  // Nested in context
  if (e.context?.logs && Array.isArray(e.context.logs)) return e.context.logs;

  // Nested in cause
  if (e.cause?.logs && Array.isArray(e.cause.logs)) return e.cause.logs;
  if (e.cause?.data?.logs && Array.isArray(e.cause.data.logs)) return e.cause.data.logs;

  // Simulation response
  if (e.simulationResponse?.logs && Array.isArray(e.simulationResponse.logs)) {
    return e.simulationResponse.logs;
  }

  return undefined;
}

/**
 * Check if error is a user wallet rejection.
 */
function isUserRejection(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const message = ((error as Error).message || '').toLowerCase();
  return (
    message.includes('user rejected') ||
    message.includes('user denied') ||
    message.includes('user cancelled') ||
    message.includes('rejected by user')
  );
}

/**
 * Check if error is network-related.
 */
function isNetworkError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const message = ((error as Error).message || '').toLowerCase();
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

/**
 * Extract a meaningful error message.
 */
function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as any).message);
  }
  return 'Unknown error';
}

/**
 * Format an error diagnosis for display/logging.
 */
export function formatDiagnosis(diagnosis: ErrorDiagnosis): string {
  const lines: string[] = [
    `❌ ${diagnosis.summary}`,
    '',
    `📋 Details: ${diagnosis.details}`,
    '',
    `💡 Suggestion: ${diagnosis.suggestion}`,
  ];

  if (diagnosis.instructionIndex !== undefined) {
    lines.push(`📍 Instruction Index: ${diagnosis.instructionIndex}`);
  }

  if (diagnosis.errorCode !== undefined) {
    lines.push(`🔢 Error Code: ${diagnosis.errorCode}`);
  }

  if (diagnosis.programAddress) {
    lines.push(`📦 Program: ${diagnosis.programAddress}`);
  }

  if (diagnosis.logs && diagnosis.logs.length > 0) {
    lines.push('', '📜 Logs:');
    diagnosis.logs.forEach(log => lines.push(`  ${log}`));
  }

  return lines.join('\n');
}

