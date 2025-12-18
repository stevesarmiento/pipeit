#!/usr/bin/env npx tsx
/**
 * Benchmark script for comparing transaction submission strategies.
 *
 * Sends multiple transactions per strategy and tracks:
 * - Landed vs sent count
 * - Drop rate percentage
 * - Min/avg/max send times
 *
 * Strategies:
 * 1. Helius RPC - Standard RPC submission via Helius
 * 2. Triton RPC - Standard RPC submission via Triton
 * 3. QuickNode RPC - Standard RPC submission via QuickNode
 * 4. TPU Direct - Direct QUIC submission to validators
 *
 * Usage:
 *   SOLANA_PRIVATE_KEY=<key> RPC_URL=<helius_url> TRITON_RPC_URL=<triton_url> QUICKNODE_RPC_URL=<quicknode_url> npx tsx scripts/benchmark-strategies.ts
 *
 * Environment Variables:
 *   SOLANA_PRIVATE_KEY - Base58 encoded private key
 *   RPC_URL - Helius RPC URL
 *   TRITON_RPC_URL - Triton RPC URL (e.g., https://xxx.mainnet.rpcpool.com/token)
 *   QUICKNODE_RPC_URL - QuickNode RPC URL (e.g., https://xxx.solana-mainnet.quiknode.pro/token/)
 *   TX_COUNT - Number of transactions per strategy (default: 5)
 */

import {
    createFlow,
    TransactionBuilder,
    createTipInstruction,
    JITO_DEFAULT_TIP_LAMPORTS,
    sendBundle,
} from '@pipeit/core';
import { getTransferSolInstruction } from '@solana-program/system';
import {
    createKeyPairSignerFromBytes,
    lamports,
    createSolanaRpc,
    createSolanaRpcSubscriptions,
    getBase58Encoder,
    type KeyPairSigner,
} from '@solana/kit';

// ============================================================================
// Types
// ============================================================================

interface TransactionAttempt {
    status: 'success' | 'failed';
    sendTimeMs: number;
    totalTimeMs: number;
    signature: string;
    error?: string;
}

interface BenchmarkResult {
    strategy: string;
    sent: number;
    landed: number;
    dropRate: number; // percentage
    avgSendTimeMs: number;
    avgTotalTimeMs: number;
    minSendTimeMs: number;
    maxSendTimeMs: number;
    costSol: number;
    signatures: string[];
    errors: string[];
}

// ============================================================================
// Configuration
// ============================================================================

const TX_COUNT = Number(process.env.TX_COUNT) || 40; // Number of transactions per strategy
const TRANSFER_AMOUNT = BigInt(1000); // 0.000001 SOL - minimal amount for self-transfer
const BASE_TX_FEE = 0.000005; // Base transaction fee in SOL
const JITO_TIP_SOL = Number(JITO_DEFAULT_TIP_LAMPORTS) / 1e9;

// ============================================================================
// Helpers
// ============================================================================

function formatSignature(sig: string): string {
    if (!sig || sig === '-') return '-';
    return sig;
}

// Base58 alphabet for encoding signatures
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function encodeBase58(bytes: Uint8Array | Buffer): string {
    const byteArray = Array.from(bytes);
    const digits = [0];
    for (let j = 0; j < byteArray.length; j++) {
        let carry = byteArray[j];
        for (let i = 0; i < digits.length; i++) {
            carry += digits[i] << 8;
            digits[i] = carry % 58;
            carry = Math.floor(carry / 58);
        }
        while (carry > 0) {
            digits.push(carry % 58);
            carry = Math.floor(carry / 58);
        }
    }
    // Handle leading zeros
    let str = '';
    for (let j = 0; j < byteArray.length; j++) {
        if (byteArray[j] === 0) str += BASE58_ALPHABET[0];
        else break;
    }
    // Convert digits to string (reverse order)
    for (let i = digits.length - 1; i >= 0; i--) {
        str += BASE58_ALPHABET[digits[i]];
    }
    return str;
}

function deriveWsUrl(rpcUrl: string): string {
    const url = new URL(rpcUrl);
    url.protocol = url.protocol.replace('http', 'ws');
    return url.toString();
}

