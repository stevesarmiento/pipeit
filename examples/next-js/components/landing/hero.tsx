'use client';

import { CopyButton } from '@/components/ui/copy-button';

export function Hero() {
    return (
        <section className="py-16">
            <div className="max-w-4xl mx-auto text-center">
                <h1 className="text-h1 text-gray-900 mb-6">
                    Build Solana transactions <br />without complexity
                </h1>
                <p className="text-body-xl text-gray-600 max-w-xl mx-auto mb-8">
                    Type-safe, composable transaction builder with automatic retry, priority fees, and smart defaults built on top of @solana/kit. 
                </p>
                <CopyButton 
                    textToCopy="npm install @pipeit/core"
                    displayText={<code>npm i @pipeit/tx-core</code>}
                    className="inline-flex items-center gap-2 bg-sand-100 rounded-lg px-4 py-2 font-berkeley-mono text-sm text-gray-900 hover:bg-sand-100/50 border border-sand-200 transition-colors"
                    iconClassName="text-gray-600"
                    iconClassNameCheck="text-gray-900"
                    showText={true}
                />
            </div>
        </section>
    );
}

