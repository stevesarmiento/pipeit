# @pipeit/core

Type-safe transaction builder for Solana with smart defaults, multi-step flows, and Kit instruction-plans integration.

## Installation

```bash
pnpm install @pipeit/core @solana/kit
```

## Features

- Type-safe builder with compile-time validation
- Auto-blockhash fetching
- Built-in transaction validation
- Simulation support
- Export in multiple formats (base64, base58, bytes)
- Compute budget (priority fees & compute limits)
- Auto-retry with exponential backoff
- Comprehensive error handling
- **Multi-step flows** with context passing between steps
- **Kit integration** - re-exports `@solana/instruction-plans` for advanced planning

## Quick Start

### Single Transaction

```typescript
import { TransactionBuilder } from '@pipeit/core';
import { createSolanaRpc, createSolanaRpcSubscriptions, address } from '@solana/kit';

const rpc = createSolanaRpc('https://api.mainnet-beta.solana.com');
const rpcSubs = createSolanaRpcSubscriptions('wss://api.mainnet-beta.solana.com');

// Build and execute
const signature = await new TransactionBuilder({ 
  rpc,
  autoRetry: true,
  priorityLevel: 'high' 
})
  .setFeePayer(address('...'))
  .addInstruction(instruction)
  .execute({ rpcSubscriptions: rpcSubs });
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

const plan = sequentialInstructionPlan([ix1, ix2, ix3, ix4, ix5]);
const result = await executePlan(plan, { rpc, rpcSubscriptions, signer });
```

## TransactionBuilder Usage

### Build Message Only

```typescript
const message = await new TransactionBuilder({ rpc })
  .setFeePayer(address('...'))
  .addInstruction(instruction)
  .build(); // Blockhash automatically fetched!
```

### Simulate Before Sending

```typescript
const result = await new TransactionBuilder({ rpc })
  .setFeePayer(address('...'))
  .addInstruction(instruction)
  .simulate();

if (result.err) {
  console.error('Simulation failed:', result.logs);
} else {
  console.log('Compute units:', result.unitsConsumed);
}
```

### Execute with Auto-Retry

```typescript
const signature = await new TransactionBuilder({ 
  rpc,
  autoRetry: { maxAttempts: 5, backoff: 'exponential' }
})
  .setFeePayer(address('...'))
  .addInstruction(instruction)
  .execute({ rpcSubscriptions });
```

## Flow API

The Flow API is designed for multi-step transaction workflows where later instructions may depend on the results of earlier ones.

### Creating a Flow

```typescript
import { createFlow } from '@pipeit/core';

const result = await createFlow({ rpc, rpcSubscriptions, signer })
  .step('step1', (ctx) => instruction1)
  .step('step2', (ctx) => {
    const prev = ctx.get('step1'); // access previous results
    return instruction2(prev);
  })
  .execute();
```

### Flow Context

Each step receives a `FlowContext` with:

```typescript
interface FlowContext {
  results: Map<string, FlowStepResult>;  // All previous results
  signer: TransactionSigner;              // The transaction signer
  rpc: Rpc<...>;                          // RPC client
  rpcSubscriptions: RpcSubscriptions<...>;
  get: (stepName: string) => FlowStepResult | undefined;  // Convenience method
}
```

### Atomic Groups

Group instructions that must execute together in one transaction:

```typescript
flow.atomic('swap', [
  (ctx) => wrapSolInstruction(...),
  (ctx) => swapInstruction(...),
  (ctx) => unwrapSolInstruction(...),
]);
```

### Lifecycle Hooks

Monitor flow execution:

```typescript
createFlow({ rpc, rpcSubscriptions, signer })
  .step('transfer', (ctx) => instruction)
  .onStepStart((name) => console.log(`Starting ${name}`))
  .onStepComplete((name, result) => console.log(`${name}: ${result.signature}`))
  .onStepError((name, error) => console.error(`${name} failed:`, error))
  .execute();
```

### Transaction Steps

Break out of batching for custom async operations:

```typescript
flow
  .step('create', (ctx) => createInstruction)
  .transaction('verify', async (ctx) => {
    // Custom async operation between batches
    const accountInfo = await ctx.rpc.getAccountInfo(address).send();
    return { signature: ctx.get('create')?.signature ?? '' };
  })
  .step('finalize', (ctx) => finalizeInstruction);
```

## Exporting Transactions

Sign and serialize transactions without sending:

```typescript
// Export for custom RPC (base64 is default)
const { data: base64Tx } = await new TransactionBuilder({ rpc })
  .setFeePayer(address('...'))
  .addInstruction(instruction)
  .export('base64');

// Export for QR code (human-readable)
const { data: base58Tx } = await builder.export('base58');

// Export raw bytes (hardware wallets)
const { data: bytes } = await builder.export('bytes');
```

## Compute Budget & Priority Fees

```typescript
const builder = new TransactionBuilder({ 
  rpc,
  priorityLevel: 'high',      // 50,000 micro-lamports per CU
  computeUnitLimit: 300_000   // Allow up to 300k compute units
});
```

### Priority Levels

| Level | Micro-lamports per CU |
|-------|----------------------|
| `none` | 0 |
| `low` | 1,000 |
| `medium` | 10,000 (default) |
| `high` | 50,000 |
| `veryHigh` | 100,000 |

## Configuration

```typescript
interface TransactionBuilderConfig {
  version?: 0 | 'legacy';
  rpc?: Rpc<GetLatestBlockhashApi>;
  autoRetry?: boolean | { maxAttempts: number; backoff: 'linear' | 'exponential' };
  priorityLevel?: 'none' | 'low' | 'medium' | 'high' | 'veryHigh';
  computeUnitLimit?: 'auto' | number;
  logLevel?: 'silent' | 'minimal' | 'verbose';
}
```

## Error Handling

```typescript
import { 
  isBlockhashExpiredError,
  isSimulationFailedError,
  InsufficientFundsError
} from '@pipeit/core';

try {
  const sig = await builder.execute({ rpcSubscriptions });
} catch (error) {
  if (isBlockhashExpiredError(error)) {
    console.error('Blockhash expired, retry with fresh blockhash');
  } else if (isSimulationFailedError(error)) {
    console.error('Simulation failed');
  } else if (error instanceof InsufficientFundsError) {
    console.error(`Need ${error.required} lamports, have ${error.available}`);
  }
}
```

## API Reference

### Main Exports

- `TransactionBuilder` - Type-safe builder class
- `createFlow` - Create multi-step transaction flows
- `TransactionFlow` - Flow class for chaining

### Flow Types

- `FlowConfig` - Configuration for createFlow
- `FlowContext` - Context passed to each step
- `FlowStepResult` - Result from a completed step
- `FlowHooks` - Lifecycle hooks
- `StepCreator` - Function that creates an instruction

### Kit Integration

Re-exports from `@solana/instruction-plans`:
- `sequentialInstructionPlan`, `parallelInstructionPlan`, `nonDivisibleSequentialInstructionPlan`
- `createTransactionPlanner`, `createTransactionPlanExecutor`
- `executePlan` - Helper to execute plans with TransactionBuilder features

### Error Exports

- Error classes and predicates
- `isBlockhashExpiredError(error)`
- `isSimulationFailedError(error)`
- `isTransactionTooLargeError(error)`

### Validation Exports

- `validateTransaction(message)`
- `validateTransactionSize(message)`
- `estimateTransactionSize(message)`
- `MAX_TRANSACTION_SIZE`

## License

MIT
