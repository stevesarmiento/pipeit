/**
 * Conversion utilities for Titan types to Kit types.
 *
 * @packageDocumentation
 */

import { address, type Address } from '@solana/addresses';
import type { Instruction, AccountMeta, AccountRole } from '@solana/instructions';
import type { TitanPubkey, TitanInstruction, TitanAccountMeta } from './types.js';

/**
 * Base58 alphabet used by Solana.
 */
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/**
 * Encode bytes as a base58 string.
 *
 * @param bytes - Uint8Array to encode
 * @returns Base58 encoded string
 *
 * @example
 * ```ts
 * const address = encodeBase58(pubkeyBytes);
 * // => 'So11111111111111111111111111111111111111112'
 * ```
 */
export function encodeBase58(bytes: Uint8Array): string {
    if (bytes.length === 0) return '';

    // Count leading zeros
    let leadingZeros = 0;
    for (const byte of bytes) {
        if (byte === 0) leadingZeros++;
        else break;
    }

    // Convert to BigInt
    let num = 0n;
    for (const byte of bytes) {
        num = num * 256n + BigInt(byte);
    }

    // Convert to base58
    let result = '';
    while (num > 0n) {
        const remainder = Number(num % 58n);
        num = num / 58n;
        result = BASE58_ALPHABET[remainder] + result;
    }

    // Add leading '1's for zeros
    return '1'.repeat(leadingZeros) + result;
}

/**
 * Convert a Titan pubkey (Uint8Array) to a Kit Address (base58 string).
 *
 * @param pubkey - Titan pubkey bytes (32 bytes)
 * @returns Kit Address
 *
 * @example
 * ```ts
 * const kitAddress = titanPubkeyToAddress(titanPubkey);
 * ```
 */
export function titanPubkeyToAddress(pubkey: TitanPubkey): Address {
    return address(encodeBase58(pubkey));
}

/**
 * Map Titan account meta flags to Kit AccountRole.
 *
 * AccountRole values:
 * - 0: READONLY
 * - 1: WRITABLE
 * - 2: READONLY_SIGNER
 * - 3: WRITABLE_SIGNER
 */
function toAccountRole(meta: TitanAccountMeta): AccountRole {
    if (meta.s && meta.w) {
        return 3 as AccountRole; // WRITABLE_SIGNER
    }
    if (meta.s) {
        return 2 as AccountRole; // READONLY_SIGNER
    }
    if (meta.w) {
        return 1 as AccountRole; // WRITABLE
    }
    return 0 as AccountRole; // READONLY
}

/**
 * Convert a Titan account meta to Kit AccountMeta.
 */
function titanAccountMetaToKit(meta: TitanAccountMeta): AccountMeta {
    return {
        address: titanPubkeyToAddress(meta.p),
        role: toAccountRole(meta),
    };
}

/**
 * Convert a Titan instruction to a Kit Instruction.
 *
 * @param instruction - Titan instruction
 * @returns Kit instruction
 *
 * @example
 * ```ts
 * const kitInstruction = titanInstructionToKit(titanInstruction);
 * ```
 */
export function titanInstructionToKit(instruction: TitanInstruction): Instruction {
    return {
        programAddress: titanPubkeyToAddress(instruction.p),
        accounts: instruction.a.map(titanAccountMetaToKit),
        data: instruction.d,
    };
}

/**
 * Convert multiple Titan instructions to Kit instructions.
 *
 * @param instructions - Array of Titan instructions
 * @returns Array of Kit instructions
 */
export function titanInstructionsToKit(instructions: TitanInstruction[]): Instruction[] {
    return instructions.map(titanInstructionToKit);
}

/**
 * Convert Titan pubkey array to Kit Address array.
 *
 * @param pubkeys - Array of Titan pubkeys
 * @returns Array of Kit addresses
 */
export function titanPubkeysToAddresses(pubkeys: TitanPubkey[]): Address[] {
    return pubkeys.map(titanPubkeyToAddress);
}
