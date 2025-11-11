/**
 * Account resolution and PDA derivation utilities.
 *
 * @packageDocumentation
 */

import type { Address, Rpc, GetAccountInfoApi } from 'gill';
import { AccountRole } from 'gill';
import type { IdlAccountItem, IdlInstruction, ProgramIdl, PdaSeed } from './types.js';

/**
 * Resolved account metadata.
 */
export interface ResolvedAccount {
  /**
   * Account address.
   */
  address: Address;

  /**
   * Account role.
   */
  role: AccountRole;
}

/**
 * Context for account resolution.
 */
export interface AccountResolutionContext {
  /**
   * Signer address (for resolving "signer" accounts).
   */
  signer: Address;

  /**
   * Program ID.
   */
  programId: Address;

  /**
   * RPC client (for PDA derivation if needed).
   */
  rpc?: Rpc<GetAccountInfoApi>;

  /**
   * Additional context values for PDA seed resolution.
   */
  context?: Record<string, unknown>;
}

/**
 * Account resolver for IDL instructions.
 */
export class AccountResolver {
  constructor(_idl: ProgramIdl) {
    // IDL stored for potential future use (PDA derivation, account validation)
  }

  /**
   * Resolve all accounts for an instruction.
   *
   * @param instruction - Instruction definition
   * @param providedAccounts - Accounts provided by the caller
   * @param context - Resolution context
   * @returns Array of resolved account metadata
   */
  async resolveAccounts(
    instruction: IdlInstruction,
    providedAccounts: Record<string, Address>,
    context: AccountResolutionContext
  ): Promise<ResolvedAccount[]> {
    const resolved: ResolvedAccount[] = [];

    for (const account of instruction.accounts) {
      let address: Address | undefined;

      // Check if account is a PDA
      if (account.pda) {
        address = await this.derivePda(account.pda, context);
      } else {
        // Use provided account
        address = providedAccounts[account.name];

        // If account is marked as signer but not provided, use context signer
        if (!address && account.isSigner) {
          address = context.signer;
        }

        // Check if account is optional
        if (!address && account.isOptional) {
          // Skip optional accounts that aren't provided
          continue;
        }

        if (!address) {
          throw new Error(`Missing required account: ${account.name}`);
        }
      }

      // Determine account role
      const role = this.determineAccountRole(account);

      resolved.push({
        address,
        role,
      });
    }

    return resolved;
  }

  /**
   * Derive a PDA from seeds.
   *
   * @param pda - PDA definition with seeds
   * @param context - Resolution context
   * @returns Derived PDA address
   */
  async derivePda(
    pda: { seeds: PdaSeed[] },
    context: AccountResolutionContext
  ): Promise<Address> {
    // Simplified PDA derivation
    // In practice, you'd use proper PDA derivation utilities from gill
    // This is a placeholder that demonstrates the structure

    const seeds: Uint8Array[] = [];

    for (const seed of pda.seeds) {
      if (seed.kind === 'const') {
        seeds.push(seed.value);
      } else if (seed.kind === 'arg') {
        // Resolve from instruction args (would need to be passed in)
        throw new Error('PDA seed resolution from args not yet implemented');
      } else if (seed.kind === 'account') {
        // Resolve from provided accounts
        const accountName = seed.path;
        const accountAddress = context.context?.[accountName] as Address | undefined;
        if (!accountAddress) {
          throw new Error(`Cannot resolve PDA seed: account ${accountName} not found`);
        }
        // TODO: Properly decode address to bytes for PDA seeds
        // For now, this is a placeholder
        throw new Error('PDA seed resolution from accounts not yet fully implemented');
      }
    }

    // TODO: Use proper PDA derivation from gill
    // For now, return a placeholder
    // In practice: findProgramDerivedAddress(seeds, programId)
    throw new Error('PDA derivation not yet fully implemented - requires gill PDA utilities');
  }

  /**
   * Determine account role from account definition.
   *
   * @param account - Account definition
   * @returns Account role
   */
  private determineAccountRole(account: IdlAccountItem): AccountRole {
    if (account.isSigner) {
      return account.isMut ? AccountRole.WRITABLE_SIGNER : AccountRole.READONLY_SIGNER;
    }
    return account.isMut ? AccountRole.WRITABLE : AccountRole.READONLY;
  }

  /**
   * Validate that provided accounts match instruction requirements.
   *
   * @param instruction - Instruction definition
   * @param providedAccounts - Accounts provided by caller
   * @param context - Resolution context
   * @throws Error if validation fails
   */
  validateAccounts(
    instruction: IdlInstruction,
    providedAccounts: Record<string, Address>,
    context: AccountResolutionContext
  ): void {
    for (const account of instruction.accounts) {
      // Skip PDAs - they're derived automatically
      if (account.pda) {
        continue;
      }

      // Skip optional accounts
      if (account.isOptional) {
        continue;
      }

      // Check if account is provided or can be resolved from context
      const address = providedAccounts[account.name];
      if (!address && !account.isSigner) {
        throw new Error(`Missing required account: ${account.name}`);
      }

      // If account is signer, it can come from context
      if (!address && account.isSigner && context.signer) {
        continue;
      }

      if (!address) {
        throw new Error(`Missing required account: ${account.name}`);
      }
    }
  }
}

