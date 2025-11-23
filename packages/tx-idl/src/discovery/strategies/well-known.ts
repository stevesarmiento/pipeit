/**
 * Well-known program account resolver.
 *
 * Automatically resolves accounts that match well-known Solana program addresses
 * (System Program, Token Program, Rent, Clock, etc.).
 *
 * @packageDocumentation
 */

import type { Address } from '@solana/addresses';
import type { IdlAccountItem } from '../../types.js';
import type { AccountDiscoveryStrategy } from '../types.js';
import { WELL_KNOWN_PATTERNS } from './constants.js';

/**
 * Resolver for well-known Solana programs.
 *
 * Matches account names to standard Solana program addresses like:
 * - System Program
 * - Token Program
 * - Rent Sysvar
 * - Clock Sysvar
 */
export class WellKnownProgramResolver implements AccountDiscoveryStrategy {
  name = 'well-known-programs';
  priority = 100; // High priority - try this first

  canResolve(account: IdlAccountItem): boolean {
    const name = account.name.toLowerCase();
    return WELL_KNOWN_PATTERNS.some((p) => p.pattern.test(name));
  }

  async resolve(account: IdlAccountItem): Promise<Address> {
    const name = account.name.toLowerCase();
    const match = WELL_KNOWN_PATTERNS.find((p) => p.pattern.test(name));

    if (!match) {
      throw new Error(`No well-known program address for: ${account.name}`);
    }

    return match.address;
  }
}

