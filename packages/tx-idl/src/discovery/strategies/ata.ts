/**
 * Associated Token Account (ATA) discovery resolver.
 *
 * Automatically discovers user token accounts by deriving Associated Token Addresses
 * based on mint and owner addresses inferred from instruction parameters.
 *
 * @packageDocumentation
 */

import type { Address } from '@solana/addresses';
import { getProgramDerivedAddress, getAddressEncoder } from '@solana/addresses';
import type { IdlAccountItem } from '../../types.js';
import type { AccountDiscoveryStrategy, DiscoveryContext } from '../types.js';
import { WELL_KNOWN_PROGRAMS } from './constants.js';

/**
 * Resolver for Associated Token Accounts (ATAs).
 *
 * Infers mint addresses from instruction parameters and derives the user's
 * Associated Token Account address.
 */
export class AssociatedTokenAccountResolver implements AccountDiscoveryStrategy {
  name = 'associated-token-account';
  priority = 90; // High priority, but lower than well-known programs

  canResolve(account: IdlAccountItem, context: DiscoveryContext): boolean {
    const name = account.name.toLowerCase();

    // Pattern matching for token accounts
    const isTokenAccount =
      (name.includes('user') && name.includes('token') && name.includes('account')) ||
      name.includes('ata') ||
      /^user(Source|Dest|Destination)(Token)?Account$/i.test(name) ||
      account.docs?.some((doc) => doc.toLowerCase().includes('associated token')) ||
      false;

    if (!isTokenAccount) {
      return false;
    }

    // Check if we can infer the mint
    return this.canInferMint(account, context);
  }

  async resolve(account: IdlAccountItem, context: DiscoveryContext): Promise<Address> {
    const mint = this.inferMint(account, context);

    if (!mint) {
      throw new Error(`Cannot infer mint for token account: ${account.name}`);
    }

    // Derive Associated Token Address
    // ATA PDA seeds: [owner, token_program_id, mint]
    // Note: Addresses are encoded as 32-byte arrays for PDA seeds
    const ownerBytes = new Uint8Array(getAddressEncoder().encode(context.signer));
    const tokenProgramBytes = new Uint8Array(
      getAddressEncoder().encode(WELL_KNOWN_PROGRAMS.tokenProgram)
    );
    const mintBytes = new Uint8Array(getAddressEncoder().encode(mint));

    const [ataAddress] = await getProgramDerivedAddress({
      programAddress: WELL_KNOWN_PROGRAMS.associatedTokenProgram,
      seeds: [ownerBytes, tokenProgramBytes, mintBytes],
    });

    return ataAddress;
  }

  private canInferMint(account: IdlAccountItem, context: DiscoveryContext): boolean {
    return this.inferMint(account, context) !== undefined;
  }

  private inferMint(
    account: IdlAccountItem,
    context: DiscoveryContext
  ): Address | undefined {
    const name = account.name.toLowerCase();

    // Strategy 1: Explicit mint in params (common in swap instructions)
    if (name.includes('source') && context.params.inputMint) {
      return context.params.inputMint as Address;
    }
    if (name.includes('dest') && context.params.outputMint) {
      return context.params.outputMint as Address;
    }

    // Strategy 2: Generic mint param
    if (context.params.mint) {
      return context.params.mint as Address;
    }

    // Strategy 3: Mint from account docs
    const mintHint = account.docs
      ?.find((doc) => doc.includes('mint:'))
      ?.match(/mint:\s*([a-zA-Z0-9]+)/)?.[1];

    if (mintHint && context.params[mintHint]) {
      return context.params[mintHint] as Address;
    }

    // Strategy 4: Look for 'mint' account in provided accounts
    if (context.providedAccounts.mint) {
      return context.providedAccounts.mint;
    }

    // Strategy 5: Check for mint in other account names
    // If there's a "mint" account in the instruction, use it
    const mintAccount = context.instruction.accounts.find(
      (acc) => acc.name.toLowerCase() === 'mint'
    );
    if (mintAccount && context.providedAccounts.mint) {
      return context.providedAccounts.mint;
    }

    // Strategy 6: Look for mint in params with common names
    const mintParamNames = ['tokenMint', 'tokenMintAddress', 'mintAddress', 'mintPubkey'];
    for (const paramName of mintParamNames) {
      if (context.params[paramName]) {
        return context.params[paramName] as Address;
      }
    }

    return undefined;
  }
}

