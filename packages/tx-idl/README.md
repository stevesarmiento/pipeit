# @pipeit/tx-idl

IDL-based transaction builder for Solana programs. Automatically fetch program IDLs, parse them, and generate instructions compatible with all pipeit packages.

## Features

- **Automatic IDL Fetching**: Fetch IDLs from on-chain accounts or external registries
- **Zero Custom Code**: Works with any Solana program that has an IDL (Anchor or Codama)
- **Package Agnostic**: Generates standard `Instruction` objects compatible with `@pipeit/tx-core`, `@pipeit/tx-builder`, and `@pipeit/tx-orchestration`
- **Full Type Support**: Handles primitives, structs, enums, arrays, options, and complex nested types
- **Account Resolution**: Automatically resolves accounts, handles PDAs, and validates account requirements
- **JSON Schema Generation**: Auto-generate parameter schemas for UI builders

## Installation

```bash
pnpm add @pipeit/tx-idl gill
```

## Quick Start

### Basic Usage

```typescript
import { IdlProgramRegistry } from '@pipeit/tx-idl';
import { createSolanaRpc } from 'gill';
import { transaction } from '@pipeit/tx-builder';

const rpc = createSolanaRpc('https://api.mainnet-beta.solana.com');

// Register a program
const registry = new IdlProgramRegistry();
await registry.registerProgram(programId, rpc);

// Build an instruction
const instruction = await registry.buildInstruction(
  programId,
  'swap',
  { amountIn: 1000000n, minimumAmountOut: 900000n },
  { userSourceAccount, userDestAccount },
  { signer: userAddress, programId, rpc }
);

// Use with tx-builder
const signature = await transaction()
  .addInstruction(instruction)
  .execute({ feePayer: signer, rpc, rpcSubscriptions });
```

### With tx-core

```typescript
import { TransactionBuilder } from '@pipeit/tx-core';
import { IdlProgramRegistry } from '@pipeit/tx-idl';

const registry = new IdlProgramRegistry();
await registry.registerProgram(programId, rpc);

const instruction = await registry.buildInstruction(
  programId,
  'transfer',
  { amount: 1000000n },
  { from: userAccount, to: recipientAccount },
  { signer: userAddress, programId, rpc }
);

const builder = new TransactionBuilder()
  .addInstruction(instruction)
  .setFeePayer(userAddress)
  .setBlockhashLifetime(blockhash, lastValidBlockHeight);
```

### With tx-orchestration

```typescript
import { createPipeline } from '@pipeit/tx-orchestration';
import { IdlProgramRegistry } from '@pipeit/tx-idl';

const registry = new IdlProgramRegistry();
await registry.registerProgram(programId, rpc);

const pipeline = createPipeline()
  .instruction('step1', async (ctx) => {
    return registry.buildInstruction(
      programId,
      'createAccount',
      { space: 100 },
      { payer: ctx.signer.address },
      { signer: ctx.signer.address, programId, rpc: ctx.rpc }
    );
  })
  .instruction('step2', async (ctx) => {
    const step1Result = ctx.results.get('step1');
    return registry.buildInstruction(
      programId,
      'initialize',
      { data: 'hello' },
      { account: step1Result.account },
      { signer: ctx.signer.address, programId, rpc: ctx.rpc }
    );
  });

await pipeline.execute({ signer, rpc, rpcSubscriptions });
```

### Loading IDL from JSON

```typescript
import { IdlProgramRegistry } from '@pipeit/tx-idl';
import fs from 'fs';

const registry = new IdlProgramRegistry();

// Load from file
const idlJson = fs.readFileSync('idl.json', 'utf-8');
registry.registerProgramFromJson(programId, idlJson);

// Or load from object
const idl = JSON.parse(idlJson);
registry.registerProgramFromJson(programId, idl);
```

## API Reference

### `IdlProgramRegistry`

Main registry class for managing program IDLs.

#### Methods

- `registerProgram(programId, rpc, options?)`: Fetch and register a program's IDL
- `registerProgramFromJson(programId, idl)`: Register a program from IDL JSON
- `buildInstruction(programId, instructionName, params, accounts, context)`: Build an instruction
- `getInstructions(programId)`: Get all instructions for a program
- `getInstructionBuilder(programId, instructionName)`: Get instruction builder for advanced usage
- `getIdl(programId)`: Get the IDL for a program
- `isRegistered(programId)`: Check if a program is registered
- `clearCache(programId?)`: Clear cached IDLs

### `IdlInstructionBuilder`

Builder for a specific instruction.

#### Methods

- `buildInstruction(params, accounts, context)`: Build the instruction
- `getParamSchema()`: Get JSON Schema for parameters (useful for UI generation)
- `getAccountRequirements()`: Get account requirements for the instruction

## Supported IDL Features

- ✅ Primitive types (u8-u128, i8-i128, bool, string, publicKey, bytes)
- ✅ Complex types (Vec, Option, COption, Array, Tuple)
- ✅ Structs and Enums
- ✅ Type references (`{ defined: "TypeName" }`)
- ✅ Instruction discriminators
- ✅ Account requirements (mut, signer, optional)
- ✅ PDA derivation (basic support)
- ✅ Error code definitions

## Examples

See the [examples directory](../../examples/) for more usage examples.

## License

MIT

