/**
 * Types for durable nonce transactions.
 *
 * @packageDocumentation
 */

import type { Address } from '@solana/addresses';

/**
 * Nonce account state.
 */
export type NonceState = 'uninitialized' | 'initialized';

/**
 * Parsed nonce account data.
 */
export interface NonceAccountData {
  /**
   * Account state.
   */
  state: NonceState;

  /**
   * Authority authorized to advance the nonce.
   */
  authority: Address;

  /**
   * Current nonce value (blockhash).
   */
  nonce: string;

  /**
   * Fee calculator associated with this nonce (lamports per signature).
   */
  feeCalculator: {
    lamportsPerSignature: bigint;
  };
}

/**
 * Configuration for creating a durable nonce transaction builder.
 */
export interface DurableNonceConfig {
  /**
   * Address of the nonce account.
   */
  nonceAccountAddress: Address;

  /**
   * Address of the nonce authority (signer that can advance the nonce).
   */
  nonceAuthorityAddress: Address;

  /**
   * Optional: Pre-fetched nonce value. If not provided, will be fetched.
   */
  nonce?: string;
}

/**
 * Result of fetching nonce account data.
 */
export interface FetchNonceResult {
  /**
   * Current nonce value.
   */
  nonce: string;

  /**
   * Full account data.
   */
  accountData: NonceAccountData;
}
