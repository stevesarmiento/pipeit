/**
 * Transaction message compression using address lookup tables.
 *
 * @packageDocumentation
 */

import { isSignerRole } from '@solana/instructions';
import {
    compressTransactionMessageUsingAddressLookupTables,
    type TransactionMessage,
} from '@solana/transaction-messages';
import type { AddressesByLookupTableAddress } from './types.js';

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
    addressesByLookupTableAddress: AddressesByLookupTableAddress,
): TMessage {
    // Address lookup tables only apply to v0 (versioned) transactions.
    if (transactionMessage.version === 'legacy') return transactionMessage;

    // Delegate to Kit's implementation (re-exported from `@solana/kit`).
    // We keep this wrapper to preserve Pipeit's legacy-safe signature.
    return compressTransactionMessageUsingAddressLookupTables(
        transactionMessage as Exclude<TransactionMessage, { version: 'legacy' }>,
        addressesByLookupTableAddress,
    ) as TMessage;
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
    addressesByLookupTableAddress: AddressesByLookupTableAddress,
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

    const programAddresses = new Set(transactionMessage.instructions.map(ix => ix.programAddress));

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
    const bytesSaved = Math.max(0, accountsConvertible * bytesPerAccount - lookupTablesUsed.size * bytesPerTable);

    return {
        accountsConvertible,
        bytesSaved,
        lookupTablesUsed: lookupTablesUsed.size,
    };
}
