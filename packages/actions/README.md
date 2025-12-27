# @pipeit/actions

Composable InstructionPlan factories for Solana DeFi, starting with Titan integration.

This package provides Kit-compatible `InstructionPlan` factories that can be:
- Executed directly with `@pipeit/core`'s `executePlan`
- Composed with other InstructionPlans using Kit's plan combinators
- Used by anyone in the Kit ecosystem

## Installation

```bash
pnpm install @pipeit/actions @pipeit/core @solana/kit
```

## Quick Start

```typescript
import { getTitanSwapPlan } from '@pipeit/actions/titan';
import { executePlan } from '@pipeit/core';
import { createSolanaRpc, createSolanaRpcSubscriptions } from '@solana/kit';

const rpc = createSolanaRpc('https://api.mainnet-beta.solana.com');
const rpcSubscriptions = createSolanaRpcSubscriptions('wss://api.mainnet-beta.solana.com');

// Get a swap plan from Titan
const { plan, lookupTableAddresses, quote } = await getTitanSwapPlan({
    swap: {
        inputMint: 'So11111111111111111111111111111111111111112', // SOL
        outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
        amount: 1_000_000_000n, // 1 SOL
        slippageBps: 50, // 0.5%
    },
    transaction: {
        userPublicKey: signer.address,
        createOutputTokenAccount: true,
    },
});

console.log(`Swapping 1 SOL for ~${quote.outputAmount / 1_000_000n} USDC`);

// Execute with ALT support for optimal transaction packing
await executePlan(plan, {
    rpc,
    rpcSubscriptions,
    signer,
    lookupTableAddresses,
});
```

## Titan API

### `getTitanSwapPlan`

The main entry point that fetches a quote, selects the best route, and returns a composable plan.

```typescript
import { getTitanSwapPlan } from '@pipeit/actions/titan';

const { plan, lookupTableAddresses, quote, providerId, route } = await getTitanSwapPlan({
    swap: {
        inputMint: 'So11111111111111111111111111111111111111112',
        outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        amount: 1_000_000_000n,
        slippageBps: 50,
        // Optional filters
        dexes: ['Raydium', 'Orca'], // Only use these DEXes
        excludeDexes: ['Phoenix'], // Exclude these DEXes
        onlyDirectRoutes: false, // Allow multi-hop routes
        providers: ['titan'], // Only use specific providers
    },
    transaction: {
        userPublicKey: signer.address,
        createOutputTokenAccount: true,
        closeInputTokenAccount: false,
    },
}, {
    // Optional: specify a provider
    providerId: 'titan',
});
```

### Lower-Level APIs

For more control, you can use the individual functions:

```typescript
import {
    createTitanClient,
    TITAN_DEMO_BASE_URLS,
    getTitanSwapQuote,
    selectTitanRoute,
    getTitanSwapInstructionPlanFromRoute,
} from '@pipeit/actions/titan';

// Create a client
const client = createTitanClient({
    // Option A: pick a demo region (us1 | jp1 | de1)
    demoRegion: 'us1',
    // Option B: specify a full base URL (demo or production)
    // baseUrl: TITAN_DEMO_BASE_URLS.jp1,
    // baseUrl: 'https://api.titan.ag/api/v1',
    authToken: 'optional-jwt-for-fees',
});

// Get quotes from all providers
const quotes = await getTitanSwapQuote(client, {
    swap: { inputMint, outputMint, amount },
    transaction: { userPublicKey },
});

// Select the best route (or a specific provider)
const { providerId, route } = selectTitanRoute(quotes, {
    providerId: 'titan', // Optional: use specific provider
});

// Build the instruction plan
const plan = getTitanSwapInstructionPlanFromRoute(route);

// Extract ALT addresses
const lookupTableAddresses = route.addressLookupTables.map(titanPubkeyToAddress);
```

## Composing Plans

The real power of InstructionPlans is composition. Combine multiple plans:

```typescript
import { getTitanSwapPlan } from '@pipeit/actions/titan';
import {
    sequentialInstructionPlan,
    parallelInstructionPlan,
    singleInstructionPlan,
} from '@solana/instruction-plans';
import { executePlan } from '@pipeit/core';

// Swap SOL → USDC
const swapResult = await getTitanSwapPlan({
    swap: {
        inputMint: SOL_MINT,
        outputMint: USDC_MINT,
        amount: 10_000_000_000n, // 10 SOL
    },
    transaction: { userPublicKey: signer.address },
});

// Add a transfer instruction
const transferPlan = singleInstructionPlan(transferInstruction);

// Combine: swap then transfer
const combinedPlan = sequentialInstructionPlan([
    swapResult.plan,
    transferPlan,
]);

// Execute with all ALTs
await executePlan(combinedPlan, {
    rpc,
    rpcSubscriptions,
    signer,
    lookupTableAddresses: swapResult.lookupTableAddresses,
});
```

