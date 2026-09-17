/**
 * Byte-level tests for TransactionBuilder.build().
 *
 * Legacy/v0: these lock in the compute-budget wire layout. Instruction order
 * must stay [CU limit, CU price, LADS, ...user instructions] and
 * `computeUnits: 'auto'` must keep emitting NO compute unit limit.
 *
 * Version 1: the compute budget lives in `message.config` and there must be
 * no ComputeBudget instructions at all; limits are always concrete.
 *
 * No live RPC required: feePayer + blockhash lifetime are set explicitly, and
 * simulation is stubbed where estimation is exercised.
 */

import { describe, it, expect, vi } from 'vitest';
import { address } from '@solana/addresses';
import type { Instruction } from '@solana/instructions';
import { TransactionBuilder } from '../builder.js';
import { COMPUTE_BUDGET_PROGRAM } from '../../compute-budget/index.js';
import { ResourceLimitEstimationError } from '../../errors/index.js';

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
    return instructions.filter(ix => ix.programAddress === COMPUTE_BUDGET_PROGRAM && ix.data?.[0] === discriminator);
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

// ============================================================================
// Version 1 (SIMD-0385)
// ============================================================================

type V1Config = {
    computeUnitLimit?: number;
    loadedAccountsDataSizeLimit?: number;
    priorityFeeLamports?: bigint;
    heapSize?: number;
};

type BuiltMessage = { version: unknown; instructions: readonly Instruction[]; config?: V1Config };

function buildV1(
    config: Omit<ConstructorParameters<typeof TransactionBuilder>[0], 'version'> = {},
    instructions: readonly Instruction[] = [USER_INSTRUCTION],
) {
    const builder = new TransactionBuilder({ ...config, version: 1 })
        .setFeePayer(FEE_PAYER)
        .setBlockhashLifetime(BLOCKHASH, LAST_VALID_BLOCK_HEIGHT)
        .addInstructions(instructions);
    return (builder as any).build() as Promise<BuiltMessage>;
}

/** RPC stub whose simulateTransaction reports fixed resource usage. */
function simulatingRpc(unitsConsumed: bigint, loadedAccountsDataSize: number | undefined, calls: number[] = []) {
    return {
        simulateTransaction: () => ({
            send: async () => {
                calls.push(1);
                return {
                    value: {
                        err: null,
                        logs: [],
                        unitsConsumed,
                        ...(loadedAccountsDataSize !== undefined && { loadedAccountsDataSize }),
                        returnData: null,
                    },
                };
            },
        }),
    } as any;
}

const FULLY_EXPLICIT = {
    computeUnits: 300_000,
    loadedAccountsDataSizeLimit: 65_536,
    priorityFee: { strategy: 'fixed' as const, microLamports: 10_000 },
};

