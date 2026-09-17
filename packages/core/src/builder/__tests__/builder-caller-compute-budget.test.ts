/**
 * TransactionBuilder.build() with caller-supplied ComputeBudget instructions.
 *
 * Instructions added by the caller may carry their own compute budget (DEX
 * routes ship RequestHeapFrame and sometimes a limit/price). The builder must
 * strip them and fold the values in: explicit builder config wins, otherwise
 * the caller's value is used. Legacy/v0 ends up with at most one instruction
 * per kind; version 1 ends up with the budget in `message.config` only.
 *
 * No live RPC required: feePayer + blockhash lifetime are set explicitly, and
 * simulation is stubbed where estimation is exercised.
 */

import { describe, it, expect, vi } from 'vitest';
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
const REQUEST_HEAP_FRAME = 1;
const SET_COMPUTE_UNIT_LIMIT = 2;
const SET_COMPUTE_UNIT_PRICE = 3;
const SET_LOADED_ACCOUNTS_DATA_SIZE_LIMIT = 4;

type BuiltMessage = {
    version: number;
    instructions: readonly Instruction[];
    config?: {
        computeUnitLimit?: number;
        heapSize?: number;
        loadedAccountsDataSizeLimit?: number;
        priorityFeeLamports?: bigint;
    };
};

type BuilderConfig = ConstructorParameters<typeof TransactionBuilder>[0];

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

const callerHeapIx = (bytes: number) => u32Instruction(REQUEST_HEAP_FRAME, bytes);
const callerLimitIx = (units: number) => u32Instruction(SET_COMPUTE_UNIT_LIMIT, units);
const callerPriceIx = (microLamports: bigint) => u64Instruction(SET_COMPUTE_UNIT_PRICE, microLamports);
const callerLadsIx = (bytes: number) => u32Instruction(SET_LOADED_ACCOUNTS_DATA_SIZE_LIMIT, bytes);

function makeBuilder(config: BuilderConfig, instructions: readonly Instruction[]) {
    return new TransactionBuilder(config)
        .setFeePayer(FEE_PAYER)
        .setBlockhashLifetime(BLOCKHASH, LAST_VALID_BLOCK_HEIGHT)
        .addInstructions(instructions);
}

function build(config: BuilderConfig, instructions: readonly Instruction[]) {
    return (makeBuilder(config, instructions) as any).build() as Promise<BuiltMessage>;
}

