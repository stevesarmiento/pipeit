# @pipeit/tx-builder

High-level builder API for Solana transactions (beginner-friendly).

## Installation

```bash
pnpm add @pipeit/tx-builder @solana/kit
```

## Usage

```typescript
import { createTransaction } from '@pipeit/tx-builder';
import { createSolanaRpc } from '@solana/kit';

const rpc = createSolanaRpc('https://api.mainnet-beta.solana.com');

const result = await createTransaction()
  .transfer({ from: wallet, to: destination, amount: 1_000_000n })
  .withPriorityFee('high')
  .send(rpc, { feePayer: wallet });
```

## API

See the [full documentation](../../docs/tx-builder.md) for complete API reference.








