'use client';

import { useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PipelineVisualization } from '@/components/pipeline';
import { pipelinesManifest } from '@/lib/pipelines-manifest';
import {
  useSimpleTransferPipeline,
  simpleTransferCode,
  useBatchedTransfersPipeline,
  batchedTransfersCode,
  useMixedPipeline,
  mixedPipelineCode,
} from '@/components/pipeline/examples';
import { useGillTransactionSigner, useCluster, useConnectorClient } from '@solana/connector';
import { createSolanaRpc, createSolanaRpcSubscriptions } from 'gill';

const pipelineExamples = {
  'simple-transfer': {
    hook: useSimpleTransferPipeline,
    code: simpleTransferCode,
  },
  'batched-transfers': {
    hook: useBatchedTransfersPipeline,
    code: batchedTransfersCode,
  },
  'mixed-pipeline': {
    hook: useMixedPipeline,
    code: mixedPipelineCode,
  },
};

export default function PipelineDetailPage() {
  const params = useParams();
  const pipelineId = params.pipelineId as string;
  const [strategy, setStrategy] = useState<'auto' | 'batch' | 'sequential'>('auto');
  const [isExecuting, setIsExecuting] = useState(false);

  const example = pipelinesManifest.find((e) => e.id === pipelineId);
  const pipelineConfig = pipelineExamples[pipelineId as keyof typeof pipelineExamples];

  const visualPipeline = pipelineConfig?.hook();

  const { signer, ready } = useGillTransactionSigner();
  const { cluster } = useCluster();
  const client = useConnectorClient();

  const handleExecute = async () => {
    if (!visualPipeline || !signer || !client) {
      alert('Please connect your wallet first');
      return;
    }

    setIsExecuting(true);
    visualPipeline.reset();

    try {
      const rpcUrl = client.getRpcUrl();
      if (!rpcUrl) {
        throw new Error('No RPC endpoint configured');
      }

      const rpc = createSolanaRpc(rpcUrl);
      const rpcSubscriptions = createSolanaRpcSubscriptions(rpcUrl.replace('http', 'ws'));

      await visualPipeline.execute({
        signer,
        rpc,
        rpcSubscriptions,
        strategy,
        commitment: 'confirmed',
      });
    } catch (error) {
      console.error('Pipeline execution failed:', error);
      alert(`Execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsExecuting(false);
    }
  };

  if (!example || !pipelineConfig) {
    return (
      <div className="container mx-auto px-4 py-12">
        <h1 className="text-title-4">Pipeline not found</h1>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/20">
      <div className="container mx-auto px-4 py-12">
        <div className="mb-8">
          <h1 className="text-h2 mb-2">{example.name}</h1>
          <p className="text-body-xl text-muted-foreground">{example.description}</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* Visualization */}
          <Card>
            <CardHeader>
              <CardTitle className="text-title-5">Visualization</CardTitle>
            </CardHeader>
            <CardContent>
              {visualPipeline && (
                <>
                  {/* Strategy switcher */}
                  <div className="mb-4 flex gap-2">
                    {(['auto', 'batch', 'sequential'] as const).map((s) => (
                      <Button
                        key={s}
                        variant={strategy === s ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => {
                          setStrategy(s);
                          visualPipeline.reset();
                        }}
                      >
                        {s.charAt(0).toUpperCase() + s.slice(1)}
                      </Button>
                    ))}
                  </div>

                  <PipelineVisualization visualPipeline={visualPipeline} strategy={strategy} />

                  {/* Execute button */}
                  <div className="mt-6">
                    <Button
                      onClick={handleExecute}
                      disabled={!ready || isExecuting}
                      className="w-full"
                    >
                      {isExecuting ? 'Executing...' : 'Execute Pipeline'}
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Code */}
          <Card>
            <CardHeader>
              <CardTitle className="text-title-5">Code</CardTitle>
            </CardHeader>
            <CardContent>
              <SyntaxHighlighter
                language="typescript"
                style={vscDarkPlus}
                customStyle={{
                  margin: 0,
                  borderRadius: '0.5rem',
                  fontSize: '0.875rem',
                }}
                showLineNumbers
              >
                {pipelineConfig.code}
              </SyntaxHighlighter>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}



