import { describe, it, expect, beforeEach } from 'vitest';
import { AccountResolver } from '../accounts.js';
import type { ProgramIdl, Address } from '../types.js';
import { address } from '@solana/addresses';

// Mock IDL with PDA definitions
const MOCK_IDL_WITH_PDA: ProgramIdl = {
  version: '0.1.0',
  name: 'test_program',
  instructions: [
    {
      name: 'createWithPda',
      accounts: [
        {
          name: 'signer',
          isMut: true,
          isSigner: true,
        },
        {
          name: 'metadata',
          isMut: true,
          isSigner: false,
          pda: {
            seeds: [
              { kind: 'const', type: 'string', value: 'metadata' },
              { kind: 'account', path: 'mint' },
            ],
          },
        },
        {
          name: 'mint',
          isMut: false,
          isSigner: false,
        },
      ],
      args: [
        { name: 'name', type: 'string' },
        { name: 'tokenId', type: 'u64' },
      ],
    },
    {
      name: 'createWithArgSeed',
      accounts: [
        {
          name: 'signer',
          isMut: true,
          isSigner: true,
        },
        {
          name: 'dataAccount',
          isMut: true,
          isSigner: false,
          pda: {
            seeds: [
              { kind: 'const', type: 'string', value: 'data' },
              { kind: 'arg', path: 'tokenId' },
            ],
          },
        },
      ],
      args: [{ name: 'tokenId', type: 'u64' }],
    },
  ],
  metadata: {
    address: '11111111111111111111111111111111',
  },
};

describe('PDA Derivation', () => {
  let resolver: AccountResolver;
  // Use valid Solana addresses (32 bytes when decoded)
  const programId = '11111111111111111111111111111111' as Address;
  const signerAddress = '11111111111111111111111111111112' as Address;
  const mintAddress = '11111111111111111111111111111113' as Address;

  beforeEach(() => {
    resolver = new AccountResolver(MOCK_IDL_WITH_PDA);
  });

  it('should derive PDA from const seeds', async () => {
    const pda = {
      seeds: [
        { kind: 'const', type: 'string', value: 'metadata' },
      ],
    };

    const pdaAddress = await resolver.derivePda(pda, {
      signer: signerAddress,
      programId,
      context: {
        args: {},
        accounts: {},
      },
    });

    expect(pdaAddress).toBeDefined();
    expect(typeof pdaAddress).toBe('string');
  });

  it('should derive PDA from account seeds', async () => {
    const pda = {
      seeds: [
        { kind: 'const', type: 'string', value: 'metadata' },
        { kind: 'account', path: 'mint' },
      ],
    };

    const pdaAddress = await resolver.derivePda(pda, {
      signer: signerAddress,
      programId,
      context: {
        args: {},
        accounts: {
          mint: mintAddress,
        },
      },
    });

    expect(pdaAddress).toBeDefined();
    expect(typeof pdaAddress).toBe('string');
  });

  it('should derive PDA from arg seeds', async () => {
    const pda = {
      seeds: [
        { kind: 'const', type: 'string', value: 'data' },
        { kind: 'arg', path: 'tokenId' },
      ],
    };

    const pdaAddress = await resolver.derivePda(pda, {
      signer: signerAddress,
      programId,
      context: {
        args: {
          tokenId: 12345n,
        },
        accounts: {},
      },
    });

    expect(pdaAddress).toBeDefined();
    expect(typeof pdaAddress).toBe('string');
  });

  it('should throw error when account seed not found', async () => {
    const pda = {
      seeds: [
        { kind: 'const', type: 'string', value: 'metadata' },
        { kind: 'account', path: 'nonexistent' },
      ],
    };

    await expect(
      resolver.derivePda(pda, {
        signer: signerAddress,
        programId,
        context: {
          args: {},
          accounts: {},
        },
      })
    ).rejects.toThrow('Cannot resolve PDA seed: account \'nonexistent\' not found');
  });

  it('should throw error when arg seed not found', async () => {
    const pda = {
      seeds: [
        { kind: 'const', type: 'string', value: 'data' },
        { kind: 'arg', path: 'nonexistent' },
      ],
    };

    await expect(
      resolver.derivePda(pda, {
        signer: signerAddress,
        programId,
        context: {
          args: {},
          accounts: {},
        },
      })
    ).rejects.toThrow("Cannot resolve PDA seed: instruction argument 'nonexistent' not found");
  });

  it('should resolve accounts with PDA automatically', async () => {
    const instruction = MOCK_IDL_WITH_PDA.instructions[0];
    const resolvedAccounts = await resolver.resolveAccounts(
      instruction,
      {
        mint: mintAddress,
      },
      {
        signer: signerAddress,
        programId,
        context: {
          args: {},
          accounts: {
            mint: mintAddress,
          },
        },
      }
    );

    expect(resolvedAccounts).toHaveLength(3);
    expect(resolvedAccounts[0].address).toBe(signerAddress);
    expect(resolvedAccounts[1].address).toBeDefined(); // PDA-derived metadata
    expect(resolvedAccounts[1].address).not.toBe(signerAddress);
    expect(resolvedAccounts[2].address).toBe(mintAddress);
  });
});