## ALT (Address Lookup Table) Support

Titan swaps often require Address Lookup Tables to stay under transaction size limits. The `@pipeit/core` `executePlan` function handles this automatically:

1. **Planner-time compression**: ALTs are used during transaction planning, so Kit can pack more instructions per transaction.
2. **Executor-time compression**: Messages are compressed before simulation and signing, ensuring what you simulate is what you send.

```typescript
// Option 1: Pass ALT addresses (core will fetch them)
await executePlan(plan, {
    rpc,
    rpcSubscriptions,
    signer,
    lookupTableAddresses: swapResult.lookupTableAddresses,
});

// Option 2: Pre-fetch ALT data yourself
import { fetchAddressLookupTables } from '@pipeit/core';

const addressesByLookupTable = await fetchAddressLookupTables(
    rpc,
    swapResult.lookupTableAddresses,
);

await executePlan(plan, {
    rpc,
    rpcSubscriptions,
    signer,
    addressesByLookupTable,
});
```

## Swap Modes

Titan supports two swap modes:

- **ExactIn** (default): Swap exactly N input tokens, get variable output
- **ExactOut**: Get exactly N output tokens, use variable input

```typescript
// ExactIn: Swap exactly 1 SOL, get as much USDC as possible
const exactInResult = await getTitanSwapPlan({
    swap: {
        inputMint: SOL_MINT,
        outputMint: USDC_MINT,
        amount: 1_000_000_000n, // 1 SOL
        swapMode: 'ExactIn',
    },
    transaction: { userPublicKey: signer.address },
});

// ExactOut: Get exactly 100 USDC, use as little SOL as possible
const exactOutResult = await getTitanSwapPlan({
    swap: {
        inputMint: SOL_MINT,
        outputMint: USDC_MINT,
        amount: 100_000_000n, // 100 USDC
        swapMode: 'ExactOut',
    },
    transaction: { userPublicKey: signer.address },
});
```

## Error Handling

```typescript
import {
    TitanApiError,
    NoRoutesError,
    ProviderNotFoundError,
    NoInstructionsError,
} from '@pipeit/actions/titan';

try {
    const result = await getTitanSwapPlan({ ... });
} catch (error) {
    if (error instanceof TitanApiError) {
        console.error(`API error (${error.statusCode}): ${error.responseBody}`);
    } else if (error instanceof NoRoutesError) {
        console.error(`No routes available for quote ${error.quoteId}`);
    } else if (error instanceof ProviderNotFoundError) {
        console.error(`Provider ${error.providerId} not found. Available: ${error.availableProviders}`);
    } else if (error instanceof NoInstructionsError) {
        console.error('Route has no instructions (may only provide pre-built transaction)');
    }
}
```

## Type Exports

### Client

- `createTitanClient` - Create a Titan REST API client
- `TitanClient` - Client interface
- `TitanClientConfig` - Client configuration

### Plan Building

- `getTitanSwapPlan` - Main entry point
- `getTitanSwapQuote` - Fetch raw quotes
- `selectTitanRoute` - Select best route from quotes
- `getTitanSwapInstructionPlanFromRoute` - Build plan from route
- `TitanSwapPlanResult` - Result type
- `TitanSwapPlanOptions` - Options type

### Types

- `SwapQuoteParams` - Quote request parameters
- `SwapQuotes` - Quote response
- `SwapRoute` - Individual route
- `RoutePlanStep` - Step in a route
- `SwapMode` - 'ExactIn' | 'ExactOut'

### Errors

- `TitanApiError` - API request failed
- `NoRoutesError` - No routes available
- `ProviderNotFoundError` - Requested provider not found
- `NoInstructionsError` - Route has no instructions

### Conversion Utilities

- `titanInstructionToKit` - Convert Titan instruction to Kit
- `titanPubkeyToAddress` - Convert Titan pubkey to Kit Address
- `encodeBase58` - Encode bytes as base58

## License

MIT
