# @pipeit/tx-core

Core types and base transaction builder for Solana transactions.

## Installation

```bash
pnpm add @pipeit/tx-core @solana/kit
```

## Usage

```typescript
import { TransactionBuilder } from '@pipeit/tx-core';
import { address, getLatestBlockhash } from '@solana/kit';

const builder = new TransactionBuilder({ version: 0 })
  .setFeePayer(address('...'))
  .setBlockhashLifetime(blockhash, lastValidBlockHeight)
  .addInstruction(instruction)
  .build(); // Type-safe: only compiles when all required fields are set
```

## API

See the [full documentation](../../docs/tx-core.md) for complete API reference.








