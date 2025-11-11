# 🚰 Pipeit

A comprehensive Solana transaction building library that makes it easier to build transactions on Solana by reducing boilerplate and providing type-safe, composable APIs.

## Packages

- `@pipeit/tx-errors` - Typed error definitions for Solana transaction building
- `@pipeit/tx-core` - Core types and base transaction builder for Solana transactions
- `@pipeit/tx-builder` - High-level builder API for Solana transactions (beginner-friendly)
- `@pipeit/tx-templates` - Pre-built transaction templates for common Solana operations
- `@pipeit/tx-middleware` - Composable middleware for Solana transactions (retry, simulation, logging)
- `@pipeit/tx-orchestration` - Transaction orchestration for multi-step Solana transaction flows
- `@pipeit/tx-idl` - IDL-based transaction builder - automatically build instructions from program IDLs

## Installation

```bash
# Core builder API (recommended for most users)
pnpm install @pipeit/tx-builder gill

# Transaction templates
pnpm install @pipeit/tx-templates gill

# Transaction orchestration
pnpm install @pipeit/tx-orchestration gill

# IDL-based transaction builder
pnpm install @pipeit/tx-idl gill
```

## Quick Start

### Simple API

```typescript
import { transaction } from '@pipeit/tx-builder'
import { createSolanaRpc, createSolanaRpcSubscriptions } from 'gill'

const rpc = createSolanaRpc('https://api.mainnet-beta.solana.com')
const rpcSubscriptions = createSolanaRpcSubscriptions('wss://api.mainnet-beta.solana.com')

// Build and execute a transaction
const signature = await transaction()
  .addInstruction(yourInstruction)
  .execute({
    feePayer: walletSigner,
    rpc,
    rpcSubscriptions,
  })
```

### With Configuration

```typescript
import { transaction } from '@pipeit/tx-builder'

const signature = await transaction({
  autoRetry: true, // Auto-retry failed transactions
  priorityLevel: 'high', // Set priority fee
  computeUnitLimit: 200_000, // Set compute unit limit
  logLevel: 'verbose', // Enable logging
})
  .addInstruction(instruction1)
  .addInstruction(instruction2)
  .execute({
    feePayer: walletSigner,
    rpc,
    rpcSubscriptions,
  })
```

### Transaction Templates

```typescript
import { transferSol } from '@pipeit/tx-templates/core'

const signature = await transaction()
  .addInstruction(transferSol({
    from: senderAddress,
    to: recipientAddress,
    amount: 1_000_000n, // 0.001 SOL
  }))
  .execute({
    feePayer: walletSigner,
    rpc,
    rpcSubscriptions,
  })
```

### Transaction Orchestration

```typescript
import { createPipeline } from '@pipeit/tx-orchestration'

const pipeline = createPipeline([
  {
    name: 'step1',
    type: 'instruction',
    instruction: firstInstruction,
  },
  {
    name: 'step2',
    type: 'instruction',
    instruction: secondInstruction,
  },
])

const results = await pipeline.execute({
  signer: walletSigner,
  rpc,
  rpcSubscriptions,
})
```

### IDL-Based Transactions

```typescript
import { IdlProgramRegistry } from '@pipeit/tx-idl'
import { transaction } from '@pipeit/tx-builder'

const registry = new IdlProgramRegistry()
await registry.registerProgram(programId, rpc)

// Build instruction from IDL (manual accounts)
const instruction = await registry.buildInstruction(
  programId,
  'swap',
  { amountIn: 1000000n, minimumAmountOut: 900000n },
  { userSourceAccount, userDestAccount },
  { signer: userAddress, programId, rpc }
)

// Or with automatic account discovery!
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
)

const signature = await transaction()
  .addInstruction(instruction)
  .execute({ feePayer: signer, rpc, rpcSubscriptions })
```

### With Protocol Plugins

```typescript
import { IdlProgramRegistry, JupiterSwapPlugin } from '@pipeit/tx-idl'

const registry = new IdlProgramRegistry()
registry.use(new JupiterSwapPlugin()) // Enable automatic Jupiter account resolution

// Jupiter swap with zero manual account setup!
const instruction = await registry.buildInstruction(
  JUPITER_V6_PROGRAM,
  'swap',
  {
    inputMint: SOL,
    outputMint: USDC,
    amountIn: 1_000_000_000n,
    slippageBps: 50
  },
  {}, // Plugin handles all accounts automatically
  { signer: userAddress, programId: JUPITER_V6_PROGRAM, rpc }
)
```

## Development

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test

# Run type checking
pnpm typecheck

# Lint
pnpm lint
```

## License

MIT
