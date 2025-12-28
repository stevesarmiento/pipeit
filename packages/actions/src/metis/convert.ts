/**
 * Conversion utilities for Metis types to Kit types.
 *
 * @packageDocumentation
 */

import { address, type Address } from '@solana/addresses';
import { getBase64Encoder } from '@solana/kit';
import type { Instruction, AccountMeta as KitAccountMeta, AccountRole } from '@solana/instructions';
import type { MetisInstruction, AccountMeta } from './types.js';

/**
 * Decode a base64 string to Uint8Array.
 */
export function decodeBase64(base64: string): Uint8Array {
    return Uint8Array.from(getBase64Encoder().encode(base64));
}

/**
 * Map Metis account meta flags to Kit AccountRole.
 *
 * AccountRole values:
 * - 0: READONLY
 * - 1: WRITABLE
 * - 2: READONLY_SIGNER
 * - 3: WRITABLE_SIGNER
 */
function toAccountRole(meta: AccountMeta): AccountRole {
    if (meta.isSigner && meta.isWritable) {
        return 3 as AccountRole; // WRITABLE_SIGNER
    }
    if (meta.isSigner) {
        return 2 as AccountRole; // READONLY_SIGNER
    }
    if (meta.isWritable) {
        return 1 as AccountRole; // WRITABLE
    }
    return 0 as AccountRole; // READONLY
}

/**
 * Convert a Metis account meta to Kit AccountMeta.
 */
function metisAccountMetaToKit(meta: AccountMeta): KitAccountMeta {
    return {
        address: address(meta.pubkey),
        role: toAccountRole(meta),
    };
}

/**
 * Convert a Metis instruction to a Kit Instruction.
 *
 * @param instruction - Metis instruction with base64-encoded data
 * @returns Kit instruction
 *
 * @example
 * ```ts
 * const kitInstruction = metisInstructionToKit(metisInstruction);
 * ```
 */
export function metisInstructionToKit(instruction: MetisInstruction): Instruction {
    return {
        programAddress: address(instruction.programId),
        accounts: instruction.accounts.map(metisAccountMetaToKit),
        data: decodeBase64(instruction.data),
    };
}

/**
 * Convert multiple Metis instructions to Kit instructions.
 *
 * @param instructions - Array of Metis instructions
 * @returns Array of Kit instructions
 */
export function metisInstructionsToKit(instructions: MetisInstruction[]): Instruction[] {
    return instructions.map(metisInstructionToKit);
}

/**
 * Convert Metis address lookup table addresses to Kit Address array.
 *
 * @param addresses - Array of base58 address strings
 * @returns Array of Kit addresses
 */
export function metisLookupTablesToAddresses(addresses: string[]): Address[] {
    return addresses.map(addr => address(addr));
}
