'use client';

import { useState } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
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
  usePipeMultiSwapPipeline,
  pipeMultiSwapCode,
} from '@/components/pipeline/examples';
import { ConnectButton } from '@/components/connector';
import { PipelineHeaderButton } from '@/components/pipeline/pipeline-header-button';

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
    id: 'pipe-multi-swap',
    name: 'Pipe Multi-Swap',
    description: 'SOL → USDC → BONK sequential swaps with Flow orchestration',
    hook: usePipeMultiSwapPipeline,
    code: pipeMultiSwapCode,
  },
  // {
  //   id: 'raydium-kamino',
  //   name: 'Raydium + Kamino',
  //   description: 'Raydium CLMM swap + Kamino deposit - pure IDL with auto account discovery',
  //   hook: useRaydiumKaminoPipeline,
  //   code: raydiumKaminoCode,
  // },
  // {
  //   id: 'instruction-plan',
  //   name: 'Instruction Plan',
  //   description: 'Kit instruction-plans with executePlan - static planning with automatic batching',
  //   hook: useInstructionPlanPipeline,
  //   code: instructionPlanCode,
  // },
];

function PipelineExampleCard({ example }: { example: PipelineExampleConfig }) {
  const [strategy, setStrategy] = useState<'auto' | 'batch' | 'sequential'>('auto');

  const visualPipeline = example.hook();

  return (
    <section className="py-16 border-b border-sand-200 last:border-b-0">
      <div className="grid grid-cols-12 gap-8">
        {/* Left column: Title and Description */}
        <div className="col-span-4 flex flex-col justify-start px-6">
          <h2 className="text-2xl font-abc-diatype-medium text-gray-900 mb-2">{example.name}</h2>
          <p className="text-sm font-berkeley-mono text-gray-600">{example.description}</p>
        </div>

        {/* Right column: Tabs with Visualization and Code */}
        <div className="col-span-8 px-6">
          <Tabs defaultValue="visualization" className="w-full">
            {/* Strategy buttons, Execute Button, Connect Button on left; Tabs on right */}
            <div className="flex flex-row-reverse justify-between items-center mb-4">
              {/* Tabs on right */}
              <TabsList>
                <TabsTrigger value="visualization">Visualization</TabsTrigger>
                <TabsTrigger value="code">Code</TabsTrigger>
              </TabsList>
              
              {/* Strategy switcher buttons, Execute Button, and Connect Button on left */}
              <div className="flex flex-row gap-2 flex-nowrap items-center">
                {/* Connected strategy buttons */}
                <div className="flex flex-row">
                  {(['auto', 'batch', 'sequential'] as const).map((s, index, arr) => (
                    <Button
                      key={s}
                      variant={strategy === s ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => {
                        setStrategy(s);
                        visualPipeline.reset();
                      }}
                      className={cn(
                        index === 0 && 'rounded-r-none',
                        index === arr.length - 1 && 'rounded-l-none',
                        index > 0 && index < arr.length - 1 && 'rounded-none',
                        index > 0 && '-ml-px'
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
              <Card className="border-sand-300 bg-sand-100/30 rounded-xl shadow-sm max-h-[340px] min-h-[340px]"
              style={{
                backgroundImage: `repeating-linear-gradient(
                  45deg,
                  transparent,
                  transparent 10px,
                  rgba(233, 231, 222, 0.5) 10px,
                  rgba(233, 231, 222, 0.5) 11px
                )`
              }}
              >
                <CardContent className="">
                  <PipelineVisualization visualPipeline={visualPipeline} strategy={strategy} />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="code" className="mt-0">
              <Card className="border-sand-300 bg-white rounded-xl shadow-sm max-h-[360px] min-h-[360px] overflow-y-auto">
                <CardContent className="">
                  <SyntaxHighlighter
                    language="typescript"
                    style={oneLight}
                    customStyle={{
                      margin: 0,
                      borderRadius: '0.5rem',
                      fontSize: '0.75rem',
                      lineHeight: '1.25rem',
                    }}
                    showLineNumbers
                  >
                    {example.code}
                  </SyntaxHighlighter>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </section>
  );
}

export default function PlaygroundPage() {
  return (
    <div className="max-w-7xl mx-auto min-h-screen bg-bg1 border-r border-l border-sand-200">
      <main className="container mx-auto">
        <section className="py-16 border-b border-sand-200"
        style={{
          backgroundImage: `repeating-linear-gradient(
            45deg,
            transparent,
            transparent 10px,
            rgba(233, 231, 222, 0.5) 10px,
            rgba(233, 231, 222, 0.5) 11px
          )`
        }}>
          <div className="max-w-7xl mx-auto">
            <h1 className="text-h2 text-gray-900 mb-2 text-center text-pretty">
              PipeIt Playground
            </h1>
            <p className="text-body-xl text-gray-600 text-center max-w-3xl mx-auto">
              Interactive real mainnet examples of multi-step pipelines and atomic transactions
            </p>
          </div>
        </section>

        {pipelineExamples.map((example) => (
          <PipelineExampleCard key={example.id} example={example} />
        ))}
      </main>
    </div>
  );
}

