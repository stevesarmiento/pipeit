import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AssociatedTokenAccountResolver } from '../strategies/ata.js';
import type { IdlAccountItem, IdlInstruction } from '../../types.js';
import type { DiscoveryContext } from '../types.js';
import { address } from '@solana/addresses';

describe('AssociatedTokenAccountResolver', () => {
  const resolver = new AssociatedTokenAccountResolver();
  const mockSigner = address('11111111111111111111111111111111');
  const mockMint = address('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'); // USDC
  const mockRpc = {} as any;
  const mockIdl = { instructions: [] } as any;

  const createContext = (params: Record<string, unknown>): DiscoveryContext => ({
    instruction: {
      name: 'test',
      accounts: [],
      args: [],
    },
    params,
    providedAccounts: {},
    signer: mockSigner,
    programId: address('11111111111111111111111111111111'),
    rpc: mockRpc,
    idl: mockIdl,
  });

  it('should identify user token accounts', () => {
    const account: IdlAccountItem = {
      name: 'userSourceTokenAccount',
      isMut: true,
      isSigner: false,
    };

    const context = createContext({ inputMint: mockMint });
    expect(resolver.canResolve(account, context)).toBe(true);
  });

  it('should identify ATA accounts', () => {
    const account: IdlAccountItem = {
      name: 'userAta',
      isMut: true,
      isSigner: false,
    };

    const context = createContext({ mint: mockMint });
    expect(resolver.canResolve(account, context)).toBe(true);
  });

  it('should infer mint from inputMint param', async () => {
    const account: IdlAccountItem = {
      name: 'userSourceTokenAccount',
      isMut: true,
      isSigner: false,
    };

    const context = createContext({ inputMint: mockMint });
    const ataAddress = await resolver.resolve(account, context);
    expect(ataAddress).toBeDefined();
    expect(typeof ataAddress).toBe('string');
  });

  it('should infer mint from outputMint param', async () => {
    const account: IdlAccountItem = {
      name: 'userDestTokenAccount',
      isMut: true,
      isSigner: false,
    };

    const context = createContext({ outputMint: mockMint });
    const ataAddress = await resolver.resolve(account, context);
    expect(ataAddress).toBeDefined();
    expect(typeof ataAddress).toBe('string');
  });

  it('should infer mint from generic mint param', async () => {
    const account: IdlAccountItem = {
      name: 'userTokenAccount',
      isMut: true,
      isSigner: false,
    };

    const context = createContext({ mint: mockMint });
    const ataAddress = await resolver.resolve(account, context);
    expect(ataAddress).toBeDefined();
  });

  it('should not resolve if mint cannot be inferred', () => {
    const account: IdlAccountItem = {
      name: 'userTokenAccount',
      isMut: true,
      isSigner: false,
    };

    const context = createContext({});
    expect(resolver.canResolve(account, context)).toBe(false);
  });

  it('should throw error when resolving without mint', async () => {
    const account: IdlAccountItem = {
      name: 'userTokenAccount',
      isMut: true,
      isSigner: false,
    };

    const context = createContext({});
    await expect(resolver.resolve(account, context)).rejects.toThrow();
  });
});


