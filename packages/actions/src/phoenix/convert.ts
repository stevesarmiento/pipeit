/**
 * Conversion utilities for Rise instructions to Kit instructions.
 *
 * @packageDocumentation
 */

import { address, type Address } from '@solana/addresses';
import type { AccountRole, Instruction } from '@solana/instructions';
import { InvalidPhoenixInstructionError } from './types.js';

export interface RiseInstructionLike {
    programAddress?: string | Address;
    accounts?: readonly {
        address?: string | Address;
        role: AccountRole | number;
    }[];
    data?: ArrayLike<number>;
}

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

export function riseInstructionsToKit(instructions: RiseInstructionLike[]): Instruction[] {
    return instructions.map(riseInstructionToKit);
}
