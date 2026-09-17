/**
 * Live devnet smoke test for version 1 (SIMD-0385) transactions.
 *
 * Run from the repo root after `bun run build`:
 *
 *   bun packages/core/scripts/v1-devnet-smoke.ts
 *
 * Environment:
 *   PIPEIT_RPC_URL        (default https://api.devnet.solana.com)
 *   PIPEIT_WS_URL         (default derived from the RPC URL)
 *   PIPEIT_PAYER_KEYPAIR  path to a JSON keypair file with devnet SOL; when unset a
 *                         fresh keypair is generated and funded via airdrop (the
 *                         public faucet is rate-limited and may refuse)
 *
 * What it checks:
 *   1. The RPC node is Agave >= 4.2.2 (v1 send/read support).
 *   2. A v1 transaction larger than the legacy 1232-byte limit builds, is sized
 *      against the 4096-byte limit, lands, and reads back as version 1 with the
 *      consumed compute units within the estimated limit.
 *   3. The same with a fixed compute unit limit (only the data size is estimated).
 *   4. The same with an explicit total priority fee in lamports.
 *   5. `executePlan({ version: 1 })` packs a 20-instruction plan.
 */

import { readFileSync } from 'node:fs';
import {
    address,
    airdropFactory,
    createKeyPairSignerFromBytes,
    createSolanaRpc,
    createSolanaRpcSubscriptions,
    generateKeyPairSigner,
    lamports,
    type Signature,
} from '@solana/kit';
import { getTransferSolInstruction } from '@solana-program/system';
import { TransactionBuilder, executePlan, sequentialInstructionPlan } from '../src/index.js';

const RPC_URL = process.env.PIPEIT_RPC_URL ?? 'https://api.devnet.solana.com';
const WS_URL = process.env.PIPEIT_WS_URL ?? RPC_URL.replace(/^http/, 'ws');
const MEMO_PROGRAM = address('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

const rpc = createSolanaRpc(RPC_URL);
const rpcSubscriptions = createSolanaRpcSubscriptions(WS_URL);

type BuiltV1 = { config?: { computeUnitLimit?: number; loadedAccountsDataSizeLimit?: number } };

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

function parseVersion(v: string): [number, number, number] {
    const [a = 0, b = 0, c = 0] = v.split('.').map(Number);
    return [a, b, c];
}

async function checkNodeVersion() {
    const { 'solana-core': core } = await rpc.getVersion().send();
    const [major, minor, patch] = parseVersion(core);
    const ok = major > 4 || (major === 4 && (minor > 2 || (minor === 2 && patch >= 2)));
    console.log(`RPC solana-core ${core} (${ok ? 'supports v1' : 'TOO OLD for v1'})`);
    assert(ok, `RPC node must be Agave >= 4.2.2, got ${core}`);
}

async function fundedSigner() {
    const keypairPath = process.env.PIPEIT_PAYER_KEYPAIR;
    if (keypairPath) {
        const bytes = new Uint8Array(JSON.parse(readFileSync(keypairPath, 'utf8')) as number[]);
        return createKeyPairSignerFromBytes(bytes);
    }

    const signer = await generateKeyPairSigner();
    const airdrop = airdropFactory({ rpc, rpcSubscriptions });
    let lastError: unknown;
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            await airdrop({
                commitment: 'confirmed',
                lamports: lamports(500_000_000n),
                recipientAddress: signer.address,
            });
            return signer;
        } catch (error) {
            lastError = error;
            console.warn(
                `airdrop attempt ${attempt} failed: ${error instanceof Error ? error.message : String(error)}`,
            );
            await new Promise(resolve => setTimeout(resolve, 2_000 * attempt));
        }
    }
    throw new Error(
        'Could not fund a payer via the devnet faucet. Set PIPEIT_PAYER_KEYPAIR to a funded devnet keypair file.',
        { cause: lastError },
    );
}

/** Ten self-transfers plus a large memo: comfortably over 1232 bytes once compiled. */
function largeInstructionSet(signer: Awaited<ReturnType<typeof generateKeyPairSigner>>) {
    const transfers = Array.from({ length: 10 }, () =>
        getTransferSolInstruction({ source: signer, destination: signer.address, amount: lamports(1n) }),
    );
    const memo = { programAddress: MEMO_PROGRAM, data: new TextEncoder().encode('pipeit v1 smoke '.repeat(60)) };
    return [...transfers, memo];
}

