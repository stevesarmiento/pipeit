/**
 * IDL instruction builder.
 *
 * @packageDocumentation
 */

import type { Address } from '@solana/addresses';
import type { Instruction, AccountMeta } from '@solana/instructions';
import type { AccountResolutionContext, AccountResolver } from './accounts.js';
import { AccountResolver as AccountResolverClass } from './accounts.js';
import type { ProgramIdl, IdlInstruction } from './types.js';
import { encodeInstructionData } from './serializer.js';
import type { SerializationContext } from './serializer.js';
import type { AccountDiscoveryRegistry } from './discovery/registry.js';

/**
 * Build context for instruction creation.
 */
export interface BuildContext extends AccountResolutionContext {
  /**
   * Program IDL.
   */
  idl: ProgramIdl;

  /**
   * Resolved type definitions cache.
   */
  resolvedTypes: Map<string, unknown>;

  /**
   * Instruction arguments for PDA seed resolution.
   */
  instructionArgs?: Record<string, unknown>;
}

/**
 * JSON Schema for parameter validation and UI generation.
 */
export interface JSONSchema {
  type: string;
  properties?: Record<string, JSONSchema>;
  required?: string[];
  items?: JSONSchema;
  enum?: unknown[];
  [key: string]: unknown;
}

/**
 * Account requirement information.
 */
export interface AccountRequirement {
  /**
   * Account name.
   */
  name: string;

  /**
   * Whether account is mutable.
   */
  isMut: boolean;

  /**
   * Whether account must be a signer.
   */
  isSigner: boolean;

  /**
   * Whether account is optional.
   */
  isOptional: boolean;

  /**
   * Whether account is a PDA.
   */
  isPda: boolean;

  /**
   * Documentation strings.
   */
  docs?: string[];
}

/**
 * Builder for creating instructions from IDL definitions.
 */
export class IdlInstructionBuilder {
  private readonly instruction: IdlInstruction;
  private readonly accountResolver: AccountResolver;

  constructor(
    private readonly idl: ProgramIdl,
    instructionName: string,
    discoveryRegistry?: AccountDiscoveryRegistry
  ) {
    const instruction = idl.instructions.find((i) => i.name === instructionName);
    if (!instruction) {
      throw new Error(`Instruction ${instructionName} not found in IDL`);
    }

    this.instruction = instruction;
    this.accountResolver = new AccountResolverClass(idl, discoveryRegistry);
  }

  /**
   * Build an instruction from parameters and accounts.
   *
   * @param params - Instruction parameters
   * @param accounts - Account addresses keyed by account name
   * @param context - Build context
   * @returns Built instruction
   */
  async buildInstruction(
    params: Record<string, unknown>,
    accounts: Record<string, Address>,
    context: BuildContext
  ): Promise<Instruction> {
    // Validate accounts
    this.accountResolver.validateAccounts(this.instruction, accounts, context);

    // Create context with instruction args for PDA seed resolution
    const accountResolutionContext: AccountResolutionContext = {
      ...context,
      context: {
        args: params,
        accounts: accounts,
      },
    };

    // Resolve accounts
    const resolvedAccounts = await this.accountResolver.resolveAccounts(
      this.instruction,
      accounts,
      accountResolutionContext
    );

    // Serialize instruction data
    const serializationContext: SerializationContext = {
      idl: this.idl,
      resolvedTypes: new Map(),
    };

    const data = encodeInstructionData(this.instruction, params, serializationContext);

    // Convert resolved accounts to account metas
    const accountMetas: AccountMeta<string>[] = resolvedAccounts.map((acc) => {
      return {
        address: acc.address,
        role: acc.role,
      } as AccountMeta<string>;
    });

    // Get program address
    const programAddress = this.idl.metadata?.address || context.programId;
    
    // Debug: Log accounts for Raydium swap
    if (this.instruction.name === 'swap_v2') {
      console.log('[Builder] Built swap_v2 instruction with accounts:', {
        accountCount: resolvedAccounts.length,
        accounts: resolvedAccounts.map((acc, idx) => ({
          index: idx,
          name: this.instruction.accounts[idx]?.name || 'unknown',
          address: acc.address.toString(),
          role: acc.role,
          roleDesc: acc.role === 0 ? 'read-only' : acc.role === 1 ? 'writable' : 'signer+writable',
        })),
      });
    }

    return {
      programAddress: programAddress as Address,
      accounts: accountMetas,
      data,
    } as Instruction;
  }

