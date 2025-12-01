/**
 * Types for address lookup table operations.
 *
 * @packageDocumentation
 */

import type { Address } from '@solana/addresses';

/**
 * Mapping of lookup table addresses to their contained addresses.
 */
export type AddressesByLookupTableAddress = {
  [lookupTableAddress: Address]: Address[];
};

/**
 * Lookup table account state.
 */
export type LookupTableState = 'uninitialized' | 'active' | 'deactivated';

/**
 * Parsed address lookup table account data.
 */
export interface LookupTableAccountData {
  /**
   * Current state of the lookup table.
   */
  state: LookupTableState;

  /**
   * Authority that can modify the table (if active).
   */
  authority?: Address;

  /**
   * Deactivation slot (if deactivated).
   */
  deactivationSlot?: bigint;

  /**
   * Last extended slot.
   */
  lastExtendedSlot: bigint;

  /**
   * Last extended slot start index.
   */
  lastExtendedSlotStartIndex: number;

  /**
   * Addresses stored in the lookup table.
   */
  addresses: Address[];
}

/**
 * Result of fetching a lookup table.
 */
export interface FetchLookupTableResult {
  /**
   * Lookup table address.
   */
  address: Address;

  /**
   * Addresses in the table.
   */
  addresses: Address[];

  /**
   * Full account data.
   */
  accountData: LookupTableAccountData;
}

/**
 * Configuration for using address lookup tables.
 */
export interface LookupTableConfig {
  /**
   * Addresses of lookup tables to use.
   * Will be fetched automatically.
   */
  lookupTableAddresses?: Address[];

  /**
   * Pre-fetched lookup table data.
   * Use this to avoid fetching if you already have the data.
   */
  addressesByLookupTable?: AddressesByLookupTableAddress;
}
