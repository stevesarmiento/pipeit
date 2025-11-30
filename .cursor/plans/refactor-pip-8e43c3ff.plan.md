<!-- 8e43c3ff-ce09-4b0d-a34c-a08ad204e4d6 dfb57aaf-166d-475a-816e-919a0f245b36 -->
# Phase 3: Improve Builder APIs - Detailed Implementation Plan

## Overview

Enhance the consolidated @pipeit/tx-builder package with the improvements suggested by your teammate:

1. Make blockhash optional with auto-fetch
2. Use Kit's assertion helpers instead of custom validators
3. Integrate validation into build methods
4. Add .simulate() method to opinionated builder
5. Ensure opinionated builder uses Kit's functional API consistently

## Step 1: Make Blockhash Optional in TransactionBuilder (Core)

**File: `packages/tx-builder/src/builder/core.ts`**

Currently the core builder requires explicit blockhash. Make it optional by:

### 1.1 Update BuilderConfig Type

Add optional RPC parameter:

```typescript
import type { Rpc, GetLatestBlockhashApi } from '@solana/rpc';

export interface BuilderConfig {
  version?: 0 | 'legacy';
  rpc?: Rpc<GetLatestBlockhashApi>; // NEW: Optional RPC for auto-fetch
}
```

### 1.2 Update Constructor

Store RPC in the builder:

```typescript
export class TransactionBuilder<TState extends BuilderState = BuilderState> {
  private feePayer?: Address;
  private lifetime?: LifetimeConstraint;
  private instructions: Instruction[] = [];
  private readonly version: 0 | 'legacy';
  private rpc?: Rpc<GetLatestBlockhashApi>; // NEW

  constructor(config: BuilderConfig = {}) {
    this.version = config.version ?? 0;
    this.rpc = config.rpc; // NEW
  }
}
```

### 1.3 Make build() Async and Auto-Fetch

Change `build()` signature to async and auto-fetch blockhash if needed:

```typescript
// Change from:
build(this: TransactionBuilder<RequiredState>): TransactionMessage

// To:
async build(this: TransactionBuilder<RequiredState>): Promise<TransactionMessage>

// Implementation:
async build(this: TransactionBuilder<RequiredState>): Promise<TransactionMessage> {
  if (!this.feePayer) {
    throw new InvalidTransactionError('Fee payer is required', ['feePayer']);
  }

  // AUTO-FETCH: If lifetime not set but RPC available, fetch latest blockhash
  if (!this.lifetime && this.rpc) {
    const { value } = await this.rpc.getLatestBlockhash().send();
    this.lifetime = {
      type: 'blockhash',
      blockhash: value.blockhash,
      lastValidBlockHeight: value.lastValidBlockHeight,
    };
  }

  if (!this.lifetime) {
    throw new InvalidTransactionError(
      'Lifetime required. Provide blockhash or pass rpc to constructor for auto-fetch.',
      ['lifetime']
    );
  }

  // Rest of build logic using Kit's functional API...
}
```

### 1.4 Update clone() Method

Ensure RPC is copied in clone:

```typescript
private clone(): TransactionBuilder<TState> {
  const builder = new TransactionBuilder<TState>({ 
    version: this.version,
    rpc: this.rpc // NEW: Copy RPC
  });
  if (this.feePayer !== undefined) {
    builder.feePayer = this.feePayer;
  }
  if (this.lifetime !== undefined) {
    builder.lifetime = this.lifetime;
  }
  builder.instructions = [...this.instructions];
  return builder;
}
```

## Step 2: Replace Custom Validators with Kit Helpers

**File: `packages/tx-builder/src/utils/utils.ts`**

### 2.1 Update isValidAddress

Replace custom implementation with Kit's assertIsAddress:

