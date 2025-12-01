/**
 * Utilities for fetching address lookup table data.
 *
 * @packageDocumentation
 */

import type { Address } from '@solana/addresses';
import { address } from '@solana/addresses';
import type { Rpc, GetAccountInfoApi } from '@solana/rpc';
import type { Commitment } from '@solana/rpc-types';
import type {
  AddressesByLookupTableAddress,
  LookupTableAccountData,
  LookupTableState,
  FetchLookupTableResult,
} from './types.js';

/**
 * Address Lookup Table program address.
 */
export const ADDRESS_LOOKUP_TABLE_PROGRAM = address('AddressLookupTab1e1111111111111111111111111');

/**
 * Lookup table account header size.
 * - 4 bytes: lookup table meta (type discriminator)
 * - 8 bytes: deactivation slot
 * - 8 bytes: last extended slot
 * - 1 byte: last extended slot start index
 * - 1 byte: has authority
 * - 32 bytes: authority (optional)
 */
const LOOKUP_TABLE_META_SIZE = 56;

/**
 * Maximum deactivation slot value (indicates table is active).
 */
const MAX_DEACTIVATION_SLOT = BigInt('18446744073709551615'); // u64::MAX

/**
 * Fetch a single address lookup table.
 *
 * @param rpc - RPC client
 * @param lookupTableAddress - Address of the lookup table
 * @param commitment - Commitment level
 * @returns Parsed lookup table data
 *
 * @example
 * ```ts
 * const table = await fetchAddressLookupTable(rpc, altAddress);
 * console.log(`Table has ${table.addresses.length} addresses`);
 * ```
 */
export async function fetchAddressLookupTable(
  rpc: Rpc<GetAccountInfoApi>,
  lookupTableAddress: Address,
  commitment: Commitment = 'confirmed'
): Promise<FetchLookupTableResult> {
  const accountInfo = await rpc
    .getAccountInfo(lookupTableAddress, {
      commitment,
      encoding: 'base64',
    })
    .send();

  if (!accountInfo.value) {
    throw new LookupTableNotFoundError(lookupTableAddress);
  }

  const data = accountInfo.value.data;
  if (!data || !Array.isArray(data) || data[1] !== 'base64') {
    throw new LookupTableInvalidError(lookupTableAddress, 'Invalid account data encoding');
  }

  const buffer = Buffer.from(data[0], 'base64');
  const accountData = parseLookupTableData(buffer, lookupTableAddress);

  return {
    address: lookupTableAddress,
    addresses: accountData.addresses,
    accountData,
  };
}

/**
 * Fetch multiple address lookup tables.
 *
 * @param rpc - RPC client
 * @param lookupTableAddresses - Addresses of the lookup tables
 * @param commitment - Commitment level
 * @returns Mapping of table addresses to their contained addresses
 *
 * @example
 * ```ts
 * const tables = await fetchAddressLookupTables(rpc, [alt1, alt2]);
 * const addressesInAlt1 = tables[alt1];
 * ```
 */
export async function fetchAddressLookupTables(
  rpc: Rpc<GetAccountInfoApi>,
  lookupTableAddresses: Address[],
  commitment: Commitment = 'confirmed'
): Promise<AddressesByLookupTableAddress> {
  const results = await Promise.all(
    lookupTableAddresses.map((addr) =>
      fetchAddressLookupTable(rpc, addr, commitment)
    )
  );

  const addressesByTable: AddressesByLookupTableAddress = {};
  for (const result of results) {
    addressesByTable[result.address] = result.addresses;
  }

  return addressesByTable;
}

/**
 * Parse lookup table data from raw bytes.
 */
