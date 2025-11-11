/**
 * Protocol account plugin interface.
 *
 * Plugins allow protocol-specific account resolution logic (e.g., Jupiter swap accounts,
 * Kamino deposit accounts) to be registered and automatically used when building instructions.
 *
 * @packageDocumentation
 */

import type { Address } from 'gill';
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
}

