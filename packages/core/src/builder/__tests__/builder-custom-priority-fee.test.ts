/**
 * `priorityFee: { strategy: 'custom', resolve }`.
 *
 * The resolver receives a PriorityFeeContext with the normalized instructions,
 * the writable accounts, the compute unit limit when known and a lazy draft
 * transaction, and returns micro-lamports per CU. Its errors propagate.
 */

import { describe, it, expect, vi } from 'vitest';
import { address } from '@solana/addresses';
import { AccountRole, type Instruction } from '@solana/instructions';
import { getBase64Encoder } from '@solana/codecs-strings';
import { getTransactionDecoder } from '@solana/transactions';
import { getCompiledTransactionMessageDecoder, decompileTransactionMessage } from '@solana/transaction-messages';
import { TransactionBuilder } from '../builder.js';
import { COMPUTE_BUDGET_PROGRAM, type PriorityFeeContext } from '../../compute-budget/index.js';
import {
    FEE_PAYER,
    MEMO_PROGRAM,
    USER_INSTRUCTION,
    callerHeapIx,
    callerPriceIx,
    callerLimitIx,
    build,
    buildWithBudget,
    stubRpc,
    emittedPrice,
    computeBudgetInstructions,
} from './helpers/compute-budget.js';

const WRITABLE_A = address('A1111111111111111111111111111111111111111111');
const WRITABLE_B = address('B1111111111111111111111111111111111111111111');
const READONLY_C = address('C1111111111111111111111111111111111111111111');

const TRANSFER_LIKE: Instruction = {
    programAddress: MEMO_PROGRAM,
    accounts: [
        { address: FEE_PAYER, role: AccountRole.WRITABLE_SIGNER },
        { address: WRITABLE_A, role: AccountRole.WRITABLE },
        { address: READONLY_C, role: AccountRole.READONLY },
        { address: WRITABLE_B, role: AccountRole.WRITABLE },
        { address: WRITABLE_A, role: AccountRole.WRITABLE },
    ],
    data: new Uint8Array([1]),
};

function custom(resolve: (ctx: PriorityFeeContext) => Promise<bigint>, extra: Record<string, unknown> = {}) {
    return { strategy: 'custom' as const, resolve, ...extra };
}

function decodeDraft(base64: string) {
    const bytes = getBase64Encoder().encode(base64);
    const transaction = getTransactionDecoder().decode(bytes);
    const compiled = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes);
    return decompileTransactionMessage(compiled as any);
}

