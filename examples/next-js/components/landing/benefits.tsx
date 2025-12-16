'use client';

import { IconXmarkCircleFill } from 'symbols-react';

const benefits = [
    {
        name: 'Build Complex Flows Easily',
        description: 'Chain multi-step transaction flows with automatic batching and intelligent instruction grouping.',
        icon: IconXmarkCircleFill,
    },
    {
        name: 'Catch Errors Before Runtime',
        description:
            'Type-safe builder with compile-time validation prevents incomplete transactions from reaching the network.',
        icon: IconXmarkCircleFill,
    },
    {
        name: 'Zero Manual Configuration',
        description:
            'Automatic blockhash fetching, lifetime tracking, and transaction lifecycle management with durable nonce support.',
        icon: IconXmarkCircleFill,
    },
    {
        name: 'Never Lose a Transaction',
        description: 'Built-in retry logic with exponential backoff and rich error types for easy debugging.',
        icon: IconXmarkCircleFill,
    },
    {
        name: 'Test Before You Send',
        description:
            'Pre-flight simulation catches errors early to reduce failed transactions and save on network fees.',
        icon: IconXmarkCircleFill,
    },
    {
        name: 'Optimize Transaction Costs',
        description:
            'Simple priority fee presets and automatic compute unit optimization prevent transaction failures.',
        icon: IconXmarkCircleFill,
    },
    {
        name: 'Extend & Customize',
        description:
            'Composable middleware system for logging, monitoring, retry, and simulation with reusable components.',
        icon: IconXmarkCircleFill,
    },
    {
        name: 'No Transaction Size Limits',
        description:
            'Automatically detects and splits oversized transactions to eliminate "transaction too large" errors.',
        icon: IconXmarkCircleFill,
    },
    {
        name: 'Guarantee Execution Order',
        description:
            'Atomic grouping ensures instructions execute together or not at all for critical DeFi operations.',
        icon: IconXmarkCircleFill,
    },
];

export function Benefits() {
    return (
        <section className="pt-0 py-16">
            <div className="mx-auto max-w-7xl px-6 lg:px-8">
                <dl className="mx-auto mt-16 grid max-w-2xl grid-cols-1 gap-8 text-base/7 text-gray-600 sm:grid-cols-2 lg:mx-0 lg:max-w-none lg:grid-cols-3 lg:gap-x-16">
                    {benefits.map(benefit => (
                        <div key={benefit.name} className="relative pl-9">
                            <dt className="inline font-semibold text-gray-900">
                                <benefit.icon
                                    aria-hidden="true"
                                    className="absolute top-1 left-1 size-5 text-gray-900"
                                />
                                {benefit.name}
                            </dt>{' '}
                            <dd className="inline">{benefit.description}</dd>
                        </div>
                    ))}
                </dl>
            </div>
        </section>
    );
}