function computeBudgetInstructions(instructions: readonly Instruction[], discriminator?: number): Instruction[] {
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

function onlyU32(instructions: readonly Instruction[], discriminator: number): number {
    const matches = computeBudgetInstructions(instructions, discriminator);
    expect(matches).toHaveLength(1);
    return readU32LE(matches[0]!.data as Uint8Array, 1);
}

function onlyU64(instructions: readonly Instruction[], discriminator: number): bigint {
    const matches = computeBudgetInstructions(instructions, discriminator);
    expect(matches).toHaveLength(1);
    return readU64LE(matches[0]!.data as Uint8Array, 1);
}

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

describe('legacy/v0 caller-supplied ComputeBudget instructions', () => {
    it('caller limit under the default config: exactly one limit instruction with the caller value', async () => {
        const message = await build({}, [callerLimitIx(287_202), USER_INSTRUCTION]);

        expect(onlyU32(message.instructions, SET_COMPUTE_UNIT_LIMIT)).toBe(287_202);
        expect(message.instructions.at(-1)!.programAddress).toBe(MEMO_PROGRAM);
    });

    it('explicit computeUnits wins over a caller limit', async () => {
        const message = await build({ computeUnits: 300_000 }, [callerLimitIx(287_202), USER_INSTRUCTION]);

        expect(onlyU32(message.instructions, SET_COMPUTE_UNIT_LIMIT)).toBe(300_000);
    });

    it("explicit computeUnits: 'auto' suppresses a caller limit", async () => {
        const message = await build({ computeUnits: 'auto' }, [callerLimitIx(287_202), USER_INSTRUCTION]);

        expect(computeBudgetInstructions(message.instructions, SET_COMPUTE_UNIT_LIMIT)).toHaveLength(0);
    });

    it('clamps a caller limit to 1,400,000', async () => {
        const message = await build({}, [callerLimitIx(2_000_000), USER_INSTRUCTION]);

        expect(onlyU32(message.instructions, SET_COMPUTE_UNIT_LIMIT)).toBe(1_400_000);
    });

    it('the last of several caller limits wins', async () => {
        const message = await build({}, [callerLimitIx(100_000), USER_INSTRUCTION, callerLimitIx(250_000)]);

        expect(onlyU32(message.instructions, SET_COMPUTE_UNIT_LIMIT)).toBe(250_000);
    });

    it("caller price beats the default 'medium' level", async () => {
        const message = await build({}, [callerPriceIx(5_000n), USER_INSTRUCTION]);

        expect(onlyU64(message.instructions, SET_COMPUTE_UNIT_PRICE)).toBe(5_000n);
    });

    it("explicit priorityFee: 'none' suppresses a caller price", async () => {
        const message = await build({ priorityFee: 'none' }, [callerPriceIx(5_000n), USER_INSTRUCTION]);

        expect(computeBudgetInstructions(message.instructions, SET_COMPUTE_UNIT_PRICE)).toHaveLength(0);
    });

    it("explicit priorityFee: 'high' wins over a caller price", async () => {
        const message = await build({ priorityFee: 'high' }, [callerPriceIx(5_000n), USER_INSTRUCTION]);

        expect(onlyU64(message.instructions, SET_COMPUTE_UNIT_PRICE)).toBe(50_000n);
    });

    it('caller heap frame becomes exactly one RequestHeapFrame in the prefix before user instructions', async () => {
        const message = await build({ loadedAccountsDataSizeLimit: 65_536 }, [USER_INSTRUCTION, callerHeapIx(262_144)]);

        expect(onlyU32(message.instructions, REQUEST_HEAP_FRAME)).toBe(262_144);
        const heapIndex = message.instructions.findIndex(ix => ix.data?.[0] === REQUEST_HEAP_FRAME);
        const ladsIndex = message.instructions.findIndex(ix => ix.data?.[0] === SET_LOADED_ACCOUNTS_DATA_SIZE_LIMIT);
        const userIndex = message.instructions.findIndex(ix => ix.programAddress === MEMO_PROGRAM);
        expect(ladsIndex).toBeLessThan(heapIndex);
        expect(heapIndex).toBeLessThan(userIndex);
    });

    it('caller data size limit is used when not configured, and explicit config wins otherwise', async () => {
        const fromCaller = await build({}, [callerLadsIx(131_072), USER_INSTRUCTION]);
        expect(onlyU32(fromCaller.instructions, SET_LOADED_ACCOUNTS_DATA_SIZE_LIMIT)).toBe(131_072);

        const fromConfig = await build({ loadedAccountsDataSizeLimit: 65_536 }, [
            callerLadsIx(131_072),
            USER_INSTRUCTION,
        ]);
        expect(onlyU32(fromConfig.instructions, SET_LOADED_ACCOUNTS_DATA_SIZE_LIMIT)).toBe(65_536);
    });

    it("explicit 'simulate' strategy keeps a single provisory (0 CU) limit and drops the caller limit", async () => {
        const message = await build({ computeUnits: { strategy: 'simulate' } }, [
            callerLimitIx(287_202),
            USER_INSTRUCTION,
        ]);

        expect(onlyU32(message.instructions, SET_COMPUTE_UNIT_LIMIT)).toBe(0);
    });

    it('unknown-discriminator and malformed ComputeBudget instructions pass through untouched', async () => {
        const unknown: Instruction = { programAddress: COMPUTE_BUDGET_PROGRAM, data: new Uint8Array([5, 0, 0, 0, 0]) };
        const malformed: Instruction = { programAddress: COMPUTE_BUDGET_PROGRAM, data: new Uint8Array([2, 1]) };

        const message = await build({ priorityFee: 'none' }, [unknown, USER_INSTRUCTION, malformed]);

        expect(message.instructions).toEqual([unknown, USER_INSTRUCTION, malformed]);
    });

    it('a full caller budget yields one instruction of each kind and nothing duplicated', async () => {
        const message = await build({}, [
            callerHeapIx(262_144),
            callerLimitIx(287_202),
            callerPriceIx(5_000n),
            callerLadsIx(131_072),
            USER_INSTRUCTION,
        ]);

        expect(computeBudgetInstructions(message.instructions)).toHaveLength(4);
        expect(onlyU32(message.instructions, REQUEST_HEAP_FRAME)).toBe(262_144);
        expect(onlyU32(message.instructions, SET_COMPUTE_UNIT_LIMIT)).toBe(287_202);
        expect(onlyU64(message.instructions, SET_COMPUTE_UNIT_PRICE)).toBe(5_000n);
        expect(onlyU32(message.instructions, SET_LOADED_ACCOUNTS_DATA_SIZE_LIMIT)).toBe(131_072);
        expect(message.instructions.at(-1)).toBe(USER_INSTRUCTION);
    });

    it('does not mutate the builder: building twice gives identical results', async () => {
        const builder = makeBuilder({}, [callerLimitIx(287_202), callerPriceIx(5_000n), USER_INSTRUCTION]);

        const first = await ((builder as any).build() as Promise<BuiltMessage>);
        const second = await ((builder as any).build() as Promise<BuiltMessage>);

        expect(second.instructions).toEqual(first.instructions);
        expect(onlyU32(second.instructions, SET_COMPUTE_UNIT_LIMIT)).toBe(287_202);
        expect(onlyU64(second.instructions, SET_COMPUTE_UNIT_PRICE)).toBe(5_000n);
    });
});

describe('version 1 caller-supplied ComputeBudget instructions', () => {
    const V1_LIMITS = { version: 1 as const, computeUnits: 300_000, loadedAccountsDataSizeLimit: 65_536 };

    it('caller heap + price with explicit limits: zero ComputeBudget instructions, values folded into config', async () => {
        const message = await build(V1_LIMITS, [callerHeapIx(262_144), callerPriceIx(5_000n), USER_INSTRUCTION]);

        expect(message.version).toBe(1);
        expect(computeBudgetInstructions(message.instructions)).toHaveLength(0);
        expect(message.instructions).toEqual([USER_INSTRUCTION]);
        expect(message.config).toEqual({
            computeUnitLimit: 300_000,
            loadedAccountsDataSizeLimit: 65_536,
            heapSize: 262_144,
            // ceil(300_000 × 5_000 / 1e6) = 1_500 lamports
            priorityFeeLamports: 1_500n,
        });
    });

    it('rounds the caller price conversion up to whole lamports against the final limit', async () => {
        const message = await build({ ...V1_LIMITS, computeUnits: 333_333 }, [callerPriceIx(5_000n), USER_INSTRUCTION]);

        // 333_333 × 5_000 µL = 1_666.665 lamports → 1_667
        expect(message.config?.priorityFeeLamports).toBe(1_667n);
    });

    it('caller price is converted against the estimated limit when computeUnits is left to simulation', async () => {
        const calls: number[] = [];
        const message = await build({ version: 1, rpc: simulatingRpc(100_000n, 40_000, calls) }, [
            callerPriceIx(5_000n),
            USER_INSTRUCTION,
        ]);

        expect(calls).toHaveLength(1);
        expect(message.config?.computeUnitLimit).toBe(110_000);
        // 110_000 × 5_000 / 1e6 = 550
        expect(message.config?.priorityFeeLamports).toBe(550n);
        expect(computeBudgetInstructions(message.instructions)).toHaveLength(0);
    });

    it('caller limit is kept as the compute unit limit while the data size is still estimated', async () => {
        const calls: number[] = [];
        const message = await build({ version: 1, rpc: simulatingRpc(100_000n, 40_000, calls), priorityFee: 'none' }, [
            callerLimitIx(287_202),
            USER_INSTRUCTION,
        ]);

        expect(calls).toHaveLength(1);
        expect(message.config?.computeUnitLimit).toBe(287_202);
        expect(message.config?.loadedAccountsDataSizeLimit).toBe(65_536);
        expect(message.config?.priorityFeeLamports).toBeUndefined();
        expect(computeBudgetInstructions(message.instructions)).toHaveLength(0);
    });

    it('caller limit + caller data size limit need no rpc and produce no warning', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            const message = await build({ version: 1, priorityFee: 'none', logLevel: 'minimal' }, [
                callerLimitIx(287_202),
                callerLadsIx(6_488_064),
                USER_INSTRUCTION,
            ]);

            expect(warn).not.toHaveBeenCalled();
            expect(message.config).toEqual({ computeUnitLimit: 287_202, loadedAccountsDataSizeLimit: 6_488_064 });
        } finally {
            warn.mockRestore();
        }
    });

    it("explicit priorityFee: 'none' suppresses a caller price", async () => {
        const message = await build({ ...V1_LIMITS, priorityFee: 'none' }, [callerPriceIx(5_000n), USER_INSTRUCTION]);

        expect(message.config?.priorityFeeLamports).toBeUndefined();
    });

    it('explicit priorityFee wins over a caller price', async () => {
        const message = await build({ ...V1_LIMITS, priorityFee: { strategy: 'fixed', lamports: 1_234n } }, [
            callerPriceIx(5_000n),
            USER_INSTRUCTION,
        ]);

        expect(message.config?.priorityFeeLamports).toBe(1_234n);
    });

    it('explicit computeUnits wins over a caller limit', async () => {
        const message = await build({ ...V1_LIMITS, priorityFee: 'none' }, [callerLimitIx(287_202), USER_INSTRUCTION]);

        expect(message.config?.computeUnitLimit).toBe(300_000);
    });

    it('the no-rpc fallback sizes compute units from the normalized instruction count', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            const message = await build({ version: 1, priorityFee: 'none' }, [
                callerHeapIx(262_144),
                callerPriceIx(5_000n),
                USER_INSTRUCTION,
                USER_INSTRUCTION,
            ]);

            // 2 user instructions × 200_000, not 4 × 200_000
            expect(message.config?.computeUnitLimit).toBe(400_000);
            expect(message.instructions).toHaveLength(2);
        } finally {
            warn.mockRestore();
        }
    });

    it('unknown-discriminator ComputeBudget instructions remain in the v1 instruction list', async () => {
        const unknown: Instruction = { programAddress: COMPUTE_BUDGET_PROGRAM, data: new Uint8Array([5, 0, 0, 0, 0]) };

        const message = await build({ ...V1_LIMITS, priorityFee: 'none' }, [unknown, USER_INSTRUCTION]);

        expect(message.instructions).toEqual([unknown, USER_INSTRUCTION]);
    });
});
