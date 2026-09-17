/**
 * Tests for version-aware transaction size validation.
 */

import { describe, it, expect } from 'vitest';
import { pipe } from '@solana/functional';
import { address } from '@solana/addresses';
import type { Instruction } from '@solana/instructions';
import {
    createTransactionMessage,
    setTransactionMessageFeePayer,
    setTransactionMessageLifetimeUsingBlockhash,
    appendTransactionMessageInstructions,
    type TransactionVersion,
} from '@solana/transaction-messages';
import {
    validateTransactionSize,
    getTransactionSizeInfo,
    LEGACY_TRANSACTION_SIZE_LIMIT,
    V1_TRANSACTION_SIZE_LIMIT,
    TRANSACTION_SIZE_LIMIT,
    MAX_TRANSACTION_SIZE,
} from '../validation.js';
import { TransactionTooLargeError } from '../../errors/index.js';

const FEE_PAYER = address('So11111111111111111111111111111111111111112');
const MEMO_PROGRAM = address('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const BLOCKHASH = { blockhash: '11111111111111111111111111111111' as never, lastValidBlockHeight: 100n };

/** A single memo instruction carrying `dataBytes` bytes of payload. */
function memo(dataBytes: number): Instruction {
    return { programAddress: MEMO_PROGRAM, data: new Uint8Array(dataBytes).fill(1) };
}

function createMessage(version: TransactionVersion, instructions: Instruction[]) {
    return pipe(
        createTransactionMessage({ version }),
        tx => setTransactionMessageFeePayer(FEE_PAYER, tx),
        tx => setTransactionMessageLifetimeUsingBlockhash(BLOCKHASH, tx),
        tx => appendTransactionMessageInstructions(instructions, tx),
    );
}

describe('size limit constants', () => {
    it('exposes the version-specific limits and keeps the deprecated alias on the legacy value', () => {
        expect(LEGACY_TRANSACTION_SIZE_LIMIT).toBe(1232);
        expect(V1_TRANSACTION_SIZE_LIMIT).toBe(4096);
        expect(TRANSACTION_SIZE_LIMIT).toBe(1232);
        expect(MAX_TRANSACTION_SIZE).toBe(1232);
    });
});

describe('validateTransactionSize', () => {
    // ~2000 bytes of instruction data: over the legacy/v0 limit, well under v1's.
    const LARGE = [memo(2000)];

    it('accepts a ~2 KB message on version 1', () => {
        expect(() => validateTransactionSize(createMessage(1, LARGE))).not.toThrow();
    });

    it('rejects the same message on version 0 with the legacy limit', () => {
        let caught: unknown;
        try {
            validateTransactionSize(createMessage(0, LARGE));
        } catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(TransactionTooLargeError);
        expect((caught as TransactionTooLargeError).maxSize).toBe(1232);
        expect((caught as TransactionTooLargeError).size).toBeGreaterThan(1232);
    });

    it('rejects the same message on legacy', () => {
        expect(() => validateTransactionSize(createMessage('legacy', LARGE))).toThrow(TransactionTooLargeError);
    });

    it('rejects a message over 4096 bytes on version 1 with the v1 limit', () => {
        let caught: unknown;
        try {
            validateTransactionSize(createMessage(1, [memo(4200)]));
        } catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(TransactionTooLargeError);
        expect((caught as TransactionTooLargeError).maxSize).toBe(4096);
    });

    it('accepts a small message on every version', () => {
        for (const version of [0, 'legacy', 1] as const) {
            expect(() => validateTransactionSize(createMessage(version, [memo(10)]))).not.toThrow();
        }
    });
});

describe('getTransactionSizeInfo', () => {
    it('reports the limit for the message version', () => {
        const v0 = getTransactionSizeInfo(createMessage(0, [memo(10)]));
        expect(v0.limit).toBe(1232);
        expect(v0.version).toBe(0);
        expect(v0.remaining).toBe(1232 - v0.size);

        const v1 = getTransactionSizeInfo(createMessage(1, [memo(10)]));
        expect(v1.limit).toBe(4096);
        expect(v1.version).toBe(1);
        expect(v1.remaining).toBe(4096 - v1.size);
        expect(v1.percentUsed).toBeCloseTo((v1.size / 4096) * 100);
    });
});
