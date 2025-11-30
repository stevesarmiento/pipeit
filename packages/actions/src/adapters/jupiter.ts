/**
 * Jupiter swap adapter for @pipeit/actions.
 * 
 * Delegates all swap logic to Jupiter's API, which handles:
 * - Route finding across all Solana DEXs
 * - Account resolution
 * - Instruction building
 * - wSOL wrapping/unwrapping
 * 
 * @example
 * ```ts
 * import { pipe } from '@pipeit/actions'
 * import { jupiter } from '@pipeit/actions/adapters/jupiter'
 * 
 * await pipe({
 *   rpc,
 *   rpcSubscriptions,
 *   signer,
 *   adapters: { swap: jupiter() }
 * })
 *   .swap({ inputMint: SOL, outputMint: USDC, amount: 10_000_000n })
 *   .execute()
 * ```
 * 
 * @packageDocumentation
 */

import { address } from '@solana/addresses';
import type { Instruction, AccountMeta, AccountRole } from '@solana/instructions';
import type { SwapAdapter, SwapParams, ActionContext } from '../types.js';

/**
 * Configuration options for Jupiter adapter.
 */
export interface JupiterConfig {
  /** Base URL for Jupiter API (default: https://lite-api.jup.ag/swap/v1) */
  apiUrl?: string;
  /** Whether to automatically wrap/unwrap SOL (default: true) */
  wrapAndUnwrapSol?: boolean;
  /** Whether to use dynamic compute unit limit (default: true) */
  dynamicComputeUnitLimit?: boolean;
  /** Priority fee in lamports or 'auto' (default: 'auto') */
  prioritizationFeeLamports?: number | 'auto';
}

/**
 * Jupiter API quote response
 */
interface JupiterQuote {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  priceImpactPct: string;
  routePlan: Array<{
    swapInfo: {
      ammKey: string;
      label: string;
      inputMint: string;
      outputMint: string;
      inAmount: string;
      outAmount: string;
      feeAmount: string;
      feeMint: string;
    };
    percent: number;
  }>;
}

/**
 * Jupiter API swap instruction response
 */
interface JupiterSwapResponse {
  swapInstruction: {
    programId: string;
    accounts: Array<{
      pubkey: string;
      isSigner: boolean;
      isWritable: boolean;
    }>;
    data: string; // base64 encoded
  };
  setupInstructions?: Array<{
    programId: string;
    accounts: Array<{
      pubkey: string;
      isSigner: boolean;
      isWritable: boolean;
    }>;
    data: string;
  }>;
  cleanupInstruction?: {
    programId: string;
    accounts: Array<{
      pubkey: string;
      isSigner: boolean;
      isWritable: boolean;
    }>;
    data: string;
  };
  addressLookupTableAddresses?: string[];
  computeUnitLimit?: number;
  simulationError?: Record<string, unknown>;
}

/**
 * Convert Jupiter account format to Solana Kit AccountMeta
 */
function toAccountMeta(acc: { pubkey: string; isSigner: boolean; isWritable: boolean }): AccountMeta {
  // AccountRole: 0=readonly, 1=writable, 2=readonly_signer, 3=writable_signer
  let role: AccountRole;
  if (acc.isSigner && acc.isWritable) {
    role = 3 as AccountRole; // WRITABLE_SIGNER
  } else if (acc.isSigner) {
    role = 2 as AccountRole; // READONLY_SIGNER
  } else if (acc.isWritable) {
    role = 1 as AccountRole; // WRITABLE
  } else {
    role = 0 as AccountRole; // READONLY
  }

  return {
    address: address(acc.pubkey),
    role,
  };
}

/**
 * Convert Jupiter instruction format to Solana Kit Instruction
 */
function toInstruction(ix: {
  programId: string;
  accounts: Array<{ pubkey: string; isSigner: boolean; isWritable: boolean }>;
  data: string;
}): Instruction {
  return {
    programAddress: address(ix.programId),
    accounts: ix.accounts.map(toAccountMeta),
    data: Buffer.from(ix.data, 'base64'),
  };
}

/**
 * Create a Jupiter swap adapter.
 * 
 * @param config - Optional configuration
 * @returns A SwapAdapter that uses Jupiter's API
 * 
 * @example
 * ```ts
 * // Default configuration
 * const adapter = jupiter()
 * 
 * // Custom API URL (for proxying in browser)
 * const adapter = jupiter({ apiUrl: '/api/jupiter' })
 * ```
 */
