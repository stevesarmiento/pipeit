/**
 * Helpers for working with durable nonce accounts.
 *
 * @packageDocumentation
 */

import type { Address } from '@solana/addresses';
import { address } from '@solana/addresses';
import type { Rpc, GetAccountInfoApi } from '@solana/rpc';
import type { Commitment } from '@solana/rpc-types';
import type { NonceAccountData, FetchNonceResult } from './types.js';

/**
 * System program address.
 */
export const SYSTEM_PROGRAM = address('11111111111111111111111111111111');

/**
 * Nonce account data layout:
 * - 4 bytes: version (u32)
 * - 4 bytes: state (u32) - 0 = uninitialized, 1 = initialized
 * - 32 bytes: authority pubkey
 * - 32 bytes: nonce (blockhash)
 * - 8 bytes: lamports per signature (u64)
 */
const NONCE_ACCOUNT_DATA_SIZE = 80;

/**
 * Fetch the current nonce value from a nonce account.
 *
 * @param rpc - RPC client
 * @param nonceAccountAddress - Address of the nonce account
 * @param commitment - Commitment level
 * @returns Current nonce value
 *
 * @example
 * ```ts
 * const nonce = await fetchNonceValue(rpc, nonceAccountAddress);
 * console.log(`Current nonce: ${nonce}`);
 * ```
 */
export async function fetchNonceValue(
  rpc: Rpc<GetAccountInfoApi>,
  nonceAccountAddress: Address,
  commitment: Commitment = 'confirmed'
): Promise<string> {
  const result = await fetchNonceAccount(rpc, nonceAccountAddress, commitment);
  return result.nonce;
}

/**
 * Fetch full nonce account data.
 *
 * @param rpc - RPC client
 * @param nonceAccountAddress - Address of the nonce account
 * @param commitment - Commitment level
 * @returns Parsed nonce account data
 *
 * @example
 * ```ts
 * const { nonce, accountData } = await fetchNonceAccount(rpc, nonceAccountAddress);
 * console.log(`Authority: ${accountData.authority}`);
 * console.log(`Nonce: ${nonce}`);
 * ```
 */
export async function fetchNonceAccount(
  rpc: Rpc<GetAccountInfoApi>,
  nonceAccountAddress: Address,
  commitment: Commitment = 'confirmed'
): Promise<FetchNonceResult> {
  const accountInfo = await rpc
    .getAccountInfo(nonceAccountAddress, {
      commitment,
      encoding: 'base64',
    })
    .send();

  if (!accountInfo.value) {
    throw new NonceAccountNotFoundError(nonceAccountAddress);
  }

  const data = accountInfo.value.data;
  if (!data || !Array.isArray(data) || data[1] !== 'base64') {
    throw new NonceAccountInvalidError(nonceAccountAddress, 'Invalid account data encoding');
  }

  const buffer = Buffer.from(data[0], 'base64');

  if (buffer.length < NONCE_ACCOUNT_DATA_SIZE) {
    throw new NonceAccountInvalidError(
      nonceAccountAddress,
      `Account data too small: ${buffer.length} bytes, expected ${NONCE_ACCOUNT_DATA_SIZE}`
    );
  }

  const accountData = parseNonceAccountData(buffer, nonceAccountAddress);

  return {
    nonce: accountData.nonce,
    accountData,
  };
}

/**
 * Parse nonce account data from raw bytes.
 */
function parseNonceAccountData(buffer: Buffer, accountAddress: Address): NonceAccountData {
  const dataView = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  // Version (4 bytes) - we skip this
  // const version = dataView.getUint32(0, true);

  // State (4 bytes)
  const stateValue = dataView.getUint32(4, true);
  if (stateValue !== 1) {
    throw new NonceAccountInvalidError(accountAddress, 'Nonce account is not initialized');
  }

  // Authority (32 bytes) at offset 8
  const authorityBytes = buffer.slice(8, 40);
  const authority = encodeBase58(authorityBytes) as Address;

  // Nonce/blockhash (32 bytes) at offset 40
  const nonceBytes = buffer.slice(40, 72);
  const nonce = encodeBase58(nonceBytes);

  // Fee calculator - lamports per signature (8 bytes) at offset 72
  const lamportsPerSignature = dataView.getBigUint64(72, true);

  return {
    state: 'initialized',
    authority,
    nonce,
    feeCalculator: {
      lamportsPerSignature,
    },
  };
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
 * Error thrown when nonce account is not found.
 */
export class NonceAccountNotFoundError extends Error {
  readonly address: Address;

  constructor(address: Address) {
    super(`Nonce account not found: ${address}`);
    this.name = 'NonceAccountNotFoundError';
    this.address = address;
  }
}

/**
 * Error thrown when nonce account data is invalid.
 */
export class NonceAccountInvalidError extends Error {
  readonly address: Address;
  readonly reason: string;

  constructor(address: Address, reason: string) {
    super(`Invalid nonce account ${address}: ${reason}`);
    this.name = 'NonceAccountInvalidError';
    this.address = address;
    this.reason = reason;
  }
}

/**
 * Check if an account is a valid nonce account.
 *
 * @param rpc - RPC client
 * @param accountAddress - Address to check
 * @returns true if the account is a valid initialized nonce account
 */
export async function isNonceAccount(
  rpc: Rpc<GetAccountInfoApi>,
  accountAddress: Address
): Promise<boolean> {
  try {
    await fetchNonceAccount(rpc, accountAddress);
    return true;
  } catch {
    return false;
  }
}
