'use client';

import { useConnector } from '@armadura/connector';
import { Alert } from '@/components/ui/alert';
import { Info } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { LegacySolTransfer } from './legacy-sol-transfer';
import { ModernSolTransfer } from './modern-sol-transfer';
import { PipeitSolTransfer } from './pipeit-sol-transfer';

export function TransactionDemo() {
    const { connected } = useConnector();

    if (!connected) {
        return (
            <Alert>
                <Info className="h-4 w-4" />
                <div className="ml-2">
                    <p className="text-body-md font-inter-medium">Connect your wallet to get started</p>
                    <p className="text-body-md text-muted-foreground mt-1">
                        Works on devnet and mainnet
                    </p>
                </div>
            </Alert>
        );
    }

    return (
        <Tabs defaultValue="pipeit" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="pipeit">Simplified (Pipeit)</TabsTrigger>
                <TabsTrigger value="modern">Modern (Gill)</TabsTrigger>
                <TabsTrigger value="legacy">Legacy (web3.js)</TabsTrigger>
            </TabsList>
            <TabsContent value="pipeit" className="mt-6">
                <PipeitSolTransfer />
            </TabsContent>
            <TabsContent value="modern" className="mt-6">
                <ModernSolTransfer />
            </TabsContent>
            <TabsContent value="legacy" className="mt-6">
                <LegacySolTransfer />
            </TabsContent>
        </Tabs>
    );
}
