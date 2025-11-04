# @pipeit/tx-templates

Pre-built transaction templates for common Solana operations.

## Installation

```bash
pnpm add @pipeit/tx-templates @solana/kit
```

## Usage

```typescript
import { createTransferTransaction } from '@pipeit/tx-templates/core';
import { address } from '@solana/kit';

const builder = createTransferTransaction({
  from: wallet,
  to: address('...'),
  amount: 1_000_000n,
});
```

## Templates

- **Core**: SOL transfers, system operations
- **Token**: SPL token operations
- **NFT**: NFT minting and transfers

## API

See the [full documentation](../../docs/tx-templates.md) for complete API reference.








