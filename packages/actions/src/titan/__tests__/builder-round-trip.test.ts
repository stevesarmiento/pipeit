/**
 * A Titan-style route round-trips through @pipeit/core's TransactionBuilder.
 *
 * Titan routes ship their own ComputeBudget instructions (RequestHeapFrame,
 * and sometimes SetComputeUnitLimit / SetComputeUnitPrice). The builder must
 * fold them into its budget: one instruction per kind on legacy/v0, config
 * only on version 1 — never a duplicate the runtime would reject.
 */

import { describe, it, expect, vi } from 'vitest';
import { address, getAddressEncoder } from '@solana/addresses';
import type { Instruction } from '@solana/instructions';
import { TransactionBuilder, COMPUTE_BUDGET_PROGRAM } from '@pipeit/core';
import { titanInstructionsToKit } from '../convert.js';
import type { TitanInstruction } from '../types.js';

const FEE_PAYER = address('So11111111111111111111111111111111111111112');
const ROUTER_PROGRAM = address('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const BLOCKHASH = '11111111111111111111111111111111' as never;

const REQUEST_HEAP_FRAME = 1;
const SET_COMPUTE_UNIT_LIMIT = 2;
const SET_COMPUTE_UNIT_PRICE = 3;

const HEAP_BYTES = 262_144;
const LIMIT_UNITS = 287_202;
const PRICE_MICRO_LAMPORTS = 5_000n;

const encodeAddress = getAddressEncoder();

function titanComputeBudget(discriminator: number, payload: Uint8Array): TitanInstruction {
    const d = new Uint8Array(1 + payload.length);
    d[0] = discriminator;
    d.set(payload, 1);
    return { p: new Uint8Array(encodeAddress.encode(COMPUTE_BUDGET_PROGRAM)), a: [], d };
}

function u32(value: number): Uint8Array {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setUint32(0, value, true);
    return bytes;
}

function u64(value: bigint): Uint8Array {
    const bytes = new Uint8Array(8);
    new DataView(bytes.buffer).setBigUint64(0, value, true);
    return bytes;
}

/** Heap frame + limit + price, then the router call — the shape Titan returns. */
const TITAN_ROUTE: TitanInstruction[] = [
    titanComputeBudget(REQUEST_HEAP_FRAME, u32(HEAP_BYTES)),
    titanComputeBudget(SET_COMPUTE_UNIT_LIMIT, u32(LIMIT_UNITS)),
    titanComputeBudget(SET_COMPUTE_UNIT_PRICE, u64(PRICE_MICRO_LAMPORTS)),
    {
        p: new Uint8Array(encodeAddress.encode(ROUTER_PROGRAM)),
        a: [{ p: new Uint8Array(encodeAddress.encode(FEE_PAYER)), s: true, w: true }],
        d: new Uint8Array([1, 2, 3, 4]),
    },
];

type BuiltMessage = {
    instructions: readonly Instruction[];
    config?: {
        computeUnitLimit?: number;
        heapSize?: number;
        loadedAccountsDataSizeLimit?: number;
        priorityFeeLamports?: bigint;
    };
};

/** The same route without a SetComputeUnitPrice: what Titan ships today. */
const TITAN_ROUTE_WITHOUT_PRICE = TITAN_ROUTE.filter(ix => ix.d[0] !== SET_COMPUTE_UNIT_PRICE || ix.a.length > 0);

function makeBuilder(config: ConstructorParameters<typeof TransactionBuilder>[0], route = TITAN_ROUTE) {
    return new TransactionBuilder(config)
        .setFeePayer(FEE_PAYER)
        .setBlockhashLifetime(BLOCKHASH, 100n)
        .addInstructions(titanInstructionsToKit(route));
}

function build(config: ConstructorParameters<typeof TransactionBuilder>[0], route = TITAN_ROUTE) {
    return makeBuilder(config, route).build() as Promise<BuiltMessage>;
}

function computeBudgetInstructions(instructions: readonly Instruction[], discriminator?: number): Instruction[] {
    return instructions.filter(
        ix =>
            ix.programAddress === COMPUTE_BUDGET_PROGRAM &&
            (discriminator === undefined || ix.data?.[0] === discriminator),
    );
}

function readU32LE(data: Uint8Array): number {
    return new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(1, true);
}

function readU64LE(data: Uint8Array): bigint {
    return new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(1, true);
}

describe('Titan route through TransactionBuilder', () => {
    it("legacy/v0: Titan's own compute budget is emitted once per kind, never duplicated", async () => {
        const message = await build({});

        const heap = computeBudgetInstructions(message.instructions, REQUEST_HEAP_FRAME);
        const limit = computeBudgetInstructions(message.instructions, SET_COMPUTE_UNIT_LIMIT);
        const price = computeBudgetInstructions(message.instructions, SET_COMPUTE_UNIT_PRICE);
        expect(heap).toHaveLength(1);
        expect(limit).toHaveLength(1);
        expect(price).toHaveLength(1);
        expect(readU32LE(heap[0]!.data as Uint8Array)).toBe(HEAP_BYTES);
        expect(readU32LE(limit[0]!.data as Uint8Array)).toBe(LIMIT_UNITS);
        expect(readU64LE(price[0]!.data as Uint8Array)).toBe(PRICE_MICRO_LAMPORTS);

        // The router call is last, with its account meta intact
        const router = message.instructions.at(-1)!;
        expect(router.programAddress).toBe(ROUTER_PROGRAM);
        expect(router.accounts?.[0]?.address).toBe(FEE_PAYER);
    });

    it('legacy/v0: explicit builder config overrides the route budget without duplicating', async () => {
        const message = await build({ computeUnits: 400_000, priorityFee: 'high' });

        const limit = computeBudgetInstructions(message.instructions, SET_COMPUTE_UNIT_LIMIT);
        const price = computeBudgetInstructions(message.instructions, SET_COMPUTE_UNIT_PRICE);
        expect(limit).toHaveLength(1);
        expect(price).toHaveLength(1);
        expect(readU32LE(limit[0]!.data as Uint8Array)).toBe(400_000);
        expect(readU64LE(price[0]!.data as Uint8Array)).toBe(50_000n);
    });

    it('version 1: no ComputeBudget instructions at all, the budget lives in config', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            const message = await build({ version: 1, loadedAccountsDataSizeLimit: 6_488_064 });

            expect(computeBudgetInstructions(message.instructions)).toHaveLength(0);
            expect(message.instructions).toHaveLength(1);
            expect(message.instructions[0]!.programAddress).toBe(ROUTER_PROGRAM);
            expect(message.config).toEqual({
                computeUnitLimit: LIMIT_UNITS,
                loadedAccountsDataSizeLimit: 6_488_064,
                heapSize: HEAP_BYTES,
                // ceil(287_202 × 5_000 / 1e6) = 1_436.01 → 1_437 lamports
                priorityFeeLamports: 1_437n,
            });
            expect(warn).not.toHaveBeenCalled();
        } finally {
            warn.mockRestore();
        }
    });

    describe('wallet fee policy: route price if present, custom estimator otherwise, capped', () => {
        const FEE_POLICY = {
            strategy: 'custom' as const,
            preferInstruction: true,
            resolve: async () => 7_000n,
            maxLamports: 100_000n,
        };

        it('legacy/v0: a route with a heap frame and no price gets the estimated price', async () => {
            const { message, budget } = await makeBuilder(
                { priorityFee: FEE_POLICY },
                TITAN_ROUTE_WITHOUT_PRICE,
            ).buildWithBudget();

            const heap = computeBudgetInstructions(message.instructions, REQUEST_HEAP_FRAME);
            const limit = computeBudgetInstructions(message.instructions, SET_COMPUTE_UNIT_LIMIT);
            const price = computeBudgetInstructions(message.instructions, SET_COMPUTE_UNIT_PRICE);
            expect(heap).toHaveLength(1);
            expect(limit).toHaveLength(1);
            expect(price).toHaveLength(1);
            expect(readU32LE(heap[0]!.data as Uint8Array)).toBe(HEAP_BYTES);
            expect(readU32LE(limit[0]!.data as Uint8Array)).toBe(LIMIT_UNITS);
            expect(readU64LE(price[0]!.data as Uint8Array)).toBe(7_000n);

            expect(budget).toEqual({
                version: 0,
                computeUnitLimit: LIMIT_UNITS,
                computeUnitPriceMicroLamports: 7_000n,
                // ceil(287_202 × 7_000 / 1e6) = 2_010.414 → 2_011 lamports
                priorityFeeLamports: 2_011n,
                loadedAccountsDataSizeLimit: null,
                heapSize: HEAP_BYTES,
                source: { priorityFee: 'config', computeUnits: 'instruction' },
            });
        });

        it("legacy/v0: a route that carries a price keeps it and the estimator isn't consulted", async () => {
            const resolve = vi.fn(async () => 7_000n);
            const { message, budget } = await makeBuilder({
                priorityFee: { ...FEE_POLICY, resolve },
            }).buildWithBudget();

            const price = computeBudgetInstructions(message.instructions, SET_COMPUTE_UNIT_PRICE);
            expect(readU64LE(price[0]!.data as Uint8Array)).toBe(PRICE_MICRO_LAMPORTS);
            expect(resolve).not.toHaveBeenCalled();
            expect(budget.source.priorityFee).toBe('instruction');
            expect(budget.priorityFeeLamports).toBe(1_437n);
        });

        it('version 1: the estimated price is converted against the route limit, under the cap', async () => {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
            try {
                const { message, budget } = await makeBuilder(
                    { version: 1, loadedAccountsDataSizeLimit: 6_488_064, priorityFee: FEE_POLICY },
                    TITAN_ROUTE_WITHOUT_PRICE,
                ).buildWithBudget();

                expect(computeBudgetInstructions(message.instructions)).toHaveLength(0);
                expect(message.config).toEqual({
                    computeUnitLimit: LIMIT_UNITS,
                    loadedAccountsDataSizeLimit: 6_488_064,
                    heapSize: HEAP_BYTES,
                    priorityFeeLamports: 2_011n,
                });
                expect(budget).toEqual({
                    version: 1,
                    computeUnitLimit: LIMIT_UNITS,
                    computeUnitPriceMicroLamports: 7_000n,
                    priorityFeeLamports: 2_011n,
                    loadedAccountsDataSizeLimit: 6_488_064,
                    heapSize: HEAP_BYTES,
                    source: { priorityFee: 'config', computeUnits: 'instruction' },
                });
                expect(warn).not.toHaveBeenCalled();
            } finally {
                warn.mockRestore();
            }
        });

        it('version 1: the cap clamps the total and the budget says so', async () => {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
            try {
                const { message, budget } = await makeBuilder(
                    {
                        version: 1,
                        loadedAccountsDataSizeLimit: 6_488_064,
                        priorityFee: { ...FEE_POLICY, maxLamports: 1_000n },
                    },
                    TITAN_ROUTE_WITHOUT_PRICE,
                ).buildWithBudget();
                expect(message.config?.priorityFeeLamports).toBe(1_000n);
                expect(budget.priorityFeeLamports).toBe(1_000n);
                expect(budget.source.priorityFee).toBe('clamped');
            } finally {
                warn.mockRestore();
            }
        });
    });
});
