/**
 * Metaplex metadata account resolution plugin.
 *
 * Automatically resolves Metaplex metadata PDAs and well-known accounts
 * for metadata-related instructions.
 *
 * @packageDocumentation
 */

import { address, getProgramDerivedAddress, getAddressEncoder, type Address } from '@solana/addresses';
import type { IdlInstruction } from '../../types.js';
import type { ProtocolAccountPlugin } from './plugin.js';
import type { DiscoveryContext } from '../types.js';
import { WELL_KNOWN_PROGRAMS } from '../strategies/constants.js';

/**
 * Metaplex Token Metadata program address.
 */
export const METAPLEX_PROGRAM = address('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');

/**
 * Plugin for resolving Metaplex metadata instruction accounts.
 *
 * This plugin automatically derives:
 * - Metadata PDA from mint address
 * - Master Edition PDA (if needed)
 * - Well-known program accounts
 */
export class MetaplexMetadataPlugin implements ProtocolAccountPlugin {
  id = 'metaplex-metadata';
  programId = METAPLEX_PROGRAM;
  instructions = [
    'createMetadataAccount',
    'createMetadataAccountV2',
    'createMetadataAccountV3',
    'updateMetadataAccount',
    'updateMetadataAccountV2',
  ];

  async resolveAccounts(
    instruction: IdlInstruction,
    params: Record<string, unknown>,
    context: DiscoveryContext
  ): Promise<Record<string, Address>> {
    const accounts: Record<string, Address> = {};

    // Get mint address from params or provided accounts
    const mint = (params.mint as Address | undefined) || context.providedAccounts.mint;
    if (!mint) {
      throw new Error('Metaplex metadata instructions require a mint address');
    }

    // Derive metadata PDA
    // Seeds: ['metadata', metadata_program_id, mint]
    const metadataPda = await this.deriveMetadataPda(mint);
    accounts.metadata = metadataPda;

    // Derive master edition PDA if instruction needs it
    const needsMasterEdition = instruction.accounts.some(
      (acc) => acc.name.toLowerCase().includes('master') && acc.name.toLowerCase().includes('edition')
    );
    if (needsMasterEdition) {
      const masterEditionPda = await this.deriveMasterEditionPda(mint);
      accounts.masterEdition = masterEditionPda;
    }

    // Add well-known programs
    for (const account of instruction.accounts) {
      const name = account.name.toLowerCase();
      if (name.includes('system') && name.includes('program')) {
        accounts[account.name] = WELL_KNOWN_PROGRAMS.systemProgram;
      } else if (name.includes('token') && name.includes('program')) {
        accounts[account.name] = WELL_KNOWN_PROGRAMS.tokenProgram;
      } else if (name === 'rent') {
        accounts[account.name] = WELL_KNOWN_PROGRAMS.rent;
      }
    }

    return accounts;
  }

  private async deriveMetadataPda(mint: Address): Promise<Address> {
    const metadataBytes = Buffer.from('metadata');
    const programBytes = new Uint8Array(getAddressEncoder().encode(this.programId));
    const mintBytes = new Uint8Array(getAddressEncoder().encode(mint));

    const [pda] = await getProgramDerivedAddress({
      programAddress: this.programId,
      seeds: [metadataBytes, programBytes, mintBytes],
    });

    return pda;
  }

  private async deriveMasterEditionPda(mint: Address): Promise<Address> {
    const editionBytes = Buffer.from('edition');
    const programBytes = new Uint8Array(getAddressEncoder().encode(this.programId));
    const mintBytes = new Uint8Array(getAddressEncoder().encode(mint));

    const [pda] = await getProgramDerivedAddress({
      programAddress: this.programId,
      seeds: [editionBytes, programBytes, mintBytes],
    });

    return pda;
  }
}