async function loadSigner(): Promise<KeyPairSigner> {
    const privateKey = process.env.SOLANA_PRIVATE_KEY;
    if (!privateKey) {
        throw new Error('SOLANA_PRIVATE_KEY environment variable is required');
    }

    let keyBytes: Uint8Array;

    // Check if it's a JSON array (byte array format) or base58 string
    if (privateKey.startsWith('[')) {
        // Parse JSON byte array
        const bytes = JSON.parse(privateKey) as number[];
        keyBytes = new Uint8Array(bytes);
    } else {
        // Base58 encoded string
        const encoder = getBase58Encoder();
        keyBytes = encoder.encode(privateKey) as Uint8Array;
    }

    return createKeyPairSignerFromBytes(keyBytes);
}

// ============================================================================
// Strategy Implementations
// ============================================================================

async function runSimpleTransfer(
    rpc: ReturnType<typeof createSolanaRpc>,
    rpcSubscriptions: ReturnType<typeof createSolanaRpcSubscriptions>,
    signer: KeyPairSigner,
    strategyName: string,
    txCount: number,
): Promise<BenchmarkResult> {
    const attempts: TransactionAttempt[] = [];

    for (let i = 0; i < txCount; i++) {
        const startTime = performance.now();

        try {
            // Build transaction
            const instruction = getTransferSolInstruction({
                source: signer,
                destination: signer.address,
                amount: lamports(TRANSFER_AMOUNT),
            });

            const builder = new TransactionBuilder({
                rpc,
                priorityFee: 'medium',
                logLevel: 'silent',
            })
                .setFeePayerSigner(signer)
                .addInstruction(instruction);

            // Time just the send+confirm
            const sendStart = performance.now();
            const signature = await builder.execute({
                rpcSubscriptions,
                commitment: 'confirmed',
            });
            const sendTime = performance.now() - sendStart;

            attempts.push({
                status: 'success',
                sendTimeMs: Math.round(sendTime),
                totalTimeMs: Math.round(performance.now() - startTime),
                signature,
            });
        } catch (error) {
            attempts.push({
                status: 'failed',
                sendTimeMs: 0,
                totalTimeMs: Math.round(performance.now() - startTime),
                signature: '',
                error: error instanceof Error ? error.message : String(error),
            });
        }

        // Small delay between transactions to avoid rate limiting
        if (i < txCount - 1) {
            await new Promise(r => setTimeout(r, 100));
        }
    }

    return aggregateResults(strategyName, attempts);
}

function aggregateResults(strategy: string, attempts: TransactionAttempt[]): BenchmarkResult {
    const successful = attempts.filter(a => a.status === 'success');
    const failed = attempts.filter(a => a.status === 'failed');

    const sendTimes = successful.map(a => a.sendTimeMs);
    const avgSendTime = sendTimes.length > 0 ? sendTimes.reduce((a, b) => a + b, 0) / sendTimes.length : 0;
    const minSendTime = sendTimes.length > 0 ? Math.min(...sendTimes) : 0;
    const maxSendTime = sendTimes.length > 0 ? Math.max(...sendTimes) : 0;

    const totalTimes = successful.map(a => a.totalTimeMs);
    const avgTotalTime = totalTimes.length > 0 ? totalTimes.reduce((a, b) => a + b, 0) / totalTimes.length : 0;

    return {
        strategy,
        sent: attempts.length,
        landed: successful.length,
        dropRate: attempts.length > 0 ? ((attempts.length - successful.length) / attempts.length) * 100 : 0,
        avgSendTimeMs: Math.round(avgSendTime),
        avgTotalTimeMs: Math.round(avgTotalTime),
        minSendTimeMs: minSendTime,
        maxSendTimeMs: maxSendTime,
        costSol: successful.length * BASE_TX_FEE,
        signatures: successful.map(a => a.signature),
        errors: failed.map(a => a.error || 'Unknown error'),
    };
}

