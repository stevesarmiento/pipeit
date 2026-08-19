/**
 * Byte-level tests for TransactionBuilder.build().
 *
 * These lock in the compute-budget wire layout across the migration from
 * hand-rolled instruction encoders to Kit v7's version-agnostic setters:
 * instruction order must stay [CU limit, CU price, LADS, ...user instructions]
 * and `computeUnits: 'auto'` must keep emitting NO compute unit limit.
 *
 * No RPC required: feePayer + blockhash lifetime are set explicitly.
 */

import { describe, it, expect } from 'vitest';
import { address } from '@solana/addresses';
import type { Instruction } from '@solana/instructions';
import { TransactionBuilder } from '../builder.js';
import { COMPUTE_BUDGET_PROGRAM } from '../../compute-budget/index.js';

const FEE_PAYER = address('So11111111111111111111111111111111111111112');
const MEMO_PROGRAM = address('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const BLOCKHASH = '11111111111111111111111111111111' as never;
const LAST_VALID_BLOCK_HEIGHT = 100n;

const USER_INSTRUCTION: Instruction = {
    programAddress: MEMO_PROGRAM,
    data: new Uint8Array([104, 105]),
};

/** Discriminators of the ComputeBudget program instructions. */
const SET_COMPUTE_UNIT_LIMIT = 2;
const SET_COMPUTE_UNIT_PRICE = 3;
const SET_LOADED_ACCOUNTS_DATA_SIZE_LIMIT = 4;

function buildMessage(config: ConstructorParameters<typeof TransactionBuilder>[0] = {}) {
    const builder = new TransactionBuilder(config)
        .setFeePayer(FEE_PAYER)
        .setBlockhashLifetime(BLOCKHASH, LAST_VALID_BLOCK_HEIGHT)
        .addInstruction(USER_INSTRUCTION);
    return (builder as any).build() as Promise<{ instructions: readonly Instruction[] }>;
}

function computeBudgetInstructions(instructions: readonly Instruction[], discriminator: number): Instruction[] {
    return instructions.filter(
        ix => ix.programAddress === COMPUTE_BUDGET_PROGRAM && ix.data?.[0] === discriminator,
    );
}

function readU32LE(data: Uint8Array, offset: number): number {
    return new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(offset, true);
}

function readU64LE(data: Uint8Array, offset: number): bigint {
    return new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(offset, true);
}

describe('TransactionBuilder.build() compute budget wire layout', () => {
    it("default config: emits CU price (medium = 10,000) but NO CU limit ('auto' semantics)", async () => {
        const message = await buildMessage();

        const limitIxs = computeBudgetInstructions(message.instructions, SET_COMPUTE_UNIT_LIMIT);
        expect(limitIxs).toHaveLength(0);

        const priceIxs = computeBudgetInstructions(message.instructions, SET_COMPUTE_UNIT_PRICE);
        expect(priceIxs).toHaveLength(1);
        expect(readU64LE(priceIxs[0]!.data as Uint8Array, 1)).toBe(10_000n);

        // Price first, user instruction last
        expect(message.instructions[0]!.programAddress).toBe(COMPUTE_BUDGET_PROGRAM);
        expect(message.instructions.at(-1)!.programAddress).toBe(MEMO_PROGRAM);
    });

    it('fixed computeUnits: order is [limit, price, user] with exact bytes', async () => {
        const message = await buildMessage({ computeUnits: 300_000 });

        expect(message.instructions).toHaveLength(3);

        const [limitIx, priceIx, userIx] = message.instructions;
        expect(limitIx!.programAddress).toBe(COMPUTE_BUDGET_PROGRAM);
        expect(limitIx!.data![0]).toBe(SET_COMPUTE_UNIT_LIMIT);
        expect(readU32LE(limitIx!.data as Uint8Array, 1)).toBe(300_000);

        expect(priceIx!.programAddress).toBe(COMPUTE_BUDGET_PROGRAM);
        expect(priceIx!.data![0]).toBe(SET_COMPUTE_UNIT_PRICE);

        expect(userIx!.programAddress).toBe(MEMO_PROGRAM);
    });

    it('computeUnits above the maximum is clamped to 1,400,000', async () => {
        const message = await buildMessage({ computeUnits: 2_000_000 });

        const limitIxs = computeBudgetInstructions(message.instructions, SET_COMPUTE_UNIT_LIMIT);
        expect(limitIxs).toHaveLength(1);
        expect(readU32LE(limitIxs[0]!.data as Uint8Array, 1)).toBe(1_400_000);
    });

    it('simulate strategy adds a provisory (0 CU) limit instruction', async () => {
        const message = await buildMessage({ computeUnits: { strategy: 'simulate' } });

        const limitIxs = computeBudgetInstructions(message.instructions, SET_COMPUTE_UNIT_LIMIT);
        expect(limitIxs).toHaveLength(1);
        expect(readU32LE(limitIxs[0]!.data as Uint8Array, 1)).toBe(0);
    });

    it("priorityFee: 'none' emits no CU price instruction", async () => {
        const message = await buildMessage({ priorityFee: 'none' });

        const priceIxs = computeBudgetInstructions(message.instructions, SET_COMPUTE_UNIT_PRICE);
        expect(priceIxs).toHaveLength(0);
    });

    it('loadedAccountsDataSizeLimit emits a discriminator-4 instruction before user instructions', async () => {
        const message = await buildMessage({ loadedAccountsDataSizeLimit: 65_536 });

        const ladsIxs = computeBudgetInstructions(message.instructions, SET_LOADED_ACCOUNTS_DATA_SIZE_LIMIT);
        expect(ladsIxs).toHaveLength(1);
        expect(readU32LE(ladsIxs[0]!.data as Uint8Array, 1)).toBe(65_536);

        const ladsIndex = message.instructions.indexOf(ladsIxs[0]!);
        const userIndex = message.instructions.findIndex(ix => ix.programAddress === MEMO_PROGRAM);
        expect(ladsIndex).toBeLessThan(userIndex);
    });

    it('loadedAccountsDataSizeLimit omitted (default): no discriminator-4 instruction', async () => {
        const message = await buildMessage();

        const ladsIxs = computeBudgetInstructions(message.instructions, SET_LOADED_ACCOUNTS_DATA_SIZE_LIMIT);
        expect(ladsIxs).toHaveLength(0);
    });
});
