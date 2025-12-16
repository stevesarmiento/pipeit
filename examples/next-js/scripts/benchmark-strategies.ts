#!/usr/bin/env npx tsx
/**
 * Benchmark script for comparing transaction submission strategies.
 *
 * Runs real mainnet transactions using three different strategies:
 * 1. Simple Transfer - Standard RPC submission
 * 2. Jito Bundle - MEV-protected bundle submission
 * 3. TPU Direct - Direct QUIC submission to validators
 *
 * Usage:
 *   SOLANA_PRIVATE_KEY=<base58_key> RPC_URL=<mainnet_url> npx tsx scripts/benchmark-strategies.ts
 *
 * Environment Variables:
 *   SOLANA_PRIVATE_KEY - Base58 encoded private key
 *   RPC_URL - Mainnet RPC URL (e.g., Helius, Triton, etc.)
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

interface BenchmarkResult {
  strategy: string;
  status: 'success' | 'failed';
  sendTimeMs: number;    // Time to send/submit transaction
  totalTimeMs: number;   // Total time including confirmation
  signature: string;
  costSol: number;
  error?: string;
}

// ============================================================================
// Configuration
// ============================================================================

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
  signer: KeyPairSigner
): Promise<BenchmarkResult> {
  const startTime = performance.now();

  try {
    // Build transaction first
    const instruction = getTransferSolInstruction({
      source: signer,
      destination: signer.address,
      amount: lamports(TRANSFER_AMOUNT),
    });

    const builder = new TransactionBuilder({
      rpc,
      priorityFee: 'medium',
      logLevel: 'silent', // Suppress internal logs during benchmark
    }).setFeePayerSigner(signer).addInstruction(instruction);

    // Time just the send+confirm
    const sendStart = performance.now();
    const signature = await builder.execute({
      rpcSubscriptions,
      commitment: 'confirmed',
    });
    const sendTime = performance.now() - sendStart;

    return {
      strategy: 'RPC (Standard)',
      status: 'success',
      sendTimeMs: Math.round(sendTime),
      totalTimeMs: Math.round(performance.now() - startTime),
      signature,
      costSol: BASE_TX_FEE,
    };
  } catch (error) {
    return {
      strategy: 'RPC (Standard)',
      status: 'failed',
      sendTimeMs: 0,
      totalTimeMs: Math.round(performance.now() - startTime),
      signature: '',
      costSol: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function runJitoBundle(
  rpc: ReturnType<typeof createSolanaRpc>,
  rpcSubscriptions: ReturnType<typeof createSolanaRpcSubscriptions>,
  signer: KeyPairSigner
): Promise<BenchmarkResult> {
  const startTime = performance.now();

  try {
    // Single simple transfer (same as other strategies)
    const transfer = getTransferSolInstruction({
      source: signer,
      destination: signer.address,
      amount: lamports(TRANSFER_AMOUNT),
    });

    // Add Jito tip
    const tipInstruction = createTipInstruction(
      signer.address,
      JITO_DEFAULT_TIP_LAMPORTS
    );

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
          await new Promise((r) => setTimeout(r, 1000 * attempt)); // backoff
        } else {
          throw lastError;
        }
      }
    }

    if (!bundleId) throw lastError;
    
    const sendTime = performance.now() - sendStart;

    return {
      strategy: 'Jito Bundle',
      status: 'success',
      sendTimeMs: Math.round(sendTime),
      totalTimeMs: Math.round(performance.now() - startTime),
      signature: bundleId,
      costSol: BASE_TX_FEE + JITO_TIP_SOL,
    };
  } catch (error) {
    return {
      strategy: 'Jito Bundle',
      status: 'failed',
      sendTimeMs: 0,
      totalTimeMs: Math.round(performance.now() - startTime),
      signature: '',
      costSol: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// TPU Client type for pre-warming
interface TpuClientInstance {
  sendTransaction: (tx: Buffer) => Promise<{ delivered: boolean; leaderCount: number; latencyMs: number }>;
  shutdown: () => void;
}

async function runTpuDirect(
  rpc: ReturnType<typeof createSolanaRpc>,
  signer: KeyPairSigner,
  tpuClient: TpuClientInstance | null  // Pre-warmed client passed in
): Promise<BenchmarkResult> {
  const startTime = performance.now();

  if (!tpuClient) {
    return {
      strategy: 'TPU Direct',
      status: 'failed',
      sendTimeMs: 0,
      totalTimeMs: 0,
      signature: '',
      costSol: 0,
      error: 'TPU client not available',
    };
  }

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
    // Format: [num_sigs (1 byte)][sig1 (64 bytes)]...[message]
    const signatureBytes = txBytes.slice(1, 65);
    const sigBase58 = encodeBase58(signatureBytes);

    return {
      strategy: 'TPU Direct',
      status: result.delivered ? 'success' : 'failed',
      sendTimeMs: Math.round(sendTime),
      totalTimeMs: Math.round(performance.now() - startTime),
      signature: result.delivered ? sigBase58 : '',
      costSol: BASE_TX_FEE,
      error: result.delivered ? undefined : `Not delivered (leaders: ${result.leaderCount})`,
    };
  } catch (error) {
    return {
      strategy: 'TPU Direct',
      status: 'failed',
      sendTimeMs: 0,
      totalTimeMs: Math.round(performance.now() - startTime),
      signature: '',
      costSol: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// ============================================================================
// Output Formatting
// ============================================================================

function printResults(results: BenchmarkResult[]): void {
  console.log('\n');
  console.log('┌───────────────────┬──────────┬────────────┬────────────┬────────────┐');
  console.log('│ Strategy          │ Status   │  Send (ms) │ Total (ms) │ Cost (SOL) │');
  console.log('├───────────────────┼──────────┼────────────┼────────────┼────────────┤');

  for (const result of results) {
    const strategy = result.strategy.padEnd(17);
    const status = (result.status === 'success' ? '✓ OK' : '✗ FAIL').padEnd(8);
    const sendTime = String(result.sendTimeMs).padStart(10);
    const totalTime = String(result.totalTimeMs).padStart(10);
    const cost = result.costSol.toFixed(6).padStart(10);

    console.log(`│ ${strategy} │ ${status} │ ${sendTime} │ ${totalTime} │ ${cost} │`);
  }

  console.log('└───────────────────┴──────────┴────────────┴────────────┴────────────┘');

  // Print signatures separately (full length for explorer)
  console.log('\nSignatures (for Solscan/Explorer):');
  for (const result of results) {
    const status = result.status === 'success' ? '✓' : '✗';
    const sig = result.signature || '-';
    console.log(`  ${status} ${result.strategy}: ${sig}`);
  }

  // Print any errors
  const failures = results.filter((r) => r.status === 'failed' && r.error);
  if (failures.length > 0) {
    console.log('\nErrors:');
    for (const f of failures) {
      console.log(`  ${f.strategy}: ${f.error}`);
    }
  }

  // Print summary
  const successCount = results.filter((r) => r.status === 'success').length;
  const totalCost = results
    .filter((r) => r.status === 'success')
    .reduce((sum, r) => sum + r.costSol, 0);

  // Find fastest by SEND time (apples to apples comparison)
  const successfulResults = results.filter((r) => r.status === 'success');
  const fastestSend = successfulResults.length > 0 
    ? successfulResults.reduce((a, b) => a.sendTimeMs < b.sendTimeMs ? a : b)
    : null;

  console.log('\nSummary:');
  console.log(`  Successful: ${successCount}/${results.length}`);
  console.log(`  Total cost: ${totalCost.toFixed(6)} SOL`);
  if (fastestSend) {
    console.log(`  Fastest (send): ${fastestSend.strategy} (${fastestSend.sendTimeMs}ms)`);
  }
  
  console.log('\nNotes:');
  console.log('  • Send time = just the network request (no confirmation wait)');
  console.log('  • RPC Total includes confirmation wait (~400ms slot time)');
  console.log('  • TPU/Jito send fire-and-forget (faster but no confirmation)');
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║           Transaction Strategy Benchmark (Mainnet)            ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝\n');

  // Validate environment
  const rpcUrl = process.env.RPC_URL;
  if (!rpcUrl) {
    console.error('Error: RPC_URL environment variable is required');
    process.exit(1);
  }

  console.log(`RPC: ${rpcUrl.replace(/api-key=\w+/, 'api-key=***')}`);

  // Load signer
  console.log('Loading signer...');
  const signer = await loadSigner();
  console.log(`Wallet: ${signer.address}\n`);

  // Create RPC clients
  const rpc = createSolanaRpc(rpcUrl);
  const wsUrl = deriveWsUrl(rpcUrl);
  const rpcSubscriptions = createSolanaRpcSubscriptions(wsUrl);

  // Check balance
  const balanceResponse = await rpc.getBalance(signer.address).send();
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
    const { TpuClient } = await import('@pipeit/tpu-native');
    const tpuClientInstance = new TpuClient({
      rpcUrl,
      wsUrl,
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
  console.log('Running RPC vs TPU comparison...\n');

  const [simpleResult, tpuResult] = await Promise.all([
    runSimpleTransfer(rpc, rpcSubscriptions, signer),
    // runJitoBundle(rpc, rpcSubscriptions, signer), // Disabled - Jito rate limits skew results
    runTpuDirect(rpc, signer, tpuClient),
  ]);

  // Shutdown TPU client
  if (tpuClient) {
    (tpuClient as any).shutdown?.();
  }

  const results: BenchmarkResult[] = [simpleResult, tpuResult];

  // Print comparison table
  printResults(results);
  
  if (tpuWarmupTime > 0) {
    console.log(`\nTPU warmup time (one-time): ${tpuWarmupTime}ms`);
  }
}

main().catch((error) => {
  console.error('Benchmark failed:', error);
  process.exit(1);
});
