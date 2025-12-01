/**
 * Transaction message compression using address lookup tables.
 *
 * @packageDocumentation
 */

import type { Address } from '@solana/addresses';
import type { AccountLookupMeta, AccountMeta, AccountRole, Instruction } from '@solana/instructions';
import type { TransactionMessage } from '@solana/transaction-messages';
import type { AddressesByLookupTableAddress } from './types.js';

/**
 * Check if an account role is a signer role.
 */
function isSignerRole(role: AccountRole): boolean {
  return role === 0b0011 || role === 0b0010; // READONLY_SIGNER or WRITABLE_SIGNER
}

/**
 * Find an address in lookup tables and return a lookup meta if found.
 */
function findAddressInLookupTables(
  address: Address,
  role: AccountRole,
  addressesByLookupTableAddress: AddressesByLookupTableAddress
): AccountLookupMeta | undefined {
  for (const [lookupTableAddress, addresses] of Object.entries(addressesByLookupTableAddress)) {
    const index = addresses.indexOf(address);
    if (index !== -1) {
      return {
        address,
        addressIndex: index,
        lookupTableAddress: lookupTableAddress as Address,
        role: role as 0b0000 | 0b0001, // READONLY or WRITABLE (non-signer)
      };
    }
  }
  return undefined;
}

/**
 * Compress a transaction message using address lookup tables.
 *
 * This replaces non-signer account references with lookup table references
 * where possible, reducing the serialized size of the transaction.
 *
 * @param transactionMessage - The transaction message to compress
 * @param addressesByLookupTableAddress - Mapping of lookup table addresses to their contents
 * @returns Compressed transaction message
 *
 * @example
 * ```ts
 * const compressedMessage = compressTransactionMessage(
 *   message,
 *   {
 *     [altAddress]: [addr1, addr2, addr3],
 *   }
 * );
 * ```
 */
export function compressTransactionMessage<TMessage extends TransactionMessage>(
  transactionMessage: TMessage,
  addressesByLookupTableAddress: AddressesByLookupTableAddress
): TMessage {
  // Only works with versioned transactions (version 0)
  if (transactionMessage.version === 'legacy') {
    console.warn('Address lookup tables are not supported for legacy transactions');
    return transactionMessage;
  }

  // Build set of program addresses (cannot be in lookup tables)
  const programAddresses = new Set(
    transactionMessage.instructions.map((ix) => ix.programAddress)
  );

  // Build set of eligible lookup addresses
  const eligibleLookupAddresses = new Set(
    Object.values(addressesByLookupTableAddress)
      .flat()
      .filter((addr) => !programAddresses.has(addr))
  );

  if (eligibleLookupAddresses.size === 0) {
    return transactionMessage;
  }

  const newInstructions: Instruction[] = [];
  let updatedAnyInstructions = false;

  for (const instruction of transactionMessage.instructions) {
    if (!instruction.accounts || instruction.accounts.length === 0) {
      newInstructions.push(instruction);
      continue;
    }

    const newAccounts: (AccountMeta | AccountLookupMeta)[] = [];
    let updatedAnyAccounts = false;

    for (const account of instruction.accounts) {
      // Skip if already a lookup, not in any lookup table, or is a signer
      if (
        'lookupTableAddress' in account ||
        !eligibleLookupAddresses.has(account.address) ||
        isSignerRole(account.role)
      ) {
        newAccounts.push(account);
        continue;
      }

      // Try to find in lookup tables
      const lookupMeta = findAddressInLookupTables(
        account.address,
        account.role,
        addressesByLookupTableAddress
      );

      if (lookupMeta) {
        newAccounts.push(Object.freeze(lookupMeta));
        updatedAnyAccounts = true;
        updatedAnyInstructions = true;
      } else {
        newAccounts.push(account);
      }
    }

    newInstructions.push(
      Object.freeze(
        updatedAnyAccounts
          ? { ...instruction, accounts: Object.freeze(newAccounts) }
          : instruction
      )
    );
  }

  if (!updatedAnyInstructions) {
    return transactionMessage;
  }

  return Object.freeze({
    ...transactionMessage,
    instructions: Object.freeze(newInstructions),
  }) as TMessage;
}

/**
 * Calculate potential size savings from using lookup tables.
 *
 * @param transactionMessage - The transaction message to analyze
 * @param addressesByLookupTableAddress - Mapping of lookup table addresses to their contents
 * @returns Size savings information
 *
 * @example
 * ```ts
 * const savings = calculateLookupTableSavings(message, lookupTables);
 * console.log(`Can save ${savings.bytesSaved} bytes using ALTs`);
 * ```
 */
export function calculateLookupTableSavings(
  transactionMessage: TransactionMessage,
  addressesByLookupTableAddress: AddressesByLookupTableAddress
): {
  /** Number of accounts that can be converted to lookups */
  accountsConvertible: number;
  /** Bytes saved per account (32 - 1 = 31 bytes per account) */
  bytesSaved: number;
  /** Number of unique lookup tables needed */
  lookupTablesUsed: number;
} {
  if (transactionMessage.version === 'legacy') {
    return { accountsConvertible: 0, bytesSaved: 0, lookupTablesUsed: 0 };
  }

  const programAddresses = new Set(
    transactionMessage.instructions.map((ix) => ix.programAddress)
  );

  const lookupTablesUsed = new Set<string>();
  let accountsConvertible = 0;

  for (const instruction of transactionMessage.instructions) {
    if (!instruction.accounts) continue;

    for (const account of instruction.accounts) {
      // Skip signers and already-lookup accounts
      if ('lookupTableAddress' in account || isSignerRole(account.role)) {
        continue;
      }

      // Skip program addresses
      if (programAddresses.has(account.address)) {
        continue;
      }

      // Check if in any lookup table
      for (const [lookupTableAddress, addresses] of Object.entries(addressesByLookupTableAddress)) {
        if (addresses.includes(account.address)) {
          accountsConvertible++;
          lookupTablesUsed.add(lookupTableAddress);
          break;
        }
      }
    }
  }

  // Each converted account saves 31 bytes (32 byte address -> 1 byte index)
  // But each lookup table used adds 34 bytes (32 byte address + 1 byte read count + 1 byte write count)
  const bytesPerAccount = 31;
  const bytesPerTable = 34;
  const bytesSaved = Math.max(
    0,
    accountsConvertible * bytesPerAccount - lookupTablesUsed.size * bytesPerTable
  );

  return {
    accountsConvertible,
    bytesSaved,
    lookupTablesUsed: lookupTablesUsed.size,
  };
}
