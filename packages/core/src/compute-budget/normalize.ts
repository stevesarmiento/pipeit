/**
 * Normalization of caller-supplied ComputeBudget instructions.
 *
 * Callers (and upstream SDKs such as Titan routes) often include their own
 * ComputeBudget instructions. The builder strips them from the instruction
 * list and folds their values into its own compute budget so a message never
 * carries two instructions of the same kind (rejected by the runtime as a
 * duplicate) and a version 1 message keeps its budget in the config block only.
 *
 * Detection mirrors Kit's: program address, exact data length and the
 * discriminator byte. Anything else — unknown discriminators, malformed
 * payloads — passes through untouched.
 *
 * @internal
 */

import type { Instruction } from '@solana/instructions';
import { COMPUTE_BUDGET_PROGRAM } from './priority-fees.js';

const REQUEST_HEAP_FRAME_DISCRIMINATOR = 1;
const SET_COMPUTE_UNIT_LIMIT_DISCRIMINATOR = 2;
const SET_COMPUTE_UNIT_PRICE_DISCRIMINATOR = 3;
const SET_LOADED_ACCOUNTS_DATA_SIZE_LIMIT_DISCRIMINATOR = 4;

/** Discriminator byte + u32 payload. */
const U32_INSTRUCTION_LENGTH = 5;
/** Discriminator byte + u64 payload. */
const U64_INSTRUCTION_LENGTH = 9;

/**
 * Compute budget values found in caller-supplied instructions.
 */
export interface CallerComputeBudgetValues {
    /** From SetComputeUnitLimit (discriminator 2). */
    computeUnitLimit?: number;
    /** From SetComputeUnitPrice (discriminator 3), micro-lamports per CU. */
    computeUnitPriceMicroLamports?: bigint;
    /** From SetLoadedAccountsDataSizeLimit (discriminator 4), bytes. */
    loadedAccountsDataSizeLimit?: number;
    /** From RequestHeapFrame (discriminator 1), bytes. */
    heapSize?: number;
}

export interface ExtractedComputeBudget {
    /** A new array with the recognised ComputeBudget instructions removed. */
    instructions: Instruction[];
    /** Values carried by the removed instructions; the last of a kind wins. */
    callerValues: CallerComputeBudgetValues;
}

function isComputeBudgetInstruction(
    instruction: Instruction,
    discriminator: number,
    expectedDataLength: number,
): instruction is Instruction & { data: Uint8Array } {
    return (
        instruction.programAddress === COMPUTE_BUDGET_PROGRAM &&
        instruction.data != null &&
        instruction.data.byteLength === expectedDataLength &&
        instruction.data[0] === discriminator
    );
}

function dataView(data: Uint8Array): DataView {
    return new DataView(data.buffer, data.byteOffset, data.byteLength);
}

/**
 * Split caller-supplied ComputeBudget instructions out of an instruction list.
 *
 * The input is never mutated.
 */
export function extractComputeBudgetValues(instructions: readonly Instruction[]): ExtractedComputeBudget {
    const remaining: Instruction[] = [];
    const callerValues: CallerComputeBudgetValues = {};

    for (const instruction of instructions) {
        if (isComputeBudgetInstruction(instruction, REQUEST_HEAP_FRAME_DISCRIMINATOR, U32_INSTRUCTION_LENGTH)) {
            callerValues.heapSize = dataView(instruction.data).getUint32(1, true);
        } else if (
            isComputeBudgetInstruction(instruction, SET_COMPUTE_UNIT_LIMIT_DISCRIMINATOR, U32_INSTRUCTION_LENGTH)
        ) {
            callerValues.computeUnitLimit = dataView(instruction.data).getUint32(1, true);
        } else if (
            isComputeBudgetInstruction(instruction, SET_COMPUTE_UNIT_PRICE_DISCRIMINATOR, U64_INSTRUCTION_LENGTH)
        ) {
            callerValues.computeUnitPriceMicroLamports = dataView(instruction.data).getBigUint64(1, true);
        } else if (
            isComputeBudgetInstruction(
                instruction,
                SET_LOADED_ACCOUNTS_DATA_SIZE_LIMIT_DISCRIMINATOR,
                U32_INSTRUCTION_LENGTH,
            )
        ) {
            callerValues.loadedAccountsDataSizeLimit = dataView(instruction.data).getUint32(1, true);
        } else {
            remaining.push(instruction);
        }
    }

    return { instructions: remaining, callerValues };
}
