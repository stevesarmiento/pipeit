/**
 * IDL fetching utilities for retrieving program IDLs from various sources.
 *
 * @packageDocumentation
 */

import type { Address } from '@solana/addresses';
import type { Rpc, GetAccountInfoApi } from '@solana/rpc';
import type { ProgramIdl } from './types.js';

/**
 * Default IDL registries to try when fetching IDLs.
 */
const DEFAULT_REGISTRIES = [
  'https://api.solana.fm/v1/idl',
  'https://raw.githubusercontent.com/coral-xyz/anchor/master/idls',
  'https://ipfs.io/ipfs',
];

/**
 * Options for fetching IDL.
 */
export interface FetchIdlOptions {
  /**
   * Skip on-chain IDL fetch attempt.
   */
  skipOnChain?: boolean;

  /**
   * Custom registry URLs to try.
   */
  registries?: string[];

  /**
   * Program address (for on-chain fetch).
   */
  programId: Address;
}

/**
 * Derive the IDL account address for an Anchor program.
 * Anchor stores IDLs at a PDA derived from the program ID.
 */
function deriveIdlAccountAddress(programId: Address): Address {
  // Anchor IDL account PDA seeds: [programId, "anchor:idl"]
  // This is a simplified version - in practice, you'd use proper PDA derivation
  // For now, we'll return a placeholder that will be handled by the caller
  // TODO: Implement proper PDA derivation using gill's utilities
  return programId as Address;
}

/**
 * Parse on-chain IDL data.
 * Anchor stores IDLs as compressed/encoded data on-chain.
 */
function parseOnChainIdl(_data: Uint8Array | string): ProgramIdl {
  // Anchor stores IDL as gzipped JSON
  // This is a placeholder - actual implementation would decompress and parse
  // For now, throw to indicate we need external registry
  throw new Error('On-chain IDL parsing not yet implemented');
}

/**
 * Fetch IDL for a program from various sources.
 *
 * Strategy:
 * 1. Try on-chain IDL account (Anchor programs)
 * 2. Try external registries
 * 3. Throw error if not found
 *
 * @param programId - Program address
 * @param rpc - RPC client for on-chain queries
 * @param options - Fetch options
 * @returns Parsed program IDL
 * @throws Error if IDL cannot be found
 *
 * @example
 * ```ts
 * const idl = await fetchIdl(programId, rpc);
 * ```
 */
export async function fetchIdl(
  programId: Address,
  rpc: Rpc<GetAccountInfoApi>,
  options?: Partial<FetchIdlOptions>
): Promise<ProgramIdl> {
  const opts: FetchIdlOptions = {
    programId,
    ...options,
  };

  // Try on-chain first (Anchor programs store IDL at PDA)
  if (!opts.skipOnChain) {
    try {
      const idlPda = deriveIdlAccountAddress(programId);
      const account = await rpc.getAccountInfo(idlPda).send();
      if (account.value && account.value.data) {
        try {
          // account.value.data is Base58EncodedBytes, convert to Uint8Array
          const data = typeof account.value.data === 'string' 
            ? new TextEncoder().encode(account.value.data)
            : account.value.data;
          return parseOnChainIdl(data);
        } catch {
          // If parsing fails, continue to registries
        }
      }
    } catch {
      // If on-chain fetch fails, continue to registries
    }
  }

  // Try external registries
  const registries = opts.registries || DEFAULT_REGISTRIES;
  for (const registry of registries) {
    try {
      const url = `${registry}/${programId}.json`;
      const response = await fetch(url);
      if (response.ok) {
        const idl = (await response.json()) as ProgramIdl;
        // Validate basic structure
        if (idl.version && idl.name && Array.isArray(idl.instructions)) {
          return idl;
        }
      }
    } catch {
      // Continue to next registry
    }
  }

  throw new Error(`IDL not found for program ${programId}. Tried on-chain and ${registries.length} registries.`);
}

/**
 * Load IDL from a JSON string or object.
 * Useful for testing or when you have the IDL locally.
 *
 * @param idl - IDL JSON string or object
 * @returns Parsed program IDL
 *
 * @example
 * ```ts
 * const idlJson = fs.readFileSync('idl.json', 'utf-8');
 * const idl = loadIdlFromJson(idlJson);
 * ```
 */
export function loadIdlFromJson(idl: string | ProgramIdl): ProgramIdl {
  if (typeof idl === 'string') {
    const parsed = JSON.parse(idl) as ProgramIdl;
    // Debug: Check if discriminator exists in raw JSON
    if ((parsed as any).name === 'amm_v3') {
      const swapV2 = (parsed as any).instructions?.find((i: any) => i.name === 'swap_v2');
      console.log('[Fetcher] loadIdlFromJson (string path) - swap_v2 has discriminator?', {
        hasDiscriminator: !!swapV2?.discriminator,
        discriminatorValue: swapV2?.discriminator,
      });
    }
    return parsed;
  }
  // Debug: Check if discriminator exists in object
  if ((idl as any).name === 'amm_v3') {
    const swapV2 = (idl as any).instructions?.find((i: any) => i.name === 'swap_v2');
    console.log('[Fetcher] loadIdlFromJson (object path) - swap_v2 has discriminator?', {
      hasDiscriminator: !!swapV2?.discriminator,
      discriminatorValue: swapV2?.discriminator,
    });
  }
  return idl;
}

