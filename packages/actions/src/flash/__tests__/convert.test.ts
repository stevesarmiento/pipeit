/**
 * Tests for Flash web3.js instruction conversion.
 */

import { PublicKey, TransactionInstruction } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';
import { web3InstructionToKit, web3InstructionsToKit, type Web3InstructionLike } from '../convert.js';
import { InvalidFlashInstructionError } from '../types.js';

const PROGRAM_ID = new PublicKey('11111111111111111111111111111111');
const ACCOUNT_ID = new PublicKey('SysvarRent111111111111111111111111111111111');

describe('web3InstructionToKit', () => {
    it('converts program id', () => {
        const instruction = web3InstructionToKit(
            new TransactionInstruction({
                programId: PROGRAM_ID,
                keys: [],
                data: Buffer.from([]),
            }),
        );

        expect(String(instruction.programAddress)).toBe(PROGRAM_ID.toBase58());
    });

    it.each([
        ['readonly', false, false, 0],
        ['writable', false, true, 1],
        ['readonly signer', true, false, 2],
        ['writable signer', true, true, 3],
    ])('converts %s account role', (_label, isSigner, isWritable, role) => {
        const instruction = web3InstructionToKit(
            new TransactionInstruction({
                programId: PROGRAM_ID,
                keys: [{ pubkey: ACCOUNT_ID, isSigner, isWritable }],
                data: Buffer.from([]),
            }),
        );

        expect(instruction.accounts?.[0]?.role).toBe(role);
        expect(String(instruction.accounts?.[0]?.address)).toBe(ACCOUNT_ID.toBase58());
    });

    it('copies data defensively', () => {
        const data = Buffer.from([1, 2, 3]);
        const instruction = web3InstructionToKit(
            new TransactionInstruction({
                programId: PROGRAM_ID,
                keys: [],
                data,
            }),
        );

        data[0] = 9;

        expect(Array.from(instruction.data ?? [])).toEqual([1, 2, 3]);
    });

    it('throws on missing program id', () => {
        expect(() => web3InstructionToKit({})).toThrow(InvalidFlashInstructionError);
    });

    it('throws on missing account pubkey', () => {
        expect(() =>
            web3InstructionToKit({
                programId: PROGRAM_ID,
                keys: [{ isSigner: false, isWritable: false }],
            } as Web3InstructionLike),
        ).toThrow(InvalidFlashInstructionError);
    });
});

describe('web3InstructionsToKit', () => {
    it('converts multiple instructions', () => {
        const instructions = web3InstructionsToKit([
            new TransactionInstruction({ programId: PROGRAM_ID, keys: [], data: Buffer.from([1]) }),
            new TransactionInstruction({ programId: PROGRAM_ID, keys: [], data: Buffer.from([2]) }),
        ]);

        expect(instructions).toHaveLength(2);
        expect(Array.from(instructions[1]?.data ?? [])).toEqual([2]);
    });
});
