/**
 * Tests for Phoenix instruction conversion.
 */

import { describe, expect, it } from 'vitest';
import { InvalidPhoenixInstructionError } from '../types.js';
import { riseInstructionToKit, riseInstructionsToKit, type RiseInstructionLike } from '../convert.js';

const PROGRAM_ADDRESS = '11111111111111111111111111111111';
const ACCOUNT_ADDRESS = 'SysvarRent111111111111111111111111111111111';

describe('riseInstructionToKit', () => {
    it('converts programAddress', () => {
        const instruction = riseInstructionToKit({
            programAddress: PROGRAM_ADDRESS,
            accounts: [],
            data: new Uint8Array(),
        });

        expect(String(instruction.programAddress)).toBe(PROGRAM_ADDRESS);
    });

    it.each([
        ['readonly', 0],
        ['writable', 1],
        ['readonly signer', 2],
        ['writable signer', 3],
    ])('converts %s account role', (_label, role) => {
        const instruction = riseInstructionToKit({
            programAddress: PROGRAM_ADDRESS,
            accounts: [{ address: ACCOUNT_ADDRESS, role }],
        });

        expect(instruction.accounts?.[0]?.role).toBe(role);
        expect(String(instruction.accounts?.[0]?.address)).toBe(ACCOUNT_ADDRESS);
    });

    it('copies Uint8Array data defensively', () => {
        const data = new Uint8Array([1, 2, 3]);
        const instruction = riseInstructionToKit({
            programAddress: PROGRAM_ADDRESS,
            data,
        });

        data[0] = 9;

        expect(Array.from(instruction.data ?? [])).toEqual([1, 2, 3]);
    });

    it('defaults missing accounts to an empty array', () => {
        const instruction = riseInstructionToKit({ programAddress: PROGRAM_ADDRESS });

        expect(instruction.accounts).toEqual([]);
    });

    it('defaults missing data to an empty Uint8Array', () => {
        const instruction = riseInstructionToKit({ programAddress: PROGRAM_ADDRESS });

        expect(instruction.data).toEqual(new Uint8Array());
    });

    it('throws on missing programAddress', () => {
        expect(() => riseInstructionToKit({})).toThrow(InvalidPhoenixInstructionError);
    });

    it('throws on account with missing address', () => {
        const instruction = {
            programAddress: PROGRAM_ADDRESS,
            accounts: [{ role: 0 }],
        } as RiseInstructionLike;

        expect(() => riseInstructionToKit(instruction)).toThrow(InvalidPhoenixInstructionError);
    });
});

describe('riseInstructionsToKit', () => {
    it('converts multiple instructions', () => {
        const instructions = riseInstructionsToKit([
            { programAddress: PROGRAM_ADDRESS, data: [1] },
            { programAddress: PROGRAM_ADDRESS, data: [2] },
        ]);

        expect(instructions).toHaveLength(2);
        expect(Array.from(instructions[1]?.data ?? [])).toEqual([2]);
    });
});
