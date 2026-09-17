'use client';

import { useMemo } from 'react';
import { createFlow, type FlowConfig } from '@pipeit/core';
import { VisualPipeline } from '@/lib/visual-pipeline';
import { getTransferSolInstruction } from '@solana-program/system';
import { address, lamports } from '@solana/kit';

const MEMO_PROGRAM = address('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const TRANSFER_COUNT = 8;

/**
 * Large transaction v1 example: eight transfers plus a ~1 KB memo in ONE
 * transaction. The compiled message is well over the 1232-byte legacy/v0
 * limit, so it only fits because the flow runs with `version: 1` (4096 bytes).
 *
 * Pipeit estimates the compute unit limit and loaded accounts data size by
 * simulation and writes them, together with the priority fee in lamports,
 * into the v1 message config. No ComputeBudget instructions are emitted.
 */
export function useLargeV1TransactionPipeline() {
    const visualPipeline = useMemo(() => {
        const flowFactory = (config: FlowConfig) => {
            // Force transaction v1 regardless of what the playground passes in.
            let flow = createFlow({ ...config, version: 1 });
            for (let i = 1; i <= TRANSFER_COUNT; i++) {
                flow = flow.step(`transfer-${i}`, ctx =>
                    getTransferSolInstruction({
                        source: ctx.signer,
                        destination: ctx.signer.address, // Self-transfer
                        amount: lamports(BigInt(i * 1_000)),
                    }),
                );
            }
            return flow.step('memo', () => ({
                programAddress: MEMO_PROGRAM,
                data: new TextEncoder().encode('pipeit tx v1 '.repeat(72)), // ~936 bytes
            }));
        };

        return new VisualPipeline('large-v1-transaction', flowFactory, [
            ...Array.from({ length: TRANSFER_COUNT }, (_, i) => ({
                name: `transfer-${i + 1}`,
                type: 'instruction' as const,
            })),
            { name: 'memo', type: 'instruction' },
        ]);
    }, []);

    return visualPipeline;
}

export const largeV1TransactionCode = `import { createFlow } from '@pipeit/core';
import { getTransferSolInstruction } from '@solana-program/system';
import { address, lamports } from '@solana/kit';

// version: 1 raises the size limit from 1232 to 4096 bytes.
// Compute unit limit, loaded accounts data size and the priority fee
// (in lamports) are resolved into the message config automatically.
let flow = createFlow({ rpc, rpcSubscriptions, signer, version: 1 });

for (const [i, recipient] of recipients.entries()) {
  flow = flow.step(\`transfer-\${i}\`, (ctx) =>
    getTransferSolInstruction({
      source: ctx.signer,
      destination: address(recipient),
      amount: lamports(1_000n),
    }),
  );
}

const result = await flow
  .step('memo', () => ({
    programAddress: address('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'),
    data: new TextEncoder().encode(note), // ~1 KB payload
  }))
  .execute(); // 9 instructions, one ~1.4 KB v1 transaction

// Reading it back needs maxSupportedTransactionVersion: 1
const tx = await rpc
  .getTransaction(result.get('memo')!.signature, { maxSupportedTransactionVersion: 1 })
  .send();`;
