# @pipeit/actions

High-level DeFi actions for Solana with a simple, composable API. Uses pluggable adapters to avoid vendor lock-in.

## Installation

```bash
pnpm install @pipeit/actions @pipeit/core @solana/kit
```

## Quick Start

```typescript
import { pipe } from '@pipeit/actions';
import { jupiter } from '@pipeit/actions/adapters';
import { createSolanaRpc, createSolanaRpcSubscriptions } from '@solana/kit';

const rpc = createSolanaRpc('https://api.mainnet-beta.solana.com');
const rpcSubscriptions = createSolanaRpcSubscriptions('wss://api.mainnet-beta.solana.com');

// Swap SOL for USDC using Jupiter
const result = await pipe({
  rpc,
  rpcSubscriptions,
  signer,
  adapters: { swap: jupiter() }
})
  .swap({ 
    inputMint: 'So11111111111111111111111111111111111111112', // SOL
    outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
    amount: 10_000_000n,  // 0.1 SOL
    slippageBps: 50  // 0.5%
  })
  .execute();

console.log('Transaction:', result.signature);
```

## Pipe API

The `pipe()` function creates a fluent builder for composing DeFi actions into atomic transactions.

### Configuration

```typescript
interface PipeConfig {
  rpc: Rpc<ActionsRpcApi>;
  rpcSubscriptions: RpcSubscriptions<ActionsRpcSubscriptionsApi>;
  signer: TransactionSigner;
  adapters?: {
    swap?: SwapAdapter;
  };
  priorityFee?: PriorityFeeLevel | PriorityFeeConfig;
  computeUnits?: 'auto' | number;
  autoRetry?: boolean | { maxAttempts: number; backoff: 'linear' | 'exponential' };
  logLevel?: 'silent' | 'minimal' | 'verbose';
}
```

### Adding Actions

#### Swap Action

```typescript
pipe({ rpc, rpcSubscriptions, signer, adapters: { swap: jupiter() } })
  .swap({
    inputMint: 'So11111111111111111111111111111111111111112',
    outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    amount: 10_000_000n,
    slippageBps: 50  // Optional, default: 50 (0.5%)
  })
```

#### Custom Actions

```typescript
pipe({ rpc, rpcSubscriptions, signer })
  .add(async (ctx) => ({
    instructions: [myCustomInstruction],
    computeUnits: 200_000,  // Optional hint
    addressLookupTableAddresses: ['...'],  // Optional ALT addresses
    data: { custom: 'data' }  // Optional metadata
  }))
```

### Executing

```typescript
// Basic execution
const result = await pipe({ rpc, rpcSubscriptions, signer, adapters: { swap: jupiter() } })
  .swap({ ... })
  .execute();

console.log('Signature:', result.signature);
console.log('Action results:', result.actionResults);

// With options
const result = await pipe({ rpc, rpcSubscriptions, signer, adapters: { swap: jupiter() } })
  .swap({ ... })
  .execute({
    commitment: 'confirmed',
    abortSignal: abortController.signal
  });
```

### Simulating

Test action sequences before execution:

```typescript
const simulation = await pipe({ rpc, rpcSubscriptions, signer, adapters: { swap: jupiter() } })
  .swap({ ... })
  .simulate();

if (simulation.success) {
  console.log('Estimated compute units:', simulation.unitsConsumed);
  console.log('Logs:', simulation.logs);
} else {
  console.error('Simulation failed:', simulation.error);
}
```

### Lifecycle Hooks

Monitor action execution progress:

```typescript
pipe({ rpc, rpcSubscriptions, signer, adapters: { swap: jupiter() } })
  .swap({ ... })
  .onActionStart((index) => console.log(`Starting action ${index}`))
  .onActionComplete((index, result) => {
    console.log(`Action ${index} completed with ${result.instructions.length} instructions`);
  })
  .onActionError((index, error) => {
    console.error(`Action ${index} failed:`, error);
  })
  .execute();
```

### Chaining Multiple Actions

All actions in a pipe execute atomically in a single transaction:

```typescript
const result = await pipe({ rpc, rpcSubscriptions, signer, adapters: { swap: jupiter() } })
  .swap({ inputMint: SOL, outputMint: USDC, amount: 10_000_000n })
  .add(async (ctx) => ({
    instructions: [transferInstruction],
  }))
  .swap({ inputMint: USDC, outputMint: BONK, amount: 5_000_000n })
  .execute();
```

## Adapters

Adapters provide protocol-specific implementations for actions. Pipeit includes built-in adapters and supports custom adapters.

### Jupiter Adapter

Jupiter adapter for token swaps across all Solana DEXs:

```typescript
import { jupiter } from '@pipeit/actions/adapters';

// Default configuration
const adapter = jupiter();

// Custom configuration
const adapter = jupiter({
  apiUrl: 'https://lite-api.jup.ag/swap/v1',  // Default
  wrapAndUnwrapSol: true,  // Default: auto-wrap/unwrap SOL
  dynamicComputeUnitLimit: true,  // Default: use Jupiter's CU estimate
  prioritizationFeeLamports: 'auto'  // Default: use Jupiter's fee estimate
});
```

**Configuration Options:**

