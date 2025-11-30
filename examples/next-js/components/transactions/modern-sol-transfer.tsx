'use client';

import { useState } from 'react';
import {
    address,
    createSolanaRpc,
    createSolanaRpcSubscriptions,
    lamports,
    sendAndConfirmTransactionFactory,
    pipe,
    createTransactionMessage, 
    setTransactionMessageFeePayer, 
    setTransactionMessageLifetimeUsingBlockhash, 
    appendTransactionMessageInstruction,
    signTransactionMessageWithSigners,
    getSignatureFromTransaction,
} from '@solana/kit';
import { getTransferSolInstruction } from '@solana-program/system';

const LAMPORTS_PER_SOL = 1_000_000_000n;
import { useGillTransactionSigner, useCluster, useConnectorClient } from '@armadura/connector';
import { TransactionForm } from './transaction-form';
import { TransactionResult } from './transaction-result';
import { CodeComparison } from './code-comparison';

/**
 * Modern SOL Transfer Component
 *
 * Demonstrates using @solana/kit (web3.js 2.0) with modular packages.
 * This shows the modern, type-safe approach to Solana development using
 * connector-kit's Kit-compatible TransactionSigner.
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

        // Create addresses using Kit's address() API
        const senderAddress = signer.address;

        // Get recent blockhash
        const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

        // Convert SOL to lamports using Kit's helper
        const amountInLamports = lamports(BigInt(Math.floor(amount * Number(LAMPORTS_PER_SOL))));

        // Create transfer instruction
        const transferInstruction = getTransferSolInstruction({
            source: signer,
            destination: address(recipientAddress),
            amount: amountInLamports,
        });

        console.log('🚀 Kit SOL Transfer: Starting transaction');

        try {
            // Build transaction message using Kit's pipe pattern
            const transactionMessage = pipe(
                createTransactionMessage({ version: 0 }),
                (msg) => setTransactionMessageFeePayer(signer.address, msg),
                (msg) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, msg),
                (msg) => appendTransactionMessageInstruction(transferInstruction, msg),
            );

            // Sign and send using Kit's standard approach
            const signedTransaction = await signTransactionMessageWithSigners(transactionMessage);
            const transactionSignature = getSignatureFromTransaction(signedTransaction);
            const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });
            await sendAndConfirm(signedTransaction as Parameters<typeof sendAndConfirm>[0], {
                commitment: 'confirmed',
            });

            console.log('✅ Kit SOL Transfer: Transaction confirmed', { signature: transactionSignature });
            setSignature(transactionSignature);
            console.log('🎉 Kit SOL Transfer: Transaction complete!', { signature: transactionSignature });

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
            console.error('❌ Kit SOL Transfer: Transaction failed', error);
            throw new Error(`Failed to send transaction: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    const kitCode = `// Get RPC and blockhash
const rpc = createSolanaRpc(rpcUrl);
const rpcSubscriptions = createSolanaRpcSubscriptions(rpcUrl.replace('http', 'ws'));
const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

// Create instruction
const transferInstruction = getTransferSolInstruction({
    source: signer,
    destination: address(recipientAddress),
    amount: lamports(BigInt(Math.floor(amount * Number(LAMPORTS_PER_SOL)))),
});

// Build transaction with Kit's pipe pattern
const transactionMessage = pipe(
    createTransactionMessage({ version: 0 }),
    (msg) => setTransactionMessageFeePayer(signer.address, msg),
    (msg) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, msg),
    (msg) => appendTransactionMessageInstruction(transferInstruction, msg),
);

// Sign and send
const signedTransaction = await signTransactionMessageWithSigners(transactionMessage);
const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });
const signature = await sendAndConfirm(signedTransaction, { commitment: 'confirmed' });`;

    return (
        <div className="grid grid-cols-1 lg:grid-cols-6 gap-4">
            <div className="col-span-2">
            <TransactionForm
                title="Kit SOL Transfer"
                description="Modern @solana/kit approach with full control"
                onSubmit={handleTransfer}
                disabled={!ready}
                defaultRecipient="DemoWa11et1111111111111111111111111111111111"
            />
            </div>
            <div className="col-span-4">
            {signature && <TransactionResult signature={signature} cluster={cluster?.id || 'devnet'} />}
            <CodeComparison title="Transaction Code (Kit Approach)" code={kitCode} />
            </div>
        </div>
    );
}