function parseLookupTableData(buffer: Buffer, tableAddress: Address): LookupTableAccountData {
  if (buffer.length < LOOKUP_TABLE_META_SIZE) {
    throw new LookupTableInvalidError(
      tableAddress,
      `Account data too small: ${buffer.length} bytes, expected at least ${LOOKUP_TABLE_META_SIZE}`
    );
  }

  const dataView = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  // Type discriminator (4 bytes) - should be 1 for lookup table
  const typeDiscriminator = dataView.getUint32(0, true);
  if (typeDiscriminator !== 1) {
    throw new LookupTableInvalidError(
      tableAddress,
      `Invalid type discriminator: ${typeDiscriminator}, expected 1`
    );
  }

  // Deactivation slot (8 bytes) at offset 4
  const deactivationSlot = dataView.getBigUint64(4, true);

  // Last extended slot (8 bytes) at offset 12
  const lastExtendedSlot = dataView.getBigUint64(12, true);

  // Last extended slot start index (1 byte) at offset 20
  const lastExtendedSlotStartIndex = buffer[20];

  // Has authority flag (1 byte) at offset 21
  const hasAuthority = buffer[21] === 1;

  // Authority (32 bytes) at offset 22 (optional, only if hasAuthority)
  let authority: Address | undefined;
  if (hasAuthority) {
    const authorityBytes = buffer.slice(22, 54);
    authority = encodeBase58(authorityBytes) as Address;
  }

  // Addresses start after the meta section
  // Meta section is LOOKUP_TABLE_META_SIZE bytes
  const addressesStartOffset = LOOKUP_TABLE_META_SIZE;
  const addressesData = buffer.slice(addressesStartOffset);

  // Each address is 32 bytes
  const numAddresses = Math.floor(addressesData.length / 32);
  const addresses: Address[] = [];

  for (let i = 0; i < numAddresses; i++) {
    const offset = i * 32;
    const addressBytes = addressesData.slice(offset, offset + 32);
    addresses.push(encodeBase58(addressBytes) as Address);
  }

  // Determine state
  let state: LookupTableState;
  if (addresses.length === 0 && lastExtendedSlot === 0n) {
    state = 'uninitialized';
  } else if (deactivationSlot === MAX_DEACTIVATION_SLOT) {
    state = 'active';
  } else {
    state = 'deactivated';
  }

  // Build result with conditional optional properties (for exactOptionalPropertyTypes)
  const result: LookupTableAccountData = {
    state,
    lastExtendedSlot,
    lastExtendedSlotStartIndex,
    addresses,
  };
  
  if (authority) {
    result.authority = authority;
  }
  
  if (state === 'deactivated') {
    result.deactivationSlot = deactivationSlot;
  }

  return result;
}

/**
 * Encode bytes as base58 string.
 */
function encodeBase58(bytes: Uint8Array): string {
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const BASE = 58n;

  if (bytes.length === 0) return '';

  // Count leading zeros
  let leadingZeros = 0;
  for (const byte of bytes) {
    if (byte === 0) leadingZeros++;
    else break;
  }

  // Convert to BigInt
  let num = 0n;
  for (const byte of bytes) {
    num = num * 256n + BigInt(byte);
  }

  // Convert to base58
  let result = '';
  while (num > 0n) {
    const remainder = num % BASE;
    num = num / BASE;
    result = ALPHABET[Number(remainder)] + result;
  }

  // Add leading '1's for zeros
  return '1'.repeat(leadingZeros) + result;
}

/**
 * Error thrown when lookup table is not found.
 */
export class LookupTableNotFoundError extends Error {
  readonly address: Address;

  constructor(address: Address) {
    super(`Address lookup table not found: ${address}`);
    this.name = 'LookupTableNotFoundError';
    this.address = address;
  }
}

/**
 * Error thrown when lookup table data is invalid.
 */
export class LookupTableInvalidError extends Error {
  readonly address: Address;
  readonly reason: string;

  constructor(address: Address, reason: string) {
    super(`Invalid lookup table ${address}: ${reason}`);
    this.name = 'LookupTableInvalidError';
    this.address = address;
    this.reason = reason;
  }
}