  /**
   * Get JSON Schema for instruction parameters.
   * Useful for UI auto-generation.
   *
   * @returns JSON Schema for parameters
   */
  getParamSchema(): JSONSchema {
    const properties: Record<string, JSONSchema> = {};

    for (const arg of this.instruction.args) {
      properties[arg.name] = this.idlTypeToJsonSchema(arg.type);
    }

    return {
      type: 'object',
      properties,
      required: this.instruction.args.map((arg) => arg.name),
    };
  }

  /**
   * Get account requirements for this instruction.
   *
   * @returns Array of account requirements
   */
  getAccountRequirements(): AccountRequirement[] {
    const flattenAccounts = (acc: typeof this.instruction.accounts[0]): AccountRequirement[] => {
      // If this is a composite account, flatten its nested accounts
      if (acc.accounts) {
        return acc.accounts.flatMap(flattenAccounts);
      }
      
      // Regular account
      const req: AccountRequirement = {
        name: acc.name,
        isMut: acc.isMut ?? false,
        isSigner: acc.isSigner ?? false,
        isOptional: acc.isOptional ?? false,
        isPda: !!acc.pda,
      };
      if (acc.docs) {
        req.docs = acc.docs;
      }
      return [req];
    };

    return this.instruction.accounts.flatMap(flattenAccounts);
  }

  /**
   * Convert IDL type to JSON Schema.
   */
  private idlTypeToJsonSchema(type: unknown): JSONSchema {
    if (typeof type === 'string') {
      switch (type) {
        case 'bool':
          return { type: 'boolean' };
        case 'u8':
        case 'u16':
        case 'u32':
        case 'u64':
        case 'u128':
        case 'i8':
        case 'i16':
        case 'i32':
        case 'i64':
        case 'i128':
        case 'f32':
        case 'f64':
          return { type: 'number' };
        case 'string':
          return { type: 'string' };
        case 'publicKey':
          return { type: 'string', pattern: '^[1-9A-HJ-NP-Za-km-z]{32,44}$' };
        case 'bytes':
          return { type: 'string', format: 'byte' };
        default:
          return { type: 'string' };
      }
    }

    if (typeof type === 'object' && type !== null) {
      const typeObj = type as Record<string, unknown>;

      if ('vec' in typeObj) {
        return {
          type: 'array',
          items: this.idlTypeToJsonSchema(typeObj.vec),
        };
      }

      if ('option' in typeObj || 'coption' in typeObj) {
        const innerType = 'option' in typeObj ? typeObj.option : typeObj.coption;
        return {
          ...this.idlTypeToJsonSchema(innerType),
          // Note: JSON Schema doesn't have a direct "optional" concept,
          // but we can mark it as nullable
        };
      }

      if ('array' in typeObj) {
        const arr = typeObj.array as [unknown, unknown];
        return {
          type: 'array',
          items: this.idlTypeToJsonSchema(arr[0]),
          maxItems: Number(arr[1]),
          minItems: Number(arr[1]),
        };
      }

      if ('tuple' in typeObj) {
        return {
          type: 'array',
          items: {
            type: 'object',
            anyOf: (typeObj.tuple as unknown[]).map((t) => this.idlTypeToJsonSchema(t)),
          },
        };
      }

      if ('defined' in typeObj) {
        return {
          type: 'object',
          // Note: Would need to resolve the type definition for full schema
        };
      }
    }

    return { type: 'string' };
  }
}