- `apiUrl` - Base URL for Jupiter API (default: `https://lite-api.jup.ag/swap/v1`)
- `wrapAndUnwrapSol` - Automatically wrap/unwrap SOL (default: `true`)
- `dynamicComputeUnitLimit` - Use Jupiter's compute unit estimate (default: `true`)
- `prioritizationFeeLamports` - Priority fee in lamports or `'auto'` (default: `'auto'`)

### Creating Custom Adapters

Implement the `SwapAdapter` interface:

```typescript
import type { SwapAdapter, SwapParams, ActionContext } from '@pipeit/actions';

const mySwapAdapter: SwapAdapter = {
  swap: (params: SwapParams) => async (ctx: ActionContext) => {
    // Call your DEX API
    const quote = await fetchQuote(params);
    const instructions = await buildSwapInstructions(quote, ctx.signer.address);
    
    return {
      instructions,
      computeUnits: 300_000,  // Optional
      addressLookupTableAddresses: ['...'],  // Optional
      data: {
        inputAmount: BigInt(quote.inAmount),
        outputAmount: BigInt(quote.outAmount),
        priceImpactPct: quote.priceImpact,
      },
    };
  },
};

// Use your custom adapter
pipe({ rpc, rpcSubscriptions, signer, adapters: { swap: mySwapAdapter } })
  .swap({ ... })
  .execute();
```

## Configuration

### Priority Fees

```typescript
// Preset levels
pipe({ 
  rpc, 
  rpcSubscriptions, 
  signer, 
  adapters: { swap: jupiter() },
  priorityFee: 'high'  // none | low | medium | high | veryHigh
})

// Custom configuration
pipe({ 
  rpc, 
  rpcSubscriptions, 
  signer, 
  adapters: { swap: jupiter() },
  priorityFee: {
    strategy: 'percentile',
    percentile: 75
  }
})
```

### Compute Units

```typescript
// Auto (collects from actions or uses default)
pipe({ 
  rpc, 
  rpcSubscriptions, 
  signer, 
  adapters: { swap: jupiter() },
  computeUnits: 'auto'
})

// Fixed limit
pipe({ 
  rpc, 
  rpcSubscriptions, 
  signer, 
  adapters: { swap: jupiter() },
  computeUnits: 400_000
})
```

### Auto-Retry

```typescript
// Default retry (3 attempts, exponential backoff)
pipe({ 
  rpc, 
  rpcSubscriptions, 
  signer, 
  adapters: { swap: jupiter() },
  autoRetry: true
})

// Custom retry configuration
pipe({ 
  rpc, 
  rpcSubscriptions, 
  signer, 
  adapters: { swap: jupiter() },
  autoRetry: {
    maxAttempts: 5,
    backoff: 'exponential'  // or 'linear'
  }
})

// No retry
pipe({ 
  rpc, 
  rpcSubscriptions, 
  signer, 
  adapters: { swap: jupiter() },
  autoRetry: false
})
```

### Logging

```typescript
pipe({ 
  rpc, 
  rpcSubscriptions, 
  signer, 
  adapters: { swap: jupiter() },
  logLevel: 'verbose'  // silent | minimal | verbose
})
```

## Address Lookup Tables

Actions can return address lookup table addresses, which are automatically fetched and used for transaction compression:

```typescript
const result = await pipe({ rpc, rpcSubscriptions, signer, adapters: { swap: jupiter() } })
  .swap({ ... })
  .execute();

// Jupiter adapter automatically includes ALT addresses if needed
// Pipe fetches and applies them automatically
```

## Error Handling

```typescript
import { 
  NoActionsError,
  NoAdapterError,
  ActionExecutionError,
  isNoActionsError,
  isNoAdapterError,
  isActionExecutionError
} from '@pipeit/actions';

try {
  const result = await pipe({ rpc, rpcSubscriptions, signer, adapters: { swap: jupiter() } })
    .swap({ ... })
    .execute();
} catch (error) {
  if (isNoActionsError(error)) {
    console.error('No actions added to pipe');
  } else if (isNoAdapterError(error)) {
    console.error(`Adapter not configured: ${error.adapterName}`);
  } else if (isActionExecutionError(error)) {
    console.error(`Action ${error.actionIndex} failed:`, error.cause);
  }
}
```

## Type Exports

### Main Classes

- `Pipe` - Fluent builder class

### Functions

- `pipe` - Create a new pipe instance

### Types

- `PipeConfig` - Configuration for creating a pipe
- `PipeResult` - Result from executing a pipe
- `ExecuteOptions` - Options for execution
- `PipeHooks` - Lifecycle hooks

### Action Types

- `ActionContext` - Context passed to actions
- `ActionExecutor` - Function that executes an action
- `ActionFactory` - Factory function for creating action executors
- `ActionResult` - Result returned by an action

### Swap Types

- `SwapParams` - Parameters for swap action
- `SwapResult` - Extended result for swap actions
- `SwapAdapter` - Interface for swap adapters

### Error Types

- `NoActionsError` - No actions added to pipe
- `NoAdapterError` - Required adapter not configured
- `ActionExecutionError` - Action execution failed

### Re-exported from Core

- `PriorityFeeLevel` - Priority fee level type
- `PriorityFeeConfig` - Priority fee configuration
- `ActionsRpcApi` - Minimum RPC API required
- `ActionsRpcSubscriptionsApi` - Minimum RPC subscriptions API required

## License

MIT
