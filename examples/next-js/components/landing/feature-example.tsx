'use client';

import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const featureExampleCode = `import { TransactionBuilder } from '@pipeit/core';
import { getCreateAccountInstruction } from '@solana-program/system';
import { address, lamports } from '@solana/kit';

const signature = await transaction({
  autoRetry: true,
  priorityLevel: 'high',
})
  .addInstruction(getCreateAccountInstruction({
    payer: signer,
    newAccount: newAccountSigner,
    space: 165n,
    lamports: rentExemptLamports,
    owner: TOKEN_PROGRAM_ADDRESS,
  }))
  .addInstruction(getInitializeAccountInstruction({
    account: newAccountSigner.address,
    mint: tokenMint,
    owner: signer.address,
  }))
  .addInstruction(getTransferInstruction({
    source: sourceTokenAccount,
    destination: newAccountSigner.address,
    amount: transferAmount,
    owner: signer,
  }))
  .execute({
    feePayer: signer,
    rpc,
    rpcSubscriptions,
  });`;

export function FeatureExample() {
    return (
        <section className="py-16 bg-sand-100/50 border-b border-sand-200">
            <div className="max-w-5xl mx-auto">
                <h2 className="text-h2 text-gray-900 mb-2 mx-auto text-center text-pretty">
                    Build atomic transactions easily
                </h2>
                <p className="text-body-xl text-gray-600 mb-12 text-center max-w-3xl mx-auto">
                    Combine multiple instructions into single or multi-step transactions. All operations succeed together or fail together—no partial state changes.
                </p>
                <Card className="border-sand-300">
                    <CardHeader className="pb-3">
                        <CardTitle className="text-body-md font-abc-diatype text-gray-900">
                            Create Token Account & Transfer Atomically
                        </CardTitle>
                        <p className="text-xs font-berkeley-mono text-gray-600 mt-1">
                            Create account, initialize it, and transfer tokens—all in one transaction
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
                            {featureExampleCode}
                        </SyntaxHighlighter>
                    </CardContent>
                </Card>
            </div>
        </section>
    );
}