```typescript
import { assertIsAddress } from '@solana/addresses';
import type { Address } from '@solana/addresses';

// Remove old implementation:
// export function isValidAddress(address: unknown): address is Address {
//   return typeof address === 'string' && address.length > 0;
// }

// NEW: Use Kit's assertion with wrapper
export function isValidAddress(value: unknown): value is Address {
  try {
    assertIsAddress(value);
    return true;
  } catch {
    return false;
  }
}

// Also re-export Kit's assertion directly
export { assertIsAddress };
```

### 2.2 Keep Other Utilities

Keep formatLamports, parseLamports, and isDefined - these are useful helpers not provided by Kit.

## Step 3: Integrate Validation into Builders

### 3.1 Update Core Builder

**File: `packages/tx-builder/src/builder/core.ts`**

Import validation functions and call in build():

```typescript
import { validateTransaction, validateTransactionSize } from '../validation/index.js';

async build(this: TransactionBuilder<RequiredState>): Promise<TransactionMessage> {
  // ... build logic to create message ...
  
  // AUTO-VALIDATE before returning
  validateTransaction(message);
  validateTransactionSize(message);
  
  return message;
}
```

### 3.2 Update Opinionated Builder

**File: `packages/tx-builder/src/builder/opinionated.ts`**

Add validation before sending:

```typescript
import { validateTransaction, validateTransactionSize } from '../validation/index.js';

async execute(params: ExecuteParams): Promise<string> {
  // ... build message ...
  
  // VALIDATE before signing/sending
  validateTransaction(message);
  validateTransactionSize(message);
  
  // Sign transaction
  const signedTransaction: any = await signTransactionMessageWithSigners(message);
  
  // ... send logic ...
}
```

## Step 4: Add .simulate() Method to Opinionated Builder

**File: `packages/tx-builder/src/builder/opinionated.ts`**

### 4.1 Add SimulateTransactionApi Import

```typescript
import type { 
  Rpc,
  GetLatestBlockhashApi,
  GetEpochInfoApi,
  GetSignatureStatusesApi,
  SendTransactionApi,
  SimulateTransactionApi, // NEW
} from '@solana/rpc';
```

### 4.2 Define Simulation Result Type

```typescript
export interface SimulationResult {
  err: unknown | null;
  logs: string[] | null;
  unitsConsumed?: bigint;
  returnData?: {
    programId: string;
    data: Uint8Array;
  } | null;
}
```

### 4.3 Implement simulate() Method

```typescript
class OpinionatedTransactionBuilder {
  // ... existing methods ...
  
  /**
   * Simulate the transaction without sending it.
   * Useful for testing and debugging before execution.
   */
  async simulate(params: {
    feePayer: TransactionSigner;
    rpc: Rpc<GetLatestBlockhashApi & SimulateTransactionApi>;
    commitment?: 'processed' | 'confirmed' | 'finalized';
  }): Promise<SimulationResult> {
    const { feePayer, rpc, commitment = 'confirmed' } = params;
    
    // Build message with auto-blockhash
    const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
    
    const version = this.config.version === 'auto' || this.config.version === undefined ? 0 : this.config.version;
    let message: any = pipe(
      createTransactionMessage({ version }),
      (tx) => setTransactionMessageFeePayer(feePayer.address, tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx)
    );
    
    // Add instructions
    for (const instruction of this.instructions) {
      message = appendTransactionMessageInstruction(instruction, message);
    }
    
    // Sign for simulation
    const signedTransaction: any = await signTransactionMessageWithSigners(message);
    
    // Simulate
    const result = await rpc.simulateTransaction(signedTransaction, { 
      commitment,
      replaceRecentBlockhash: true,
    }).send();
    
    return {
      err: result.value.err,
      logs: result.value.logs,
      unitsConsumed: result.value.unitsConsumed,
      returnData: result.value.returnData,
    };
  }
}
```

## Step 5: Ensure Kit's Functional API is Used Consistently

**File: `packages/tx-builder/src/builder/core.ts`**

Update build() to use Kit's pipe pattern consistently:

