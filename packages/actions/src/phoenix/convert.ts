/**
 * Conversion utilities for Rise instructions to Kit instructions.
 *
 * @packageDocumentation
 */

import { address } from '@solana/addresses';
import type { AccountRole, Instruction } from '@solana/instructions';
import type { RiseInstructionLike } from './types.js';
import { InvalidPhoenixInstructionError } from './types.js';

export type { RiseInstructionLike } from './types.js';

/**
 * Converts a Rise instruction (kit v4-typed) into this package's Kit
 * {@link Instruction} shape. Account roles share the same 0-3 enum encoding;
 * addresses are revalidated and instruction data is defensively copied.
 *
 * @example
 * ```ts
 * const ix = await client.ixs.buildCancelAll({ authority, symbol });
 * const kitIx = riseInstructionToKit(ix);
 * ```
 */
export function riseInstructionToKit(instruction: RiseInstructionLike): Instruction {
    if (!instruction.programAddress) {
        throw new InvalidPhoenixInstructionError('Phoenix instruction is missing a programAddress.');
    }

    return {
        programAddress: address(String(instruction.programAddress)),
        accounts: (instruction.accounts ?? []).map(account => {
            if (!account.address) {
                throw new InvalidPhoenixInstructionError('Phoenix instruction account is missing an address.');
            }

            return {
                address: address(String(account.address)),
                role: account.role as AccountRole,
            };
        }),
        data: instruction.data ? new Uint8Array(instruction.data) : new Uint8Array(),
    };
}

/**
 * Converts a list of Rise instructions to Kit instructions.
 * See {@link riseInstructionToKit}.
 */
export function riseInstructionsToKit(instructions: RiseInstructionLike[]): Instruction[] {
    return instructions.map(riseInstructionToKit);
}
