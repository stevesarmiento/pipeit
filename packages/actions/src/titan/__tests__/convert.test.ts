/**
 * Tests for Titan conversion utilities.
 */

import { describe, it, expect } from 'vitest';
import { encodeBase58, titanPubkeyToAddress, titanInstructionToKit, titanPubkeysToAddresses } from '../convert.js';
import type { TitanInstruction, TitanAccountMeta } from '../types.js';

describe('encodeBase58', () => {
    it('should encode empty bytes to empty string', () => {
        expect(encodeBase58(new Uint8Array([]))).toBe('');
    });

    it('should encode all zeros to leading ones', () => {
        // 32 zeros should become 32 ones (the minimum Solana address)
        const zeros = new Uint8Array(32);
        const result = encodeBase58(zeros);
        expect(result).toBe('11111111111111111111111111111111');
    });

    it('should encode system program address correctly', () => {
        // System program: 11111111111111111111111111111111
        // This is 32 bytes of 0x00
        const systemProgram = new Uint8Array(32);
        expect(encodeBase58(systemProgram)).toBe('11111111111111111111111111111111');
    });

    it('should encode non-zero bytes correctly', () => {
        // A simple test case: [1] should encode to '2' (second character in base58)
        expect(encodeBase58(new Uint8Array([1]))).toBe('2');

        // [58] should encode to '21' (58 in base58 is 1*58 + 0 = '21')
        expect(encodeBase58(new Uint8Array([58]))).toBe('21');
    });

    it('should handle leading zeros followed by data', () => {
        // [0, 1] should be '12' (one leading 1, then 2)
        expect(encodeBase58(new Uint8Array([0, 1]))).toBe('12');

        // [0, 0, 1] should be '112'
        expect(encodeBase58(new Uint8Array([0, 0, 1]))).toBe('112');
    });
});

describe('titanPubkeyToAddress', () => {
    it('should convert 32-byte pubkey to base58 address', () => {
        // System program
        const pubkey = new Uint8Array(32);
        const address = titanPubkeyToAddress(pubkey);
        expect(address).toBe('11111111111111111111111111111111');
    });

    it('should return a valid Kit Address type', () => {
        const pubkey = new Uint8Array(32);
        const address = titanPubkeyToAddress(pubkey);
        // Address is a branded string type, should be usable as string
        expect(typeof address).toBe('string');
        expect(address.length).toBe(32); // System program is exactly 32 chars
    });
});

describe('titanInstructionToKit', () => {
    it('should convert a simple instruction', () => {
        const titanIx: TitanInstruction = {
            p: new Uint8Array(32), // System program
            a: [],
            d: new Uint8Array([1, 2, 3, 4]),
        };

        const kitIx = titanInstructionToKit(titanIx);

        expect(kitIx.programAddress).toBe('11111111111111111111111111111111');
        expect(kitIx.accounts).toEqual([]);
        expect(kitIx.data).toEqual(new Uint8Array([1, 2, 3, 4]));
    });

    it('should convert instruction with accounts', () => {
        const account1: TitanAccountMeta = {
            p: new Uint8Array(32),
            s: false,
            w: false,
        };
        const account2: TitanAccountMeta = {
            p: new Uint8Array(32),
            s: true,
            w: false,
        };
        const account3: TitanAccountMeta = {
            p: new Uint8Array(32),
            s: false,
            w: true,
        };
        const account4: TitanAccountMeta = {
            p: new Uint8Array(32),
            s: true,
            w: true,
        };

        const titanIx: TitanInstruction = {
            p: new Uint8Array(32),
            a: [account1, account2, account3, account4],
            d: new Uint8Array([]),
        };

        const kitIx = titanInstructionToKit(titanIx);

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
});

describe('titanPubkeysToAddresses', () => {
    it('should convert empty array', () => {
        expect(titanPubkeysToAddresses([])).toEqual([]);
    });

    it('should convert multiple pubkeys', () => {
        const pubkeys = [new Uint8Array(32), new Uint8Array(32)];
        const addresses = titanPubkeysToAddresses(pubkeys);

        expect(addresses).toHaveLength(2);
        expect(addresses[0]).toBe('11111111111111111111111111111111');
        expect(addresses[1]).toBe('11111111111111111111111111111111');
    });
});
