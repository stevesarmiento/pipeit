/**
 * Utilities for wrapping and unwrapping SOL (wSOL operations).
 *
 * @packageDocumentation
 */

import { address, getProgramDerivedAddress, getAddressEncoder, type Address } from '@solana/addresses';
import type { Instruction } from '@solana/instructions';
import { WELL_KNOWN_PROGRAMS } from '../strategies/constants.js';

/**
 * Native SOL mint address (wrapped SOL).
 */
export const SOL_MINT = address('So11111111111111111111111111111111111111112');

/**
 * Derive wSOL Associated Token Account address for an owner.
 *
 * @param owner - Owner address
 * @returns wSOL ATA address
 */
export async function deriveWsolAta(owner: Address): Promise<Address> {
  const ownerBytes = new Uint8Array(getAddressEncoder().encode(owner));
  const tokenProgramBytes = new Uint8Array(
    getAddressEncoder().encode(WELL_KNOWN_PROGRAMS.tokenProgram)
  );
  const mintBytes = new Uint8Array(getAddressEncoder().encode(SOL_MINT));

  const [ata] = await getProgramDerivedAddress({
    programAddress: WELL_KNOWN_PROGRAMS.associatedTokenProgram,
    seeds: [ownerBytes, tokenProgramBytes, mintBytes],
  });

  return ata;
}

/**
 * Create instruction to create wSOL Associated Token Account.
 * This is idempotent - safe to call even if the account already exists.
 *
 * @param payer - Account that will pay for the account creation
 * @param owner - Owner of the token account
 * @returns Promise resolving to instruction to create wSOL ATA
 */
export async function createWsolAtaInstruction(
  payer: Address,
  owner: Address
): Promise<Instruction> {
  const wsolAta = await deriveWsolAta(owner);
  const isPayerOwner = payer.toString() === owner.toString();
  
  // For ATA creation:
  // - Payer must be signer+writable (role 3) to pay for rent
  // - If payer = owner, we still need owner account but payer should be signer+writable
  // - ATA is writable (role 1)
  // - Other accounts are readonly (role 0)
  const data = new Uint8Array([1]); // CreateIdempotent instruction discriminator

  return {
    programAddress: WELL_KNOWN_PROGRAMS.associatedTokenProgram,
    accounts: [
      { address: payer, role: isPayerOwner ? 3 : 2 }, // payer: signer+writable if payer=owner, else signer
      { address: wsolAta, role: 1 }, // associatedToken (writable)
      { address: owner, role: 0 }, // owner (readonly)
      { address: SOL_MINT, role: 0 }, // mint (readonly)
      { address: WELL_KNOWN_PROGRAMS.systemProgram, role: 0 }, // systemProgram (readonly)
      { address: WELL_KNOWN_PROGRAMS.tokenProgram, role: 0 }, // tokenProgram (readonly)
      { address: WELL_KNOWN_PROGRAMS.rent, role: 0 }, // rent sysvar required by Associated Token Program
    ],
    data,
  };
}

/**
 * Create instructions to wrap native SOL into wSOL.
 * Returns instructions to:
 * 1. Create wSOL ATA (if needed)
 * 2. Transfer native SOL to wSOL ATA
 * 3. Sync native balance
 *
 * @param payer - Account that will pay and wrap SOL
 * @param amount - Amount of SOL to wrap in lamports
 * @returns Array of instructions to wrap SOL
 */
export async function wrapSolInstructions(
  payer: Address,
  amount: bigint
): Promise<Instruction[]> {
  const wsolAta = await deriveWsolAta(payer);

  // 1. Create wSOL ATA (idempotent)
  const createAtaIx = await createWsolAtaInstruction(payer, payer);

  // 2. Transfer native SOL to wSOL ATA
  // System Program Transfer instruction: instruction discriminator (2) + amount (u64)
  const transferData = new Uint8Array(12);
  new DataView(transferData.buffer).setUint32(0, 2, true); // Transfer instruction
  new DataView(transferData.buffer).setBigUint64(4, amount, true);

  const transferIx: Instruction = {
    programAddress: WELL_KNOWN_PROGRAMS.systemProgram,
    accounts: [
      { address: payer, role: 2 }, // from (signer)
      { address: wsolAta, role: 1 }, // to (writable)
    ],
    data: transferData,
  };

  // 3. Sync native balance (SyncNative instruction)
  // SPL Token SyncNative instruction discriminator: 17
  const syncIx: Instruction = {
    programAddress: WELL_KNOWN_PROGRAMS.tokenProgram,
    accounts: [
      { address: wsolAta, role: 1 }, // account (writable)
    ],
    data: new Uint8Array([17]),
  };

  return [createAtaIx, transferIx, syncIx];
}

/**
 * Create instruction to unwrap wSOL back to native SOL.
 * This closes the wSOL token account and transfers the SOL back to the owner.
 *
 * @param owner - Owner of the wSOL account
 * @returns Instruction to unwrap SOL
 */
export async function unwrapSolInstruction(owner: Address): Promise<Instruction> {
  const wsolAta = await deriveWsolAta(owner);

  // CloseAccount instruction discriminator: 9
  // Accounts: account (writable), destination (writable), authority (signer)
  const closeData = new Uint8Array(1);
  closeData[0] = 9; // CloseAccount instruction

  return {
    programAddress: WELL_KNOWN_PROGRAMS.tokenProgram,
    accounts: [
      { address: wsolAta, role: 1 }, // account to close (writable)
      { address: owner, role: 1 }, // destination for lamports (writable)
      { address: owner, role: 2 }, // authority/owner (signer)
    ],
    data: closeData,
  };
}

