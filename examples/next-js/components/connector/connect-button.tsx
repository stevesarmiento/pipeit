'use client';

import { useConnector } from '@solana/connector';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useState } from 'react';
import { motion } from 'motion/react';
import { WalletModal } from './wallet-modal';
import { Wallet, LogOut, ChevronDown, AlertCircle } from 'lucide-react';

interface ConnectButtonProps {
    className?: string;
}

export function ConnectButton({ className }: ConnectButtonProps) {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const { connected, connecting, selectedWallet, selectedAccount, disconnect, wallets } = useConnector();

    if (connecting) {
        return (
            <Button size="sm" disabled className={className}>
                <div className=" h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
            </Button>
        );
    }

    if (connected && selectedAccount && selectedWallet) {
        const shortAddress = `${selectedAccount.slice(0, 4)}...${selectedAccount.slice(-4)}`;

        // Get wallet icon from wallets list (has proper icons) or fallback to selectedWallet
        const walletWithIcon = wallets.find(w => w.wallet.name === selectedWallet.name);
        const walletIcon = walletWithIcon?.wallet.icon || selectedWallet.icon;

        return (
            <DropdownMenu open={isDropdownOpen} onOpenChange={setIsDropdownOpen}>
                <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className={className}>
                        <Avatar className="h-5 w-5">
                            {walletIcon && <AvatarImage src={walletIcon} alt={selectedWallet.name} />}
                            <AvatarFallback>
                                <Wallet className="h-3 w-3" />
                            </AvatarFallback>
                        </Avatar>
                        <div className="h-8 w-px bg-sand-200" />
                        <motion.div
                            animate={{ rotate: isDropdownOpen ? -90 : 0 }}
                            transition={{ duration: 0.2, ease: 'easeInOut' }}
                        >
                            <ChevronDown className="h-4 w-4 opacity-50" />
                        </motion.div>
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" side="right" className="w-72">
                    <DropdownMenuLabel>
                        <div className="flex flex-col space-y-1">
                            <p className="text-xs font-abc-diatype leading-none"><span className="opacity-50">Connected to</span> {selectedWallet.name}</p>
                            <p className="text-body-md font-berkeley-mono text-muted-foreground">{shortAddress}</p>
                        </div>
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <div className="px-2 py-1.5">
                        <div className="flex items-start gap-2">
                            <AlertCircle className="h-4 w-4 text-amber-500 mt-0.5 flex-shrink-0" />
                            <p className="text-xs text-muted-foreground leading-relaxed">
                                These examples execute SOL transfers (self-transfers to your own address). Each transaction pays standard network fees.
                            </p>
                        </div>
                    </div>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => disconnect()} className="cursor-pointer group hover:!bg-red-600/5 transition-all duration-150 ease-in-out">
                        <LogOut className="mr-2 h-4 w-4 group-hover:text-red-600" />
                        <span className="font-berkeley-mono group-hover:text-red-600">Disconnect</span>
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
        );
    }

    return (
        <>
            <Button size="sm" onClick={() => setIsModalOpen(true)} className={className}>
                Connect
            </Button>
            <WalletModal open={isModalOpen} onOpenChange={setIsModalOpen} />
        </>
    );
}
