'use client';

import {
    IconBrainFill,
    IconCharacterMagnify,
    IconChartBarXaxisAscending,
    IconHandRaisedFill,
    IconHareFill,
} from 'symbols-react';
import { StructuralValidationBackground } from './backgrounds/structural-validation-background';
import { GeometricWaveGridBackground } from './backgrounds/geometric-wave-grid-background';
import { RadarSweepBackground } from './backgrounds/radar-sweep-background';
import { PianoRollBackground } from './backgrounds/piano-roll-background';
import { DitheredBarsBackground } from './backgrounds/dithered-bars-background';

interface FeatureBoxProps {
    icon: React.ReactNode;
    title: string;
    description: string;
    className?: string;
    background?: React.ReactNode;
}

function FeatureBox({ icon, title, description, className = '', background }: FeatureBoxProps) {
    return (
        <div className={`relative p-6 flex flex-col justify-start overflow-hidden  ${className}`}>
            <div className="absolute inset-0 transform translate-y-[120px] scale-[1.02] mask-b-from-10%">
                {background}
            </div>
            <div className="relative z-10">
                <h3 className="text-base font-semibold text-sand-1500 mb-1 font-diatype-medium flex items-center gap-2">
                    <span className="hidden">{icon}</span>
                    {title}
                </h3>
                <p className="text-sand-1000 text-sm leading-relaxed font-diatype-mono">{description}</p>
            </div>
        </div>
    );
}

export function FeaturesBento() {
    return (
        <section className="relative">
            <div className="w-full border-t border-b border-sand-300">
                {/* Main grid: 2 equal columns */}
                <div className="grid grid-cols-2">
                    {/* Left Column: 2 small on top, 1 big below */}
                    <div className="border-r border-sand-300">
                        {/* Top: 2 small boxes in grid */}
                        <div className="grid grid-cols-2 border-b border-sand-300">
                            <div className="border-r border-sand-300 min-h-[280px]">
                                <FeatureBox
                                    icon={<IconChartBarXaxisAscending className="size-4.5 fill-sand-1000/50" />}
                                    title="Type-Safe Builder"
                                    description="Compile-time validation prevents incomplete transactions from ever reaching the network."
                                    className="h-full"
                                    background={<StructuralValidationBackground />}
                                />
                            </div>
                            <div className="min-h-[240px]">
                                <FeatureBox
                                    icon={<IconBrainFill className="size-4.5 fill-sand-1000/50" />}
                                    title="Direct TPU Submission"
                                    description="Native QUIC client with 90%+ landing rates. Slot-aware leader routing via fastlane."
                                    className="h-full"
                                    background={<PianoRollBackground />}
                                />
                            </div>
                        </div>

                        {/* Bottom: 1 big box */}
                        <div className="">
                            <FeatureBox
                                icon={<IconCharacterMagnify className="size-4.5 fill-sand-1000/50" />}
                                title="Multi-Step Flows"
                                description="Chain complex operations with automatic batching, atomic groups, and auto-splitting when transactions exceed size limits."
                                className="h-full min-h-[420px]"
                                background={<DitheredBarsBackground />}
                            />
                        </div>
                    </div>

                    {/* Right Column: 1 big above, 2 small below */}
                    <div>
                        {/* Top: 1 big box */}
                        <div className="border-b border-sand-300">
                            <FeatureBox
                                icon={<IconHandRaisedFill className="size-4.5 fill-sand-1000/50" />}
                                title="Execution Strategies"
                                description="Standard, Fast, or Ultra presets. Race Jito bundles against TPU and parallel RPCs for maximum landing probability."
                                className="h-full min-h-[420px]"
                                background={<PianoRollBackground />}
                            />
                        </div>

                        {/* Bottom: 2 small boxes in grid */}
                        <div className="grid grid-cols-2">
                            <div className="border-r border-sand-300 min-h-[280px]">
                                <FeatureBox
                                    icon={<IconHareFill className="size-5 fill-sand-1000/50" />}
                                    title="MEV Protection"
                                    description="Jito bundle integration shields transactions from sandwich attacks."
                                    className="h-full"
                                    background={<RadarSweepBackground />}
                                />
                            </div>
                            <div className="min-h-[240px]">
                                <FeatureBox
                                    icon={<IconChartBarXaxisAscending className="size-4.5 fill-sand-1000/50" />}
                                    title="Smart Defaults"
                                    description="Auto blockhash, compute units, priority fees, and ALT compression."
                                    className="h-full"
                                    background={<GeometricWaveGridBackground />}
                                />
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}
