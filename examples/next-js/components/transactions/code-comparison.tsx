'use client';

import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface CodeComparisonProps {
    title: string;
    code: string;
}

export function CodeComparison({ title, code }: CodeComparisonProps) {
    return (
        <Card className="mt-4">
            <CardHeader className="pb-3">
                <CardTitle className="text-sm font-mono">{title}</CardTitle>
            </CardHeader>
            <CardContent>
                <SyntaxHighlighter
                    language="typescript"
                    style={vscDarkPlus}
                    customStyle={{
                        margin: 0,
                        borderRadius: '0.5rem',
                        fontSize: '0.75rem',
                        lineHeight: '1.25rem',
                    }}
                    showLineNumbers
                >
                    {code}
                </SyntaxHighlighter>
            </CardContent>
        </Card>
    );
}



