/**
 * IDL program registry for managing and building instructions from IDLs.
 *
 * @packageDocumentation
 */

import type { Address } from '@solana/addresses';
import type { Rpc, GetAccountInfoApi } from '@solana/rpc';
import type { Instruction } from '@solana/instructions';
import { fetchIdl, loadIdlFromJson } from './fetcher.js';
import { parseIdl } from './parser.js';
import { IdlInstructionBuilder } from './builder.js';
import type { BuildContext } from './builder.js';
import type { ProgramIdl, IdlInstruction } from './types.js';
import { AccountDiscoveryRegistry } from './discovery/registry.js';
import { WellKnownProgramResolver } from './discovery/strategies/well-known.js';
import { AssociatedTokenAccountResolver } from './discovery/strategies/ata.js';
import { ProtocolPluginRegistry } from './discovery/plugins/plugin-registry.js';
import type { ProtocolAccountPlugin } from './discovery/plugins/plugin.js';
import type { DiscoveryContext } from './discovery/types.js';

/**
 * Registry for managing program IDLs and building instructions.
 */
export class IdlProgramRegistry {
  private readonly cache = new Map<string, ProgramIdl>();
  private readonly builders = new Map<string, Map<string, IdlInstructionBuilder>>();
  private readonly pluginRegistry = new ProtocolPluginRegistry();
  private readonly discoveryRegistry = new AccountDiscoveryRegistry();

  constructor() {
    // Register default discovery strategies
    this.discoveryRegistry.registerStrategy(new WellKnownProgramResolver());
    this.discoveryRegistry.registerStrategy(new AssociatedTokenAccountResolver());
  }

  /**
   * Register a program by fetching its IDL.
   *
   * @param programId - Program address
   * @param rpc - RPC client for fetching IDL
   * @param options - Optional fetch options
   * @throws Error if IDL cannot be fetched or parsed
   *
   * @example
   * ```ts
   * const registry = new IdlProgramRegistry();
   * await registry.registerProgram(programId, rpc);
   * ```
   */
  async registerProgram(
    programId: Address,
    rpc: Rpc<GetAccountInfoApi>,
    options?: { skipOnChain?: boolean; registries?: string[] }
  ): Promise<void> {
    // Check cache first
    if (this.cache.has(programId)) {
      return;
    }

    // Fetch IDL
    const rawIdl = await fetchIdl(programId, rpc, options);
    const idl = parseIdl(rawIdl);

    // Ensure metadata has program address
    if (!idl.metadata) {
      idl.metadata = { address: programId };
    } else if (!idl.metadata.address) {
      idl.metadata.address = programId;
    }

    // Cache IDL
    this.cache.set(programId, idl);

    // Create builders for all instructions
    const instructionBuilders = new Map<string, IdlInstructionBuilder>();
    for (const instruction of idl.instructions) {
      instructionBuilders.set(
        instruction.name,
        new IdlInstructionBuilder(idl, instruction.name, this.discoveryRegistry)
      );
    }
    this.builders.set(programId, instructionBuilders);
  }

  /**
   * Register a program from a JSON IDL.
   * Useful for testing or when you have the IDL locally.
   *
   * @param programId - Program address
   * @param idl - IDL JSON string or object
   *
   * @example
   * ```ts
   * const idlJson = fs.readFileSync('idl.json', 'utf-8');
   * registry.registerProgramFromJson(programId, idlJson);
   * ```
   */
  registerProgramFromJson(programId: Address, idl: string | ProgramIdl): void {
    const rawIdl = loadIdlFromJson(idl);
    const parsedIdl = parseIdl(rawIdl);

    // Ensure metadata has program address
    if (!parsedIdl.metadata) {
      parsedIdl.metadata = { address: programId };
    } else if (!parsedIdl.metadata.address) {
      parsedIdl.metadata.address = programId;
    }

    // Cache IDL
    this.cache.set(programId, parsedIdl);

    // Create builders for all instructions
    const instructionBuilders = new Map<string, IdlInstructionBuilder>();
    for (const instruction of parsedIdl.instructions) {
      instructionBuilders.set(
        instruction.name,
        new IdlInstructionBuilder(parsedIdl, instruction.name, this.discoveryRegistry)
      );
    }
    this.builders.set(programId, instructionBuilders);
  }

