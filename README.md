# Pipeit

Type-safe Solana transaction builder with smart defaults

## Overview

Pipeit is a comprehensive TypeScript SDK for building and executing Solana transactions. It provides everything from low-level transaction primitives to high-level DeFi actions, enabling developers to build reliable Solana applications with minimal boilerplate.

Built on modern Solana libraries (@solana/kit) with a focus on type safety, developer experience, and production readiness.

**Key Features:**
- Type-safe transaction building with compile-time validation
- Multiple execution strategies (Standard RPC, Jito Bundles, Parallel Execution, TPU direct)
- Multi-step flows with dynamic context between steps
- High-level DeFi actions with pluggable protocol adapters
- Native Rust QUIC client for direct to TPU submission
- Server-side handlers for browser TPU submission
- Automatic blockhash management, retry logic, and priority fees

## Packages

| Package | Description | Docs |
|---------|-------------|------|
| [@pipeit/core](./packages/core) | Transaction builder with smart defaults, flows, and execution strategies | [README](./packages/core/README.md) |
| [@pipeit/actions](./packages/actions) | InstructionPlan factories for DeFi (Titan, Metis) | [README](./packages/actions/README.md) |
| [@pipeit/fastlane](./packages/fastlane) | Native Rust QUIC client for direct TPU submission | [Package](./packages/fastlane) |

## Package Overview

### @pipeit/core
The foundation package for transaction building:
- TransactionBuilder with auto-blockhash, auto-retry, and priority fees
- Flow API for multi-step workflows with dynamic context
- Multiple execution strategies (RPC, Jito bundles, parallel execution, TPU direct)
- Kit instruction-plans integration
- Server exports for server components based TPU handlers

### @pipeit/actions
Composable InstructionPlan factories for DeFi:
- Kit-compatible InstructionPlans for swap operations
- Titan and Metis aggregator integration
- Address lookup table support
- Composable with Kit's plan combinators

### @pipeit/fastlane
Ultra-fast transaction submission:
- Native Rust QUIC implementation via NAPI
- Direct TPU submission bypassing RPC nodes
- Continuous resubmission until confirmation
- Per-leader send results with latency and error details
- Leader schedule tracking and connection pre-warming
- Cross-platform support (macOS ARM64, Linux x64, Windows x64)

## Architecture

```
pipeit/
├── packages/
│   ├── @pipeit/core        # Transaction builder, flows, execution
│   ├── @pipeit/actions     # InstructionPlan factories for DeFi
│   └── @pipeit/fastlane    # Native QUIC TPU client
└── examples/
    └── next-js/            # Example application
```

**Choosing a Package:**
- Building transactions? → `@pipeit/core`
- DeFi operations (swaps)? → `@pipeit/actions` + `@pipeit/core`
- Ultra-fast submission? → `@pipeit/fastlane` + `@pipeit/core`

## Installation

```bash
# Transaction builder (recommended starting point)
pnpm install @pipeit/core @solana/kit

# DeFi operations (swaps via Titan/Metis)
pnpm install @pipeit/actions @pipeit/core @solana/kit

# TPU direct submission (server-side only)
pnpm install @pipeit/fastlane
```

## Usage Examples

### Single Transaction

```typescript
import { TransactionBuilder } from '@pipeit/core';
import { createSolanaRpc, createSolanaRpcSubscriptions } from '@solana/kit';

const rpc = createSolanaRpc('https://api.mainnet-beta.solana.com');
const rpcSubscriptions = createSolanaRpcSubscriptions('wss://api.mainnet-beta.solana.com');

const signature = await new TransactionBuilder({
    rpc,
    autoRetry: true,
    priorityFee: 'high',
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

### DeFi Swap

```typescript
import { getTitanSwapPlan } from '@pipeit/actions/titan';
import { executePlan } from '@pipeit/core';

// Get a swap plan from Titan
const { plan, lookupTableAddresses, quote } = await getTitanSwapPlan({
    swap: {
        inputMint: 'So11111111111111111111111111111111111111112', // SOL
        outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
        amount: 100_000_000n, // 0.1 SOL
        slippageBps: 50,
    },
    transaction: {
        userPublicKey: signer.address,
    },
});

// Execute with ALT support
await executePlan(plan, {
    rpc,
    rpcSubscriptions,
    signer,
    lookupTableAddresses,
});
```

## Execution Strategies

Pipeit supports multiple execution strategies for different use cases:

| Preset | Description | Use Case |
|--------|-------------|----------|
| `'standard'` | Default RPC submission | General transactions |
| `'economical'` | Jito bundle only | MEV-sensitive swaps |
| `'fast'` | Jito + parallel RPC race | Time-sensitive operations |
| `'ultra'` | TPU direct + Jito race | Fastest possible (requires `@pipeit/fastlane`) |

```typescript
const signature = await new TransactionBuilder({ rpc })
    .setFeePayerSigner(signer)
    .addInstruction(instruction)
    .execute({ 
        rpcSubscriptions,
        execution: 'fast', // or 'standard', 'economical', 'ultra'
    });
```

For custom configuration, see the [@pipeit/core README](./packages/core/README.md).

## Additional Features

### Simulation

Test transactions before execution:

```typescript
const result = await builder.simulate();
if (result.err) console.error('Failed:', result.logs);
```

### Export

Export signed transactions for custom transport:

```typescript
const { data } = await builder.export('base64'); // or 'base58', 'bytes'
```

### Durable Nonce

For offline or scheduled transactions:

```typescript
const builder = await TransactionBuilder.withDurableNonce({
    rpc,
    nonceAccountAddress: address('...'),
    nonceAuthorityAddress: address('...'),
});
```

### Error Diagnostics

Get human-readable error explanations:

```typescript
import { diagnoseError } from '@pipeit/core';

try {
    await builder.execute({ rpcSubscriptions });
} catch (error) {
    const { summary, suggestion } = diagnoseError(error);
    console.error(summary, suggestion);
}
```

## Server Setup (TPU Submission)

For browser environments, TPU submission requires a server-side API route:

```typescript
// app/api/tpu/route.ts
export { tpuHandler as POST } from '@pipeit/core/server';
```

## Development

### Prerequisites
- Node.js 20+
- pnpm 10+
- Rust (for @pipeit/fastlane development)

### Setup
```bash
git clone https://github.com/stevesarmiento/pipeit.git
cd pipeit
pnpm install
```

### Commands
```bash
pnpm build       # Build all packages
pnpm test        # Run all tests
pnpm typecheck   # Type checking
pnpm lint        # Lint code
```

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

## License

MIT 
[LICENSE.md](.LICENSE.md)
