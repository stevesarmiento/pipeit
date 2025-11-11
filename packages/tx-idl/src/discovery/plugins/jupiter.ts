/**
 * Jupiter swap account resolution plugin.
 *
 * Automatically resolves accounts for Jupiter swap instructions by calling
 * Jupiter's quote and swap APIs to get the required pool and vault addresses.
 *
 * @packageDocumentation
 */

import { address } from 'gill';
import type { Address } from 'gill';
import type { IdlInstruction } from '../../types.js';
import type { ProtocolAccountPlugin } from './plugin.js';
import type { DiscoveryContext } from '../types.js';

/**
 * Jupiter V6 program address.
 */
export const JUPITER_V6_PROGRAM = address('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4');

/**
 * Plugin for resolving Jupiter swap instruction accounts.
 *
 * This plugin:
 * 1. Calls Jupiter's quote API to get optimal route
 * 2. Calls Jupiter's swap-instructions API to get all required accounts
 * 3. Maps Jupiter's account array to IDL account names
 */
export class JupiterSwapPlugin implements ProtocolAccountPlugin {
  id = 'jupiter-swap';
  programId = JUPITER_V6_PROGRAM;
  instructions = ['sharedAccountsRoute', 'route', 'routeWithTokenLedger'];

  async resolveAccounts(
    instruction: IdlInstruction,
    params: Record<string, unknown>,
    context: DiscoveryContext
  ): Promise<Record<string, Address>> {
    // 1. Get Jupiter quote
    const quote = await this.fetchQuote(params, context);

    // 2. Get swap instruction data from Jupiter API
    const swapData = await fetch('https://quote-api.jup.ag/v6/swap-instructions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey: context.signer.toString(),
        wrapAndUnwrapSol: params.wrapAndUnwrapSol ?? true,
        dynamicComputeUnitLimit: params.dynamicComputeUnitLimit ?? true,
        prioritizationFeeLamports: params.prioritizationFeeLamports ?? 'auto',
      }),
    }).then((r) => {
      if (!r.ok) {
        throw new Error(`Jupiter API error: ${r.status} ${r.statusText}`);
      }
      return r.json();
    });

    // 3. Map account indexes to IDL account names
    return this.mapJupiterAccountsToIdl(swapData, instruction);
  }

  private async fetchQuote(
    params: Record<string, unknown>,
    context: DiscoveryContext
  ): Promise<any> {
    const inputMint = params.inputMint as string | undefined;
    const outputMint = params.outputMint as string | undefined;
    const amountIn = params.amountIn as string | number | bigint | undefined;

    if (!inputMint || !outputMint || amountIn === undefined) {
      throw new Error(
        'Jupiter swap requires inputMint, outputMint, and amountIn parameters'
      );
    }

    const queryParams = new URLSearchParams({
      inputMint,
      outputMint,
      amount: amountIn.toString(),
      slippageBps: (params.slippageBps as string | number | undefined)?.toString() || '50',
      onlyDirectRoutes: (params.onlyDirectRoutes as boolean | undefined)?.toString() || 'false',
      asLegacyTransaction: (params.asLegacyTransaction as boolean | undefined)?.toString() || 'false',
    });

    const response = await fetch(`https://quote-api.jup.ag/v6/quote?${queryParams}`);
    if (!response.ok) {
      throw new Error(`Jupiter quote API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  private mapJupiterAccountsToIdl(
    swapData: any,
    instruction: IdlInstruction
  ): Record<string, Address> {
    const accounts: Record<string, Address> = {};

    // Jupiter returns accounts in a specific order
    // Map based on instruction.accounts order
    if (swapData.accounts && Array.isArray(swapData.accounts)) {
      swapData.accounts.forEach((addr: string, index: number) => {
        const idlAccount = instruction.accounts[index];
        if (idlAccount) {
          accounts[idlAccount.name] = address(addr);
        }
      });
    }

    // Also handle addressLookupTableAddresses if present
    if (swapData.addressLookupTableAddresses && Array.isArray(swapData.addressLookupTableAddresses)) {
      // These are typically used for address lookup tables
      // Map to any account that might need them
      swapData.addressLookupTableAddresses.forEach((addr: string, index: number) => {
        // Try to find an account that might be a lookup table
        const lookupTableAccount = instruction.accounts.find(
          (acc) => acc.name.toLowerCase().includes('lookup') || acc.name.toLowerCase().includes('alt')
        );
        if (lookupTableAccount && !accounts[lookupTableAccount.name]) {
          accounts[lookupTableAccount.name] = address(addr);
        }
      });
    }

    return accounts;
  }
}

