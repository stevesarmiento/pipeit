/**
 * Account resolution and PDA derivation utilities.
 *
 * @packageDocumentation
 */

import type { Address } from '@solana/addresses';
import { getProgramDerivedAddress, getAddressEncoder } from '@solana/addresses';
import type { Rpc, GetAccountInfoApi } from '@solana/rpc';
import { AccountRole } from '@solana/instructions';
import type { IdlAccountItem, IdlInstruction, ProgramIdl, PdaSeed } from './types.js';
import { serializeSeedValue } from './seed-serializer.js';
import type { AccountDiscoveryRegistry } from './discovery/registry.js';
import type { DiscoveryContext } from './discovery/types.js';

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
  context?: {
    /**
     * Instruction arguments for arg-based seed resolution.
     */
    args?: Record<string, unknown>;
    /**
     * Provided accounts for account-based seed resolution.
     */
    accounts?: Record<string, Address>;
  };
}

/**
 * Context for seed resolution during PDA derivation.
 */
interface SeedResolutionContext {
  /**
   * Instruction arguments (for arg-based seeds).
   */
  instructionArgs: Record<string, unknown>;
  /**
   * Provided accounts (for account-based seeds).
   */
  accounts: Record<string, Address>;
  /**
   * Signer address (fallback for account resolution).
   */
  signer: Address;
}

/**
 * Account resolver for IDL instructions.
 */
export class AccountResolver {
  constructor(
    private readonly _idl: ProgramIdl,
    private readonly discoveryRegistry?: AccountDiscoveryRegistry
  ) {
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

      // 1. Check provided accounts first (user override)
      address = providedAccounts[account.name];

      // 2. Try PDA derivation
      if (!address && account.pda) {
        address = await this.derivePda(account.pda, context);
      }

      // 3. Try automatic discovery (NEW)
      if (!address && this.discoveryRegistry && context.rpc) {
        const discoveryContext: DiscoveryContext = {
          instruction,
          params: context.context?.args || {},
          providedAccounts,
          signer: context.signer,
          programId: context.programId,
          rpc: context.rpc,
          idl: this._idl,
        };
        address = await this.discoveryRegistry.discover(account, discoveryContext);
      }

      // 4. Signer fallback
      if (!address && account.isSigner) {
        address = context.signer;
      }

      // 5. Optional accounts
      if (!address && account.isOptional) {
        continue;
      }

      // 6. Error if still missing
      if (!address) {
        throw new Error(
          `Cannot resolve required account '${account.name}'. ` +
            `Tried: provided, PDA derivation, auto-discovery. ` +
            `Please provide the account address manually.`
        );
      }

      // Determine account role (ensure program accounts are never writable)
      const role = this.determineAccountRole(account, address, context.programId);

      resolved.push({
        address,
        role,
      });
    }

    return resolved;
  }

  /**
   * Convert a PDA seed to bytes.
   *
   * @param seed - PDA seed definition
   * @param seedContext - Context for resolving seed values
   * @returns Seed value as bytes
   */
  private seedToBytes(seed: PdaSeed, seedContext: SeedResolutionContext): Uint8Array {
    if (seed.kind === 'const') {
      // Convert const value to bytes based on type
      if (typeof seed.value === 'string') {
        return Buffer.from(seed.value);
      }
      if (seed.value instanceof Uint8Array) {
        return seed.value;
      }
      if (seed.value instanceof Buffer) {
        return seed.value;
      }
      // Handle other primitive types using serializer
      return serializeSeedValue(seed.value, seed.type);
    }

    if (seed.kind === 'arg') {
      // Resolve from instruction arguments
      const argValue = seedContext.instructionArgs[seed.path];
      if (argValue === undefined) {
        throw new Error(`Cannot resolve PDA seed: instruction argument '${seed.path}' not found`);
      }
      return serializeSeedValue(argValue, 'inferred');
    }

    if (seed.kind === 'account') {
      // Resolve from provided accounts and encode address to bytes
      const accountAddress = seedContext.accounts[seed.path];
      if (!accountAddress) {
        throw new Error(`Cannot resolve PDA seed: account '${seed.path}' not found`);
      }
      const encoded = getAddressEncoder().encode(accountAddress);
      return new Uint8Array(encoded);
    }

    throw new Error(`Unknown PDA seed kind: ${(seed as { kind: string }).kind}`);
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
    // Convert IDL seeds to byte arrays
    const seedBytes: Uint8Array[] = [];

    const seedContext: SeedResolutionContext = {
      instructionArgs: context.context?.args || {},
      accounts: context.context?.accounts || {},
      signer: context.signer,
    };

    for (const seed of pda.seeds) {
      const bytes = this.seedToBytes(seed, seedContext);
      seedBytes.push(bytes);
    }

    // Derive PDA using gill's utility
    const [pdaAddress] = await getProgramDerivedAddress({
      programAddress: context.programId,
      seeds: seedBytes,
    });

    return pdaAddress;
  }

  /**
   * Determine account role from account definition.
   *
   * @param account - Account definition
   * @param address - Resolved account address (to check if it's the program itself)
   * @param programId - Program ID being invoked
   * @returns Account role
   */
  private determineAccountRole(account: IdlAccountItem, address: Address, programId: Address): AccountRole {
    // Program accounts can NEVER be writable - they're invoked, not modified
    if (address === programId) {
      return AccountRole.READONLY;
    }
    
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

