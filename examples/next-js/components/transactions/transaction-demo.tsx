'use client';

import { useConnector } from '@solana/connector';
import { Alert } from '@/components/ui/alert';
import { Info } from 'lucide-react';
import { ModernSolTransfer } from './modern-sol-transfer';
import { PipeitSolTransfer } from './pipeit-sol-transfer';

export function TransactionDemo() {
    const { connected } = useConnector();

    if (!connected) {
        return (
            <Alert>
                <Info className="h-4 w-4" />
                <div className="ml-2">
                    <p className="font-medium">Connect your wallet to get started</p>
                    <p className="text-sm text-muted-foreground mt-1">
                        Works on devnet and mainnet
                    </p>
                </div>
            </Alert>
        );
    }

    return (
            <div className="grid gap-4 lg:grid-cols-2">
            <div>
                <h2 className="text-xl font-semibold mb-4">Gill Approach (Verbose)</h2>
                <ModernSolTransfer />
            </div>
            <div>
                <h2 className="text-xl font-semibold mb-4">Pipeit Approach (Simplified)</h2>
                <PipeitSolTransfer />
            </div>
        </div>
    );
}
