/**
 * Tests for collectWritableAccounts.
 */

import { describe, it, expect } from 'vitest';
import { address } from '@solana/addresses';
import { AccountRole, type Instruction } from '@solana/instructions';
import { collectWritableAccounts } from '../writable-accounts.js';

const FEE_PAYER = address('So11111111111111111111111111111111111111112');
const PROGRAM = address('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const A = address('A1111111111111111111111111111111111111111111');
const B = address('B1111111111111111111111111111111111111111111');
const C = address('C1111111111111111111111111111111111111111111');

function ix(accounts: Instruction['accounts']): Instruction {
    return { programAddress: PROGRAM, accounts, data: new Uint8Array() };
}

describe('collectWritableAccounts', () => {
    it('starts with the fee payer even when no instruction mentions it', () => {
        expect(collectWritableAccounts(FEE_PAYER, [])).toEqual([FEE_PAYER]);
        expect(collectWritableAccounts(FEE_PAYER, [ix(undefined)])).toEqual([FEE_PAYER]);
    });

    it('includes writable and writable-signer accounts, skipping readonly ones', () => {
        const accounts = collectWritableAccounts(FEE_PAYER, [
            ix([
                { address: A, role: AccountRole.WRITABLE },
                { address: B, role: AccountRole.READONLY },
                { address: C, role: AccountRole.WRITABLE_SIGNER },
            ]),
        ]);
        expect(accounts).toEqual([FEE_PAYER, A, C]);
    });

    it('de-duplicates across instructions in order of first appearance', () => {
        const accounts = collectWritableAccounts(FEE_PAYER, [
            ix([
                { address: B, role: AccountRole.WRITABLE },
                { address: FEE_PAYER, role: AccountRole.WRITABLE_SIGNER },
            ]),
            ix([
                { address: A, role: AccountRole.WRITABLE },
                { address: B, role: AccountRole.WRITABLE },
            ]),
        ]);
        expect(accounts).toEqual([FEE_PAYER, B, A]);
    });

    it('ignores an account that is readonly in one instruction and writable in another only until it is writable', () => {
        const accounts = collectWritableAccounts(FEE_PAYER, [
            ix([{ address: A, role: AccountRole.READONLY }]),
            ix([{ address: A, role: AccountRole.WRITABLE }]),
        ]);
        expect(accounts).toEqual([FEE_PAYER, A]);
    });
});
