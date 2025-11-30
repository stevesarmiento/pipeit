'use client';

import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const pipelineExampleCode = `import { createFlow } from '@pipeit/tx-builder';
import { getCreateAccountInstruction, getCloseAccountInstruction } from '@solana-program/system';

const result = await createFlow({ rpc, rpcSubscriptions, signer })
  // Transaction 1: Setup - Create temporary token accounts
  .step('create-temp-usdc', (ctx) => 
    getCreateAccountInstruction({
      payer: ctx.signer,
      newAccount: tempUsdcAccount,
      space: 165n,
      owner: TOKEN_PROGRAM,
    })
  )
  .step('init-temp-usdc', (ctx) =>
    getInitializeAccountInstruction({
      account: tempUsdcAccount.address,
      mint: usdcMint,
      owner: ctx.signer.address,
    })
  )
  
  // Transaction 2: Execute trades using created accounts
  .step('swap-sol-to-usdc', (ctx) => 
    createSwapInstruction({
      input: solAccount,
      output: ctx.get('init-temp-usdc')?.account,
      amountIn: 1_000_000n,
      pool: dexPoolA,
    })
  )
  .step('swap-usdc-to-token', (ctx) => {
    const usdcAmount = ctx.get('swap-sol-to-usdc')?.amountOut;
    return createSwapInstruction({
      input: tempUsdcAccount.address,
      output: targetTokenAccount,
      amountIn: usdcAmount,
      pool: dexPoolB,
    });
  })
  
  // Transaction 3: Cleanup - Close temporary accounts
  .step('close-temp', (ctx) =>
    getCloseAccountInstruction({
      account: tempUsdcAccount.address,
      destination: ctx.signer.address,
      authority: ctx.signer,
    })
  )
  .execute();`;

export function PipelineExample() {
    return (
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
            <div className="max-w-5xl mx-auto">
                <h2 className="text-h2 text-gray-900 mb-2 text-center text-pretty">
                    Orchestrate multi-transaction flows
                </h2>
                <p className="text-body-xl text-gray-600 mb-12 text-center max-w-3xl mx-auto">
                    Build flows that batch instructions across multiple transactions. Automatically groups compatible operations, passes results between transactions, and handles cleanup.
                </p>
                <Card className="border-sand-300 bg-white">
                    <CardHeader className="pb-3">
                        <CardTitle className="text-body-md font-abc-diatype text-gray-900">
                            Multi-DEX Swap with Setup & Cleanup
                        </CardTitle>
                        <p className="text-xs font-berkeley-mono text-gray-600 mt-1">
                            TX1: Create temp accounts → TX2: Execute swaps → TX3: Cleanup
                        </p>
                    </CardHeader>
                    <CardContent>
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
                            {pipelineExampleCode}
                        </SyntaxHighlighter>
                    </CardContent>
                </Card>
            </div>
        </section>
    );
}
