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
        public readonly account?: string,
    ) {
        super(`Insufficient funds: required ${required.toString()}, available ${available.toString()}`);
        this.name = 'InsufficientFundsError';
        Object.setPrototypeOf(this, InsufficientFundsError.prototype);
    }
}

/**
 * Error thrown when transaction size exceeds the limit for its version
 * (1232 bytes for legacy/v0, 4096 bytes for v1).
 * Pipeit-specific validation error.
 */
export class TransactionTooLargeError extends Error {
    constructor(
        public readonly size: number,
        public readonly maxSize: number,
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
 * Error thrown when the RPC node or cluster does not support the requested
 * transaction version. Version 1 (SIMD-0385) transactions require Agave 4.2.2+
 * RPC nodes and a cluster with the `enable_tx_v1` feature active.
 */
export class TransactionVersionUnsupportedError extends Error {
    constructor(
        public readonly version: 'legacy' | 0 | 1,
        options?: { cause?: unknown },
    ) {
        super(
            `Transaction version ${String(version)} is not supported by this RPC node or cluster. ` +
                'Version 1 transactions require Agave 4.2.2+ RPC nodes and a cluster with SIMD-0385 active. ' +
                'Use version: 0 or point at an upgraded endpoint.',
            options,
        );
        this.name = 'TransactionVersionUnsupportedError';
        Object.setPrototypeOf(this, TransactionVersionUnsupportedError.prototype);
    }
}

/**
 * Error thrown when resource limits for a version 1 transaction could not be
 * estimated because the RPC node did not report `loadedAccountsDataSize` from
 * `simulateTransaction`. v1 transactions fail on-chain without an explicit
 * loaded accounts data size limit, so estimation cannot silently proceed.
 */
export class ResourceLimitEstimationError extends Error {
    constructor(options?: { cause?: unknown }) {
        super(
            'RPC node did not return loadedAccountsDataSize from simulateTransaction; version 1 transactions ' +
                'need it to set loadedAccountsDataSizeLimit. Upgrade the RPC node to Agave 4.2.2+ or set ' +
                'loadedAccountsDataSizeLimit explicitly in the builder config.',
            options,
        );
        this.name = 'ResourceLimitEstimationError';
        Object.setPrototypeOf(this, ResourceLimitEstimationError.prototype);
    }
}

/**
 * Union type of Pipeit-specific transaction errors.
 */
export type PipeitErrorType =
    | InsufficientFundsError
    | TransactionTooLargeError
    | SignatureRejectedError
    | AccountNotFoundError
    | TransactionVersionUnsupportedError
    | ResourceLimitEstimationError;
