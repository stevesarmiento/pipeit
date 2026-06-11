/**
 * Conversion utilities for web3.js instructions to Kit instructions.
 *
 * @packageDocumentation
 */

import { address, type Address } from '@solana/addresses';
import type { AccountRole, Instruction } from '@solana/instructions';
import type { PublicKey } from '@solana/web3.js';
import { InvalidFlashInstructionError } from './types.js';

export interface Web3InstructionLike {
    programId?: PublicKey;
    keys?: Array<{
        pubkey?: PublicKey;
        isSigner: boolean;
        isWritable: boolean;
    }>;
    data?: ArrayLike<number>;
}

function toAccountRole(key: { isSigner: boolean; isWritable: boolean }): AccountRole {
    if (key.isSigner && key.isWritable) {
        return 3 as AccountRole;
    }
    if (key.isSigner) {
        return 2 as AccountRole;
    }
    if (key.isWritable) {
        return 1 as AccountRole;
    }
    return 0 as AccountRole;
}

export function web3InstructionToKit(instruction: Web3InstructionLike): Instruction {
    if (!instruction.programId) {
        throw new InvalidFlashInstructionError('Flash instruction is missing a programId.');
    }

    return {
        programAddress: address(instruction.programId.toBase58()),
        accounts: (instruction.keys ?? []).map(key => {
            if (!key.pubkey) {
                throw new InvalidFlashInstructionError('Flash instruction account is missing a pubkey.');
            }

            return {
                address: address(key.pubkey.toBase58()),
                role: toAccountRole(key),
            };
        }),
        data: instruction.data ? new Uint8Array(instruction.data) : new Uint8Array(),
    };
}

export function web3InstructionsToKit(instructions: Web3InstructionLike[]): Instruction[] {
    return instructions.map(web3InstructionToKit);
}

export function web3LookupTableAddressesToKit(lookupTableAddresses: PublicKey[]): Address[] {
    return lookupTableAddresses.map(lookupTableAddress => address(lookupTableAddress.toBase58()));
}
