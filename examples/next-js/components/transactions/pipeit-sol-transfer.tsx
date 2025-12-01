'use client';

import { useState } from 'react';
import {
    address,
    createSolanaRpc,
    createSolanaRpcSubscriptions,
    lamports,
} from '@solana/kit';
import { getTransferSolInstruction } from '@solana-program/system';

const LAMPORTS_PER_SOL = 1_000_000_000n;
import { TransactionBuilder } from '@pipeit/core';
import { useGillTransactionSigner, useCluster, useConnectorClient } from '@armadura/connector';
import { TransactionForm } from './transaction-form';
import { TransactionResult } from './transaction-result';
import { CodeComparison } from './code-comparison';

/**
 * Pipeit SOL Transfer Component
 *
 * Demonstrates using @pipeit/core for simplified transaction creation.
 * This shows how pipeit reduces boilerplate compared to the manual Gill approach.
 */
export function PipeitSolTransfer() {
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

        // Create RPC clients
        const rpc = createSolanaRpc(rpcUrl);
        const rpcSubscriptions = createSolanaRpcSubscriptions(rpcUrl.replace('http', 'ws'));

        // Convert SOL to lamports
        const amountInLamports = lamports(BigInt(Math.floor(amount * Number(LAMPORTS_PER_SOL))));

        // Create transfer instruction
        const transferInstruction = getTransferSolInstruction({
            source: signer,
            destination: address(recipientAddress),
            amount: amountInLamports,
        });

        console.log('🚀 Pipeit SOL Transfer: Starting transaction');

        try {
            // Pipeit's fluent API handles everything: blockhash fetching, building, signing, and confirmation
            const transactionSignature = await new TransactionBuilder({ 
                rpc,
                priorityFee: 'medium', 
                autoRetry: true 
            })
                .setFeePayer(signer.address)
                .addInstruction(transferInstruction)
                .execute({
                    rpcSubscriptions,
                    commitment: 'confirmed',
                });

            setSignature(transactionSignature);
            console.log('🎉 Pipeit SOL Transfer: Transaction complete!', { signature: transactionSignature });

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
            console.error('❌ Pipeit SOL Transfer: Transaction failed', error);
            throw new Error(`Failed to send transaction: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    const pipeitCode = `// Create RPC clients
const rpc = createSolanaRpc(rpcUrl);
const rpcSubscriptions = createSolanaRpcSubscriptions(rpcUrl.replace('http', 'ws'));

// Create instruction
const transferInstruction = getTransferSolInstruction({
    source: signer,
    destination: address(recipientAddress),
    amount: lamports(BigInt(Math.floor(amount * Number(LAMPORTS_PER_SOL)))),
});

// Send with opinionated API - smart defaults: auto-retry, priority fees
const signature = await new TransactionBuilder({ 
  rpc,
  priorityLevel: 'medium', 
  autoRetry: true 
})
  .setFeePayer(signer.address)
  .addInstruction(transferInstruction)
  .execute({
    rpcSubscriptions,
    commitment: 'confirmed',
  });`;

    return (
        <div className="grid grid-cols-1 lg:grid-cols-6 gap-4">
            <div className="col-span-2">
            <TransactionForm
                title="Pipeit SOL Transfer"
                description="Simplified with fluent builder API"
                onSubmit={handleTransfer}
                disabled={!ready}
                defaultRecipient="DemoWa11et1111111111111111111111111111111111"
            />
            </div>
            <div className="col-span-4">
            {signature && <TransactionResult signature={signature} cluster={cluster?.id || 'devnet'} />}
            <CodeComparison title="Transaction Code (Pipeit Approach)" code={pipeitCode} />
            </div>
        </div>
    );
}