```typescript
import { pipe } from '@solana/functional';
import {
  createTransactionMessage,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  setTransactionMessageLifetimeUsingDurableNonce,
  appendTransactionMessageInstruction,
} from '@solana/transaction-messages';

async build(this: TransactionBuilder<RequiredState>): Promise<TransactionMessage> {
  // Validation and auto-fetch logic...
  
  // Build using Kit's functional API
  let message: any = pipe(
    createTransactionMessage({ version: this.version }),
    (tx) => setTransactionMessageFeePayer(this.feePayer!, tx),
    (tx) => this.lifetime!.type === 'blockhash'
      ? setTransactionMessageLifetimeUsingBlockhash(
          {
            blockhash: this.lifetime!.blockhash as any,
            lastValidBlockHeight: this.lifetime!.lastValidBlockHeight,
          },
          tx
        )
      : setTransactionMessageLifetimeUsingDurableNonce(
          {
            nonce: this.lifetime!.nonce as any,
            nonceAccountAddress: this.lifetime!.nonceAccountAddress,
            nonceAuthorityAddress: this.lifetime!.nonceAuthorityAddress,
          },
          tx
        )
  );
  
  // Add instructions one by one
  for (const instruction of this.instructions) {
    message = appendTransactionMessageInstruction(instruction, message);
  }
  
  // Validate
  validateTransaction(message);
  validateTransactionSize(message);
  
  return message;
}
```

## Step 6: Update Types and Exports

### 6.1 Update BuilderConfig in types.ts

**File: `packages/tx-builder/src/types.ts`**

Add RPC to BuilderConfig:

```typescript
import type { Rpc, GetLatestBlockhashApi } from '@solana/rpc';

export interface BuilderConfig {
  version?: 0 | 'legacy';
  rpc?: Rpc<GetLatestBlockhashApi>; // NEW
}
```

### 6.2 Ensure Proper Exports

**File: `packages/tx-builder/src/builder/index.ts`**

Make sure both builders and their types are exported:

```typescript
export { TransactionBuilder } from './core.js';
export { OpinionatedTransactionBuilder, transaction } from './opinionated.js';
export type { TransactionBuilderConfig, SimulationResult } from './opinionated.js';
```

## Step 7: Update Documentation Comments

Update JSDoc comments to reflect new capabilities:

**In `packages/tx-builder/src/builder/core.ts`:**

````typescript
/**
 * Type-safe transaction builder that tracks required fields.
 *
 * @example
 * ```ts
 * // With auto-blockhash fetch
 * const builder = new TransactionBuilder({ version: 0, rpc })
 *   .setFeePayer(address('...'))
 *   .addInstruction(instruction)
 *   .build(); // Blockhash auto-fetched!
 *
 * // Or with explicit blockhash
 * const builder = new TransactionBuilder({ version: 0 })
 *   .setFeePayer(address('...'))
 *   .setBlockhashLifetime(blockhash, lastValidBlockHeight)
 *   .addInstruction(instruction)
 *   .build();
 * ```
 */
````

**In `packages/tx-builder/src/builder/opinionated.ts`:**

````typescript
/**
 * Opinionated transaction builder with smart defaults.
 *
 * Features:
 * - Auto-retry with configurable backoff
 * - Auto-blockhash fetching
 * - Built-in validation
 * - Simulation support
 * - Comprehensive logging
 *
 * @example
 * ```ts
 * // Simple usage
 * const sig = await transaction({ autoRetry: true })
 *   .addInstruction(ix)
 *   .execute({ feePayer, rpc, rpcSubscriptions });
 *
 * // With simulation
 * const result = await transaction()
 *   .addInstruction(ix)
 *   .simulate({ feePayer, rpc });
 * console.log('Simulation logs:', result.logs);
 * ```
 */
````

## Implementation Checklist

### Core Builder Improvements

