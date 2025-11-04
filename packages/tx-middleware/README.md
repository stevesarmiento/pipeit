# @pipeit/tx-middleware

Composable middleware for Solana transactions (retry, simulation, logging).

## Installation

```bash
pnpm add @pipeit/tx-middleware @solana/kit
```

## Usage

```typescript
import { withRetry, withSimulation, withLogging, composeMiddleware } from '@pipeit/tx-middleware';

const middleware = composeMiddleware(
  withLogging(),
  withSimulation(),
  withRetry({ attempts: 3 })
);

const result = await middleware(transaction, context, next);
```

## Middleware

- **Retry**: Automatic retry with exponential backoff
- **Simulation**: Pre-flight transaction simulation
- **Logging**: Transaction lifecycle logging

## API

See the [full documentation](../../docs/tx-middleware.md) for complete API reference.