export function jupiter(config: JupiterConfig = {}): SwapAdapter {
  const {
    apiUrl = 'https://lite-api.jup.ag/swap/v1',
    wrapAndUnwrapSol = true,
    dynamicComputeUnitLimit = true,
    prioritizationFeeLamports = 'auto',
  } = config;

  return {
    swap: (params: SwapParams) => async (ctx: ActionContext) => {
      // Normalize all params to strings (Address is a branded string type)
      const inputMint = String(params.inputMint);
      const outputMint = String(params.outputMint);
      const amount = String(params.amount);
      const slippageBps = params.slippageBps ?? 50;

      // 1. Get quote from Jupiter
      const quoteUrl = new URL(`${apiUrl}/quote`);
      quoteUrl.searchParams.set('inputMint', inputMint);
      quoteUrl.searchParams.set('outputMint', outputMint);
      quoteUrl.searchParams.set('amount', amount);
      quoteUrl.searchParams.set('slippageBps', slippageBps.toString());

      console.log('[Jupiter] Fetching quote:', quoteUrl.toString());

      const quoteResponse = await fetch(quoteUrl.toString());
      if (!quoteResponse.ok) {
        const errorText = await quoteResponse.text();
        throw new Error(`Jupiter quote API error: ${quoteResponse.status} - ${errorText}`);
      }

      const quote: JupiterQuote = await quoteResponse.json();
      console.log('[Jupiter] Quote received:', {
        inAmount: quote.inAmount,
        outAmount: quote.outAmount,
        priceImpactPct: quote.priceImpactPct,
        routes: quote.routePlan.length,
      });

      // 2. Get swap instructions from Jupiter
      const swapUrl = `${apiUrl}/swap-instructions`;
      const signerAddress = String(ctx.signer.address);

      console.log('[Jupiter] Fetching swap instructions for user:', signerAddress);

      const swapResponse = await fetch(swapUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quoteResponse: quote,
          userPublicKey: signerAddress,
          wrapAndUnwrapSol,
          dynamicComputeUnitLimit,
          prioritizationFeeLamports,
        }),
      });

      if (!swapResponse.ok) {
        const errorText = await swapResponse.text();
        throw new Error(`Jupiter swap-instructions API error: ${swapResponse.status} - ${errorText}`);
      }

      const swapData: JupiterSwapResponse = await swapResponse.json();

      // Check for simulation errors
      if (swapData.simulationError && Object.keys(swapData.simulationError).length > 0) {
        console.warn('[Jupiter] Simulation error detected:', swapData.simulationError);
      }

      // 3. Build instructions array
      const instructions: Instruction[] = [];

      // Add setup instructions (ATA creation, wSOL wrapping, etc.)
      if (swapData.setupInstructions && swapData.setupInstructions.length > 0) {
        console.log('[Jupiter] Adding', swapData.setupInstructions.length, 'setup instructions');
        for (const setupIx of swapData.setupInstructions) {
          instructions.push(toInstruction(setupIx));
        }
      }

      // Add main swap instruction
      instructions.push(toInstruction(swapData.swapInstruction));

      // Add cleanup instruction (unwrap wSOL, etc.)
      if (swapData.cleanupInstruction) {
        console.log('[Jupiter] Adding cleanup instruction');
        instructions.push(toInstruction(swapData.cleanupInstruction));
      }

      console.log('[Jupiter] Built', instructions.length, 'total instructions');
      if (swapData.addressLookupTableAddresses?.length) {
        console.log('[Jupiter] Lookup tables:', swapData.addressLookupTableAddresses.length);
      }

      // Build the result with all fields at top level for ActionResult compatibility
      const result: {
        instructions: Instruction[];
        computeUnits?: number;
        addressLookupTableAddresses?: string[];
        data: Record<string, unknown>;
      } = {
        instructions,
        // Surface ALT addresses at top level for Pipe to collect
        addressLookupTableAddresses: swapData.addressLookupTableAddresses ?? [],
        data: {
          inputAmount: BigInt(quote.inAmount),
          outputAmount: BigInt(quote.outAmount),
          priceImpactPct: parseFloat(quote.priceImpactPct),
          route: quote.routePlan,
        },
      };

      // Only add computeUnits if Jupiter provided it
      if (swapData.computeUnitLimit !== undefined) {
        result.computeUnits = swapData.computeUnitLimit;
      }

      return result;
    },
  };
}
