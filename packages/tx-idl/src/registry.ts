/**
 * IDL program registry for managing and building instructions from IDLs.
 *
 * @packageDocumentation
 */

import type { Address, Rpc, GetAccountInfoApi } from 'gill';
import type { Instruction } from 'gill';
import { fetchIdl, loadIdlFromJson } from './fetcher.js';
import { parseIdl } from './parser.js';
import { IdlInstructionBuilder } from './builder.js';
import type { BuildContext } from './builder.js';
import type { ProgramIdl, IdlInstruction } from './types.js';

/**
 * Registry for managing program IDLs and building instructions.
 */
export class IdlProgramRegistry {
  private readonly cache = new Map<string, ProgramIdl>();
  private readonly builders = new Map<string, Map<string, IdlInstructionBuilder>>();

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
        new IdlInstructionBuilder(idl, instruction.name)
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
        new IdlInstructionBuilder(parsedIdl, instruction.name)
      );
    }
    this.builders.set(programId, instructionBuilders);
  }

  /**
   * Build an instruction from IDL.
   * Returns a standard Instruction object compatible with all pipeit packages.
   *
   * @param programId - Program address
   * @param instructionName - Instruction name
   * @param params - Instruction parameters
   * @param accounts - Account addresses keyed by account name
   * @param context - Build context (signer, programId, etc.)
   * @returns Built instruction
   * @throws Error if program not registered or instruction not found
   *
   * @example
   * ```ts
   * const instruction = await registry.buildInstruction(
   *   programId,
   *   'swap',
   *   { amountIn: 1000000n, minimumAmountOut: 900000n },
   *   { userSourceAccount, userDestAccount },
   *   { signer: userAddress, programId, rpc }
   * );
   * ```
   */
  async buildInstruction(
    programId: Address,
    instructionName: string,
    params: Record<string, unknown>,
    accounts: Record<string, Address>,
    context: {
      signer: Address;
      programId: Address;
      rpc?: Rpc<GetAccountInfoApi>;
      context?: Record<string, unknown>;
    }
  ): Promise<Instruction> {
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

    const idl = this.cache.get(programId)!;
    const buildContext: BuildContext = {
      ...context,
      idl,
      resolvedTypes: new Map(),
    };

    return builder.buildInstruction(params, accounts, buildContext);
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

