/**
 * Protocol account plugin interface.
 *
 * Plugins allow protocol-specific account resolution logic (e.g., Jupiter swap accounts,
 * Kamino deposit accounts) to be registered and automatically used when building instructions.
 *
 * @packageDocumentation
 */

import type { Address } from '@solana/addresses';
import type { Instruction } from '@solana/instructions';
import type { IdlInstruction } from '../../types.js';
import type { DiscoveryContext } from '../types.js';

/**
 * Plugin for protocol-specific account resolution.
 *
 * Plugins can resolve accounts for specific programs/instructions by:
 * - Calling external APIs (e.g., Jupiter quote API)
 * - Querying on-chain data
 * - Using protocol-specific heuristics
 */
export interface ProtocolAccountPlugin {
  /**
   * Plugin identifier (e.g., 'jupiter-swap', 'kamino-deposit').
   */
  id: string;

  /**
   * Program ID this plugin supports.
   */
  programId: Address;

  /**
   * Instruction names this plugin handles.
   * Use '*' to handle all instructions for the program.
   */
  instructions: string[] | '*';

  /**
   * Resolve accounts for the instruction.
   *
   * @param instruction - Instruction definition from IDL
   * @param params - Instruction parameters
   * @param context - Discovery context
   * @returns Map of account names to addresses
   */
  resolveAccounts: (
    instruction: IdlInstruction,
    params: Record<string, unknown>,
    context: DiscoveryContext
  ) => Promise<Record<string, Address>>;

  /**
   * Optional: Modify params before building instruction.
   *
   * Useful for plugins that need to fetch quotes, calculate amounts, etc.
   * The modified params will be used for both account resolution and instruction building.
   *
   * @param params - Original instruction parameters
   * @param context - Discovery context
   * @returns Modified parameters
   */
  prepareParams?: (
    params: Record<string, unknown>,
    context: DiscoveryContext
  ) => Promise<Record<string, unknown>>;

  /**
   * Optional: Prepare additional instructions to execute before or after the main instruction.
   *
   * Useful for plugins that need to set up accounts (e.g., wrap SOL) or clean up after
   * the main instruction (e.g., unwrap SOL). These instructions will be included in the
   * same transaction as the main instruction.
   *
   * @param instruction - Instruction definition from IDL
   * @param params - Instruction parameters (after prepareParams if applicable)
   * @param context - Discovery context
   * @returns Object containing pre and post instructions
   */
  prepareInstructions?: (
    instruction: IdlInstruction,
    params: Record<string, unknown>,
    context: DiscoveryContext
  ) => Promise<{
    preInstructions?: Instruction[];
    postInstructions?: Instruction[];
  }>;

  /**
   * Optional: Get remaining accounts that should be added after IDL-defined accounts.
   *
   * Some instructions (like Raydium swap_v2) require additional accounts that aren't
   * listed in the IDL but are needed by the program. These accounts are appended
   * to the instruction's accounts array after all IDL-defined accounts.
   *
   * @param instruction - Instruction definition from IDL
   * @param params - Instruction parameters (after prepareParams if applicable)
   * @param context - Discovery context
   * @returns Array of account addresses with their roles (0=readonly, 1=writable, 2=signer, 3=signer+writable)
   */
  getRemainingAccounts?: (
    instruction: IdlInstruction,
    params: Record<string, unknown>,
    context: DiscoveryContext
  ) => Promise<Array<{ address: Address; role: number }>>;
}