async function runJitoBundle(
    rpc: ReturnType<typeof createSolanaRpc>,
    _rpcSubscriptions: ReturnType<typeof createSolanaRpcSubscriptions>,
    signer: KeyPairSigner,
    txCount: number,
): Promise<BenchmarkResult> {
    const attempts: TransactionAttempt[] = [];

    for (let i = 0; i < txCount; i++) {
        const startTime = performance.now();

        try {
            // Single simple transfer (same as other strategies)
            const transfer = getTransferSolInstruction({
                source: signer,
                destination: signer.address,
                amount: lamports(TRANSFER_AMOUNT),
            });

            // Add Jito tip
            const tipInstruction = createTipInstruction(signer.address, JITO_DEFAULT_TIP_LAMPORTS);

            // Build and export transaction as base64
            const exported = await new TransactionBuilder({
                rpc,
                priorityFee: 'medium',
                logLevel: 'silent',
            })
                .setFeePayerSigner(signer)
                .addInstruction(transfer)
                .addInstruction(tipInstruction)
                .export('base64');

            const base64Tx = exported.data as string;

            // Time just the bundle submission
            const sendStart = performance.now();

            // Submit to Jito with retry on rate limit
            let bundleId: string | null = null;
            let lastError: Error | null = null;

            for (let attempt = 1; attempt <= 3; attempt++) {
                try {
                    bundleId = await sendBundle([base64Tx], {
                        blockEngineUrl: 'mainnet',
                    });
                    break;
                } catch (err) {
                    lastError = err as Error;
                    const isRateLimit = lastError.message.includes('429') || lastError.message.includes('rate');
                    if (isRateLimit && attempt < 3) {
                        await new Promise(r => setTimeout(r, 1000 * attempt)); // backoff
                    } else {
                        throw lastError;
                    }
                }
            }

            if (!bundleId) throw lastError;

            const sendTime = performance.now() - sendStart;

            attempts.push({
                status: 'success',
                sendTimeMs: Math.round(sendTime),
                totalTimeMs: Math.round(performance.now() - startTime),
                signature: bundleId,
            });
        } catch (error) {
            attempts.push({
                status: 'failed',
                sendTimeMs: 0,
                totalTimeMs: Math.round(performance.now() - startTime),
                signature: '',
                error: error instanceof Error ? error.message : String(error),
            });
        }

        // Delay between transactions
        if (i < txCount - 1) {
            await new Promise(r => setTimeout(r, 500)); // longer delay for Jito rate limits
        }
    }

    // Adjust cost for Jito tip
    const result = aggregateResults('Jito Bundle', attempts);
    result.costSol = result.landed * (BASE_TX_FEE + JITO_TIP_SOL);
    return result;
}

// TPU Client type for pre-warming
interface TpuClientInstance {
    sendTransaction: (tx: Buffer) => Promise<{ delivered: boolean; leaderCount: number; latencyMs: number }>;
    shutdown: () => void;
}

async function runTpuDirect(
    rpc: ReturnType<typeof createSolanaRpc>,
    signer: KeyPairSigner,
    tpuClient: TpuClientInstance | null,
    txCount: number,
): Promise<BenchmarkResult> {
    if (!tpuClient) {
        return {
            strategy: 'TPU Direct',
            sent: txCount,
            landed: 0,
            dropRate: 100,
            avgSendTimeMs: 0,
            avgTotalTimeMs: 0,
            minSendTimeMs: 0,
            maxSendTimeMs: 0,
            costSol: 0,
            signatures: [],
            errors: ['TPU client not available'],
        };
    }

    const attempts: TransactionAttempt[] = [];

    for (let i = 0; i < txCount; i++) {
        const startTime = performance.now();

        try {
            // Build a simple transfer transaction
            const instruction = getTransferSolInstruction({
                source: signer,
                destination: signer.address,
                amount: lamports(TRANSFER_AMOUNT),
            });

            // Export as bytes for TPU submission
            const exported = await new TransactionBuilder({
                rpc,
                priorityFee: 'medium',
                logLevel: 'silent',
            })
                .setFeePayerSigner(signer)
                .addInstruction(instruction)
                .export('bytes');

            const txBytes = Buffer.from(exported.data);

            // Time just the TPU send
            const sendStart = performance.now();
            const result = await tpuClient.sendTransaction(txBytes);
            const sendTime = performance.now() - sendStart;

            // Extract signature from the signed transaction bytes
            const signatureBytes = txBytes.slice(1, 65);
            const sigBase58 = encodeBase58(signatureBytes);

            attempts.push({
                status: result.delivered ? 'success' : 'failed',
                sendTimeMs: Math.round(sendTime),
                totalTimeMs: Math.round(performance.now() - startTime),
                signature: result.delivered ? sigBase58 : '',
                error: result.delivered ? undefined : `Not delivered (leaders: ${result.leaderCount})`,
            });
        } catch (error) {
            attempts.push({
                status: 'failed',
                sendTimeMs: 0,
                totalTimeMs: Math.round(performance.now() - startTime),
                signature: '',
                error: error instanceof Error ? error.message : String(error),
            });
        }

        // Small delay between transactions
        if (i < txCount - 1) {
            await new Promise(r => setTimeout(r, 50));
        }
    }

    return aggregateResults('TPU Direct', attempts);
}

// ============================================================================
// Output Formatting
// ============================================================================

