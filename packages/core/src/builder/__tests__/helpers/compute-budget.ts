/**
 * Shared fixtures for the priority-fee and compute-budget builder suites.
 * Mirrors the helpers in builder-caller-compute-budget.test.ts.
 */

import { expect } from 'vitest';
import { address } from '@solana/addresses';
import type { Instruction } from '@solana/instructions';
import { TransactionBuilder } from '../../builder.js';
import type { RequiredState } from '../../../types.js';
import { COMPUTE_BUDGET_PROGRAM } from '../../../compute-budget/index.js';

export const FEE_PAYER = address('So11111111111111111111111111111111111111112');
export const MEMO_PROGRAM = address('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
export const BLOCKHASH = '11111111111111111111111111111111' as never;
export const LAST_VALID_BLOCK_HEIGHT = 100n;

export const USER_INSTRUCTION: Instruction = {
    programAddress: MEMO_PROGRAM,
    data: new Uint8Array([104, 105]),
};

/** Discriminators of the ComputeBudget program instructions. */
export const REQUEST_HEAP_FRAME = 1;
export const SET_COMPUTE_UNIT_LIMIT = 2;
export const SET_COMPUTE_UNIT_PRICE = 3;
export const SET_LOADED_ACCOUNTS_DATA_SIZE_LIMIT = 4;

export type BuiltMessage = {
    version: number;
    instructions: readonly Instruction[];
    config?: {
        computeUnitLimit?: number;
        heapSize?: number;
        loadedAccountsDataSizeLimit?: number;
        priorityFeeLamports?: bigint;
    };
};

export type BuilderConfig = ConstructorParameters<typeof TransactionBuilder>[0];

export function u32Instruction(discriminator: number, value: number): Instruction {
    const data = new Uint8Array(5);
    data[0] = discriminator;
    new DataView(data.buffer).setUint32(1, value, true);
    return { programAddress: COMPUTE_BUDGET_PROGRAM, data };
}

export function u64Instruction(discriminator: number, value: bigint): Instruction {
    const data = new Uint8Array(9);
    data[0] = discriminator;
    new DataView(data.buffer).setBigUint64(1, value, true);
    return { programAddress: COMPUTE_BUDGET_PROGRAM, data };
}

export const callerHeapIx = (bytes: number) => u32Instruction(REQUEST_HEAP_FRAME, bytes);
export const callerLimitIx = (units: number) => u32Instruction(SET_COMPUTE_UNIT_LIMIT, units);
export const callerPriceIx = (microLamports: bigint) => u64Instruction(SET_COMPUTE_UNIT_PRICE, microLamports);
export const callerLadsIx = (bytes: number) => u32Instruction(SET_LOADED_ACCOUNTS_DATA_SIZE_LIMIT, bytes);

export function makeBuilder(
    config: BuilderConfig,
    instructions: readonly Instruction[],
): TransactionBuilder<RequiredState> {
    return new TransactionBuilder(config)
        .setFeePayer(FEE_PAYER)
        .setBlockhashLifetime(BLOCKHASH, LAST_VALID_BLOCK_HEIGHT)
        .addInstructions(instructions);
}

export function build(config: BuilderConfig, instructions: readonly Instruction[]) {
    return makeBuilder(config, instructions).build() as Promise<BuiltMessage>;
}

export function buildWithBudget(config: BuilderConfig, instructions: readonly Instruction[]) {
    return makeBuilder(config, instructions).buildWithBudget();
}

/**
 * An rpc stub whose simulation reports the given units consumed (for v1
 * estimation) and whose recent prioritization fees are `recentFees`.
 */
export function stubRpc(options: { unitsConsumed?: bigint; recentFees?: bigint[]; calls?: string[] } = {}) {
    const { unitsConsumed = 100_000n, recentFees = [], calls = [] } = options;
    return {
        simulateTransaction: () => ({
            send: async () => {
                calls.push('simulateTransaction');
                return {
                    value: { err: null, logs: [], unitsConsumed, loadedAccountsDataSize: 32_768, returnData: null },
                };
            },
        }),
        getRecentPrioritizationFees: () => ({
            send: async () => {
                calls.push('getRecentPrioritizationFees');
                return recentFees.map((prioritizationFee, i) => ({ slot: BigInt(i + 1), prioritizationFee }));
            },
        }),
    } as any;
}

export function computeBudgetInstructions(instructions: readonly Instruction[], discriminator?: number): Instruction[] {
    return instructions.filter(
        ix =>
            ix.programAddress === COMPUTE_BUDGET_PROGRAM &&
            (discriminator === undefined || ix.data?.[0] === discriminator),
    );
}

function readU32LE(data: Uint8Array, offset: number): number {
    return new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(offset, true);
}

function readU64LE(data: Uint8Array, offset: number): bigint {
    return new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(offset, true);
}

export function onlyU32(instructions: readonly Instruction[], discriminator: number): number {
    const matches = computeBudgetInstructions(instructions, discriminator);
    expect(matches).toHaveLength(1);
    return readU32LE(matches[0]!.data as Uint8Array, 1);
}

export function onlyU64(instructions: readonly Instruction[], discriminator: number): bigint {
    const matches = computeBudgetInstructions(instructions, discriminator);
    expect(matches).toHaveLength(1);
    return readU64LE(matches[0]!.data as Uint8Array, 1);
}

/** The emitted SetComputeUnitPrice, or `undefined` when none was emitted. */
export function emittedPrice(instructions: readonly Instruction[]): bigint | undefined {
    const matches = computeBudgetInstructions(instructions, SET_COMPUTE_UNIT_PRICE);
    expect(matches.length).toBeLessThanOrEqual(1);
    return matches[0] ? readU64LE(matches[0].data as Uint8Array, 1) : undefined;
}