  /**
   * Register a protocol-specific account plugin.
   *
   * Plugins can automatically resolve accounts for specific programs/instructions
   * by calling external APIs, querying on-chain data, or using protocol-specific heuristics.
   *
   * @param plugin - Protocol plugin to register
   *
   * @example
   * ```ts
   * import { JupiterSwapPlugin } from '@pipeit/tx-idl/discovery/plugins/jupiter'
   * registry.use(new JupiterSwapPlugin())
   * ```
   */
  use(plugin: ProtocolAccountPlugin): void {
    this.pluginRegistry.register(plugin);
  }

  /**
   * Build an instruction from IDL.
   * Returns a standard Instruction object compatible with all pipeit packages.
   *
   * Supports automatic account discovery through plugins and discovery strategies.
   *
   * @param programId - Program address
   * @param instructionName - Instruction name
   * @param params - Instruction parameters
   * @param accounts - Account addresses keyed by account name (optional - will be auto-discovered if not provided)
   * @param context - Build context (signer, programId, etc.)
   * @returns Built instruction
   * @throws Error if program not registered or instruction not found
   *
   * @example
   * ```ts
   * // Manual accounts (still works)
   * const instruction = await registry.buildInstruction(
   *   programId,
   *   'swap',
   *   { amountIn: 1000000n, minimumAmountOut: 900000n },
   *   { userSourceAccount, userDestAccount },
   *   { signer: userAddress, programId, rpc }
   * );
   *
   * // Automatic discovery (new!)
   * const instruction = await registry.buildInstruction(
   *   programId,
   *   'swap',
   *   { amountIn: 1000000n, inputMint: SOL, outputMint: USDC },
   *   {}, // Accounts auto-discovered!
   *   { signer: userAddress, programId, rpc }
   * );
   * ```
   */
  async buildInstruction(
    programId: Address,
    instructionName: string,
    params: Record<string, unknown>,
    accounts: Record<string, Address> = {},
    context: {
      signer: Address;
      programId: Address;
      rpc?: Rpc<GetAccountInfoApi>;
      context?: Record<string, unknown>;
    }
  ): Promise<Instruction> {
    const builder = this.builders.get(programId)?.get(instructionName);
    const idl = this.cache.get(programId);
    if (!builder || !idl) {
      if (!idl) {
        throw new Error(`Program ${programId} not registered. Call registerProgram() first.`);
      }
      throw new Error(
        `Instruction ${instructionName} not found in program ${programId}. Available: ${idl.instructions.map((i) => i.name).join(', ')}`
      );
    }

    const instruction = idl.instructions.find((i) => i.name === instructionName)!;

    // Try protocol-specific plugin first
    const plugin = this.pluginRegistry.getPlugin(programId, instructionName);
    let resolvedAccounts = { ...accounts };

    if (plugin) {
      // Use plugin to discover accounts
      const discoveryContext: DiscoveryContext = {
        instruction,
        params,
        providedAccounts: accounts,
        signer: context.signer,
        programId,
        rpc: context.rpc!,
        idl,
      };

      // Prepare params if plugin has prepareParams hook
      let finalParams = params;
      if (plugin.prepareParams) {
        finalParams = await plugin.prepareParams(params, discoveryContext);
      }

      // Resolve accounts using plugin
      const discoveredAccounts = await plugin.resolveAccounts(
        instruction,
        finalParams,
        discoveryContext
      );

      // Merge discovered accounts with provided (provided overrides discovered)
      resolvedAccounts = { ...discoveredAccounts, ...accounts };

      // Use prepared params for building
      params = finalParams;
    }

    const buildContext: BuildContext = {
      ...context,
      idl,
      resolvedTypes: new Map(),
    };

    let mainInstruction = await builder.buildInstruction(params, resolvedAccounts, buildContext);

    // Check if plugin has getRemainingAccounts hook (for accounts not in IDL)
    if (plugin?.getRemainingAccounts) {
      const discoveryContext: DiscoveryContext = {
        instruction,
        params,
        providedAccounts: accounts,
        signer: context.signer,
        programId,
        rpc: context.rpc!,
        idl,
      };

      const remainingAccounts = await plugin.getRemainingAccounts(
        instruction,
        params,
        discoveryContext
      );

      if (remainingAccounts && remainingAccounts.length > 0) {
        console.log(
          `[Registry] Plugin ${plugin.id ?? 'unknown'} provided ${remainingAccounts.length} remaining accounts for ${instruction.name}`
        );
        // Append remaining accounts to the instruction
        const remainingAccountMetas = remainingAccounts.map((acc) => ({
          address: acc.address,
          role: acc.role,
        }));

        const existingAccounts = mainInstruction.accounts
          ? [...mainInstruction.accounts]
          : [];

        mainInstruction = {
          ...mainInstruction,
          accounts: [...existingAccounts, ...remainingAccountMetas],
        };

        console.log(
          `[Registry] ${instruction.name} final account count after plugin append: ${mainInstruction.accounts?.length ?? existingAccounts.length}`
        );

        console.log(`[Registry] Added ${remainingAccounts.length} remaining accounts to ${instruction.name}`);
      }
    }

    // Check if plugin has prepareInstructions hook
    if (plugin?.prepareInstructions) {
      const discoveryContext: DiscoveryContext = {
        instruction,
        params,
        providedAccounts: accounts,
        signer: context.signer,
        programId,
        rpc: context.rpc!,
        idl,
      };

      const { preInstructions, postInstructions } = await plugin.prepareInstructions(
        instruction,
        params,
        discoveryContext
      );

      // If there are pre/post instructions, return an object with them
      // Otherwise, return just the instruction for backward compatibility
      if (preInstructions && preInstructions.length > 0) {
        return {
          ...mainInstruction,
          _preInstructions: preInstructions,
          _postInstructions: postInstructions,
        } as Instruction & { _preInstructions?: Instruction[]; _postInstructions?: Instruction[] };
      }
      if (postInstructions && postInstructions.length > 0) {
        return {
          ...mainInstruction,
          _preInstructions: preInstructions,
          _postInstructions: postInstructions,
        } as Instruction & { _preInstructions?: Instruction[]; _postInstructions?: Instruction[] };
      }
    }

    return mainInstruction;
  }