- [ ] Add RPC to BuilderConfig type
- [ ] Update TransactionBuilder constructor to accept RPC
- [ ] Make build() method async
- [ ] Implement auto-blockhash fetch in build()
- [ ] Update clone() to copy RPC
- [ ] Import and use Kit's pipe for functional composition
- [ ] Import validation functions
- [ ] Call validateTransaction() in build()
- [ ] Call validateTransactionSize() in build()
- [ ] Update JSDoc comments

### Utils Improvements

- [ ] Import assertIsAddress from @solana/addresses
- [ ] Rewrite isValidAddress to use assertIsAddress
- [ ] Export assertIsAddress for direct use
- [ ] Keep other utility functions (formatLamports, parseLamports, isDefined)

### Opinionated Builder Improvements

- [ ] Add SimulateTransactionApi type import
- [ ] Define SimulationResult interface
- [ ] Implement simulate() method
- [ ] Import validation functions
- [ ] Add validation calls before signing in execute()
- [ ] Update JSDoc comments
- [ ] Export SimulationResult type

### Type Updates

- [ ] Update BuilderConfig in types.ts to include RPC
- [ ] Update builder/index.ts exports
- [ ] Verify all type exports in main index.ts

## Key Files to Modify

1. `packages/tx-builder/src/types.ts` - Add RPC to BuilderConfig
2. `packages/tx-builder/src/builder/core.ts` - Auto-blockhash, validation
3. `packages/tx-builder/src/builder/opinionated.ts` - Simulate method, validation
4. `packages/tx-builder/src/utils/utils.ts` - Kit assertion helpers
5. `packages/tx-builder/src/builder/index.ts` - Export SimulationResult

## Testing Strategy

After implementing improvements:

1. **Test auto-blockhash fetch:**
   ```typescript
   const builder = new TransactionBuilder({ rpc, version: 0 })
     .setFeePayer(address)
     .addInstruction(ix);
   const message = await builder.build(); // Should auto-fetch blockhash
   ```

2. **Test manual blockhash:**
   ```typescript
   const builder = new TransactionBuilder({ version: 0 })
     .setFeePayer(address)
     .setBlockhashLifetime(blockhash, lastValidBlockHeight)
     .addInstruction(ix);
   const message = await builder.build(); // Should use provided blockhash
   ```

3. **Test simulation:**
   ```typescript
   const result = await transaction()
     .addInstruction(ix)
     .simulate({ feePayer, rpc });
   expect(result).toHaveProperty('logs');
   ```

4. **Test validation:**

                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                - Try building transaction with missing feePayer (should throw)
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                - Try building transaction that's too large (should throw)

## Success Criteria

- [ ] TransactionBuilder accepts optional RPC in constructor
- [ ] build() is async and auto-fetches blockhash when RPC provided
- [ ] build() still works with manually set blockhash
- [ ] isValidAddress uses Kit's assertIsAddress internally
- [ ] assertIsAddress is exported from utils
- [ ] validateTransaction() is called automatically in build()
- [ ] validateTransactionSize() is called automatically in build()
- [ ] OpinionatedTransactionBuilder has simulate() method
- [ ] simulate() returns proper SimulationResult
- [ ] All JSDoc comments updated
- [ ] Package builds successfully: `pnpm build`
- [ ] Type checking passes: `pnpm typecheck`
- [ ] Tests pass (if any exist)

## Notes

- The opinionated builder already uses Kit's functional API (done in Phase 1)
- Validation functions are already in place (from Phase 2)
- The main work is: auto-blockhash, Kit assertions, and simulate method
- Keep changes backward compatible where possible

### To-dos

- [ ] Phase 1: Migrate from Gill to @solana/kit
- [ ] Phase 2: Consolidate packages into @pipeit/tx-builder
- [ ] Phase 1: Migrate from Gill to @solana/kit
- [ ] Phase 2: Consolidate packages into @pipeit/tx-builder