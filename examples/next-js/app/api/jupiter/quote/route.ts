import { NextRequest, NextResponse } from 'next/server';

const JUPITER_API_BASE = 'https://api.jup.ag/swap/v1';

/**
 * Next.js API route proxy for Jupiter Metis quote API.
 * Proxies requests to Jupiter's quote API with API key authentication.
 */
export async function GET(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams;

    const params = new URLSearchParams();

    // Required params
    const inputMint = searchParams.get('inputMint');
    const outputMint = searchParams.get('outputMint');
    const amount = searchParams.get('amount');

    if (!inputMint || !outputMint || !amount) {
        return NextResponse.json(
            { error: 'Missing required parameters: inputMint, outputMint, amount' },
            { status: 400 },
        );
    }

    params.set('inputMint', inputMint);
    params.set('outputMint', outputMint);
    params.set('amount', amount);

    // Optional params
    const slippageBps = searchParams.get('slippageBps');
    if (slippageBps) params.set('slippageBps', slippageBps);

    const swapMode = searchParams.get('swapMode');
    if (swapMode) params.set('swapMode', swapMode);

    const dexes = searchParams.get('dexes');
    if (dexes) params.set('dexes', dexes);

    const excludeDexes = searchParams.get('excludeDexes');
    if (excludeDexes) params.set('excludeDexes', excludeDexes);

    const restrictIntermediateTokens = searchParams.get('restrictIntermediateTokens');
    if (restrictIntermediateTokens) params.set('restrictIntermediateTokens', restrictIntermediateTokens);

    const onlyDirectRoutes = searchParams.get('onlyDirectRoutes');
    if (onlyDirectRoutes) params.set('onlyDirectRoutes', onlyDirectRoutes);

    const asLegacyTransaction = searchParams.get('asLegacyTransaction');
    if (asLegacyTransaction) params.set('asLegacyTransaction', asLegacyTransaction);

    const platformFeeBps = searchParams.get('platformFeeBps');
    if (platformFeeBps) params.set('platformFeeBps', platformFeeBps);

    const maxAccounts = searchParams.get('maxAccounts');
    if (maxAccounts) params.set('maxAccounts', maxAccounts);

    try {
        const headers: Record<string, string> = {
            Accept: 'application/json',
        };

        // Add API key if available
        if (process.env.JUPITER_API_KEY) {
            headers['x-api-key'] = process.env.JUPITER_API_KEY;
        }

        const response = await fetch(`${JUPITER_API_BASE}/quote?${params}`, {
            headers,
            cache: 'no-store',
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Jupiter quote API error:', response.status, errorText);
            throw new Error(`Jupiter API error: ${response.status} - ${errorText.substring(0, 200)}`);
        }

        const data = await response.json();
        return NextResponse.json(data);
    } catch (error) {
        console.error('Jupiter quote API error:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to fetch Jupiter quote' },
            { status: 500 },
        );
    }
}
