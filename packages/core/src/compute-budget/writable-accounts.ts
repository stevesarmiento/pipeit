/**
 * Writable account collection for fee estimators.
 *
 * @packageDocumentation
 */

import type { Address } from '@solana/addresses';
import { isWritableRole, type Instruction } from '@solana/instructions';

/**
 * Collect the writable accounts of a transaction: the fee payer first, then
 * every account an instruction marks writable (signer or not), de-duplicated
 * in order of first appearance.
 *
 * This is the account set handed to `'custom'` priority fee resolvers as
 * `PriorityFeeContext.writableAccounts`.
 *
 * @param feePayer - The transaction's fee payer
 * @param instructions - The transaction's instructions
 */
export function collectWritableAccounts(feePayer: Address, instructions: readonly Instruction[]): Address[] {
    const seen = new Set<Address>([feePayer]);
    const writable: Address[] = [feePayer];
    for (const instruction of instructions) {
        for (const account of instruction.accounts ?? []) {
            if (!isWritableRole(account.role) || seen.has(account.address)) continue;
            seen.add(account.address);
            writable.push(account.address);
        }
    }
    return writable;
}
