'use client';

import { useMemo, useState } from 'react';
import { address, createSolanaRpc, createSolanaRpcSubscriptions, lamports } from '@solana/kit';
import { getTransferSolInstruction } from '@solana-program/system';
import { TransactionBuilder } from '@pipeit/core';
import {
    useGillTransactionSigner,
    useCluster,
    useConnector,
    useConnectorClient,
    getWalletsRegistry,
} from '@solana/connector';
import { Alert } from '@/components/ui/alert';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { TransactionForm } from './transaction-form';
import { TransactionResult } from './transaction-result';
import { CodeComparison } from './code-comparison';

const LAMPORTS_PER_SOL = 1_000_000_000n;

/** Wallet Standard features that carry `supportedTransactionVersions`. */
const SIGNING_FEATURES = ['solana:signAndSendTransaction', 'solana:signTransaction'] as const;

type VersionedFeature = { supportedTransactionVersions?: ReadonlySet<'legacy' | 0 | 1> | readonly unknown[] };

/**
 * Look up the connected Wallet Standard wallet and report whether it advertises
 * transaction version 1. Returns `null` when the wallet cannot be identified.
 *
 * Wallets must only advertise version 1 once they can parse and sign it, so an
 * absent `1` means "do not hand this wallet a v1 transaction".
 */
function walletSupportsV1(connectedAddress: string | null): boolean | null {
    if (!connectedAddress) return null;
    const registry = getWalletsRegistry() as unknown as { get?: () => readonly unknown[] };
    const wallets = registry.get?.() ?? [];
    for (const candidate of wallets) {
        const wallet = candidate as {
            accounts?: readonly { address: string }[];
            features?: Record<string, VersionedFeature | undefined>;
        };
        if (!wallet.accounts?.some(account => account.address === connectedAddress)) continue;
        for (const featureName of SIGNING_FEATURES) {
            const versions = wallet.features?.[featureName]?.supportedTransactionVersions;
            if (!versions) continue;
            const list = versions instanceof Set ? Array.from(versions) : Array.from(versions as readonly unknown[]);
            return list.includes(1);
        }
        return false;
    }
    return null;
}

/**
 * Pipeit transaction v1 (SIMD-0385) SOL transfer.
 *
 * Same fluent API as the v0 demo, with `version: 1`: up to 4096 bytes, no
 * address lookup tables, and the compute budget in the message config. Pipeit
 * estimates the compute unit and loaded-accounts-data-size limits by
 * simulation inside `build()` and converts the per-CU priority fee into the
 * total lamports v1 expects.
 */
export function PipeitV1Transfer() {
    const { signer, ready } = useGillTransactionSigner();
    const { cluster } = useCluster();
    const { account } = useConnector();
    const client = useConnectorClient();
    const [signature, setSignature] = useState<string | null>(null);

    const v1Support = useMemo(() => walletSupportsV1(account), [account]);

    async function handleTransfer(recipientAddress: string, amount: number) {
        if (!signer || !client) {
            throw new Error('Wallet not connected or client not available');
        }
        if (v1Support === false) {
            throw new Error('Connected wallet does not advertise transaction version 1 support');
        }

        const rpcUrl = client.getRpcUrl();
        if (!rpcUrl) {
            throw new Error('No RPC endpoint configured');
        }

        const rpc = createSolanaRpc(rpcUrl);
        const rpcSubscriptions = createSolanaRpcSubscriptions(rpcUrl.replace('http', 'ws'));

        const transferInstruction = getTransferSolInstruction({
            source: signer,
            destination: address(recipientAddress),
            amount: lamports(BigInt(Math.floor(amount * Number(LAMPORTS_PER_SOL)))),
        });

        try {
            // version: 1 → limits estimated by simulation, fee converted to total lamports
            const transactionSignature = await new TransactionBuilder({
                rpc,
                version: 1,
                priorityFee: 'medium',
                autoRetry: true,
            })
                .setFeePayerSigner(signer)
                .addInstruction(transferInstruction)
                .execute({
                    rpcSubscriptions,
                    commitment: 'confirmed',
                });

            setSignature(transactionSignature);

            client.trackTransaction({
                signature: transactionSignature as any,
                status: 'confirmed',
                method: 'signAndSendTransaction',
                feePayer: signer.address,
            });
        } catch (error) {
            throw new Error(`Failed to send transaction: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    const v1Code = `// Transaction v1 (SIMD-0385): up to 4096 bytes, no lookup tables,
// compute budget in the message config instead of ComputeBudget instructions.
const signature = await new TransactionBuilder({
  rpc,
  version: 1,            // opt in; default is 0
  priorityFee: 'medium', // per-CU price, converted to total lamports on v1
  autoRetry: true,
})
  .setFeePayerSigner(signer)
  .addInstruction(transferInstruction)
  .execute({ rpcSubscriptions, commitment: 'confirmed' });

// Reading it back needs maxSupportedTransactionVersion: 1
const tx = await rpc
  .getTransaction(signature, { maxSupportedTransactionVersion: 1 })
  .send();`;

    return (
        <div className="grid grid-cols-1 lg:grid-cols-6 gap-4">
            <div className="col-span-2">
                {v1Support === false && (
                    <Alert className="mb-4">
                        <AlertTriangle className="h-4 w-4" />
                        <div className="ml-2">
                            <p className="text-body-md font-inter-medium">Wallet does not support transaction v1</p>
                            <p className="text-body-md text-muted-foreground mt-1">
                                The connected wallet does not list version 1 in supportedTransactionVersions. Use a
                                wallet with v1 support or the v0 demo.
                            </p>
                        </div>
                    </Alert>
                )}
                {v1Support === true && (
                    <Alert className="mb-4">
                        <CheckCircle2 className="h-4 w-4" />
                        <div className="ml-2">
                            <p className="text-body-md font-inter-medium">Wallet advertises transaction v1</p>
                        </div>
                    </Alert>
                )}
                <TransactionForm
                    title="Pipeit v1 SOL Transfer"
                    description="Transaction v1: 4096-byte limit, config-based compute budget"
                    onSubmit={handleTransfer}
                    disabled={!ready || v1Support === false}
                    defaultRecipient="DemoWa11et1111111111111111111111111111111111"
                />
            </div>
            <div className="col-span-4">
                {signature && <TransactionResult signature={signature} cluster={cluster?.id || 'devnet'} />}
                <CodeComparison title="Transaction Code (Pipeit, version 1)" code={v1Code} />
            </div>
        </div>
    );
}
