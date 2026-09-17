# @pipeit/actions

Composable InstructionPlan factories for Solana DeFi protocols.

This package provides Kit-compatible `InstructionPlan` factories that can be:

- Executed directly with `@pipeit/core`'s `executePlan`
- Composed with other InstructionPlans using Kit's plan combinators
- Used by anyone in the Kit ecosystem

## Supported Integrations

| Protocol          | Import Path               | Actions                                                      |
| ----------------- | ------------------------- | ------------------------------------------------------------ |
| Titan             | `@pipeit/actions/titan`   | Swap quote and swap plan builders                            |
| Jupiter Metis     | `@pipeit/actions/metis`   | Swap quote and swap instruction plan builders                |
| Phoenix Perps     | `@pipeit/actions/phoenix` | Open/close position and cancel-order plan builders           |

## Installation

```bash
bun add @pipeit/actions @pipeit/core @solana/kit
```

Some integrations have their own SDK as an optional peer dependency, installed
only by consumers that use that subpath — see each integration's section below.

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

const { plan, lookupTableAddresses, quote, providerId, route } = await getTitanSwapPlan(
    {
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
    },
    {
        // Optional: specify a provider
        providerId: 'titan',
    },
);
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

## Phoenix Perps API

Phoenix actions are exposed only through the Phoenix subpath and require the
`@ellipsis-labs/rise` SDK, an optional peer dependency — install it only if
you use `@pipeit/actions/phoenix`:

```bash
bun add @ellipsis-labs/rise
```

Create one
client, reuse it across calls, and dispose it when done — it holds HTTP,
exchange-metadata cache, and RPC resources (plan builders create and dispose
a throwaway client per call when none is passed, re-fetching exchange
metadata every time):

```typescript
import { createPhoenixActionsClient, getPhoenixOpenPositionPlan } from '@pipeit/actions/phoenix';
import { executePlan } from '@pipeit/core';

const client = createPhoenixActionsClient();
try {
    const { plan, lookupTableAddresses } = await getPhoenixOpenPositionPlan({
        client,
        trader: {
            authority: signer.address,
            traderPdaIndex: 0,
            traderSubaccountIndex: 0,
        },
        symbol: 'SOL-PERP',
        side: 'long',
        size: { baseUnits: '0.25' },
        entry: {
            type: 'limit',
            priceUsd: '150.50',
            postOnly: true,
        },
        risk: {
            takeProfit: {
                type: 'limit',
                triggerPriceUsd: '165.00',
                executionPriceUsd: '164.75',
            },
            stopLoss: {
                type: 'market',
                triggerPriceUsd: '142.00',
                slippageBps: 1000,
            },
        },
    });

    await executePlan(plan, {
        rpc,
        rpcSubscriptions,
        signer,
        lookupTableAddresses,
    });
} finally {
    client.dispose();
}
```

Behavior worth knowing:

- **Risk legs on limit entries are attached conditionals** — they only
  activate once the entry order fills (`risk.mode === 'attached'` in the
  result). Market entries use position-level conditionals sized at 100% of
  the live position (`risk.mode === 'position'`), and the entry +
  conditional instructions are combined in a non-divisible plan so the entry
  can never land without its stop.
- **Closes are reduce-only by default** — `getPhoenixClosePositionPlan` sets
  `OrderFlags.ReduceOnly`, so an oversized or stale size can never flip you
  into the opposite position. Opt out with `reduceOnly: false`. Pass
  `priceLimitUsd` unless you really want an unbounded market close.
- **Cancel by `priceInTicks`** where possible; the float `price` path is
  deprecated upstream and can silently miss orders due to floor rounding.
- **`lookupTableAddresses` is always empty for Phoenix** — the Rise SDK does
  not publish address lookup tables through its client API. The field exists
  for interface parity with the swap actions.

### Trader onboarding prerequisites

These actions only build order instructions. The trader must already be
registered on Phoenix perps with collateral deposited (and a
conditional-orders account for TP/SL); otherwise transactions fail on-chain.
The Rise SDK provides `buildRegisterTrader`, deposit builders, and
`buildCreateConditionalOrdersAccount` for onboarding.

### Phoenix errors

```typescript
import {
    PhoenixPlanError, // base class
    UnknownPhoenixMarketError, // exposes .symbol and .availableSymbols
    InvalidPhoenixRiskConfigError,
    UnsupportedPhoenixOrderConfigError,
    InvalidPhoenixInstructionError,
} from '@pipeit/actions/phoenix';
```

Phoenix is private beta software and requires Phoenix access. Phoenix states it is not available in the U.S. or sanctioned jurisdictions. These actions only build instructions; callers remain responsible for eligibility, trader account funding, signing, and trading outcomes.

## Composing Plans

The real power of InstructionPlans is composition. Combine multiple plans:

```typescript
import { getTitanSwapPlan } from '@pipeit/actions/titan';
import { sequentialInstructionPlan, parallelInstructionPlan, singleInstructionPlan } from '@solana/instruction-plans';
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
const combinedPlan = sequentialInstructionPlan([swapResult.plan, transferPlan]);

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

> **Transaction v1 note:** version 1 transactions (SIMD-0385) allow 4096 bytes but do
> not support lookup tables. Titan and Metis plans return `lookupTableAddresses`
> and must run with `version: 0` (the default). Phoenix plans return no lookup tables and
> can be executed with `executePlan(plan, { ..., version: 1 })`.

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

const addressesByLookupTable = await fetchAddressLookupTables(rpc, swapResult.lookupTableAddresses);

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
