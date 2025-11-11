import { describe, it, expect } from 'vitest';
import { WellKnownProgramResolver } from '../strategies/well-known.js';
import { WELL_KNOWN_PROGRAMS } from '../strategies/constants.js';
import type { IdlAccountItem } from '../../types.js';
import type { DiscoveryContext } from '../types.js';

describe('WellKnownProgramResolver', () => {
  const resolver = new WellKnownProgramResolver();

  it('should resolve systemProgram account', async () => {
    const account: IdlAccountItem = {
      name: 'systemProgram',
      isMut: false,
      isSigner: false,
    };

    expect(resolver.canResolve(account)).toBe(true);
    const address = await resolver.resolve(account);
    expect(address).toBe(WELL_KNOWN_PROGRAMS.systemProgram);
  });

  it('should resolve tokenProgram account', async () => {
    const account: IdlAccountItem = {
      name: 'tokenProgram',
      isMut: false,
      isSigner: false,
    };

    expect(resolver.canResolve(account)).toBe(true);
    const address = await resolver.resolve(account);
    expect(address).toBe(WELL_KNOWN_PROGRAMS.tokenProgram);
  });

  it('should resolve rent account', async () => {
    const account: IdlAccountItem = {
      name: 'rent',
      isMut: false,
      isSigner: false,
    };

    expect(resolver.canResolve(account)).toBe(true);
    const address = await resolver.resolve(account);
    expect(address).toBe(WELL_KNOWN_PROGRAMS.rent);
  });

  it('should handle case-insensitive matching', async () => {
    const account: IdlAccountItem = {
      name: 'SYSTEM_PROGRAM',
      isMut: false,
      isSigner: false,
    };

    expect(resolver.canResolve(account)).toBe(true);
    const address = await resolver.resolve(account);
    expect(address).toBe(WELL_KNOWN_PROGRAMS.systemProgram);
  });

  it('should not resolve unknown accounts', () => {
    const account: IdlAccountItem = {
      name: 'unknownAccount',
      isMut: false,
      isSigner: false,
    };

    expect(resolver.canResolve(account)).toBe(false);
  });
});

