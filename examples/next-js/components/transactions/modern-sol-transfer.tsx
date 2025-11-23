'use client';

import { useState } from 'react';
import {
    address,
    createSolanaRpc,
    createSolanaRpcSubscriptions,
    lamports,
    sendAndConfirmTransactionFactory,
} from '@solana/kit';
import { getTransferSolInstruction } from '@solana-program/system';
import { pipe } from '@solana/functional';
import { 
    createTransactionMessage, 
    setTransactionMessageFeePayer, 
    setTransactionMessageLifetimeUsingBlockhash, 
    appendTransactionMessageInstruction 
} from '@solana/transaction-messages';
import { signTransactionMessageWithSigners } from '@solana/signers';

const LAMPORTS_PER_SOL = 1_000_000_000n;
import { useGillTransactionSigner, useCluster, useConnectorClient } from '@solana/connector';
import { TransactionForm } from './transaction-form';
import { TransactionResult } from './transaction-result';
import { CodeComparison } from './code-comparison';

/**
 * Modern SOL Transfer Component
 *
 * Demonstrates using @solana/kit (web3.js 2.0) with modular packages.
 * This shows the modern, type-safe approach to Solana development using
 * connector-kit's gill-compatible TransactionSigner.
 */
export function ModernSolTransfer() {
    const { signer, ready } = useGillTransactionSigner();
    const { cluster } = useCluster();
    const client = useConnectorClient();
    const [signature, setSignature] = useState<string | null>(null);

    async function handleTransfer(recipientAddress: string, amount: number) {
        if (!signer || !client) {
            throw new Error('Wallet not connected or client not available');
        }

        // Get RPC URL from connector client
        const rpcUrl = client.getRpcUrl();
        if (!rpcUrl) {
            throw new Error('No RPC endpoint configured');
        }

        // Create RPC client using web3.js 2.0
        const rpc = createSolanaRpc(rpcUrl);
        const rpcSubscriptions = createSolanaRpcSubscriptions(rpcUrl.replace('http', 'ws'));

        // Create addresses using gill's address() API
        const senderAddress = signer.address;

        // Get recent blockhash using Gill's RPC
        const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

        // Convert SOL to lamports using gill's helper and constant
        const amountInLamports = lamports(BigInt(Math.floor(amount * Number(LAMPORTS_PER_SOL))));

        // Create transfer instruction using gill's modern API
        const transferInstruction = getTransferSolInstruction({
            source: signer,
            destination: address(recipientAddress),
            amount: amountInLamports,
        });

        console.log('🚀 Gill SOL Transfer: Starting transaction');

        try {
            // Use Gill's createTransaction (handles version, fee payer, compute budget)
            const transactionMessage = createTransaction({
                feePayer: signer,
                instructions: [transferInstruction],
                latestBlockhash,
                computeUnitPrice: 10_000n, // Manual priority fee
            });

            // Use Gill's sendAndConfirmTransactionWithSignersFactory
            const sendAndConfirm = sendAndConfirmTransactionWithSignersFactory({ rpc, rpcSubscriptions });
            const transactionSignature = await sendAndConfirm(transactionMessage, {
                commitment: 'confirmed',
            });

            console.log('✅ Gill SOL Transfer: Transaction confirmed', { signature: transactionSignature });
        setSignature(transactionSignature);
            console.log('🎉 Gill SOL Transfer: Transaction complete!', { signature: transactionSignature });

        // Track transaction in debugger
        if (client) {
            client.trackTransaction({
                    signature: transactionSignature as any,
                status: 'confirmed',
                method: 'signAndSendTransaction',
                    feePayer: signer.address,
                });
            }
        } catch (error) {
            console.error('❌ Gill SOL Transfer: Transaction failed', error);
            throw new Error(`Failed to send transaction: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    const gillCode = `// Get RPC and blockhash
const rpc = createSolanaRpc(rpcUrl);
const rpcSubscriptions = createSolanaRpcSubscriptions(rpcUrl.replace('http', 'ws'));
const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

// Create instruction
const transferInstruction = getTransferSolInstruction({
    source: signer,
    destination: address(recipientAddress),
    amount: lamports(BigInt(Math.floor(amount * Number(LAMPORTS_PER_SOL)))),
            });

// Build transaction with Gill's createTransaction
const transactionMessage = createTransaction({
    feePayer: signer,
    instructions: [transferInstruction],
    latestBlockhash,
    computeUnitPrice: 10_000n, // Manual priority fee
});

// Send and confirm with Gill's factory
const sendAndConfirm = sendAndConfirmTransactionWithSignersFactory({ rpc, rpcSubscriptions });
const signature = await sendAndConfirm(transactionMessage, {
    commitment: 'confirmed',
});`;

    return (
        <div className="grid grid-cols-1 lg:grid-cols-6 gap-4">
            <div className="col-span-2">
            <TransactionForm
                title="Gill SOL Transfer"
                description="Manual approach with full control"
                onSubmit={handleTransfer}
                disabled={!ready}
                defaultRecipient="DemoWa11et1111111111111111111111111111111111"
            />
            </div>
            <div className="col-span-4">
            {signature && <TransactionResult signature={signature} cluster={cluster?.id || 'devnet'} />}
            <CodeComparison title="Transaction Code (Gill Approach)" code={gillCode} />
            </div>
        </div>
    );
}