async function readBack(signature: Signature, label: string, expectedCuLimit?: number) {
    const tx = await rpc
        .getTransaction(signature, { commitment: 'confirmed', encoding: 'json', maxSupportedTransactionVersion: 1 })
        .send();
    assert(tx, `${label}: transaction not found`);
    assert(tx.version === 1, `${label}: expected version 1, got ${String(tx.version)}`);
    assert(tx.meta?.err == null, `${label}: transaction failed on-chain: ${JSON.stringify(tx.meta?.err)}`);
    const consumed = tx.meta?.computeUnitsConsumed;
    console.log(`  ${label}: version=${tx.version} computeUnitsConsumed=${consumed} fee=${tx.meta?.fee}`);
    if (expectedCuLimit !== undefined && consumed !== undefined) {
        assert(consumed <= BigInt(expectedCuLimit), `${label}: consumed ${consumed} > limit ${expectedCuLimit}`);
    }
}

async function main() {
    await checkNodeVersion();
    const signer = await fundedSigner();
    console.log(`payer ${signer.address}`);

    // 1. auto CU (estimated), estimated data size, per-CU fee converted to lamports
    {
        const builder = new TransactionBuilder({ rpc, version: 1, logLevel: 'verbose', priorityFee: 'low' })
            .setFeePayerSigner(signer)
            .addInstructions(largeInstructionSet(signer));
        const info = await builder.getSizeInfo();
        console.log(`size ${info.size}/${info.limit} bytes (${info.percentUsed.toFixed(1)}%)`);
        assert(info.limit === 4096, 'v1 size limit should be 4096');
        assert(info.size > 1232, 'test message should exceed the legacy 1232-byte limit');
        const built = (await builder.build()) as BuiltV1;
        const signature = (await builder.execute({ rpcSubscriptions, commitment: 'confirmed' })) as Signature;
        await readBack(signature, 'auto CU', built.config?.computeUnitLimit);
    }

    // 2. fixed CU (the memo payload alone burns ~340k CU), estimated data size
    {
        const builder = new TransactionBuilder({ rpc, version: 1, computeUnits: 500_000, priorityFee: 'low' })
            .setFeePayerSigner(signer)
            .addInstructions(largeInstructionSet(signer));
        const built = (await builder.build()) as BuiltV1;
        assert(built.config?.computeUnitLimit === 500_000, 'fixed CU must be preserved on v1');
        assert((built.config?.loadedAccountsDataSizeLimit ?? 0) > 0, 'data size must be estimated on v1');
        const signature = (await builder.execute({ rpcSubscriptions, commitment: 'confirmed' })) as Signature;
        await readBack(signature, 'fixed CU', 500_000);
    }

    // 3. explicit total priority fee in lamports
    {
        const builder = new TransactionBuilder({
            rpc,
            version: 1,
            priorityFee: { strategy: 'fixed', lamports: 5_000n },
        })
            .setFeePayerSigner(signer)
            .addInstructions(largeInstructionSet(signer));
        const signature = (await builder.execute({ rpcSubscriptions, commitment: 'confirmed' })) as Signature;
        await readBack(signature, 'lamports fee');
    }

    // 4. executePlan with version 1 (the executor throws if any transaction fails)
    {
        const plan = sequentialInstructionPlan(
            Array.from({ length: 20 }, () =>
                getTransferSolInstruction({ source: signer, destination: signer.address, amount: lamports(1n) }),
            ),
        );
        const result = await executePlan(plan, { rpc, rpcSubscriptions, signer, version: 1, commitment: 'confirmed' });
        const signatures: string[] = [];
        const walk = (node: unknown) => {
            const n = node as { context?: { signature?: string }; plans?: unknown[] };
            if (n.context?.signature) signatures.push(n.context.signature);
            n.plans?.forEach(walk);
        };
        walk(result);
        console.log(`  executePlan(version: 1): ${result.kind} result, ${signatures.length} transaction(s)`);
        for (const [i, signature] of signatures.entries()) {
            await readBack(signature as Signature, `plan tx ${i + 1}`);
        }
    }

    console.log('\nv1 devnet smoke: OK');
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
