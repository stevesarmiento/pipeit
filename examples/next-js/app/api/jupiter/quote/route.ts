import { NextRequest, NextResponse } from 'next/server';

/**
 * Next.js API route proxy for Jupiter quote API.
 * Proxies requests to Jupiter's quote API to work around network/DNS restrictions.
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  
  const params = new URLSearchParams({
    inputMint: searchParams.get('inputMint') || '',
    outputMint: searchParams.get('outputMint') || '',
    amount: searchParams.get('amount') || '',
    slippageBps: searchParams.get('slippageBps') || '50',
    onlyDirectRoutes: searchParams.get('onlyDirectRoutes') || 'false',
    asLegacyTransaction: searchParams.get('asLegacyTransaction') || 'false',
  });

  try {
    const response = await fetch(`https://lite-api.jup.ag/swap/v1/quote?${params}`, {
      headers: {
        'Accept': 'application/json',
      },
    });
    
    if (!response.ok) {
      throw new Error(`Jupiter API error: ${response.status}`);
    }
    
    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Jupiter quote API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch Jupiter quote' },
      { status: 500 }
    );
  }
}

