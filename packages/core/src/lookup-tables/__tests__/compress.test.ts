/**
 * Tests for lookup-table compression guards.
 *
 * These lock in the v1 (Alpenglow) hazard fix: address lookup tables only
 * apply to v0 transactions. Legacy predates them and v1 does not support
 * them, so both must pass through compression untouched.
 */

import { describe, it, expect } from 'vitest';
import { pipe } from '@solana/functional';
import { address } from '@solana/addresses';
import { AccountRole } from '@solana/instructions';
import {
    createTransactionMessage,
    setTransactionMessageFeePayer,
    appendTransactionMessageInstruction,
    type TransactionMessage,
} from '@solana/transaction-messages';
import { compressTransactionMessage, calculateLookupTableSavings } from '../compress.js';
import type { AddressesByLookupTableAddress } from '../types.js';

const FEE_PAYER = address('So11111111111111111111111111111111111111112');
const PROGRAM = address('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const ACCOUNT_A = address('SysvarRent111111111111111111111111111111111');
const ACCOUNT_B = address('Vote111111111111111111111111111111111111111');
const LOOKUP_TABLE = address('Stake11111111111111111111111111111111111111');

const LOOKUP_TABLES: AddressesByLookupTableAddress = {
    [LOOKUP_TABLE]: [ACCOUNT_A, ACCOUNT_B],
};

function createMessage(version: 0 | 'legacy') {
    return pipe(
        createTransactionMessage({ version }),
        tx => setTransactionMessageFeePayer(FEE_PAYER, tx),
        tx =>
            appendTransactionMessageInstruction(
                {
                    programAddress: PROGRAM,
                    accounts: [
                        { address: ACCOUNT_A, role: AccountRole.READONLY },
                        { address: ACCOUNT_B, role: AccountRole.WRITABLE },
                    ],
                    data: new Uint8Array([1]),
                },
                tx,
            ),
    );
}

/** v1 messages cannot be created via Kit 7.0.0's public API; shape one by hand. */
function createV1ShapedMessage(): TransactionMessage {
    const v0 = createMessage(0);
    return { ...v0, version: 1 } as unknown as TransactionMessage;
}

describe('compressTransactionMessage', () => {
    it('compresses v0 messages using the provided lookup tables', () => {
        const compressed = compressTransactionMessage(createMessage(0), LOOKUP_TABLES);

        const accounts = compressed.instructions[0]!.accounts!;
        const lookupMetas = accounts.filter(account => 'lookupTableAddress' in account);
        expect(lookupMetas.length).toBeGreaterThan(0);
        for (const meta of lookupMetas) {
            expect((meta as { lookupTableAddress: string }).lookupTableAddress).toBe(LOOKUP_TABLE);
        }
    });

    it('returns legacy messages unchanged by reference', () => {
        const message = createMessage('legacy');
        expect(compressTransactionMessage(message, LOOKUP_TABLES)).toBe(message);
    });

    it('returns v1 messages unchanged by reference (v1 has no ALT support)', () => {
        const message = createV1ShapedMessage();
        expect(compressTransactionMessage(message, LOOKUP_TABLES)).toBe(message);
    });
});

describe('calculateLookupTableSavings', () => {
    it('reports zero savings for legacy messages', () => {
        expect(calculateLookupTableSavings(createMessage('legacy'), LOOKUP_TABLES)).toEqual({
            accountsConvertible: 0,
            bytesSaved: 0,
            lookupTablesUsed: 0,
        });
    });

    it('reports zero savings for v1 messages', () => {
        expect(calculateLookupTableSavings(createV1ShapedMessage(), LOOKUP_TABLES)).toEqual({
            accountsConvertible: 0,
            bytesSaved: 0,
            lookupTablesUsed: 0,
        });
    });

    it('reports correct savings for v0 messages', () => {
        const savings = calculateLookupTableSavings(createMessage(0), LOOKUP_TABLES);

        // 2 convertible accounts x 31 bytes saved - 1 table x 34 bytes overhead = 28
        expect(savings).toEqual({
            accountsConvertible: 2,
            bytesSaved: 28,
            lookupTablesUsed: 1,
        });
    });
});
