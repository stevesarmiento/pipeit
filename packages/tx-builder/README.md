# @pipeit/tx-builder

Type-safe transaction builder for Solana with smart defaults.

## Installation

```bash
pnpm install @pipeit/tx-builder @solana/kit
```

## Features

- ✅ Type-safe builder with compile-time validation
- ✅ Auto-blockhash fetching
- ✅ Built-in transaction validation
- ✅ Simulation support
- ✅ Auto-retry with exponential backoff
- ✅ Comprehensive error handling
- ✅ Kit assertion helpers

## Usage

### Simple API (Recommended)

The simple API provides smart defaults and automatic handling of common transaction building tasks:

```typescript
import { transaction } from '@pipeit/tx-builder';
import { createSolanaRpc, createSolanaRpcSubscriptions } from '@solana/kit';

const rpc = createSolanaRpc('https://api.mainnet-beta.solana.com');
const rpcSubs = createSolanaRpcSubscriptions('wss://api.mainnet-beta.solana.com');

const signature = await transaction({ 
  autoRetry: true,
  logLevel: 'verbose'
})
  .addInstruction(instruction)
  .execute({ feePayer: signer, rpc, rpcSubscriptions: rpcSubs });
```

### Advanced API (Type-Safe)

For more control, use the type-safe builder with compile-time validation:

```typescript
import { TransactionBuilder } from '@pipeit/tx-builder';
import { address } from '@solana/kit';

// With auto-blockhash fetch
const message = await new TransactionBuilder({ rpc, version: 0 })
  .setFeePayer(address('...'))
  .addInstruction(instruction)
  .build(); // Blockhash automatically fetched!

// With explicit blockhash
const message = await new TransactionBuilder({ version: 0 })
  .setFeePayer(address('...'))
  .setBlockhashLifetime(blockhash, lastValidBlockHeight)
  .addInstruction(instruction)
  .build(); // Type-safe: only compiles when all fields set
```

## Configuration

### TransactionBuilderConfig

```typescript
interface TransactionBuilderConfig {
  // Auto-retry configuration
  autoRetry?: boolean | { 
    maxAttempts: number; 
    backoff: 'linear' | 'exponential' 
  };
  
  // Priority fees (coming soon)
  priorityLevel?: 'none' | 'low' | 'medium' | 'high' | 'veryHigh';
  
  // Compute budget (coming soon)
  computeUnitLimit?: 'auto' | number;
  
  // Logging level
  logLevel?: 'silent' | 'minimal' | 'verbose';
  
  // Transaction version
  version?: 'auto' | 0 | 'legacy';
}
```

Example:

```typescript
const signature = await transaction({
  autoRetry: { maxAttempts: 5, backoff: 'exponential' },
  logLevel: 'verbose',
  version: 0
})
  .addInstructions([instruction1, instruction2, instruction3])
  .execute({ feePayer, rpc, rpcSubscriptions });
```

## Simulation

Test transactions before sending:

```typescript
const result = await transaction()
  .addInstruction(instruction)
  .simulate({ feePayer: signer, rpc });

if (result.err) {
  console.error('Simulation failed!');
  console.error('Logs:', result.logs);
} else {
  console.log('Success!');
  console.log('Units consumed:', result.unitsConsumed);
  if (result.returnData) {
    console.log('Return data:', result.returnData);
  }
}
```

## Error Handling

### Using Error Predicates

```typescript
import { 
  isNetworkError, 
  isBlockhashExpiredError,
  isSimulationFailedError,
  InsufficientFundsError
} from '@pipeit/tx-builder';

try {
  const sig = await transaction()
    .addInstruction(ix)
    .execute({ feePayer, rpc, rpcSubscriptions });
} catch (error) {
  if (isNetworkError(error)) {
    console.error('Network issue, retry...');
  } else if (isBlockhashExpiredError(error)) {
    console.error('Blockhash expired, refetch...');
  } else if (error instanceof InsufficientFundsError) {
    console.error(`Need ${error.required} lamports, have ${error.available}`);
  }
}
```

### Available Error Types

- `InsufficientFundsError`
- `BlockhashExpiredError`
- `SimulationFailedError`
- `NetworkError`
- `SignatureRejectedError`
- `AccountNotFoundError`
- `ProgramError`
- `TransactionTooLargeError`
- `InvalidTransactionError`

## Validation

Transactions are automatically validated before building/sending:

```typescript
import { validateTransaction, validateTransactionSize } from '@pipeit/tx-builder';

// Validation happens automatically in .build() and .execute()
// But you can also validate manually:
validateTransaction(message);
validateTransactionSize(message);
```

## Utilities

### Address Validation

```typescript
import { assertIsAddress, isValidAddress } from '@pipeit/tx-builder';

// Type guard
if (isValidAddress(maybeAddress)) {
  // TypeScript knows it's an Address here
}

// Assertion (throws if invalid)
assertIsAddress(address); // Uses Kit's assertion
```

### Lamports Helpers

```typescript
import { formatLamports, parseLamports } from '@pipeit/tx-builder';

const sol = formatLamports(1_000_000_000n); // "1"
const lamports = parseLamports("0.5"); // 500_000_000n
```

## API Reference

### Main Exports

- `transaction(config?)` - Create opinionated builder
- `OpinionatedTransactionBuilder` - Class for opinionated builder
- `TransactionBuilder` - Type-safe builder class
- `TransactionBuilderConfig` - Configuration interface
- `SimulationResult` - Simulation result interface

### Error Exports

- All error classes and predicates
- Error message utilities

### Validation Exports

- `validateTransaction(message)`
- `validateTransactionSize(message)`
- `estimateTransactionSize(message)`
- `MAX_TRANSACTION_SIZE`

### Utility Exports

- `isValidAddress(value)`
- `assertIsAddress(value)`
- `isDefined(value)`
- `formatLamports(lamports, decimals?)`
- `parseLamports(sol, decimals?)`

## Examples

See the `examples/` directory for complete working examples.

## License

MIT