  /**
   * Build an instruction with pre/post instructions from plugins.
   * Returns an object containing the main instruction and any pre/post instructions.
   *
   * @param programId - Program address
   * @param instructionName - Instruction name
   * @param params - Instruction parameters
   * @param accounts - Account addresses keyed by account name (optional)
   * @param context - Build context (signer, programId, etc.)
   * @returns Object containing main instruction and pre/post instructions
   */
  async buildInstructionWithPrePost(
    programId: Address,
    instructionName: string,
    params: Record<string, unknown>,
    accounts: Record<string, Address> = {},
    context: {
      signer: Address;
      programId: Address;
      rpc?: Rpc<GetAccountInfoApi>;
      context?: Record<string, unknown>;
    }
  ): Promise<{
    instruction: Instruction;
    preInstructions?: Instruction[];
    postInstructions?: Instruction[];
  }> {
    const builder = this.builders.get(programId)?.get(instructionName);
    const idl = this.cache.get(programId);
    if (!builder || !idl) {
      if (!idl) {
        throw new Error(`Program ${programId} not registered. Call registerProgram() first.`);
      }
      throw new Error(
        `Instruction ${instructionName} not found in program ${programId}. Available: ${idl.instructions.map((i) => i.name).join(', ')}`
      );
    }

    const instruction = idl.instructions.find((i) => i.name === instructionName)!;

    // Try protocol-specific plugin first
    const plugin = this.pluginRegistry.getPlugin(programId, instructionName);
    let resolvedAccounts = { ...accounts };

    if (plugin) {
      // Use plugin to discover accounts
      const discoveryContext: DiscoveryContext = {
        instruction,
        params,
        providedAccounts: accounts,
        signer: context.signer,
        programId,
        rpc: context.rpc!,
        idl,
      };

      // Prepare params if plugin has prepareParams hook
      let finalParams = params;
      if (plugin.prepareParams) {
        finalParams = await plugin.prepareParams(params, discoveryContext);
      }

      // Resolve accounts using plugin
      const discoveredAccounts = await plugin.resolveAccounts(
        instruction,
        finalParams,
        discoveryContext
      );

      // Merge discovered accounts with provided (provided overrides discovered)
      resolvedAccounts = { ...discoveredAccounts, ...accounts };

      // Use prepared params for building
      params = finalParams;
    }

    const buildContext: BuildContext = {
      ...context,
      idl,
      resolvedTypes: new Map(),
    };

    let mainInstruction = await builder.buildInstruction(params, resolvedAccounts, buildContext);

    if (plugin?.getRemainingAccounts) {
      console.log(`[Registry buildInstructionWithPrePost] Calling getRemainingAccounts for ${instruction.name} with plugin ${plugin.id}`);
      const discoveryContext: DiscoveryContext = {
        instruction,
        params,
        providedAccounts: accounts,
        signer: context.signer,
        programId,
        rpc: context.rpc!,
        idl,
      };

      const remainingAccounts = await plugin.getRemainingAccounts(
        instruction,
        params,
        discoveryContext
      );
      
      console.log(`[Registry buildInstructionWithPrePost] getRemainingAccounts returned ${remainingAccounts?.length ?? 0} accounts`);

      if (remainingAccounts && remainingAccounts.length > 0) {
        console.log(
          `[Registry] Plugin ${plugin.id ?? 'unknown'} provided ${remainingAccounts.length} remaining accounts for ${instruction.name}`
        );

        const remainingAccountMetas = remainingAccounts.map((acc) => ({
          address: acc.address,
          role: acc.role,
        }));

        const existingAccounts = mainInstruction.accounts
          ? [...mainInstruction.accounts]
          : [];

        mainInstruction = {
          ...mainInstruction,
          accounts: [...existingAccounts, ...remainingAccountMetas],
        };

        console.log(
          `[Registry] ${instruction.name} final account count after plugin append: ${mainInstruction.accounts?.length ?? existingAccounts.length}`
        );

        // Log final account list for swap_v2 debugging
        if (instruction.name === 'swap_v2' && mainInstruction.accounts) {
          console.log(`[Registry] swap_v2 final account list:`, {
            totalAccounts: mainInstruction.accounts.length,
            idlAccounts: existingAccounts.length,
            remainingAccounts: remainingAccounts.length,
            accountAddresses: mainInstruction.accounts.map((acc, idx) => ({
              index: idx,
              address: acc.address.toString(),
              role: acc.role,
            })),
          });
        }

        console.log(`[Registry] Added ${remainingAccounts.length} remaining accounts to ${instruction.name}`);
      }
    }

    // Check if plugin has prepareInstructions hook
    const result: {
      instruction: Instruction;
      preInstructions?: Instruction[];
      postInstructions?: Instruction[];
    } = {
      instruction: mainInstruction,
    };

    if (plugin?.prepareInstructions) {
      const discoveryContext: DiscoveryContext = {
        instruction,
        params,
        providedAccounts: accounts,
        signer: context.signer,
        programId,
        rpc: context.rpc!,
        idl,
      };

      const prepared = await plugin.prepareInstructions(instruction, params, discoveryContext);
      if (prepared.preInstructions && prepared.preInstructions.length > 0) {
        result.preInstructions = prepared.preInstructions;
      }
      if (prepared.postInstructions && prepared.postInstructions.length > 0) {
        result.postInstructions = prepared.postInstructions;
      }
    }

    return result;
  }

