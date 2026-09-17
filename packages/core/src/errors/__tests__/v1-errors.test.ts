/**
 * Tests for version 1 error translation and diagnostics.
 */

import { describe, it, expect } from 'vitest';
import {
    SolanaError,
    SOLANA_ERROR__TRANSACTION__FAILED_TO_ESTIMATE_LOADED_ACCOUNTS_DATA_SIZE_LIMIT,
    SOLANA_ERROR__JSON_RPC__SERVER_ERROR_UNSUPPORTED_TRANSACTION_VERSION,
    SOLANA_ERROR__TRANSACTION_ERROR__UNSUPPORTED_VERSION,
    SOLANA_ERROR__TRANSACTION_ERROR__MAX_LOADED_ACCOUNTS_DATA_SIZE_EXCEEDED,
    SOLANA_ERROR__BLOCK_HEIGHT_EXCEEDED,
} from '@solana/errors';
import {
    translateVersionError,
    ResourceLimitEstimationError,
    TransactionVersionUnsupportedError,
    isPipeitError,
    isResourceLimitEstimationError,
    isTransactionVersionUnsupportedError,
    getErrorMessage,
    diagnoseError,
} from '../index.js';

describe('translateVersionError', () => {
    it('maps a missing loadedAccountsDataSize estimate to ResourceLimitEstimationError', () => {
        const kitError = new SolanaError(SOLANA_ERROR__TRANSACTION__FAILED_TO_ESTIMATE_LOADED_ACCOUNTS_DATA_SIZE_LIMIT);
        const translated = translateVersionError(kitError);

        expect(translated).toBeInstanceOf(ResourceLimitEstimationError);
        expect((translated as Error).cause).toBe(kitError);
        expect((translated as Error).message).toMatch(/Agave 4\.2\.2\+/);
    });

    it('maps RPC and runtime "unsupported version" codes to TransactionVersionUnsupportedError', () => {
        for (const code of [
            SOLANA_ERROR__JSON_RPC__SERVER_ERROR_UNSUPPORTED_TRANSACTION_VERSION,
            SOLANA_ERROR__TRANSACTION_ERROR__UNSUPPORTED_VERSION,
        ] as const) {
            const kitError = new SolanaError(code as any);
            const translated = translateVersionError(kitError, 1);
            expect(translated).toBeInstanceOf(TransactionVersionUnsupportedError);
            expect((translated as TransactionVersionUnsupportedError).version).toBe(1);
            expect((translated as Error).cause).toBe(kitError);
        }
    });

    it('looks through a wrapping error cause', () => {
        const inner = new SolanaError(SOLANA_ERROR__TRANSACTION_ERROR__UNSUPPORTED_VERSION);
        const wrapped = new Error('send failed', { cause: inner });
        expect(translateVersionError(wrapped)).toBeInstanceOf(TransactionVersionUnsupportedError);
    });

    it('returns unrelated errors unchanged', () => {
        const other = new SolanaError(SOLANA_ERROR__BLOCK_HEIGHT_EXCEEDED, {
            currentBlockHeight: 1n,
            lastValidBlockHeight: 0n,
        });
        expect(translateVersionError(other)).toBe(other);
        const plain = new Error('boom');
        expect(translateVersionError(plain)).toBe(plain);
        expect(translateVersionError(undefined)).toBeUndefined();
    });
});

describe('predicates and messages', () => {
    it('recognises the new errors as Pipeit errors', () => {
        const a = new ResourceLimitEstimationError();
        const b = new TransactionVersionUnsupportedError(1);
        expect(isPipeitError(a)).toBe(true);
        expect(isPipeitError(b)).toBe(true);
        expect(isResourceLimitEstimationError(a)).toBe(true);
        expect(isTransactionVersionUnsupportedError(b)).toBe(true);
        expect(isResourceLimitEstimationError(b)).toBe(false);
        expect(getErrorMessage(a)).toBe(a.message);
        expect(getErrorMessage(b)).toContain('version 1');
    });
});

describe('diagnoseError for version 1 failures', () => {
    it('categorises unsupported version', () => {
        const diagnosis = diagnoseError(
            new SolanaError(SOLANA_ERROR__JSON_RPC__SERVER_ERROR_UNSUPPORTED_TRANSACTION_VERSION as any),
        );
        expect(diagnosis.category).toBe('unsupported_version');
        expect(diagnosis.suggestion).toMatch(/version: 0/);

        expect(diagnoseError(new TransactionVersionUnsupportedError(1)).category).toBe('unsupported_version');
    });

    it('categorises failed loaded-accounts-data-size estimation', () => {
        const diagnosis = diagnoseError(
            new SolanaError(SOLANA_ERROR__TRANSACTION__FAILED_TO_ESTIMATE_LOADED_ACCOUNTS_DATA_SIZE_LIMIT),
        );
        expect(diagnosis.category).toBe('resource_limit_estimation');
        expect(diagnoseError(new ResourceLimitEstimationError()).category).toBe('resource_limit_estimation');
    });

    it('categorises a loaded-accounts-data-size limit that was too low', () => {
        const diagnosis = diagnoseError(
            new SolanaError(SOLANA_ERROR__TRANSACTION_ERROR__MAX_LOADED_ACCOUNTS_DATA_SIZE_EXCEEDED as any),
        );
        expect(diagnosis.category).toBe('resource_limit_exceeded');
        expect(diagnosis.suggestion).toMatch(/loadedAccountsDataSizeLimit/);
    });
});
