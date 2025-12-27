/**
 * Tests for Metis conversion utilities.
 */

import { describe, it, expect } from 'vitest';
import {
    decodeBase64,
    metisInstructionToKit,
    metisInstructionsToKit,
    metisLookupTablesToAddresses,
} from '../convert.js';
import type { MetisInstruction, AccountMeta } from '../types.js';

describe('decodeBase64', () => {
    it('should decode empty string to empty array', () => {
        const result = decodeBase64('');
        expect(result).toEqual(new Uint8Array([]));
    });

    it('should decode simple base64', () => {
        // 'AQID' is base64 for bytes [1, 2, 3]
        const result = decodeBase64('AQID');
        expect(result).toEqual(new Uint8Array([1, 2, 3]));
    });

    it('should decode longer base64 strings', () => {
        // 'SGVsbG8gV29ybGQ=' is base64 for 'Hello World'
        const result = decodeBase64('SGVsbG8gV29ybGQ=');
        expect(result).toEqual(new Uint8Array([72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100]));
    });

    it('should handle base64 with padding', () => {
        // 'YQ==' is base64 for 'a' (single byte)
        const result = decodeBase64('YQ==');
        expect(result).toEqual(new Uint8Array([97]));
    });
});

describe('metisInstructionToKit', () => {
    it('should convert a simple instruction', () => {
        const metisIx: MetisInstruction = {
            programId: '11111111111111111111111111111111',
            accounts: [],
            data: 'AQIDBA==', // [1, 2, 3, 4]
        };

        const kitIx = metisInstructionToKit(metisIx);

        expect(kitIx.programAddress).toBe('11111111111111111111111111111111');
        expect(kitIx.accounts).toEqual([]);
        expect(kitIx.data).toEqual(new Uint8Array([1, 2, 3, 4]));
    });

    it('should convert instruction with accounts and correct roles', () => {
        const readonlyAccount: AccountMeta = {
            pubkey: '11111111111111111111111111111111',
            isSigner: false,
            isWritable: false,
        };
        const readonlySignerAccount: AccountMeta = {
            pubkey: '11111111111111111111111111111111',
            isSigner: true,
            isWritable: false,
        };
        const writableAccount: AccountMeta = {
            pubkey: '11111111111111111111111111111111',
            isSigner: false,
            isWritable: true,
        };
        const writableSignerAccount: AccountMeta = {
            pubkey: '11111111111111111111111111111111',
            isSigner: true,
            isWritable: true,
        };

        const metisIx: MetisInstruction = {
            programId: '11111111111111111111111111111111',
            accounts: [
                readonlyAccount,
                readonlySignerAccount,
                writableAccount,
                writableSignerAccount,
            ],
            data: '',
        };

        const kitIx = metisInstructionToKit(metisIx);

        expect(kitIx.accounts).toHaveLength(4);

        // READONLY (role 0)
        expect(kitIx.accounts[0].role).toBe(0);
        // READONLY_SIGNER (role 2)
        expect(kitIx.accounts[1].role).toBe(2);
        // WRITABLE (role 1)
        expect(kitIx.accounts[2].role).toBe(1);
        // WRITABLE_SIGNER (role 3)
        expect(kitIx.accounts[3].role).toBe(3);
    });

    it('should convert instruction with real-looking addresses', () => {
        const metisIx: MetisInstruction = {
            programId: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
            accounts: [
                {
                    pubkey: 'So11111111111111111111111111111111111111112',
                    isSigner: false,
                    isWritable: true,
                },
            ],
            data: 'AQID',
        };

        const kitIx = metisInstructionToKit(metisIx);

        expect(kitIx.programAddress).toBe('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4');
        expect(kitIx.accounts[0].address).toBe('So11111111111111111111111111111111111111112');
        expect(kitIx.accounts[0].role).toBe(1); // WRITABLE
    });
});

describe('metisInstructionsToKit', () => {
    it('should convert empty array', () => {
        expect(metisInstructionsToKit([])).toEqual([]);
    });

    it('should convert multiple instructions', () => {
        const instructions: MetisInstruction[] = [
            {
                programId: '11111111111111111111111111111111',
                accounts: [],
                data: 'AQ==', // [1]
            },
            {
                programId: '11111111111111111111111111111111',
                accounts: [],
                data: 'Ag==', // [2]
            },
        ];

        const result = metisInstructionsToKit(instructions);

        expect(result).toHaveLength(2);
        expect(result[0].data).toEqual(new Uint8Array([1]));
        expect(result[1].data).toEqual(new Uint8Array([2]));
    });
});

describe('metisLookupTablesToAddresses', () => {
    it('should convert empty array', () => {
        expect(metisLookupTablesToAddresses([])).toEqual([]);
    });

    it('should convert address strings to Kit addresses', () => {
        const addresses = [
            'AddressLookupTab1e1111111111111111111111111',
            'AddressLookupTab1e2222222222222222222222222',
        ];

        const result = metisLookupTablesToAddresses(addresses);

        expect(result).toHaveLength(2);
        expect(result[0]).toBe('AddressLookupTab1e1111111111111111111111111');
        expect(result[1]).toBe('AddressLookupTab1e2222222222222222222222222');
    });
});
