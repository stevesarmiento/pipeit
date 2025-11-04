# @pipeit/tx-effect

Effect-based API for Solana transactions (advanced users).

## Installation

```bash
pnpm add @pipeit/tx-effect effect @solana/kit
```

## Usage

```typescript
import { createTransferEffect, RpcService } from '@pipeit/tx-effect';
import { Effect } from 'effect';

const transferEffect = createTransferEffect({
  from: address('...'),
  to: address('...'),
  amount: 1_000_000n,
}).pipe(
  Effect.retry({ times: 3 }),
  Effect.timeout('30 seconds')
);

const result = await Effect.runPromise(
  transferEffect.pipe(
    Effect.provide(RpcService.layer(rpc))
  )
);
```

## API

See the [full documentation](../../docs/tx-effect.md) for complete API reference.