  /**
   * Get all instructions for a registered program.
   *
   * @param programId - Program address
   * @returns Array of instruction definitions
   * @throws Error if program not registered
   */
  getInstructions(programId: Address): IdlInstruction[] {
    const idl = this.cache.get(programId);
    if (!idl) {
      throw new Error(`Program ${programId} not registered. Call registerProgram() first.`);
    }
    return idl.instructions;
  }

  /**
   * Get instruction builder for a specific instruction.
   * Useful for getting parameter schemas or account requirements.
   *
   * @param programId - Program address
   * @param instructionName - Instruction name
   * @returns Instruction builder
   * @throws Error if program not registered or instruction not found
   */
  getInstructionBuilder(programId: Address, instructionName: string): IdlInstructionBuilder {
    const builder = this.builders.get(programId)?.get(instructionName);
    if (!builder) {
      const idl = this.cache.get(programId);
      if (!idl) {
        throw new Error(`Program ${programId} not registered. Call registerProgram() first.`);
      }
      throw new Error(
        `Instruction ${instructionName} not found in program ${programId}. Available: ${idl.instructions.map((i) => i.name).join(', ')}`
      );
    }
    return builder;
  }

  /**
   * Get the IDL for a registered program.
   *
   * @param programId - Program address
   * @returns Program IDL
   * @throws Error if program not registered
   */
  getIdl(programId: Address): ProgramIdl {
    const idl = this.cache.get(programId);
    if (!idl) {
      throw new Error(`Program ${programId} not registered. Call registerProgram() first.`);
    }
    return idl;
  }

  /**
   * Check if a program is registered.
   *
   * @param programId - Program address
   * @returns True if program is registered
   */
  isRegistered(programId: Address): boolean {
    return this.cache.has(programId);
  }

  /**
   * Clear the cache for a specific program or all programs.
   *
   * @param programId - Optional program address. If not provided, clears all.
   */
  clearCache(programId?: Address): void {
    if (programId) {
      this.cache.delete(programId);
      this.builders.delete(programId);
    } else {
      this.cache.clear();
      this.builders.clear();
    }
  }
}

