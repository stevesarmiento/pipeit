/**
 * Translation of Kit errors that only surface with version 1 transactions into
 * actionable Pipeit errors.
 *
 * @packageDocumentation
 */

import {
    isSolanaError,
    SOLANA_ERROR__TRANSACTION__FAILED_TO_ESTIMATE_LOADED_ACCOUNTS_DATA_SIZE_LIMIT,
    SOLANA_ERROR__JSON_RPC__SERVER_ERROR_UNSUPPORTED_TRANSACTION_VERSION,
    SOLANA_ERROR__TRANSACTION_ERROR__UNSUPPORTED_VERSION,
} from '@solana/errors';
import { ResourceLimitEstimationError, TransactionVersionUnsupportedError } from './errors.js';

/**
 * Map Kit/RPC errors that mean "this endpoint cannot handle v1" onto Pipeit
 * errors with a clear message. Any other error is returned unchanged, so this
 * is safe to apply in a catch-all: `throw translateVersionError(error)`.
 *
 * - `SOLANA_ERROR__TRANSACTION__FAILED_TO_ESTIMATE_LOADED_ACCOUNTS_DATA_SIZE_LIMIT`
 *   → {@link ResourceLimitEstimationError} (RPC predates v1 simulation support)
 * - `SOLANA_ERROR__JSON_RPC__SERVER_ERROR_UNSUPPORTED_TRANSACTION_VERSION` and
 *   `SOLANA_ERROR__TRANSACTION_ERROR__UNSUPPORTED_VERSION`
 *   → {@link TransactionVersionUnsupportedError}
 *
 * @param error - Any thrown value
 * @param version - The transaction version being built or sent (default 1)
 */
export function translateVersionError(error: unknown, version: 'legacy' | 0 | 1 = 1): unknown {
    if (isSolanaError(error, SOLANA_ERROR__TRANSACTION__FAILED_TO_ESTIMATE_LOADED_ACCOUNTS_DATA_SIZE_LIMIT)) {
        return new ResourceLimitEstimationError({ cause: error });
    }
    if (
        isSolanaError(error, SOLANA_ERROR__JSON_RPC__SERVER_ERROR_UNSUPPORTED_TRANSACTION_VERSION) ||
        isSolanaError(error, SOLANA_ERROR__TRANSACTION_ERROR__UNSUPPORTED_VERSION)
    ) {
        return new TransactionVersionUnsupportedError(version, { cause: error });
    }
    // Kit wraps simulation failures during estimation; look one level down.
    const cause = (error as { cause?: unknown } | null)?.cause;
    if (cause !== undefined && cause !== error) {
        const translated = translateVersionError(cause, version);
        if (translated !== cause) return translated;
    }
    return error;
}
