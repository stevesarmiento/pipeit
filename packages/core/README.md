# @pipeit/core

Type-safe transaction builder for Solana with smart defaults, multi-step flows, and Kit instruction-plans integration.

## Installation

```bash
pnpm install @pipeit/core @solana/kit
```

## Quick Start

### Single Transaction

```typescript
import { TransactionBuilder } from '@pipeit/core';
import { createSolanaRpc, createSolanaRpcSubscriptions } from '@solana/kit';

const rpc = createSolanaRpc('https://api.mainnet-beta.solana.com');
const rpcSubscriptions = createSolanaRpcSubscriptions('wss://api.mainnet-beta.solana.com');

// Build and execute with auto-blockhash, auto-retry, and priority fees
const signature = await new TransactionBuilder({ 
  rpc,
  autoRetry: true,
  priorityFee: 'high',
  logLevel: 'verbose'
})
  .setFeePayerSigner(signer)
  .addInstruction(instruction)
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

const plan = sequentialInstructionPlan([ix1, ix2, ix3, ix4, ix5]);
const result = await executePlan(plan, { rpc, rpcSubscriptions, signer });
```

## TransactionBuilder API

### Configuration

```typescript
interface TransactionBuilderConfig {
  version?: 0 | 'legacy';
  rpc?: Rpc<GetLatestBlockhashApi & GetAccountInfoApi>;
  autoRetry?: boolean | { maxAttempts: number; backoff: 'linear' | 'exponential' };
  logLevel?: 'silent' | 'minimal' | 'verbose';
  priorityFee?: PriorityFeeLevel | PriorityFeeConfig;
  computeUnits?: 'auto' | number | ComputeUnitConfig;
  lookupTableAddresses?: Address[];
  addressesByLookupTable?: AddressesByLookupTableAddress;
}
```

### Methods

#### Setting Fee Payer

```typescript
// Use setFeePayerSigner when executing (recommended)
builder.setFeePayerSigner(signer)

// Use setFeePayer when only building/exporting
builder.setFeePayer(address('...'))
```

#### Setting Lifetime

```typescript
// Blockhash lifetime (auto-fetched if RPC provided)
builder.setBlockhashLifetime(blockhash, lastValidBlockHeight)

// Durable nonce lifetime
builder.setDurableNonceLifetime(nonce, nonceAccountAddress, nonceAuthorityAddress)

// Static factory for durable nonce (auto-fetches nonce)
const builder = await TransactionBuilder.withDurableNonce({
  rpc,
  nonceAccountAddress: address('...'),
  nonceAuthorityAddress: address('...'),
});
```

#### Adding Instructions

```typescript
// Single instruction
builder.addInstruction(instruction)

// Multiple instructions
builder.addInstructions([ix1, ix2, ix3])

// With auto-packing (returns overflow instructions)
const { builder: packed, overflow } = await builder.addInstructionsWithPacking(manyInstructions);
```

#### Building

```typescript
// Build transaction message (auto-fetches blockhash if RPC provided)
const message = await builder.build();
```

#### Simulating

```typescript
const result = await builder.simulate();

if (result.err) {
  console.error('Simulation failed:', result.logs);
} else {
  console.log('Compute units:', result.unitsConsumed);
}
```

#### Executing

```typescript
// Basic execution
const signature = await builder.execute({ rpcSubscriptions });

// With execution options
const signature = await builder.execute({
  rpcSubscriptions,
  commitment: 'confirmed',
  skipPreflight: false,
  skipPreflightOnRetry: true,
  maxRetries: 5,
  preflightCommitment: 'confirmed',
});
```

#### Exporting

```typescript
// Export as base64 (default, for RPC)
const { data: base64Tx } = await builder.export('base64');

// Export as base58 (human-readable, for QR codes)
const { data: base58Tx } = await builder.export('base58');

// Export as bytes (for hardware wallets)
const { data: bytes } = await builder.export('bytes');
```

#### Size Information

```typescript
const info = await builder.getSizeInfo();
console.log(`Using ${info.percentUsed.toFixed(1)}% of transaction space`);
console.log(`${info.remaining} bytes remaining`);
```

### Priority Fees

Priority fees can be configured using preset levels or custom strategies:

