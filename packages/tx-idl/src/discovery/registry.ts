/**
 * Account discovery registry.
 *
 * Orchestrates multiple discovery strategies to automatically resolve account addresses.
 *
 * @packageDocumentation
 */

import type { Address } from '@solana/addresses';
import type { IdlAccountItem } from '../types.js';
import type { AccountDiscoveryStrategy, DiscoveryContext } from './types.js';

/**
 * Registry for account discovery strategies.
 *
 * Tries strategies in priority order until one successfully resolves an account.
 */
export class AccountDiscoveryRegistry {
  private strategies: AccountDiscoveryStrategy[] = [];

  /**
   * Register a discovery strategy.
   *
   * Strategies are tried in priority order (higher priority first).
   *
   * @param strategy - Discovery strategy to register
   */
  registerStrategy(strategy: AccountDiscoveryStrategy): void {
    this.strategies.push(strategy);
    // Sort by priority (highest first)
    this.strategies.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Attempt to discover an account address.
   *
   * Tries each registered strategy in priority order until one succeeds.
   *
   * @param account - Account definition from IDL
   * @param context - Discovery context
   * @returns Resolved account address, or undefined if no strategy can resolve it
   */
  async discover(
    account: IdlAccountItem,
    context: DiscoveryContext
  ): Promise<Address | undefined> {
    // Try each strategy in priority order
    for (const strategy of this.strategies) {
      try {
        const canResolve = await strategy.canResolve(account, context);
        if (canResolve) {
          const resolved = await strategy.resolve(account, context);
          // Debug logging (can be disabled in production)
          if (typeof console !== 'undefined' && console.debug) {
            console.debug(
              `Account '${account.name}' resolved by strategy '${strategy.name}': ${resolved}`
            );
          }
          return resolved;
        }
      } catch (error) {
        // Strategy failed, try next
        if (typeof console !== 'undefined' && console.debug) {
          console.debug(
            `Strategy '${strategy.name}' failed for account '${account.name}':`,
            error
          );
        }
        continue;
      }
    }

    return undefined;
  }

  /**
   * Get all registered strategies.
   *
   * @returns Array of registered strategies (sorted by priority)
   */
  getStrategies(): readonly AccountDiscoveryStrategy[] {
    return [...this.strategies];
  }

  /**
   * Clear all registered strategies.
   */
  clear(): void {
    this.strategies = [];
  }
}


