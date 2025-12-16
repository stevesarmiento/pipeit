/**
 * TPU submission API route.
 * 
 * Enables browser-based applications to submit transactions
 * directly to Solana validator TPU endpoints via QUIC.
 */

import { tpuHandler } from '@pipeit/core/server';

export async function POST(request: Request) {
  return tpuHandler(request);
}

