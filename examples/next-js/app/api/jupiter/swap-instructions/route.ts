import { NextRequest, NextResponse } from 'next/server';

const JUPITER_API_BASE = 'https://api.jup.ag/swap/v1';

/**
 * Next.js API route proxy for Jupiter Metis swap-instructions API.
 * Proxies requests to Jupiter's swap-instructions API with API key authentication.
 */
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();

        // Validate required fields
        if (!body.quoteResponse) {
            return NextResponse.json({ error: 'Missing required field: quoteResponse' }, { status: 400 });
        }

        if (!body.userPublicKey) {
            return NextResponse.json({ error: 'Missing required field: userPublicKey' }, { status: 400 });
        }

        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            Accept: 'application/json',
        };

        // Add API key if available
        if (process.env.JUPITER_API_KEY) {
            headers['x-api-key'] = process.env.JUPITER_API_KEY;
        }

        const response = await fetch(`${JUPITER_API_BASE}/swap-instructions`, {
            method: 'POST',
            headers,
            cache: 'no-store',
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Jupiter swap-instructions API error:', response.status, errorText);
            throw new Error(`Jupiter API error: ${response.status} - ${errorText.substring(0, 200)}`);
        }

        const data = await response.json();
        return NextResponse.json(data);
    } catch (error) {
        console.error('Jupiter swap-instructions API error:', error);
        const errorMessage = error instanceof Error ? error.message : 'Failed to fetch swap instructions';
        return NextResponse.json({ error: errorMessage }, { status: 500 });
    }
}
