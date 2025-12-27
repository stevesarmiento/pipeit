'use client';

import { useState, useEffect } from 'react';
import { oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { PipelineVisualization } from '@/components/pipeline';
import {
    useSimpleTransferPipeline,
    simpleTransferCode,
    useBatchedTransfersPipeline,
    batchedTransfersCode,
    useMixedPipeline,
    mixedPipelineCode,
    jupiterSwapCode,
    useJupiterSwapPipeline,
    useTitanSwapPipeline,
    titanSwapCode,
    useJitoBundlePipeline,
    jitoBundleCode,
    useTpuDirectPipeline,
    tpuDirectCode,
    type TpuSubmissionResult,
} from '@/components/pipeline/examples';
import { ConnectButton } from '@/components/connector';
import { PipelineHeaderButton } from '@/components/pipeline/pipeline-header-button';
import { TpuResultsPanel } from '@/components/pipeline';
import { tpuEvents } from '@/lib/tpu-events';
import { CodeBlock } from '@/components/code/code-block';

interface PipelineExampleConfig {
    id: string;
    name: string;
    description: string;
    hook: () => ReturnType<typeof useSimpleTransferPipeline>;
    code: string;
}

const pipelineExamples: PipelineExampleConfig[] = [
    {
        id: 'simple-transfer',
        name: 'Simple Transfer',
        description: 'Single instruction, single transaction - baseline example',
        hook: useSimpleTransferPipeline,
        code: simpleTransferCode,
    },
    {
        id: 'batched-transfers',
        name: 'Batched Transfers',
        description: 'Multiple transfers batched into one atomic transaction',
        hook: useBatchedTransfersPipeline,
        code: batchedTransfersCode,
    },
    {
        id: 'mixed-pipeline',
        name: 'Mixed Pipeline',
        description: 'Instruction and transaction steps - shows when batching breaks',
        hook: useMixedPipeline,
        code: mixedPipelineCode,
    },
    {
        id: 'jupiter-swap',
        name: 'Jupiter Swap',
        description: 'Swap tokens using Jupiter aggregator',
        hook: useJupiterSwapPipeline,
        code: jupiterSwapCode,
    },
    {
        id: 'titan-swap',
        name: 'Titan Swap',
        description: 'Swap tokens using Titan aggregator with InstructionPlan API',
        hook: useTitanSwapPipeline,
        code: titanSwapCode,
    },
    {
        id: 'jito-bundle',
        name: 'Jito Bundle',
        description: 'MEV-protected bundle submission with Jito tip instructions',
        hook: useJitoBundlePipeline,
        code: jitoBundleCode,
    },
    {
        id: 'tpu-direct',
        name: 'TPU Direct',
        description: 'Direct QUIC submission to validator TPU - bypass RPC queues for maximum speed',
        hook: useTpuDirectPipeline,
        code: tpuDirectCode,
    },
];

function PipelineExampleCard({ example }: { example: PipelineExampleConfig }) {
    const [strategy, setStrategy] = useState<'auto' | 'batch' | 'sequential'>('auto');
    const [tpuResult, setTpuResult] = useState<TpuSubmissionResult | null>(null);
    const [tpuSending, setTpuSending] = useState(false);

    const visualPipeline = example.hook();
    const isTpuExample = example.id === 'tpu-direct';

    const isExecuting = visualPipeline.state === 'executing';

    useEffect(() => {
        if (!isTpuExample) return;

        tpuEvents.startIntercepting();

        const unsubStart = tpuEvents.onStart(() => {
            setTpuSending(true);
        });

        const unsubResult = tpuEvents.onResult(result => {
            setTpuResult(result);
            setTpuSending(false);
        });

        return () => {
            unsubStart();
            unsubResult();
            tpuEvents.stopIntercepting();
        };
    }, [isTpuExample]);

    return (
        <section className="py-16 border-b border-sand-200 last:border-b-0">
            <div className="grid grid-cols-12 gap-8">
                <div className="col-span-4 flex flex-col justify-start px-6">
                    <h2 className="text-2xl font-abc-diatype-medium text-gray-900 mb-2">{example.name}</h2>
                    <p className="text-sm font-berkeley-mono text-gray-600">{example.description}</p>

                    {isTpuExample && (
                        <div className="mt-6">
                            <TpuResultsPanel result={tpuResult} isExecuting={isExecuting || tpuSending} />
                        </div>
                    )}
                </div>

                <div className="col-span-8 px-6">
                    <Tabs defaultValue="visualization" className="w-full">
                        <div className="flex flex-row-reverse justify-between items-center mb-4">
                            <TabsList>
                                <TabsTrigger value="visualization">Visualization</TabsTrigger>
                                <TabsTrigger value="code">Code</TabsTrigger>
                            </TabsList>

                            <div className="flex flex-row gap-2 flex-nowrap items-center">
                                <div className="flex flex-row">
                                    {(['auto', 'batch', 'sequential'] as const).map((s, index, arr) => (
                                        <Button
                                            key={s}
                                            variant={strategy === s ? 'default' : 'outline'}
                                            size="sm"
                                            onClick={() => {
                                                setStrategy(s);
                                                visualPipeline.reset();
                                                setTpuResult(null);
                                            }}
                                            className={cn(
                                                index === 0 && 'rounded-r-none',
                                                index === arr.length - 1 && 'rounded-l-none',
                                                index > 0 && index < arr.length - 1 && 'rounded-none',
                                                index > 0 && '-ml-px',
                                            )}
                                        >
                                            {s.charAt(0).toUpperCase() + s.slice(1)}
                                        </Button>
                                    ))}
                                </div>
                                <div className="h-8 w-px bg-gradient-to-b from-transparent via-sand-800 to-transparent" />
                                <ConnectButton />
                                <div className="h-8 w-px bg-gradient-to-b from-transparent via-sand-800 to-transparent" />
                                <PipelineHeaderButton visualPipeline={visualPipeline} strategy={strategy} />
                            </div>
                        </div>

                        <TabsContent value="visualization" className="">
                            <Card
                                className={cn(
                                    'border-sand-300 bg-sand-100/30 rounded-xl shadow-sm overflow-visible',
                                    'max-h-[340px] min-h-[340px]',
                                )}
                                style={{
                                    backgroundImage: `repeating-linear-gradient(
                                        45deg,
                                        transparent,
                                        transparent 10px,
                                        rgba(233, 231, 222, 0.5) 10px,
                                        rgba(233, 231, 222, 0.5) 11px
                                    )`,
                                }}
                            >
                                <CardContent className="flex flex-col h-full overflow-visible">
                                    <div className={isTpuExample ? 'flex-1 min-h-[280px]' : ''}>
                                        <PipelineVisualization visualPipeline={visualPipeline} strategy={strategy} />
                                    </div>
                                </CardContent>
                            </Card>
                        </TabsContent>

                        <TabsContent value="code" className="mt-0">
                            <Card className="border-sand-300 bg-white rounded-xl shadow-sm max-h-[360px] min-h-[360px] overflow-y-auto">
                                <CardContent className="">
                                    <CodeBlock
                                        code={example.code}
                                        style={oneLight}
                                        showLineNumbers
                                        customStyle={{
                                            margin: 0,
                                            borderRadius: '0.5rem',
                                            fontSize: '0.75rem',
                                            lineHeight: '1.25rem',
                                        }}
                                    />
                                </CardContent>
                            </Card>
                        </TabsContent>
                    </Tabs>
                </div>
            </div>
        </section>
    );
}

export function Playground() {
    return (
        <section id="playground" className="scroll-mt-16">
            <div className="sticky top-16 z-10 h-[calc(100vh-4rem)] bg-bg1 border-t border-sand-200">
                <div className="flex h-full flex-col">
                    <div className="shrink-0">
                        <section
                            className="py-8 border-b border-sand-200"
                            style={{
                                backgroundImage: `repeating-linear-gradient(
                                    45deg,
                                    transparent,
                                    transparent 10px,
                                    rgba(233, 231, 222, 0.5) 10px,
                                    rgba(233, 231, 222, 0.5) 11px
                                )`,
                            }}
                        >
                            <div className="max-w-7xl mx-auto">
                                <h2 className="text-h2 text-gray-900 mb-2 text-center text-pretty">
                                    Interactive Playground
                                </h2>
                                <p className="text-body-xl text-gray-600 text-center max-w-3xl mx-auto">
                                    Real mainnet examples of multi-step pipelines and atomic transactions
                                </p>
                            </div>
                        </section>
                    </div>

                    <div className="min-h-0 flex-1 overflow-y-auto">
                        {pipelineExamples.map(example => (
                            <PipelineExampleCard key={example.id} example={example} />
                        ))}
                    </div>
                </div>
            </div>
        </section>
    );
}
