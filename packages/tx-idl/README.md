# @pipeit/tx-idl

IDL-based transaction builder for Solana programs. Automatically fetch program IDLs, parse them, and generate instructions compatible with all pipeit packages.

## Features

- **Automatic IDL Fetching**: Fetch IDLs from on-chain accounts or external registries
- **Zero Custom Code**: Works with any Solana program that has an IDL (Anchor or Codama)
- **Package Agnostic**: Generates standard `Instruction` objects compatible with `@pipeit/tx-core`, `@pipeit/tx-builder`, and `@pipeit/tx-orchestration`
- **Full Type Support**: Handles primitives, structs, enums, arrays, options, and complex nested types
- **Account Resolution**: Automatically resolves accounts, handles PDAs, and validates account requirements
- **Automatic Account Discovery**: Auto-resolves well-known programs, user token accounts (ATAs), and protocol-specific accounts via plugins
- **Plugin System**: Extensible plugin architecture for protocol-specific account resolution (Jupiter, Kamino, etc.)
- **JSON Schema Generation**: Auto-generate parameter schemas for UI builders

## Installation

```bash
pnpm add @pipeit/tx-idl @solana/kit
```

## Quick Start

### Basic Usage

```typescript
import { IdlProgramRegistry } from '@pipeit/tx-idl';
import { createSolanaRpc } from '@solana/kit';
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

### Automatic Account Discovery

The registry automatically discovers account addresses through multiple strategies:

1. **Well-Known Programs**: System Program, Token Program, Rent, Clock, etc.
2. **Associated Token Accounts**: User token accounts derived from mint addresses
3. **PDA Derivation**: PDAs defined in the IDL are automatically derived
4. **Protocol Plugins**: Protocol-specific resolvers (Jupiter, Metaplex, etc.)

#### Well-Known Programs

Common Solana programs are automatically resolved:

```typescript
// These accounts are auto-discovered - no need to provide them!
const instruction = await registry.buildInstruction(
  programId,
  'transfer',
  { amount: 1000000n },
  {
    from: userAccount,
    to: recipientAccount,
    // systemProgram is auto-discovered!
  },
  { signer: userAddress, programId, rpc }
);
```

#### Associated Token Accounts

User token accounts are automatically derived when mint addresses are provided:

```typescript
// User token accounts are auto-discovered from mint addresses
const instruction = await registry.buildInstruction(
  programId,
  'swap',
  {
    amountIn: 1000000n,
    inputMint: SOL_MINT,    // Used to derive userSourceTokenAccount
    outputMint: USDC_MINT,  // Used to derive userDestTokenAccount
  },
  {
    // userSourceTokenAccount and userDestTokenAccount are auto-derived!
    // Only provide accounts you know
  },
  { signer: userAddress, programId, rpc }
);
```

#### Protocol Plugins

Register plugins for automatic account resolution:

```typescript
import { JupiterSwapPlugin } from '@pipeit/tx-idl';
import { IdlProgramRegistry } from '@pipeit/tx-idl';

const registry = new IdlProgramRegistry();

// Register Jupiter plugin
registry.use(new JupiterSwapPlugin());

// Now Jupiter swaps are fully automatic!
const instruction = await registry.buildInstruction(
  JUPITER_V6_PROGRAM,
  'swap',
  {
    inputMint: SOL,
    outputMint: USDC,
    amountIn: 1_000_000_000n,
    slippageBps: 50,
  },
  {}, // NO ACCOUNTS NEEDED! Plugin handles everything 🔥
  { signer: userAddress, programId: JUPITER_V6_PROGRAM, rpc }
);
```

The plugin automatically:
- Calls Jupiter's quote API to get optimal route
- Gets all required pool/vault addresses
- Maps accounts to IDL account names

### Automatic PDA Derivation

PDAs defined in the IDL are automatically derived. You only need to provide the accounts/arguments referenced in the PDA seeds:

```typescript
import { IdlProgramRegistry } from '@pipeit/tx-idl';
import { transaction } from '@pipeit/tx-builder';
import { address } from '@solana/kit';

const registry = new IdlProgramRegistry();
await registry.registerProgramFromJson(METAPLEX_PROGRAM, metaplexIdl);

// IDL defines metadata PDA with seeds: ["metadata", programId, mint]
// You only provide the mint - metadata PDA is auto-derived!
const instruction = await registry.buildInstruction(
  METAPLEX_PROGRAM,
  'createMetadataAccountV3',
  {
    data: {
      name: 'My NFT',
      symbol: 'NFT',
      uri: 'https://example.com/metadata.json',
    },
    isMutable: true,
  },
  {
    // Only provide accounts referenced in PDA seeds or required accounts
    mint: mintAddress,
    mintAuthority: signerAddress,
    payer: signerAddress,
    updateAuthority: signerAddress,
    // metadata account is auto-derived from PDA seeds!
  },
  {
    signer: signerAddress,
    programId: METAPLEX_PROGRAM,
    rpc,
  }
);

// Use with tx-builder
const signature = await transaction()
  .addInstruction(instruction)
  .execute({ feePayer: signer, rpc, rpcSubscriptions });
