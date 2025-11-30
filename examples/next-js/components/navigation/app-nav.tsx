'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { IconLine3Horizontal, IconXmarkCircleFill } from 'symbols-react';
import { ClusterSelector, AccountSwitcher } from '@/components/connector';
import { useConnector } from '@armadura/connector';
import { cn } from '@/lib/utils';
import { Logo } from './logo';

const navItems = [
    { href: '/', label: 'Home' },
    // { href: '/transactions', label: 'Transactions' },
    { href: '/playground', label: 'Playground' },
];

export const AppNav = React.memo(() => {
    const { connected } = useConnector();
    const pathname = usePathname();
    const [isMobileMenuOpen, setIsMobileMenuOpen] = React.useState(false);

    const toggleMobileMenu = () => {
        setIsMobileMenuOpen(!isMobileMenuOpen);
    };

    const closeMobileMenu = () => {
        setIsMobileMenuOpen(false);
    };

    return (
        <>
            <nav className="sticky top-0 z-50">
                <div className="max-w-7xl mx-auto border-r border-l border-b border-sand-200 bg-[var(--color-bg1)]/70 backdrop-blur-md">
                    <div className="px-4 sm:px-6 lg:px-8 py-4">
                        <div className="flex items-center justify-between h-16">
                            {/* Logo */}
                            <Link href="/" className="flex items-center gap-2 z-10">
                                <Logo width={32} height={32} />
                                <span className="text-2xl font-abc-diatype-medium font-bold text-gray-900">Pipeit</span>
                            </Link>

                            {/* Desktop Navigation */}
                            <div className="hidden md:flex items-center gap-6">
                                {navItems.map((item) => {
                                    const isActive =
                                        pathname === item.href ||
                                        (item.href !== '/' && pathname?.startsWith(item.href));
                                    return (
                                        <Link
                                            key={item.href}
                                            href={item.href}
                                            className={cn(
                                                'text-body-md font-inter-medium transition-colors',
                                                isActive
                                                    ? 'text-gray-900'
                                                    : 'text-gray-600 hover:text-gray-900'
                                            )}
                                        >
                                            {item.label}
                                        </Link>
                                    );
                                })}
                            </div>

                            {/* Mobile Menu Trigger */}
                            <button
                                className="md:hidden p-2 rounded-lg hover:bg-sand-100 transition-colors"
                                onClick={toggleMobileMenu}
                                aria-label="Toggle mobile menu"
                            >
                                <IconLine3Horizontal className="w-6 h-6 fill-gray-900" />
                            </button>
                        </div>
                    </div>
                </div>
            </nav>

            {/* Mobile Menu Overlay */}
            {isMobileMenuOpen && (
                <>
                    {/* Backdrop */}
                    <div
                        className="fixed top-[101px] left-0 right-0 bottom-0 bg-black/20 backdrop-blur-sm z-40 animate-in fade-in-0 duration-150"
                        onClick={closeMobileMenu}
                    />

                    {/* Mobile Menu replacing nav */}
                    <div className="fixed top-0 left-0 right-0 z-50 animate-in slide-in-from-top-2 fade-in-0 duration-150 ease-[cubic-bezier(0.32,0.72,0,1)]">
                        <div className="max-w-7xl mx-auto border-r border-l border-b border-border-low bg-[var(--color-bg1)]/80 backdrop-blur-md">
                            <div className="px-4 sm:px-6 lg:px-8 py-4">
                                <div className="flex items-center justify-between h-16">
                                    {/* Logo */}
                                    <Link href="/" className="flex items-center gap-2" onClick={closeMobileMenu}>
                                        <Logo width={28} height={28} />
                                    </Link>

                                    {/* Close Button */}
                                    <button
                                        className="md:hidden p-2 rounded-lg hover:bg-sand-100 transition-colors"
                                        onClick={closeMobileMenu}
                                        aria-label="Close mobile menu"
                                    >
                                        <IconXmarkCircleFill className="w-6 h-6 fill-gray-900" />
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* Mobile Menu Content */}
                        <div className="animate-in slide-in-from-top-2 fade-in-0 duration-150 delay-75 ease-[cubic-bezier(0.32,0.72,0,1)]">
                            <div className="max-w-7xl mx-auto border-r border-l border-b border-border-low bg-[var(--color-bg1)]">
                                <div className="p-6">
                                    {/* Navigation Links */}
                                    <div className="space-y-2">
                                        {navItems.map((item, index) => {
                                            const isActive =
                                                pathname === item.href ||
                                                (item.href !== '/' && pathname?.startsWith(item.href));
                                            return (
                                                <Link
                                                    key={item.href}
                                                    href={item.href}
                                                    onClick={closeMobileMenu}
                                                    className={cn(
                                                        'block px-3 py-2 font-inter-medium rounded-lg transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] animate-in slide-in-from-left-2 fade-in-0',
                                                        isActive
                                                            ? 'bg-sand-100 text-gray-900'
                                                            : 'text-gray-600 hover:bg-sand-100 hover:text-gray-900'
                                                    )}
                                                    style={{
                                                        animationDelay: `${100 + index * 50}ms`,
                                                        animationFillMode: 'both',
                                                    }}
                                                >
                                                    {item.label}
                                                </Link>
                                            );
                                        })}
                                    </div>

                                    {/* Connector components */}
                                    {connected && (
                                        <div className="mt-6 pt-4 border-t border-border-low space-y-2">
                                            <div className="px-3 py-2">
                                                <ClusterSelector />
                                            </div>
                                            <div className="px-3 py-2">
                                                <AccountSwitcher />
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </>
            )}
        </>
    );
});

AppNav.displayName = 'AppNav';
