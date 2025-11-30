/**
 * Pipeit-specific error definitions for transaction building.
 *
 * For general Solana errors, use Kit's @solana/errors.
 * These errors are specific to Pipeit's builder functionality.
 *
 * @packageDocumentation
 */

/**
 * Error thrown when account has insufficient funds for a transaction.
 * Builder-specific helper for checking account balances.
 */
export class InsufficientFundsError extends Error {
  constructor(
    public readonly required: bigint,
    public readonly available: bigint,
    public readonly account?: string
  ) {
    super(
      `Insufficient funds: required ${required.toString()}, available ${available.toString()}`
    );
    this.name = 'InsufficientFundsError';
    Object.setPrototypeOf(this, InsufficientFundsError.prototype);
  }
}

/**
 * Error thrown when transaction size exceeds the Solana limit (1232 bytes).
 * Pipeit-specific validation error.
 */
export class TransactionTooLargeError extends Error {
  constructor(
    public readonly size: number,
    public readonly maxSize: number
  ) {
    super(`Transaction too large: ${size} bytes (max: ${maxSize} bytes)`);
    this.name = 'TransactionTooLargeError';
    Object.setPrototypeOf(this, TransactionTooLargeError.prototype);
  }
}

/**
 * Error thrown when user rejects transaction signature.
 * Wallet interaction wrapper.
 */
export class SignatureRejectedError extends Error {
  constructor(public readonly reason?: string) {
    super(`Transaction signature rejected${reason ? `: ${reason}` : ''}`);
    this.name = 'SignatureRejectedError';
    Object.setPrototypeOf(this, SignatureRejectedError.prototype);
  }
}

/**
 * Error thrown when account is not found during IDL/account resolution.
 * IDL account resolution helper.
 */
export class AccountNotFoundError extends Error {
  constructor(public readonly account: string) {
    super(`Account not found: ${account}`);
    this.name = 'AccountNotFoundError';
    Object.setPrototypeOf(this, AccountNotFoundError.prototype);
  }
}

/**
 * Union type of Pipeit-specific transaction errors.
 */
export type PipeitErrorType =
  | InsufficientFundsError
  | TransactionTooLargeError
  | SignatureRejectedError
  | AccountNotFoundError;
