# 🚰 Pipeit - Type-Safe Solana Transaction Builder

A comprehensive Solana transaction building library that reduces boilerplate and provides type-safe, composable APIs built on @solana/kit.

## Packages

- **@pipeit/tx-builder** - Main transaction builder with smart defaults
- **@pipeit/tx-idl** - IDL-based transaction building with automatic account discovery
- **@pipeit/tx-orchestration** - (EXPERIMENTAL) Advanced multi-step orchestration

## Installation

```bash
# Main builder package (recommended for most users)
pnpm install @pipeit/tx-builder @solana/kit

# IDL-based building
pnpm install @pipeit/tx-idl @solana/kit

# Experimental orchestration
pnpm install @pipeit/tx-orchestration @solana/kit
```

## Quick Start

### Simple API

```typescript
import { transaction } from '@pipeit/tx-builder';
import { createSolanaRpc, createSolanaRpcSubscriptions } from '@solana/kit';

const rpc = createSolanaRpc('https://api.mainnet-beta.solana.com');
const rpcSubscriptions = createSolanaRpcSubscriptions('wss://api.mainnet-beta.solana.com');

// Auto-retry, auto-blockhash fetch, built-in validation
const signature = await transaction({ autoRetry: true, logLevel: 'verbose' })
  .addInstruction(yourInstruction)
  .execute({ feePayer: signer, rpc, rpcSubscriptions });
```

### Advanced API (Type-Safe)

```typescript
import { TransactionBuilder } from '@pipeit/tx-builder';

// Auto-fetch blockhash when RPC provided
const message = await new TransactionBuilder({ rpc, version: 0 })
  .setFeePayer(address)
  .addInstruction(instruction)
  .build(); // Type-safe + auto-blockhash!
```

### Simulation

```typescript
const result = await transaction()
  .addInstruction(instruction)
  .simulate({ feePayer: signer, rpc });

if (result.err) {
  console.error('Simulation failed:', result.logs);
} else {
  console.log('Success! Units consumed:', result.unitsConsumed);
}
```

### IDL-Based Transactions

```typescript
import { IdlProgramRegistry } from '@pipeit/tx-idl';
import { transaction } from '@pipeit/tx-builder';
import { createSolanaRpc } from '@solana/kit';

const rpc = createSolanaRpc('https://api.mainnet-beta.solana.com');
const registry = new IdlProgramRegistry();
await registry.registerProgram(programId, rpc);

// Automatic account discovery!
const instruction = await registry.buildInstruction(
  programId,
  'swap',
  { 
    amountIn: 1000000n, 
    inputMint: SOL_MINT,    // Auto-derives userSourceTokenAccount
    outputMint: USDC_MINT   // Auto-derives userDestTokenAccount
  },
  {}, // Accounts auto-discovered!
  { signer: userAddress, programId, rpc }
);

const signature = await transaction()
  .addInstruction(instruction)
  .execute({ feePayer: signer, rpc, rpcSubscriptions });
```

## What's New in v0.2?

- ✅ Migrated from Gill to @solana/kit (official Solana SDK)
- ✅ Consolidated packages for simpler API surface
- ✅ Auto-blockhash fetching (pass `rpc` to constructor)
- ✅ Built-in transaction validation
- ✅ Simulation support with `.simulate()`
- ✅ Kit assertion helpers (`assertIsAddress`)
- ✅ Improved TypeScript types

## Features

### @pipeit/tx-builder

- **Type-Safe Builder**: Compile-time checks ensure all required fields are set
- **Auto-Blockhash**: Automatically fetches latest blockhash when RPC provided
- **Smart Defaults**: Opinionated configuration for common use cases
- **Auto-Retry**: Configurable retry with exponential backoff
- **Built-in Validation**: Automatic transaction size and field validation
- **Simulation**: Test transactions before sending
- **Comprehensive Logging**: Verbose error logs with simulation details

### @pipeit/tx-idl

- **Automatic IDL Fetching**: Fetch program IDLs from on-chain or registries
- **Account Auto-Discovery**: Automatically resolve accounts, PDAs, and ATAs
- **Protocol Plugins**: Extensible system for Jupiter, Kamino, Raydium, etc.
- **Full Type Support**: Handles all Anchor/Codama type definitions
- **JSON Schema Generation**: Auto-generate parameter schemas for UIs

### @pipeit/tx-orchestration (EXPERIMENTAL)

- **Multi-Step Flows**: Chain dependent instructions with result passing
- **Automatic Batching**: Intelligently batch instructions into single transactions
- **Size Handling**: Auto-split transactions that exceed size limits
- **Execution Strategies**: Auto, batch, or sequential execution

## Development

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test

# Type checking
pnpm typecheck

# Lint
pnpm lint
```

## License

MIT
