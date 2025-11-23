/**
 * Account discovery types and interfaces.
 *
 * @packageDocumentation
 */

import type { Address } from '@solana/addresses';
import type { Rpc, GetAccountInfoApi } from '@solana/rpc';
import type { IdlAccountItem, IdlInstruction, ProgramIdl } from '../types.js';

/**
 * Context for account discovery operations.
 */
export interface DiscoveryContext {
  /**
   * The instruction being built.
   */
  instruction: IdlInstruction;

  /**
   * Instruction parameters.
   */
  params: Record<string, unknown>;

  /**
   * Accounts already provided by the caller.
   */
  providedAccounts: Record<string, Address>;

  /**
   * Signer address.
   */
  signer: Address;

  /**
   * Program ID.
   */
  programId: Address;

  /**
   * RPC client for on-chain queries.
   */
  rpc: Rpc<GetAccountInfoApi>;

  /**
   * Program IDL.
   */
  idl: ProgramIdl;
}

/**
 * Strategy for discovering account addresses.
 */
export interface AccountDiscoveryStrategy {
  /**
   * Strategy name for debugging and logging.
   */
  name: string;

  /**
   * Priority (higher = try first).
   * Strategies are tried in priority order.
   */
  priority: number;

  /**
   * Check if this strategy can resolve the account.
   *
   * @param account - Account definition from IDL
   * @param context - Discovery context
   * @returns True if this strategy can resolve the account
   */
  canResolve: (
    account: IdlAccountItem,
    context: DiscoveryContext
  ) => boolean | Promise<boolean>;

  /**
   * Resolve the account address.
   *
   * @param account - Account definition from IDL
   * @param context - Discovery context
   * @returns Resolved account address
   * @throws Error if resolution fails
   */
  resolve: (
    account: IdlAccountItem,
    context: DiscoveryContext
  ) => Promise<Address>;
}