describe('TransactionBuilder.build() version 1 message config', () => {
    it('writes explicit limits and the converted fee into config, with NO ComputeBudget instructions', async () => {
        const message = await buildV1(FULLY_EXPLICIT);

        expect(message.version).toBe(1);
        expect(message.config).toEqual({
            computeUnitLimit: 300_000,
            loadedAccountsDataSizeLimit: 65_536,
            // ceil(300_000 × 10_000 / 1e6) = 3_000 lamports
            priorityFeeLamports: 3_000n,
        });
        expect(message.instructions).toHaveLength(1);
        expect(message.instructions[0]!.programAddress).toBe(MEMO_PROGRAM);
        expect(message.instructions.some(ix => ix.programAddress === COMPUTE_BUDGET_PROGRAM)).toBe(false);
    });

    it('rounds the converted priority fee up to whole lamports', async () => {
        const message = await buildV1({ ...FULLY_EXPLICIT, computeUnits: 333_333 });
        // 333_333 × 10_000 µL = 3_333.33 lamports → 3_334
        expect(message.config?.priorityFeeLamports).toBe(3_334n);
    });

    it("priorityFee: 'none' leaves priorityFeeLamports unset", async () => {
        const message = await buildV1({ ...FULLY_EXPLICIT, priorityFee: 'none' });
        expect(message.config?.priorityFeeLamports).toBeUndefined();
    });

    it('priorityFee.lamports sets the total directly regardless of the compute unit limit', async () => {
        const message = await buildV1({
            ...FULLY_EXPLICIT,
            priorityFee: { strategy: 'fixed', lamports: 1_234n },
        });
        expect(message.config?.priorityFeeLamports).toBe(1_234n);
    });

    it('clamps an oversized compute unit limit to 1,400,000', async () => {
        const message = await buildV1({ ...FULLY_EXPLICIT, computeUnits: 2_000_000 });
        expect(message.config?.computeUnitLimit).toBe(1_400_000);
    });

    it("computeUnits: 'auto' with an rpc estimates both limits by simulation and pads them", async () => {
        const calls: number[] = [];
        const message = await buildV1({
            rpc: simulatingRpc(100_000n, 40_000, calls),
            priorityFee: { strategy: 'fixed', microLamports: 10_000 },
        });

        expect(calls).toHaveLength(1);
        // 100_000 × 1.1 = 110_000 CU
        expect(message.config?.computeUnitLimit).toBe(110_000);
        // 40_000 × 1.1 = 44_000 → rounded up to 2 × 32 KiB pages
        expect(message.config?.loadedAccountsDataSizeLimit).toBe(65_536);
        // Fee is computed on the FINAL (estimated) limit: 110_000 × 10_000 / 1e6 = 1_100
        expect(message.config?.priorityFeeLamports).toBe(1_100n);
    });

    it('fixed computeUnits with an rpc keeps the limit and estimates only the data size', async () => {
        const message = await buildV1({
            rpc: simulatingRpc(100_000n, 40_000),
            computeUnits: 300_000,
            priorityFee: 'none',
        });

        expect(message.config?.computeUnitLimit).toBe(300_000);
        expect(message.config?.loadedAccountsDataSizeLimit).toBe(65_536);
    });

    it('simulate strategy honours a custom buffer', async () => {
        const message = await buildV1({
            rpc: simulatingRpc(100_000n, 30_000),
            computeUnits: { strategy: 'simulate', buffer: 1.5 },
            priorityFee: 'none',
        });

        expect(message.config?.computeUnitLimit).toBe(150_000);
        // 30_000 × 1.5 = 45_000 → 65_536
        expect(message.config?.loadedAccountsDataSizeLimit).toBe(65_536);
    });

    it('fully explicit limits never hit the rpc', async () => {
        const calls: number[] = [];
        await buildV1({ ...FULLY_EXPLICIT, rpc: simulatingRpc(1n, 1, calls) });
        expect(calls).toHaveLength(0);
    });

    it('without an rpc falls back to 200k CU per instruction and 64 MiB data size, and warns', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            const message = await buildV1({ logLevel: 'minimal', priorityFee: 'none' }, [
                USER_INSTRUCTION,
                USER_INSTRUCTION,
            ]);

            expect(message.config?.computeUnitLimit).toBe(400_000);
            expect(message.config?.loadedAccountsDataSizeLimit).toBe(64 * 1024 * 1024);
            expect(warn).toHaveBeenCalledTimes(1);
            expect(String(warn.mock.calls[0]![0])).toMatch(/without an rpc/);
        } finally {
            warn.mockRestore();
        }
    });

    it("no-rpc fallback stays quiet under logLevel: 'silent'", async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            await buildV1({ priorityFee: 'none' });
            expect(warn).not.toHaveBeenCalled();
        } finally {
            warn.mockRestore();
        }
    });

    it('surfaces a missing loadedAccountsDataSize from the rpc as ResourceLimitEstimationError', async () => {
        await expect(buildV1({ rpc: simulatingRpc(100_000n, undefined), priorityFee: 'none' })).rejects.toThrow(
            ResourceLimitEstimationError,
        );
    });
});

describe('TransactionBuilder constructor version guards', () => {
    it('rejects lookup tables on version 1', () => {
        expect(() => new TransactionBuilder({ version: 1, lookupTableAddresses: [FEE_PAYER] })).toThrow(
            /lookup tables are not supported by version 1/,
        );
        expect(() => new TransactionBuilder({ version: 1, addressesByLookupTable: { [FEE_PAYER]: [] } })).toThrow(
            /lookup tables are not supported by version 1/,
        );
    });

    it('rejects priorityFee.lamports on version 0 and legacy', () => {
        expect(() => new TransactionBuilder({ priorityFee: { strategy: 'fixed', lamports: 1n } })).toThrow(
            /only valid for version: 1/,
        );
        expect(
            () => new TransactionBuilder({ version: 'legacy', priorityFee: { strategy: 'fixed', lamports: 1n } }),
        ).toThrow(/only valid for version: 1/);
    });

    it('accepts priorityFee.lamports on version 1', () => {
        expect(
            () => new TransactionBuilder({ version: 1, priorityFee: { strategy: 'fixed', lamports: 1n } }),
        ).not.toThrow();
    });
});