```typescript
// Preset levels
new TransactionBuilder({ priorityFee: 'none' })    // 0 micro-lamports/CU
new TransactionBuilder({ priorityFee: 'low' })     // 1,000 micro-lamports/CU
new TransactionBuilder({ priorityFee: 'medium' })  // 10,000 micro-lamports/CU (default)
new TransactionBuilder({ priorityFee: 'high' })     // 50,000 micro-lamports/CU
new TransactionBuilder({ priorityFee: 'veryHigh' }) // 100,000 micro-lamports/CU

// Custom fixed fee
new TransactionBuilder({ 
  priorityFee: { 
    strategy: 'fixed', 
    microLamports: 25_000 
  } 
})

// Percentile-based estimation (requires RPC)
new TransactionBuilder({ 
  priorityFee: { 
    strategy: 'percentile', 
    percentile: 75  // Use 75th percentile of recent fees
  } 
})
```

### Compute Units

```typescript
// Auto (no explicit instruction, uses default)
new TransactionBuilder({ computeUnits: 'auto' })

// Fixed limit
new TransactionBuilder({ computeUnits: 300_000 })

// Custom strategy
new TransactionBuilder({ 
  computeUnits: { 
    strategy: 'fixed', 
    units: 400_000 
  } 
})
```

### Address Lookup Tables

Address lookup tables automatically compress transactions for version 0 transactions:

```typescript
// Provide ALT addresses (will be fetched automatically)
new TransactionBuilder({ 
  version: 0,
  lookupTableAddresses: [address('...'), address('...')]
})

// Or provide pre-fetched ALT data
new TransactionBuilder({ 
  version: 0,
  addressesByLookupTable: { /* pre-fetched data */ }
})
```

## Flow API

The Flow API orchestrates multi-step transaction workflows where later instructions may depend on previous results.

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

### Step Types

**Instruction Steps** - Automatically batched into single transactions:

```typescript
flow.step('transfer', (ctx) => getTransferSolInstruction({
  source: ctx.signer,
  destination: recipient,
  amount: lamports(1_000_000n),
}));
```

**Atomic Groups** - Instructions that must execute together:

```typescript
flow.atomic('swap', [
  (ctx) => wrapSolInstruction(...),
  (ctx) => swapInstruction(...),
  (ctx) => unwrapSolInstruction(...),
]);
```

**Transaction Steps** - Custom async operations that break batching:

```typescript
flow.transaction('verify-state', async (ctx) => {
  const prevResult = ctx.get('create-account');
  // Custom logic that needs the previous transaction confirmed
  const accountInfo = await ctx.rpc.getAccountInfo(accountAddress).send();
  return { signature: prevResult?.signature ?? '', verified: !!accountInfo };
});
```

### Flow Context

Each step receives a `FlowContext`:

```typescript
interface FlowContext {
  results: Map<string, FlowStepResult>;  // All previous results
  signer: TransactionSigner;             // The transaction signer
  rpc: Rpc<FlowRpcApi>;                  // RPC client
  rpcSubscriptions: RpcSubscriptions<FlowRpcSubscriptionsApi>;
  get: (stepName: string) => FlowStepResult | undefined;  // Convenience method
}
```

### Execution Strategies

```typescript
// Auto: Try batching, fallback to sequential if too large (default)
createFlow({ rpc, rpcSubscriptions, signer, strategy: 'auto' })

// Batch: Always batch consecutive instruction steps
createFlow({ rpc, rpcSubscriptions, signer, strategy: 'batch' })

// Sequential: Execute each step as separate transaction
createFlow({ rpc, rpcSubscriptions, signer, strategy: 'sequential' })
```

### Lifecycle Hooks

```typescript
createFlow({ rpc, rpcSubscriptions, signer })
  .step('transfer', (ctx) => instruction)
  .onStepStart((name) => console.log(`Starting ${name}`))
  .onStepComplete((name, result) => console.log(`${name}: ${result.signature}`))
  .onStepError((name, error) => console.error(`${name} failed:`, error))
  .execute();
```

## Plans API

For advanced users who know all instructions upfront, Pipeit re-exports Kit's instruction-plans and provides a convenience helper:

