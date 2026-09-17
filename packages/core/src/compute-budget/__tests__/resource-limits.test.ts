/**
 * Tests for the buffered resource-limit estimator.
 */

import { describe, it, expect } from 'vitest';
import { pipe } from '@solana/functional';
import { address } from '@solana/addresses';
import {
    createTransactionMessage,
    setTransactionMessageFeePayer,
    setTransactionMessageLifetimeUsingBlockhash,
    appendTransactionMessageInstruction,
    getTransactionMessageComputeUnitLimit,
    getTransactionMessageLoadedAccountsDataSizeLimit,
    setTransactionMessageComputeUnitLimit,
    type TransactionVersion,
} from '@solana/transaction-messages';
import { fillTransactionMessageProvisoryResourceLimits } from '@solana/kit';
import { createBufferedResourceLimitsEstimator } from '../resource-limits.js';
import { ResourceLimitEstimationError } from '../../errors/index.js';

const FEE_PAYER = address('So11111111111111111111111111111111111111112');
const MEMO_PROGRAM = address('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const BLOCKHASH = { blockhash: '11111111111111111111111111111111' as never, lastValidBlockHeight: 100n };

function provisoryMessage(version: TransactionVersion) {
    return pipe(
        createTransactionMessage({ version }),
        tx => setTransactionMessageFeePayer(FEE_PAYER, tx),
        tx => setTransactionMessageLifetimeUsingBlockhash(BLOCKHASH, tx),
        tx => appendTransactionMessageInstruction({ programAddress: MEMO_PROGRAM, data: new Uint8Array([1]) }, tx),
        tx => fillTransactionMessageProvisoryResourceLimits(tx),
    );
}

function rpcStub(unitsConsumed: bigint, loadedAccountsDataSize?: number) {
    return {
        simulateTransaction: () => ({
            send: async () => ({
                value: {
                    err: null,
                    logs: [],
                    unitsConsumed,
                    ...(loadedAccountsDataSize !== undefined && { loadedAccountsDataSize }),
                    returnData: null,
                },
            }),
        }),
    } as any;
}

describe('createBufferedResourceLimitsEstimator', () => {
    it('pads both limits on version 1 and rounds the data size up to a 32 KiB page', async () => {
        const estimateAndSet = createBufferedResourceLimitsEstimator({ rpc: rpcStub(100_000n, 40_000), buffer: 1.1 });
        const message = await estimateAndSet(provisoryMessage(1));

        expect(getTransactionMessageComputeUnitLimit(message)).toBe(110_000);
        expect(getTransactionMessageLoadedAccountsDataSizeLimit(message)).toBe(65_536);
    });

    it('defaults the buffer to 1.1', async () => {
        const estimateAndSet = createBufferedResourceLimitsEstimator({ rpc: rpcStub(200_000n, 1_000) });
        const message = await estimateAndSet(provisoryMessage(1));

        expect(getTransactionMessageComputeUnitLimit(message)).toBe(220_000);
        expect(getTransactionMessageLoadedAccountsDataSizeLimit(message)).toBe(32_768);
    });

    it('caps the padded compute unit limit at 1,400,000', async () => {
        const estimateAndSet = createBufferedResourceLimitsEstimator({ rpc: rpcStub(1_390_000n, 1), buffer: 1.1 });
        const message = await estimateAndSet(provisoryMessage(1));
        expect(getTransactionMessageComputeUnitLimit(message)).toBe(1_400_000);
    });

    it('leaves an explicit version 1 compute unit limit alone and fills only the data size', async () => {
        const estimateAndSet = createBufferedResourceLimitsEstimator({ rpc: rpcStub(100_000n, 10) });
        const message = await estimateAndSet(setTransactionMessageComputeUnitLimit(300_000, provisoryMessage(1)));

        expect(getTransactionMessageComputeUnitLimit(message)).toBe(300_000);
        expect(getTransactionMessageLoadedAccountsDataSizeLimit(message)).toBe(32_768);
    });

    it('on version 0 pads the compute unit limit and does not add a data-size instruction', async () => {
        const estimateAndSet = createBufferedResourceLimitsEstimator({ rpc: rpcStub(100_000n, 40_000), buffer: 1.2 });
        const message = await estimateAndSet(provisoryMessage(0));

        expect(getTransactionMessageComputeUnitLimit(message)).toBe(120_000);
        expect(getTransactionMessageLoadedAccountsDataSizeLimit(message)).toBeUndefined();
        // Provisory limit replaced in place: still one CU limit + the memo
        expect(message.instructions).toHaveLength(2);
    });

    it('translates a missing loadedAccountsDataSize on version 1 into ResourceLimitEstimationError', async () => {
        const estimateAndSet = createBufferedResourceLimitsEstimator({ rpc: rpcStub(100_000n, undefined) });
        await expect(estimateAndSet(provisoryMessage(1))).rejects.toBeInstanceOf(ResourceLimitEstimationError);
    });
});
