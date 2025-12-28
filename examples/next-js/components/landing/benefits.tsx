'use client';

import {
    IconArrowDownAppDashedTrianglebadgeExclamationmark,
    IconArrowtriangleRightAndLineVerticalAndArrowtriangleLeftFill,
    IconCharacterMagnify,
    IconCursorarrowClick2,
    IconDigitalcrownHorizontalArrowClockwiseFill,
    IconGaugeWithDotsNeedle67percent,
    IconInfinity,
    IconTrayAndArrowUpFill,
    IconXmarkCircleFill,
} from 'symbols-react';

const benefits = [
    {
        name: 'Built-in Retry Logic',
        description: 'Exponential backoff with configurable attempts and rich error types for debugging.',
        icon: IconDigitalcrownHorizontalArrowClockwiseFill,
    },
    {
        name: 'Pre-flight Simulation',
        description: 'Test transactions before sending to catch errors early and save on network fees.',
        icon: IconArrowDownAppDashedTrianglebadgeExclamationmark,
    },
    {
        name: 'Priority Fee Presets',
        description: 'Choose from none/low/medium/high/veryHigh or use percentile-based estimation.',
        icon: IconGaugeWithDotsNeedle67percent,
    },
    {
        name: 'Address Lookup Tables',
        description: 'Automatic ALT compression for v0 transactions reduces size and cost.',
        icon: IconCharacterMagnify,
    },
    {
        name: 'Durable Nonce Support',
        description: "Create long-lived transactions that don't expire with blockhash.",
        icon: IconInfinity,
    },
    {
        name: 'Composable Middleware',
        description: 'Plug in logging, simulation, retry, or custom logic at any execution step.',
        icon: IconArrowtriangleRightAndLineVerticalAndArrowtriangleLeftFill,
    },
    {
        name: 'Export Any Format',
        description: 'Output base64, base58, or raw bytes for custom transports and hardware wallets.',
        icon: IconTrayAndArrowUpFill,
    },
    {
        name: 'Continuous Resubmission',
        description: 'TPU client resubmits until confirmed for highest possible landing rates.',
        icon: IconCursorarrowClick2,
    },
    {
        name: 'Rich Error Diagnostics',
        description: 'Human-readable error messages with program-specific context and debugging hints.',
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
                            <dt className="inline font-semibold text-sand-1500">
                                <benefit.icon
                                    aria-hidden="true"
                                    className="absolute top-1 left-1 size-5 fill-sand-600"
                                />
                                {benefit.name}
                            </dt>{' '}
                            <dd className="inline text-sand-1000">{benefit.description}</dd>
                        </div>
                    ))}
                </dl>
            </div>
        </section>
    );
}