```typescript
import { 
  sequentialInstructionPlan, 
  parallelInstructionPlan,
  executePlan 
} from '@pipeit/core';

// Create a plan
const plan = sequentialInstructionPlan([
  parallelInstructionPlan([depositA, depositB]),
  activateVault,
  parallelInstructionPlan([withdrawA, withdrawB]),
]);

// Execute with TransactionBuilder features
const result = await executePlan(plan, {
  rpc,
  rpcSubscriptions,
  signer,
  commitment: 'confirmed',
});
```

All Kit instruction-plans types and functions are re-exported. See [@solana/instruction-plans](https://github.com/solana-labs/solana-web3.js/tree/master/packages/instruction-plans) for full documentation.

## Error Handling

```typescript
import { 
  isBlockhashExpiredError,
  isSimulationFailedError,
  isTransactionTooLargeError,
  TransactionTooLargeError,
  InsufficientFundsError
} from '@pipeit/core';

try {
  const sig = await builder.execute({ rpcSubscriptions });
} catch (error) {
  if (isBlockhashExpiredError(error)) {
    console.error('Blockhash expired, retry with fresh blockhash');
  } else if (isSimulationFailedError(error)) {
    console.error('Simulation failed');
  } else if (isTransactionTooLargeError(error)) {
    console.error('Transaction too large, split into multiple transactions');
  } else if (error instanceof InsufficientFundsError) {
    console.error(`Need ${error.required} lamports, have ${error.available}`);
  } else if (error instanceof TransactionTooLargeError) {
    console.error(`Transaction size: ${error.size}, limit: ${error.limit}`);
  }
}
```

## Type Exports

### Main Classes

- `TransactionBuilder` - Type-safe builder class
- `TransactionFlow` - Flow class for chaining

### Functions

- `createFlow` - Create multi-step transaction flows
- `executePlan` - Execute Kit instruction plans with TransactionBuilder features

### Flow Types

- `FlowConfig` - Configuration for createFlow
- `FlowContext` - Context passed to each step
- `FlowStepResult` - Result from a completed step
- `FlowHooks` - Lifecycle hooks
- `StepCreator` - Function that creates an instruction
- `ExecutionStrategy` - 'auto' | 'batch' | 'sequential'

### TransactionBuilder Types

- `TransactionBuilderConfig` - Builder configuration
- `SimulationResult` - Result from simulation
- `ExportFormat` - 'base64' | 'base58' | 'bytes'
- `ExportedTransaction` - Exported transaction data
- `ExecuteConfig` - Execution options
- `SendingConfig` - Sending options

### Compute Budget Types

- `PriorityFeeLevel` - 'none' | 'low' | 'medium' | 'high' | 'veryHigh'
- `PriorityFeeConfig` - Custom priority fee configuration
- `ComputeUnitConfig` - Compute unit configuration
- `PriorityFeeEstimate` - Result from fee estimation

### Nonce Types

- `DurableNonceConfig` - Configuration for durable nonce
- `NonceAccountData` - Parsed nonce account data
- `FetchNonceResult` - Result from fetching nonce

### Lookup Table Types

- `AddressesByLookupTableAddress` - Lookup table data structure

### Validation

- `validateTransaction(message)` - Validate transaction has required fields
- `validateTransactionSize(message)` - Validate transaction size
- `getTransactionSizeInfo(message)` - Get size information
- `TRANSACTION_SIZE_LIMIT` - Maximum transaction size constant

### Errors

- `TransactionTooLargeError` - Transaction exceeds size limit
- `InsufficientFundsError` - Insufficient funds for transaction
- `isBlockhashExpiredError(error)` - Check if error is blockhash expiration
- `isSimulationFailedError(error)` - Check if error is simulation failure
- `isTransactionTooLargeError(error)` - Check if error is transaction too large

### Kit Integration

All types and functions from `@solana/instruction-plans` are re-exported:
- `InstructionPlan`, `TransactionPlan`, `TransactionPlanResult`
- `sequentialInstructionPlan`, `parallelInstructionPlan`, `nonDivisibleSequentialInstructionPlan`
- `createTransactionPlanner`, `createTransactionPlanExecutor`
- And more...

## License

MIT