```

#### PDA Seed Types

The IDL supports three types of PDA seeds:

1. **Const seeds**: Fixed values (strings, numbers, addresses)
   ```json
   { "kind": "const", "type": "string", "value": "metadata" }
   ```

2. **Arg seeds**: References to instruction arguments
   ```json
   { "kind": "arg", "path": "tokenId" }
   ```

3. **Account seeds**: References to other accounts
   ```json
   { "kind": "account", "path": "mint" }
   ```

Example with arg-based seed:

```typescript
// IDL defines PDA with seeds: ["data", tokenId]
// tokenId comes from instruction args
const instruction = await registry.buildInstruction(
  programId,
  'createDataAccount',
  {
    tokenId: 12345n, // This is used for PDA seed
    data: 'some data',
  },
  {
    signer: signerAddress,
    // dataAccount is auto-derived using tokenId from args!
  },
  {
    signer: signerAddress,
    programId,
    rpc,
  }
);
```

## Account Discovery

### Built-in Discovery Strategies

The registry includes two built-in discovery strategies:

1. **WellKnownProgramResolver**: Resolves System Program, Token Program, Rent, Clock, etc.
2. **AssociatedTokenAccountResolver**: Derives user ATAs from mint addresses

These are automatically registered and used for all instructions.

### Creating Custom Plugins

You can create plugins for protocol-specific account resolution:

```typescript
import type { ProtocolAccountPlugin } from '@pipeit/tx-idl';
import type { IdlInstruction } from '@pipeit/tx-idl';
import type { DiscoveryContext } from '@pipeit/tx-idl';

class MyProtocolPlugin implements ProtocolAccountPlugin {
  id = 'my-protocol';
  programId = address('YOUR_PROGRAM_ID');
  instructions = ['swap', 'deposit']; // or '*' for all

  async resolveAccounts(
    instruction: IdlInstruction,
    params: Record<string, unknown>,
    context: DiscoveryContext
  ): Promise<Record<string, Address>> {
    // Your custom logic to resolve accounts
    // e.g., call external API, query on-chain data, etc.
    return {
      poolAddress: await this.findPool(params),
      vaultAddress: await this.findVault(params),
      // ... other accounts
    };
  }
}

// Register your plugin
registry.use(new MyProtocolPlugin());
```

### Discovery Priority

Accounts are resolved in this order:

1. **Provided accounts** (user override - highest priority)
2. **PDA derivation** (from IDL seeds)
3. **Protocol plugins** (if registered)
4. **Discovery strategies** (well-known, ATA, etc.)
5. **Signer fallback** (for signer accounts)
6. **Optional skip** (for optional accounts)

## API Reference

### `IdlProgramRegistry`

Main registry class for managing program IDLs.

#### Methods

- `registerProgram(programId, rpc, options?)`: Fetch and register a program's IDL
- `registerProgramFromJson(programId, idl)`: Register a program from IDL JSON
- `use(plugin)`: Register a protocol-specific account plugin
- `buildInstruction(programId, instructionName, params, accounts?, context)`: Build an instruction (accounts are optional - auto-discovered if not provided)
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
- ✅ Automatic PDA derivation (const, arg, and account seeds)
- ✅ Automatic account discovery (well-known programs, ATAs, plugins)
- ✅ Error code definitions

## Example Plugins

The package includes example plugins for popular protocols:

- **JupiterSwapPlugin**: Automatic account resolution for Jupiter swaps
- **MetaplexMetadataPlugin**: Automatic metadata PDA derivation for Metaplex
- **KaminoLendingPlugin**: Automatic account resolution for Kamino lending (deposit, withdraw, etc.)

```typescript
import { 
  JupiterSwapPlugin, 
  MetaplexMetadataPlugin,
  KaminoLendingPlugin 
} from '@pipeit/tx-idl';

const registry = new IdlProgramRegistry();

// Register plugins
registry.use(new JupiterSwapPlugin());
registry.use(new MetaplexMetadataPlugin());
registry.use(new KaminoLendingPlugin());

// Now these protocols work automatically!
```

### Kamino Lending Example

```typescript
import { IdlProgramRegistry, KaminoLendingPlugin, KAMINO_LENDING_PROGRAM } from '@pipeit/tx-idl';

const registry = new IdlProgramRegistry();
registry.use(new KaminoLendingPlugin());

// Deposit to Kamino - accounts auto-discovered!
const instruction = await registry.buildInstruction(
  KAMINO_LENDING_PROGRAM,
  'depositReserveLiquidity',
  {
    mint: USDC_MINT,           // Reserve mint
    amount: 1_000_000_000n,    // Amount to deposit
    lendingMarket: lendingMarketAddress, // Optional - plugin can find it
  },
  {}, // Plugin handles reserve, liquidity supply, user accounts, etc.
  { signer: userAddress, programId: KAMINO_LENDING_PROGRAM, rpc }
);
```

The Kamino plugin automatically:
- Finds or derives the lending market address
- Derives the reserve address from the mint
- Derives user token accounts (ATAs)
- Resolves well-known program accounts
- Maps accounts to IDL account names

## Examples

See the [examples directory](../../examples/) for more usage examples.

## License

MIT

