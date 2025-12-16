# 🚰 Pipeit - Type-Safe Solana Transaction Builder

A comprehensive Solana transaction building library that reduces boilerplate and provides type-safe, composable APIs built on @solana/kit.

## Packages

- **@pipeit/core** - Main transaction builder with smart defaults, multi-step flows, and Kit instruction-plans integration
- **@pipeit/actions** - High-level DeFi actions with pluggable protocol adapters (Jupiter, Raydium, etc.)

## Installation

```bash
# Main builder package (recommended for most users)
pnpm install @pipeit/core @solana/kit

# High-level DeFi actions
pnpm install @pipeit/actions @solana/kit
```

## Quick Start

### Single Transaction

```typescript
import { TransactionBuilder } from '@pipeit/core';
import { createSolanaRpc, createSolanaRpcSubscriptions } from '@solana/kit';

const rpc = createSolanaRpc('https://api.mainnet-beta.solana.com');
const rpcSubscriptions = createSolanaRpcSubscriptions('wss://api.mainnet-beta.solana.com');

// Auto-retry, auto-blockhash fetch, built-in validation
const signature = await new TransactionBuilder({
    rpc,
    autoRetry: true,
    priorityFee: 'high',
    logLevel: 'verbose',
})
    .setFeePayerSigner(signer)
    .addInstruction(yourInstruction)
    .execute({ rpcSubscriptions });
```

### Multi-Step Flows

For workflows where instructions depend on previous results:

```typescript
import { createFlow } from '@pipeit/core';

const result = await createFlow({ rpc, rpcSubscriptions, signer })
  .step('create-account', (ctx) => createAccountInstruction(...))
  .step('init-metadata', (ctx) => {
    // Access previous step results
    const prevResult = ctx.get('create-account');
    return initMetadataInstruction(prevResult, ...);
  })
  .atomic('swap', [
    (ctx) => wrapSolInstruction(...),
    (ctx) => swapInstruction(...),
  ])
  .onStepComplete((name, result) => console.log(`${name}: ${result.signature}`))
  .execute();
```

### Static Instruction Plans (Kit Integration)

For advanced users who know all instructions upfront:

```typescript
import { sequentialInstructionPlan, executePlan } from '@pipeit/core';

// Kit's instruction-plans are re-exported for advanced use cases
const plan = sequentialInstructionPlan([ix1, ix2, ix3, ix4, ix5]);
const result = await executePlan(plan, { rpc, rpcSubscriptions, signer });
```

### Simulation

```typescript
const result = await new TransactionBuilder({ rpc }).setFeePayerSigner(signer).addInstruction(instruction).simulate();

if (result.err) {
    console.error('Simulation failed:', result.logs);
} else {
    console.log('Success! Units consumed:', result.unitsConsumed);
}
```

### High-Level DeFi Actions

```typescript
import { pipe } from '@pipeit/actions';
import { jupiter } from '@pipeit/actions/adapters';

// Simple, composable DeFi actions
const result = await pipe({
    rpc,
    rpcSubscriptions,
    signer,
    adapters: { swap: jupiter() },
})
    .swap({
        inputMint: 'So11111111111111111111111111111111111111112', // SOL
        outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
        amount: 100_000_000n, // 0.1 SOL
        slippageBps: 50, // 0.5%
    })
    .execute();

console.log('Swap completed:', result.signature);

// Simulate before executing
const simulation = await pipe({ rpc, rpcSubscriptions, signer, adapters: { swap: jupiter() } })
    .swap({
        inputMint: 'So11111111111111111111111111111111111111112',
        outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        amount: 100_000_000n,
    })
    .simulate();

if (simulation.success) {
    console.log('Estimated compute units:', simulation.unitsConsumed);
}
```

## Features

### @pipeit/core

**Single Transactions:**

- **Type-Safe Builder**: Compile-time checks ensure all required fields are set
- **Auto-Blockhash**: Automatically fetches latest blockhash when RPC provided
- **Smart Defaults**: Opinionated configuration for common use cases
- **Priority Fees**: Configurable priority fee levels (none, low, medium, high, veryHigh) or custom percentile-based estimation
- **Compute Budget**: Automatic or custom compute unit limits
- **Address Lookup Tables**: Automatic compression for versioned transactions
- **Durable Nonce**: Built-in support for nonce-based transactions
- **Auto-Retry**: Configurable retry with exponential backoff
- **Built-in Validation**: Automatic transaction size and field validation
- **Simulation**: Test transactions before sending
- **Export Formats**: Export transactions as base64, base58, or raw bytes
- **Comprehensive Logging**: Verbose error logs with simulation details

**Multi-Step Flows:**

- **Dynamic Context**: Build instructions that depend on previous step results
- **Automatic Batching**: Intelligently batch instructions into single transactions
- **Atomic Groups**: Group instructions that must execute together
- **Size Handling**: Auto-split transactions that exceed size limits
- **Execution Hooks**: Monitor step lifecycle with onStepStart, onStepComplete, onStepError

**Kit Integration:**

- **Instruction Plans**: Re-exports `@solana/instruction-plans` for advanced planning
- **executePlan()**: Execute Kit instruction plans with TransactionBuilder features

### @pipeit/actions

- **High-Level DeFi Actions**: Simple, composable API for swaps, lending, staking
- **Pluggable Adapters**: Protocol-specific adapters (Jupiter, Raydium, etc.)
- **API-Centric Design**: Delegates complexity to protocol APIs for reliability
- **Fluent Builder**: Chain multiple actions with `.swap()`, `.add()`, etc.
- **Simulation Support**: Test action sequences before execution
- **Lifecycle Hooks**: Monitor action progress with `onActionStart`, `onActionComplete`, `onActionError`
- **Abort Signal**: Cancel execution with AbortController
- **Address Lookup Tables**: Automatic ALT handling for compressed transactions

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
