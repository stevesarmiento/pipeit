/**
 * Tests for caller-supplied ComputeBudget instruction extraction.
 */

import { describe, it, expect } from 'vitest';
import { address } from '@solana/addresses';
import type { Instruction } from '@solana/instructions';
import { extractComputeBudgetValues } from '../normalize.js';
import { COMPUTE_BUDGET_PROGRAM } from '../priority-fees.js';

const MEMO_PROGRAM = address('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

const USER_INSTRUCTION: Instruction = {
    programAddress: MEMO_PROGRAM,
    data: new Uint8Array([104, 105]),
};

function u32Instruction(discriminator: number, value: number): Instruction {
    const data = new Uint8Array(5);
    data[0] = discriminator;
    new DataView(data.buffer).setUint32(1, value, true);
    return { programAddress: COMPUTE_BUDGET_PROGRAM, data };
}

function u64Instruction(discriminator: number, value: bigint): Instruction {
    const data = new Uint8Array(9);
    data[0] = discriminator;
    new DataView(data.buffer).setBigUint64(1, value, true);
    return { programAddress: COMPUTE_BUDGET_PROGRAM, data };
}

const heapIx = (bytes: number) => u32Instruction(1, bytes);
const limitIx = (units: number) => u32Instruction(2, units);
const priceIx = (microLamports: bigint) => u64Instruction(3, microLamports);
const ladsIx = (bytes: number) => u32Instruction(4, bytes);

describe('extractComputeBudgetValues', () => {
    it('returns empty values and an empty list for empty input', () => {
        expect(extractComputeBudgetValues([])).toEqual({ instructions: [], callerValues: {} });
    });

    it('decodes each ComputeBudget instruction kind and removes it', () => {
        const { instructions, callerValues } = extractComputeBudgetValues([
            heapIx(262_144),
            limitIx(287_202),
            priceIx(12_345_678_901n),
            ladsIx(6_488_064),
            USER_INSTRUCTION,
        ]);

        expect(instructions).toEqual([USER_INSTRUCTION]);
        expect(callerValues).toEqual({
            heapSize: 262_144,
            computeUnitLimit: 287_202,
            computeUnitPriceMicroLamports: 12_345_678_901n,
            loadedAccountsDataSizeLimit: 6_488_064,
        });
    });

    it('keeps the last value when the caller supplied several of a kind', () => {
        const { instructions, callerValues } = extractComputeBudgetValues([
            limitIx(100_000),
            USER_INSTRUCTION,
            limitIx(300_000),
        ]);

        expect(instructions).toEqual([USER_INSTRUCTION]);
        expect(callerValues.computeUnitLimit).toBe(300_000);
    });

    it('passes through ComputeBudget instructions with unknown discriminators or wrong lengths', () => {
        const unknown: Instruction = { programAddress: COMPUTE_BUDGET_PROGRAM, data: new Uint8Array([5, 0, 0, 0, 0]) };
        const truncatedLimit: Instruction = { programAddress: COMPUTE_BUDGET_PROGRAM, data: new Uint8Array([2, 1, 2]) };
        const noData: Instruction = { programAddress: COMPUTE_BUDGET_PROGRAM };

        const { instructions, callerValues } = extractComputeBudgetValues([
            unknown,
            truncatedLimit,
            noData,
            USER_INSTRUCTION,
        ]);

        expect(instructions).toEqual([unknown, truncatedLimit, noData, USER_INSTRUCTION]);
        expect(callerValues).toEqual({});
    });

    it('ignores instructions of other programs with matching bytes', () => {
        const lookalike: Instruction = { programAddress: MEMO_PROGRAM, data: limitIx(1).data };
        const { instructions, callerValues } = extractComputeBudgetValues([lookalike]);

        expect(instructions).toEqual([lookalike]);
        expect(callerValues).toEqual({});
    });

    it('does not mutate the input array', () => {
        const input = [limitIx(1), USER_INSTRUCTION];
        const snapshot = [...input];

        extractComputeBudgetValues(input);

        expect(input).toEqual(snapshot);
    });
});
