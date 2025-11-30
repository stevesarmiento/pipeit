'use client';

import { useMemo } from 'react';
import { AppProvider, getDefaultConfig, getDefaultMobileConfig } from '@armadura/connector';
import type { ReactNode } from 'react';

export function Providers({ children }: { children: ReactNode }) {
    const connectorConfig = useMemo(() => {
        // Get custom RPC URL from environment variable (for mainnet)
        const customRpcUrl = process.env.NEXT_PUBLIC_SOLANA_RPC_URL;

        // Always provide cluster configuration with mainnet as default
        const clusters = [
            {
                id: 'solana:mainnet' as const,
                label: customRpcUrl ? 'Mainnet (Custom RPC)' : 'Mainnet',
                name: 'mainnet-beta' as const,
                url: customRpcUrl || 'https://api.mainnet-beta.solana.com',
            },
            {
                id: 'solana:devnet' as const,
                label: 'Devnet',
                name: 'devnet' as const,
                url: 'https://api.devnet.solana.com',
            },
            {
                id: 'solana:testnet' as const,
                label: 'Testnet',
                name: 'testnet' as const,
                url: 'https://api.testnet.solana.com',
            },
        ];

        return getDefaultConfig({
            appName: 'Pipeit - Solana Transaction Builder',
            appUrl: 'http://localhost:3000',
            autoConnect: true,
            enableMobile: true,
            clusters,
        });
    }, []);

    const mobile = useMemo(
        () =>
            getDefaultMobileConfig({
                appName: 'ConnectorKit Example',
                appUrl: 'http://localhost:3000',
            }),
        [],
    );

    return (
        <AppProvider connectorConfig={connectorConfig} mobile={mobile}>
            {children}
        </AppProvider>
    );
}
