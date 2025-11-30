import { NextRequest, NextResponse } from 'next/server';

/**
 * Next.js API route proxy for Jupiter swap-instructions API.
 * Proxies requests to Jupiter's swap-instructions API to work around network/DNS restrictions.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    // Validate required fields
    if (!body.quoteResponse) {
      return NextResponse.json(
        { error: 'Missing required field: quoteResponse' },
        { status: 400 }
      );
    }
    
    if (!body.userPublicKey) {
      return NextResponse.json(
        { error: 'Missing required field: userPublicKey' },
        { status: 400 }
      );
    }
    
    const response = await fetch('https://lite-api.jup.ag/swap/v1/swap-instructions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(body),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('Jupiter API error response:', response.status, errorText);
      throw new Error(`Jupiter API error: ${response.status} - ${errorText.substring(0, 200)}`);
    }
    
    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Jupiter swap-instructions API error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to fetch swap instructions';
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}

