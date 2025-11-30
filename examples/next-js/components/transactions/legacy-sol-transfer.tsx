'use client';

import { useState } from 'react';
import { Connection, Transaction, SystemProgram, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { address, signature as createSignature } from '@solana/kit';
import { useWalletAdapterCompat } from '@armadura/connector/compat';
import { useTransactionSigner, useConnector, useCluster, useConnectorClient } from '@armadura/connector';
import { TransactionForm } from './transaction-form';
import { TransactionResult } from './transaction-result';
import { CodeComparison } from './code-comparison';

/**
 * Legacy SOL Transfer Component
 *
 * Demonstrates using @solana/web3.js (v1) with the wallet adapter compat layer.
 * This shows how connector-kit can seamlessly integrate with existing code
 * that was written for @solana/wallet-adapter.
 */
export function LegacySolTransfer() {
    const { signer } = useTransactionSigner();
    const { disconnect } = useConnector();
    const { cluster } = useCluster();
    const client = useConnectorClient();
    const [signature, setSignature] = useState<string | null>(null);

    // Create wallet adapter compatible interface
    const walletAdapter = useWalletAdapterCompat(signer, disconnect);

    async function handleTransfer(recipientAddress: string, amount: number) {
        if (!signer || !client) {
            throw new Error('Wallet not connected or client not available');
        }

        if (!walletAdapter.publicKey) {
            throw new Error('Wallet address not available');
        }

        // Get RPC URL from connector client
        const rpcUrl = client.getRpcUrl();
        if (!rpcUrl) {
            throw new Error('No RPC endpoint configured');
        }

        // Create connection to Solana network
        const connection = new Connection(rpcUrl, 'confirmed');

        // Create recipient public key
        const recipientPubkey = new PublicKey(recipientAddress);
        const senderPubkey = new PublicKey(walletAdapter.publicKey);

        // Get recent blockhash
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();

        // Create transfer instruction using legacy SystemProgram API
        const transferInstruction = SystemProgram.transfer({
            fromPubkey: senderPubkey,
            toPubkey: recipientPubkey,
            lamports: amount * LAMPORTS_PER_SOL,
        });

        // Build transaction
        const transaction = new Transaction({
            feePayer: senderPubkey,
            blockhash,
            lastValidBlockHeight,
        }).add(transferInstruction);

        // Sign and send using wallet adapter compat layer
        const sig = await walletAdapter.sendTransaction(transaction, connection);

        setSignature(sig);

        // Track transaction in debugger
        if (client) {
            client.trackTransaction({
                signature: createSignature(sig),
                status: 'pending' as const,
                method: 'sendTransaction',
                feePayer: address(walletAdapter.publicKey),
            });
        }

        // Wait for confirmation
        try {
            await connection.confirmTransaction({
                signature: sig,
                blockhash,
                lastValidBlockHeight,
            });

            // Update status to confirmed
            if (client) {
                client.updateTransactionStatus(createSignature(sig), 'confirmed');
            }
        } catch (confirmError) {
            // Update status to failed if confirmation fails
            if (client) {
                client.updateTransactionStatus(
                    createSignature(sig),
                    'failed',
                    confirmError instanceof Error ? confirmError.message : 'Confirmation failed',
                );
            }
            throw confirmError;
        }
    }

    const legacyCode = `// Create connection using web3.js v1
const connection = new Connection(rpcUrl, 'confirmed');

// Create public keys
const recipientPubkey = new PublicKey(recipientAddress);
const senderPubkey = new PublicKey(walletAdapter.publicKey);

// Get recent blockhash
const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();

// Create transfer instruction using SystemProgram
const transferInstruction = SystemProgram.transfer({
    fromPubkey: senderPubkey,
    toPubkey: recipientPubkey,
    lamports: amount * LAMPORTS_PER_SOL,
});

// Build transaction
const transaction = new Transaction({
    feePayer: senderPubkey,
    blockhash,
    lastValidBlockHeight,
}).add(transferInstruction);

// Sign and send using wallet adapter
const sig = await walletAdapter.sendTransaction(transaction, connection);

// Wait for confirmation
await connection.confirmTransaction({
    signature: sig,
    blockhash,
    lastValidBlockHeight,
});`;

    return (
        <div className="grid grid-cols-1 lg:grid-cols-6 gap-4">
            <div className="col-span-2">
            <TransactionForm
                title="Legacy SOL Transfer"
                description="Using @solana/web3.js with wallet adapter compat layer"
                onSubmit={handleTransfer}
                disabled={!walletAdapter.connected}
                defaultRecipient="DemoWa11et1111111111111111111111111111111111"
            />
            </div>
            <div className="col-span-4">
                {signature && <TransactionResult signature={signature} cluster={cluster?.id || 'devnet'} />}
                <CodeComparison title="Transaction Code (Legacy Approach)" code={legacyCode} />
            </div>
        </div>
    );
}
