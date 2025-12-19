'use client';

import { useMemo } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { useGillTransactionSigner, useConnectorClient } from '@solana/connector';
import { createSolanaRpc, createSolanaRpcSubscriptions, address } from '@solana/kit';

import {
    BuilderCanvas,
    BuilderToolbar,
    NodePalette,
    NodeInspector,
    FeedbackPanel,
} from '@/components/builder';
import { useBuilderFeedback } from '@/lib/builder';
import type { CompileContext } from '@/lib/builder/types';
import { ConnectButton } from '@/components/connector';

// =============================================================================
// Builder Page Content
// =============================================================================

function BuilderContent() {
    const { signer, ready } = useGillTransactionSigner();
    const client = useConnectorClient();

    // Create compile context from wallet connection
    const compileContext = useMemo<CompileContext | null>(() => {
        if (!ready || !signer || !client) return null;

        const rpcUrl = client.getRpcUrl();
        if (!rpcUrl) return null;

        const rpc = createSolanaRpc(rpcUrl);
        const rpcSubscriptions = createSolanaRpcSubscriptions(
            rpcUrl.replace('https', 'wss').replace('http', 'ws')
        );

        return {
            signer,
            rpc,
            rpcSubscriptions,
            walletAddress: address(signer.address),
        };
    }, [ready, signer, client]);

    // Get feedback for the current graph
    const feedback = useBuilderFeedback(compileContext);

    return (
        <div className="h-screen flex flex-col bg-white">
            {/* Toolbar */}
            <BuilderToolbar compileContext={compileContext} />

            {/* Main content */}
            <div className="flex-1 flex overflow-hidden">
                {/* Node palette */}
                <NodePalette />

                {/* Canvas */}
                <div className="flex-1 flex flex-col">
                    {/* Connection status banner */}
                    {!ready && (
                        <div className="bg-yellow-50 border-b border-yellow-200 px-4 py-2 flex items-center justify-between">
                            <span className="text-sm text-yellow-800">
                                Connect your wallet to simulate and execute transactions
                            </span>
                            <ConnectButton />
                        </div>
                    )}

                    {/* React Flow canvas */}
                    <BuilderCanvas />

                    {/* Feedback panel */}
                    <FeedbackPanel feedback={feedback} />
                </div>

                {/* Inspector panel */}
                <NodeInspector />
            </div>
        </div>
    );
}

// =============================================================================
// Builder Page
// =============================================================================

export default function BuilderPage() {
    return (
        <ReactFlowProvider>
            <BuilderContent />
        </ReactFlowProvider>
    );
}

