# @pipeit/tx-errors

Typed error definitions and error handling utilities for Solana transaction building.

## Installation

```bash
pnpm add @pipeit/tx-errors
```

## Usage

```typescript
import { InsufficientFundsError, isInsufficientFundsError, getErrorMessage } from '@pipeit/tx-errors';

// Create an error
const error = new InsufficientFundsError(1_000_000n, 500_000n);

// Check error type
if (isInsufficientFundsError(error)) {
  console.log('Insufficient funds!');
}

// Get human-readable message
console.log(getErrorMessage(error));
```

## API

See the [full documentation](../../docs/tx-errors.md) for complete API reference.








