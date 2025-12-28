'use client';

import * as React from 'react';
import Link from 'next/link';
import { IconLine3Horizontal, IconXmarkCircleFill } from 'symbols-react';
import { ClusterSelector, AccountSwitcher } from '@/components/connector';
import { useConnector } from '@solana/connector';
import { CopyButton } from '@/components/ui/copy-button';
import { Logo } from './logo';

export const AppNav = React.memo(() => {
    const { connected } = useConnector();
    const [isMobileMenuOpen, setIsMobileMenuOpen] = React.useState(false);
    const [showCopyButtons, setShowCopyButtons] = React.useState(false);

    // Watch for hero copy buttons visibility
    React.useEffect(() => {
        const heroCopyButtons = document.getElementById('hero-copy-buttons');
        if (!heroCopyButtons) return;

        const observer = new IntersectionObserver(
            ([entry]) => {
                // Show nav copy buttons when hero buttons are NOT visible
                setShowCopyButtons(!entry.isIntersecting);
            },
            {
                threshold: 0,
                rootMargin: '-64px 0px 0px 0px', // Account for nav height
            },
        );

        observer.observe(heroCopyButtons);
        return () => observer.disconnect();
    }, []);

    const toggleMobileMenu = () => {
        setIsMobileMenuOpen(!isMobileMenuOpen);
    };

    const closeMobileMenu = () => {
        setIsMobileMenuOpen(false);
    };

    return (
        <>
            <header className="sticky top-0 z-50 w-full border-b border-border-low bg-bg1/80 backdrop-blur-sm">
                <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
                    {/* Logo & Brand */}
                    <div className="flex items-center gap-8">
                        <Link href="/" className="flex items-center gap-2">
                            <Logo width={32} height={32} className="flex-shrink-0" />
                            <span className="font-diatype-bold text-title-5 text-sand-1500 hidden sm:block">
                                Pipeit
                            </span>
                        </Link>
                    </div>

                    {/* Copy Buttons - appear when hero buttons scroll out of view */}
                    <div
                        className={`hidden md:flex items-center gap-2 transition-all duration-300 ${
                            showCopyButtons
                                ? 'opacity-100 translate-y-0'
                                : 'opacity-0 -translate-y-2 pointer-events-none'
                        }`}
                    >
                        <CopyButton
                            textToCopy="npm install @pipeit/core"
                            displayText={<code className="text-xs">npm i @pipeit/core</code>}
                            className="inline-flex items-center gap-1.5 bg-sand-100 rounded-md px-2.5 py-1.5 font-berkeley-mono text-xs text-gray-900 hover:bg-sand-200 border border-sand-200 transition-colors"
                            iconClassName="text-gray-600 size-3"
                            iconClassNameCheck="text-gray-900 size-3"
                            showText={true}
                        />
                        <CopyButton
                            textToCopy="npm install @pipeit/fastlane"
                            displayText={<code className="text-xs">npm i @pipeit/fastlane</code>}
                            className="inline-flex items-center gap-1.5 bg-sand-100 rounded-md px-2.5 py-1.5 font-berkeley-mono text-xs text-gray-900 hover:bg-sand-200 border border-sand-200 transition-colors"
                            iconClassName="text-gray-600 size-3"
                            iconClassNameCheck="text-gray-900 size-3"
                            showText={true}
                        />
                    </div>

                    {/* Mobile Menu Trigger */}
                    <button
                        className="md:hidden p-2 rounded-lg hover:bg-sand-100 transition-colors"
                        onClick={toggleMobileMenu}
                        aria-label="Toggle mobile menu"
                    >
                        <IconLine3Horizontal className="w-6 h-6 fill-sand-1500" />
                    </button>
                </div>
            </header>

            {/* Mobile Menu Overlay */}
            {isMobileMenuOpen && (
                <>
                    {/* Backdrop */}
                    <div
                        className="fixed top-16 left-0 right-0 bottom-0 bg-black/20 backdrop-blur-sm z-40 animate-in fade-in-0 duration-150"
                        onClick={closeMobileMenu}
                    />

                    {/* Mobile Menu */}
                    <div className="fixed top-0 left-0 right-0 z-50 animate-in slide-in-from-top-2 fade-in-0 duration-150 ease-[cubic-bezier(0.32,0.72,0,1)]">
                        <header className="w-full border-b border-border-low bg-bg1/95 backdrop-blur-md">
                            <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
                                {/* Logo */}
                                <Link href="/" className="flex items-center gap-2" onClick={closeMobileMenu}>
                                    <Logo width={32} height={32} className="flex-shrink-0" />
                                    <span className="font-diatype-bold text-title-5 text-sand-1500">Pipeit</span>
                                </Link>

                                {/* Close Button */}
                                <button
                                    className="p-2 rounded-lg hover:bg-sand-100 transition-colors"
                                    onClick={closeMobileMenu}
                                    aria-label="Close mobile menu"
                                >
                                    <IconXmarkCircleFill className="w-6 h-6 fill-sand-1500" />
                                </button>
                            </div>
                        </header>

                        {/* Mobile Menu Content */}
                        <div className="animate-in slide-in-from-top-2 fade-in-0 duration-150 delay-75 ease-[cubic-bezier(0.32,0.72,0,1)]">
                            <div className="max-w-7xl mx-auto bg-bg1 border-b border-border-low">
                                <div className="p-4">
                                    {/* Copy Buttons */}
                                    <div className="space-y-2 mb-4">
                                        <CopyButton
                                            textToCopy="npm install @pipeit/core"
                                            displayText={<code>npm i @pipeit/core</code>}
                                            className="w-full inline-flex items-center justify-center gap-2 bg-sand-100 rounded-lg px-4 py-3 font-berkeley-mono text-sm text-gray-900 hover:bg-sand-200 border border-sand-200 transition-colors"
                                            iconClassName="text-gray-600"
                                            iconClassNameCheck="text-gray-900"
                                            showText={true}
                                        />
                                        <CopyButton
                                            textToCopy="npm install @pipeit/fastlane"
                                            displayText={<code>npm i @pipeit/fastlane</code>}
                                            className="w-full inline-flex items-center justify-center gap-2 bg-sand-100 rounded-lg px-4 py-3 font-berkeley-mono text-sm text-gray-900 hover:bg-sand-200 border border-sand-200 transition-colors"
                                            iconClassName="text-gray-600"
                                            iconClassNameCheck="text-gray-900"
                                            showText={true}
                                        />
                                    </div>

                                    {/* Connector components */}
                                    {connected && (
                                        <div className="pt-4 border-t border-border-low space-y-2">
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