function printResults(results: BenchmarkResult[], txCount: number): void {
    console.log('\n');
    console.log('┌───────────────────┬────────────┬────────────┬────────────┬────────────┬────────────┬────────────┐');
    console.log('│ Strategy          │ Landed     │ Drop Rate  │ Avg Send   │ Min Send   │ Max Send   │ Cost (SOL) │');
    console.log('├───────────────────┼────────────┼────────────┼────────────┼────────────┼────────────┼────────────┤');

    for (const result of results) {
        const strategy = result.strategy.padEnd(17);
        const landed = `${result.landed}/${result.sent}`.padStart(10);
        const dropRate = `${result.dropRate.toFixed(1)}%`.padStart(10);
        const avgSend = `${result.avgSendTimeMs}ms`.padStart(10);
        const minSend = `${result.minSendTimeMs}ms`.padStart(10);
        const maxSend = `${result.maxSendTimeMs}ms`.padStart(10);
        const cost = result.costSol.toFixed(6).padStart(10);

        console.log(`│ ${strategy} │ ${landed} │ ${dropRate} │ ${avgSend} │ ${minSend} │ ${maxSend} │ ${cost} │`);
    }

    console.log('└───────────────────┴────────────┴────────────┴────────────┴────────────┴────────────┴────────────┘');

    // Print any errors (summarized)
    const resultsWithErrors = results.filter(r => r.errors.length > 0);
    if (resultsWithErrors.length > 0) {
        console.log('\nErrors:');
        for (const r of resultsWithErrors) {
            const uniqueErrors = [...new Set(r.errors)];
            for (const err of uniqueErrors.slice(0, 3)) {
                console.log(`  ${r.strategy}: ${err}`);
            }
            if (uniqueErrors.length > 3) {
                console.log(`  ${r.strategy}: ... and ${uniqueErrors.length - 3} more unique errors`);
            }
        }
    }

    // Print summary
    const totalSent = results.reduce((sum, r) => sum + r.sent, 0);
    const totalLanded = results.reduce((sum, r) => sum + r.landed, 0);
    const totalCost = results.reduce((sum, r) => sum + r.costSol, 0);
    const overallDropRate = totalSent > 0 ? ((totalSent - totalLanded) / totalSent) * 100 : 0;

    // Find fastest by AVG send time
    const successfulResults = results.filter(r => r.landed > 0);
    const fastestAvg =
        successfulResults.length > 0
            ? successfulResults.reduce((a, b) => (a.avgSendTimeMs < b.avgSendTimeMs ? a : b))
            : null;
    const lowestDropRate =
        successfulResults.length > 0 ? successfulResults.reduce((a, b) => (a.dropRate < b.dropRate ? a : b)) : null;

    console.log('\nSummary:');
    console.log(`  Transactions per strategy: ${txCount}`);
    console.log(`  Total sent: ${totalSent}, Total landed: ${totalLanded}`);
    console.log(`  Overall drop rate: ${overallDropRate.toFixed(1)}%`);
    console.log(`  Total cost: ${totalCost.toFixed(6)} SOL`);
    if (fastestAvg) {
        console.log(`  Fastest avg send: ${fastestAvg.strategy} (${fastestAvg.avgSendTimeMs}ms)`);
    }
    if (lowestDropRate && lowestDropRate.dropRate < 100) {
        console.log(`  Most reliable: ${lowestDropRate.strategy} (${lowestDropRate.dropRate.toFixed(1)}% drop rate)`);
    }

    console.log('\nNotes:');
    console.log('  • Send time = network request + confirmation wait');
    console.log('  • TPU send is fire-and-forget (faster but reports "delivered" not "confirmed")');
    console.log('  • Set TX_COUNT env var to change number of transactions (default: 5)');

    // Print sample signatures for verification
    console.log('\nSample signatures (for Solscan/Explorer):');
    for (const result of results) {
        if (result.signatures.length > 0) {
            console.log(`  ${result.strategy}: ${result.signatures[0]}`);
        }
    }
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
    console.log('╔═══════════════════════════════════════════════════════════════╗');
    console.log('║           Transaction Strategy Benchmark (Mainnet)            ║');
    console.log('╚═══════════════════════════════════════════════════════════════╝\n');

    // Validate environment
    const heliusRpcUrl = process.env.RPC_URL;
    if (!heliusRpcUrl) {
        console.error('Error: RPC_URL environment variable is required');
        process.exit(1);
    }

    const tritonRpcUrl = process.env.TRITON_RPC_URL;
    if (!tritonRpcUrl) {
        console.error('Error: TRITON_RPC_URL environment variable is required');
        process.exit(1);
    }

    const quicknodeRpcUrl = process.env.QUICKNODE_RPC_URL;
    if (!quicknodeRpcUrl) {
        console.error('Error: QUICKNODE_RPC_URL environment variable is required');
        process.exit(1);
    }

    console.log(`Helius RPC: ${heliusRpcUrl.replace(/api-key=\w+/, 'api-key=***')}`);
    console.log(`Triton RPC: ${tritonRpcUrl.replace(/\/[a-f0-9-]{36}$/, '/***')}`);
    console.log(`QuickNode RPC: ${quicknodeRpcUrl.replace(/\.pro\/[a-f0-9]+\/?$/, '.pro/***')}`);

    // Load signer
    console.log('\nLoading signer...');
    const signer = await loadSigner();
    console.log(`Wallet: ${signer.address}\n`);

    // Create RPC clients for Helius
    const heliusRpc = createSolanaRpc(heliusRpcUrl);
    const heliusWsUrl = deriveWsUrl(heliusRpcUrl);
    const heliusRpcSubscriptions = createSolanaRpcSubscriptions(heliusWsUrl);

    // Create RPC clients for Triton
    const tritonRpc = createSolanaRpc(tritonRpcUrl);
    const tritonWsUrl = deriveWsUrl(tritonRpcUrl);
    const tritonRpcSubscriptions = createSolanaRpcSubscriptions(tritonWsUrl);

    // Create RPC clients for QuickNode
    const quicknodeRpc = createSolanaRpc(quicknodeRpcUrl);
    const quicknodeWsUrl = deriveWsUrl(quicknodeRpcUrl);
    const quicknodeRpcSubscriptions = createSolanaRpcSubscriptions(quicknodeWsUrl);

    // Check balance (using Helius)
    const balanceResponse = await heliusRpc.getBalance(signer.address).send();
    const balanceSol = Number(balanceResponse.value) / 1e9;
    console.log(`Balance: ${balanceSol.toFixed(4)} SOL\n`);

    if (balanceSol < 0.01) {
        console.error('Error: Insufficient balance. Need at least 0.01 SOL for testing.');
        process.exit(1);
    }

    // Pre-warm TPU client (this is the expensive part - leader schedule fetch + QUIC connections)
    console.log('Warming up TPU client...');
    let tpuClient: TpuClientInstance | null = null;
    let tpuWarmupTime = 0;

    try {
        const tpuStart = performance.now();
        const { TpuClient } = await import('@pipeit/fastlane');
        const tpuClientInstance = new TpuClient({
            rpcUrl: heliusRpcUrl,
            wsUrl: heliusWsUrl,
            fanout: 2,
        });
        await tpuClientInstance.waitReady();
        tpuWarmupTime = Math.round(performance.now() - tpuStart);
        tpuClient = tpuClientInstance as TpuClientInstance;
        console.log(`  TPU client ready (warmup took ${tpuWarmupTime}ms)\n`);
    } catch (error) {
        console.log(`  TPU client unavailable: ${(error as Error).message}\n`);
    }

    // Run all strategies IN PARALLEL for accurate timing comparison
    console.log(`Running benchmark with ${TX_COUNT} transactions per strategy...\n`);

    const [heliusResult, tritonResult, quicknodeResult, tpuResult] = await Promise.all([
        runSimpleTransfer(heliusRpc, heliusRpcSubscriptions, signer, 'Helius RPC', TX_COUNT),
        runSimpleTransfer(tritonRpc, tritonRpcSubscriptions, signer, 'Triton RPC', TX_COUNT),
        runSimpleTransfer(quicknodeRpc, quicknodeRpcSubscriptions, signer, 'QuickNode RPC', TX_COUNT),
        runTpuDirect(heliusRpc, signer, tpuClient, TX_COUNT),
    ]);

    // Shutdown TPU client
    if (tpuClient) {
        (tpuClient as any).shutdown?.();
    }

    const results: BenchmarkResult[] = [heliusResult, tritonResult, quicknodeResult, tpuResult];

    // Print comparison table
    printResults(results, TX_COUNT);

    if (tpuWarmupTime > 0) {
        console.log(`\nTPU warmup time (one-time): ${tpuWarmupTime}ms`);
    }
}

main().catch(error => {
    console.error('Benchmark failed:', error);
    process.exit(1);
});
