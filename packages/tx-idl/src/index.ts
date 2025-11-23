/**
 * @pipeit/tx-idl - IDL-based transaction builder for Solana programs.
 *
 * @packageDocumentation
 */

// Core types
export type {
  ProgramIdl,
  IdlInstruction,
  IdlAccountItem,
  IdlField,
  IdlType,
  IdlAccountDef,
  IdlTypeDef,
  IdlErrorCode,
} from './types.js';

// Registry (main API)
export { IdlProgramRegistry } from './registry.js';
export type { BuildContext } from './builder.js';

// Instruction builder
export { IdlInstructionBuilder } from './builder.js';
export type {
  JSONSchema,
  AccountRequirement,
} from './builder.js';

// Account resolution
export { AccountResolver } from './accounts.js';
export type {
  ResolvedAccount,
  AccountResolutionContext,
} from './accounts.js';
// AccountRole is exported from gill, re-export it here for convenience
export type { AccountRole } from '@solana/instructions';

// IDL fetching
export { fetchIdl, loadIdlFromJson } from './fetcher.js';
export type { FetchIdlOptions } from './fetcher.js';

// IDL parsing
export { parseIdl, resolveTypeReference } from './parser.js';
export { IdlValidationError } from './parser.js';

// Serialization
export {
  createInstructionCodec,
  createInstructionEncoder,
  createInstructionDecoder,
  idlTypeToEncoder,
  idlTypeToDecoder,
  encodeInstructionData,
} from './serializer.js';

// Account Discovery
export * from './discovery/index.js';

// Example Plugins
export { JupiterSwapPlugin, JUPITER_V6_PROGRAM } from './discovery/plugins/jupiter.js';
export type { JupiterApiConfig } from './discovery/plugins/jupiter.js';
export { MetaplexMetadataPlugin, METAPLEX_PROGRAM } from './discovery/plugins/metaplex.js';
export {
  KaminoLendingPlugin,
  KAMINO_LENDING_PROGRAM,
  KAMINO_MAINNET_LENDING_MARKET,
} from './discovery/plugins/kamino.js';
export {
  RaydiumSwapPlugin,
  RAYDIUM_CLMM_PROGRAM,
} from './discovery/plugins/raydium.js';

// Seed serialization (for PDA derivation)
export { serializeSeedValue } from './seed-serializer.js';

