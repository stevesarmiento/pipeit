/**
 * Flow API: version / priority fee / compute unit passthrough to TransactionBuilder.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { address } from '@solana/addresses';
import type { Instruction } from '@solana/instructions';

const constructorConfigs: unknown[] = [];

vi.mock('../../builder/builder.js', () => {
    class TransactionBuilder {
        constructor(config: unknown) {
            constructorConfigs.push(config);
        }
        setFeePayerSigner() {
            return this;
        }
        addInstructions() {
            return this;
        }
        addInstruction() {
            return this;
        }
        async execute() {
            return 'sig';
        }
    }
    return { TransactionBuilder };
});

import { createFlow } from '../index.js';

const MEMO_PROGRAM = address('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const ix: Instruction = { programAddress: MEMO_PROGRAM, data: new Uint8Array([1]) };
const baseConfig = {
    rpc: {} as any,
    rpcSubscriptions: {} as any,
    signer: { address: MEMO_PROGRAM } as any,
};

beforeEach(() => {
    constructorConfigs.length = 0;
});

describe('Flow builder options', () => {
    it('passes version and priorityFee to batched and atomic transactions (auto strategy)', async () => {
        await createFlow({ ...baseConfig, version: 1, priorityFee: 'high' })
            .step('a', () => ix)
            .atomic('group', [() => ix, () => ix])
            .execute();

        expect(constructorConfigs).toHaveLength(2);
        for (const config of constructorConfigs as Array<Record<string, unknown>>) {
            expect(config.version).toBe(1);
            expect(config.priorityFee).toBe('high');
        }
        // Atomic groups keep their 400k CU default when computeUnits is not configured
        expect((constructorConfigs[1] as Record<string, unknown>).computeUnits).toBe(400_000);
        expect('computeUnits' in (constructorConfigs[0] as Record<string, unknown>)).toBe(false);
    });

    it('passes version and computeUnits to sequential-strategy transactions and atomic groups', async () => {
        await createFlow({ ...baseConfig, strategy: 'sequential', version: 1, computeUnits: { strategy: 'simulate' } })
            .step('a', () => ix)
            .atomic('group', [() => ix])
            .execute();

        expect(constructorConfigs).toHaveLength(2);
        for (const config of constructorConfigs as Array<Record<string, unknown>>) {
            expect(config.version).toBe(1);
            expect(config.computeUnits).toEqual({ strategy: 'simulate' });
        }
    });

    it('omits the options entirely when not configured', async () => {
        await createFlow(baseConfig)
            .step('a', () => ix)
            .execute();

        expect(constructorConfigs).toHaveLength(1);
        const config = constructorConfigs[0] as Record<string, unknown>;
        expect('version' in config).toBe(false);
        expect('priorityFee' in config).toBe(false);
    });
});
