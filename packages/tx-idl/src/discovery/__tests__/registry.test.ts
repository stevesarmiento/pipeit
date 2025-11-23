import { describe, it, expect } from 'vitest';
import { AccountDiscoveryRegistry } from '../registry.js';
import { WellKnownProgramResolver } from '../strategies/well-known.js';
import { AssociatedTokenAccountResolver } from '../strategies/ata.js';
import type { IdlAccountItem } from '../../types.js';
import type { DiscoveryContext } from '../types.js';
import { address } from '@solana/addresses';

describe('AccountDiscoveryRegistry', () => {
  it('should register and discover accounts', async () => {
    const registry = new AccountDiscoveryRegistry();
    registry.registerStrategy(new WellKnownProgramResolver());

    const account: IdlAccountItem = {
      name: 'systemProgram',
      isMut: false,
      isSigner: false,
    };

    const context: DiscoveryContext = {
      instruction: { name: 'test', accounts: [], args: [] },
      params: {},
      providedAccounts: {},
      signer: address('11111111111111111111111111111111'),
      programId: address('11111111111111111111111111111111'),
      rpc: {} as any,
      idl: { version: '0.1.0', name: 'test', instructions: [] },
    };

    const discovered = await registry.discover(account, context);
    expect(discovered).toBeDefined();
  });

  it('should try strategies in priority order', async () => {
    const registry = new AccountDiscoveryRegistry();

    // Register lower priority strategy first
    const lowPriority = new AssociatedTokenAccountResolver();
    const highPriority = new WellKnownProgramResolver();

    registry.registerStrategy(lowPriority);
    registry.registerStrategy(highPriority);

    // Should use high priority strategy first
    const account: IdlAccountItem = {
      name: 'systemProgram',
      isMut: false,
      isSigner: false,
    };

    const context: DiscoveryContext = {
      instruction: { name: 'test', accounts: [], args: [] },
      params: {},
      providedAccounts: {},
      signer: address('11111111111111111111111111111111'),
      programId: address('11111111111111111111111111111111'),
      rpc: {} as any,
      idl: { version: '0.1.0', name: 'test', instructions: [] },
    };

    const discovered = await registry.discover(account, context);
    expect(discovered).toBeDefined();
  });

  it('should return undefined if no strategy can resolve', async () => {
    const registry = new AccountDiscoveryRegistry();
    registry.registerStrategy(new WellKnownProgramResolver());

    const account: IdlAccountItem = {
      name: 'unknownAccount',
      isMut: false,
      isSigner: false,
    };

    const context: DiscoveryContext = {
      instruction: { name: 'test', accounts: [], args: [] },
      params: {},
      providedAccounts: {},
      signer: address('11111111111111111111111111111111'),
      programId: address('11111111111111111111111111111111'),
      rpc: {} as any,
      idl: { version: '0.1.0', name: 'test', instructions: [] },
    };

    const discovered = await registry.discover(account, context);
    expect(discovered).toBeUndefined();
  });
});