describe("legacy/v0 'custom' priority fee strategy", () => {
    it('emits the resolved price', async () => {
        const message = await build({ priorityFee: custom(async () => 7_000n) }, [USER_INSTRUCTION]);
        expect(emittedPrice(message.instructions)).toBe(7_000n);
    });

    it('receives version, fee payer, normalized instructions and de-duplicated writable accounts', async () => {
        const seen: PriorityFeeContext[] = [];
        await build({ version: 0, priorityFee: custom(async ctx => (seen.push(ctx), 1n)) }, [
            callerHeapIx(262_144),
            callerPriceIx(5_000n),
            TRANSFER_LIKE,
            USER_INSTRUCTION,
        ]);
        expect(seen).toHaveLength(1);
        const ctx = seen[0]!;
        expect(ctx.version).toBe(0);
        expect(ctx.feePayer).toBe(FEE_PAYER);
        expect(ctx.instructions).toEqual([TRANSFER_LIKE, USER_INSTRUCTION]);
        expect(ctx.writableAccounts).toEqual([FEE_PAYER, WRITABLE_A, WRITABLE_B]);
    });

    it("reports the configured limit, or null for 'auto'", async () => {
        const limits: Array<number | null> = [];
        const resolve = async (ctx: PriorityFeeContext) => (limits.push(ctx.computeUnitLimit), 1n);

        await build({ computeUnits: 300_000, priorityFee: custom(resolve) }, [USER_INSTRUCTION]);
        await build({ priorityFee: custom(resolve) }, [callerLimitIx(287_202), USER_INSTRUCTION]);
        await build({ computeUnits: 'auto', priorityFee: custom(resolve) }, [USER_INSTRUCTION]);
        await build({ computeUnits: { strategy: 'simulate' }, priorityFee: custom(resolve) }, [USER_INSTRUCTION]);

        expect(limits).toEqual([300_000, 287_202, null, null]);
    });

    it('compiles the draft lazily and without any ComputeBudget instructions', async () => {
        const compile = vi.fn();
        let draft: string | undefined;
        await build(
            {
                version: 'legacy',
                computeUnits: 300_000,
                priorityFee: custom(async ctx => {
                    compile.mockImplementation(ctx.draftTransactionBase64);
                    return 1n;
                }),
            },
            [callerHeapIx(262_144), callerPriceIx(5_000n), USER_INSTRUCTION],
        );
        expect(compile).not.toHaveBeenCalled();

        await build(
            {
                version: 'legacy',
                computeUnits: 300_000,
                priorityFee: custom(async ctx => {
                    draft = ctx.draftTransactionBase64();
                    return 1n;
                }),
            },
            [callerHeapIx(262_144), callerPriceIx(5_000n), USER_INSTRUCTION],
        );
        const decoded = decodeDraft(draft!);
        expect(decoded.feePayer.address).toBe(FEE_PAYER);
        expect(decoded.instructions.map(ix => ix.programAddress)).toEqual([MEMO_PROGRAM]);
        expect(decoded.instructions.some(ix => ix.programAddress === COMPUTE_BUDGET_PROGRAM)).toBe(false);
    });

    it('propagates resolver errors instead of falling back to a preset', async () => {
        await expect(
            build(
                {
                    priorityFee: custom(async () => {
                        throw new Error('fee api down');
                    }),
                },
                [USER_INSTRUCTION],
            ),
        ).rejects.toThrow('fee api down');
    });

    it('is skipped when preferInstruction is set and the route carries a price', async () => {
        const resolve = vi.fn(async () => 9_000n);
        const message = await build({ priorityFee: custom(resolve, { preferInstruction: true }) }, [
            callerPriceIx(5_000n),
            USER_INSTRUCTION,
        ]);
        expect(resolve).not.toHaveBeenCalled();
        expect(emittedPrice(message.instructions)).toBe(5_000n);
    });

    it('survives setters (clone) and is reported as a config source', async () => {
        const { message, budget } = await buildWithBudget({ priorityFee: custom(async () => 4_000n) }, [
            USER_INSTRUCTION,
        ]);
        expect(emittedPrice(message.instructions)).toBe(4_000n);
        expect(budget.computeUnitPriceMicroLamports).toBe(4_000n);
        expect(budget.source.priorityFee).toBe('config');
    });
});

describe("version 1 'custom' priority fee strategy", () => {
    it('runs after the limit is resolved and converts the price against it', async () => {
        const calls: string[] = [];
        const rpc = stubRpc({ unitsConsumed: 100_000n, calls });
        const limits: Array<number | null> = [];
        const message = await build(
            {
                version: 1,
                rpc,
                priorityFee: custom(async ctx => {
                    limits.push(ctx.computeUnitLimit);
                    calls.push('resolve');
                    return 10_000n;
                }),
            },
            [USER_INSTRUCTION],
        );
        expect(calls).toEqual(['simulateTransaction', 'resolve']);
        expect(limits).toEqual([110_000]);
        expect(message.config?.priorityFeeLamports).toBe(1_100n);
        expect(computeBudgetInstructions(message.instructions)).toHaveLength(0);
    });

    it('reports the explicit limit and a v1 draft without budget instructions', async () => {
        let ctx: PriorityFeeContext | undefined;
        await build(
            {
                version: 1,
                computeUnits: 300_000,
                loadedAccountsDataSizeLimit: 65_536,
                priorityFee: custom(async c => ((ctx = c), 1n)),
            },
            [callerHeapIx(262_144), USER_INSTRUCTION],
        );
        expect(ctx!.version).toBe(1);
        expect(ctx!.computeUnitLimit).toBe(300_000);
        expect(ctx!.instructions).toEqual([USER_INSTRUCTION]);
        expect(typeof ctx!.draftTransactionBase64()).toBe('string');
    });

    it('propagates resolver errors untouched', async () => {
        const failure = new Error('fee api down');
        await expect(
            build(
                {
                    version: 1,
                    computeUnits: 300_000,
                    loadedAccountsDataSizeLimit: 65_536,
                    priorityFee: custom(async () => {
                        throw failure;
                    }),
                },
                [USER_INSTRUCTION],
            ),
        ).rejects.toBe(failure);
    });
});

describe('custom strategy validation', () => {
    it('throws at construction when resolve is missing', () => {
        expect(() => new TransactionBuilder({ priorityFee: { strategy: 'custom' } })).toThrow(/resolve is required/);
    });

    it('throws at construction when maxLamports is negative', () => {
        expect(() => new TransactionBuilder({ priorityFee: { strategy: 'none', maxLamports: -1n } })).toThrow(
            /must not be negative/,
        );
    });
});
