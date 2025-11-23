/**
 * Typed error definitions for Solana transaction building.
 *
 * @packageDocumentation
 */

/**
 * Base error class for all transaction-related errors.
 */
export class TransactionError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly context?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'TransactionError';
    Object.setPrototypeOf(this, TransactionError.prototype);
  }
}

/**
 * Error thrown when account has insufficient funds.
 */
export class InsufficientFundsError extends TransactionError {
  constructor(
    public readonly required: bigint,
    public readonly available: bigint,
    public readonly account?: string
  ) {
    super(
      `Insufficient funds: required ${required.toString()}, available ${available.toString()}`,
      'INSUFFICIENT_FUNDS',
      { required, available, account }
    );
    this.name = 'InsufficientFundsError';
    Object.setPrototypeOf(this, InsufficientFundsError.prototype);
  }
}

/**
 * Error thrown when blockhash has expired.
 */
export class BlockhashExpiredError extends TransactionError {
  constructor(
    public readonly blockhash: string,
    public readonly lastValidBlockHeight: bigint,
    public readonly currentBlockHeight: bigint
  ) {
    super(
      `Blockhash expired: ${blockhash}. Last valid at ${lastValidBlockHeight.toString()}, current ${currentBlockHeight.toString()}`,
      'BLOCKHASH_EXPIRED',
      { blockhash, lastValidBlockHeight, currentBlockHeight }
    );
    this.name = 'BlockhashExpiredError';
    Object.setPrototypeOf(this, BlockhashExpiredError.prototype);
  }
}

/**
 * Error thrown when transaction simulation fails.
 */
export class SimulationFailedError extends TransactionError {
  constructor(
    public readonly logs: readonly string[],
    public readonly programError?: {
      code: number;
      message: string;
    }
  ) {
    super(
      `Transaction simulation failed: ${programError?.message || 'Unknown error'}`,
      'SIMULATION_FAILED',
      { logs, programError }
    );
    this.name = 'SimulationFailedError';
    Object.setPrototypeOf(this, SimulationFailedError.prototype);
  }
}

/**
 * Error thrown when network request fails.
 */
export class NetworkError extends TransactionError {
  constructor(
    message: string,
    public readonly cause?: unknown,
    public readonly statusCode?: number
  ) {
    super(message, 'NETWORK_ERROR', { cause, statusCode });
    this.name = 'NetworkError';
    Object.setPrototypeOf(this, NetworkError.prototype);
  }
}

/**
 * Error thrown when user rejects transaction signature.
 */
export class SignatureRejectedError extends TransactionError {
  constructor(public readonly reason?: string) {
    super(
      `Transaction signature rejected${reason ? `: ${reason}` : ''}`,
      'SIGNATURE_REJECTED',
      { reason }
    );
    this.name = 'SignatureRejectedError';
    Object.setPrototypeOf(this, SignatureRejectedError.prototype);
  }
}

/**
 * Error thrown when account is not found.
 */
export class AccountNotFoundError extends TransactionError {
  constructor(public readonly account: string) {
    super(`Account not found: ${account}`, 'ACCOUNT_NOT_FOUND', { account });
    this.name = 'AccountNotFoundError';
    Object.setPrototypeOf(this, AccountNotFoundError.prototype);
  }
}

/**
 * Error thrown when program execution fails.
 */
export class ProgramError extends TransactionError {
  constructor(
    public readonly programId: string,
    public readonly instructionIndex: number,
    public readonly errorCode: number | string,
    public readonly errorMessage: string,
    public readonly logs?: readonly string[]
  ) {
    super(
      `Program error in ${programId} at instruction ${instructionIndex}: ${errorMessage}`,
      'PROGRAM_ERROR',
      { programId, instructionIndex, errorCode, errorMessage, logs }
    );
    this.name = 'ProgramError';
    Object.setPrototypeOf(this, ProgramError.prototype);
  }
}

/**
 * Error thrown when transaction size exceeds limit.
 */
export class TransactionTooLargeError extends TransactionError {
  constructor(
    public readonly size: number,
    public readonly maxSize: number
  ) {
    super(
      `Transaction too large: ${size} bytes (max: ${maxSize} bytes)`,
      'TRANSACTION_TOO_LARGE',
      { size, maxSize }
    );
    this.name = 'TransactionTooLargeError';
    Object.setPrototypeOf(this, TransactionTooLargeError.prototype);
  }
}

/**
 * Error thrown when transaction is missing required fields.
 */
export class InvalidTransactionError extends TransactionError {
  constructor(
    message: string,
    public readonly missingFields?: readonly string[]
  ) {
    super(message, 'INVALID_TRANSACTION', { missingFields });
    this.name = 'InvalidTransactionError';
    Object.setPrototypeOf(this, InvalidTransactionError.prototype);
  }
}

/**
 * Union type of all transaction errors.
 */
export type TransactionErrorType =
  | InsufficientFundsError
  | BlockhashExpiredError
  | SimulationFailedError
  | NetworkError
  | SignatureRejectedError
  | AccountNotFoundError
  | ProgramError
  | TransactionTooLargeError
  | InvalidTransactionError;









