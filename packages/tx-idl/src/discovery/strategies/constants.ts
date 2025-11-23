/**
 * Well-known Solana program addresses.
 *
 * @packageDocumentation
 */

import { address, type Address } from '@solana/addresses';

/**
 * Well-known Solana program addresses.
 */
export const WELL_KNOWN_PROGRAMS = {
  systemProgram: address('11111111111111111111111111111111'),
  tokenProgram: address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
  token2022Program: address('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'),
  associatedTokenProgram: address('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'),
  rent: address('SysvarRent111111111111111111111111111111111'),
  clock: address('SysvarC1ock11111111111111111111111111111111'),
  recentBlockhashes: address('SysvarRecentB1ockHashes11111111111111111111'),
  stakeHistory: address('SysvarStakeHistory1111111111111111111111111'),
  instructions: address('Sysvar1nstructions1111111111111111111111111'),
} as const;

/**
 * Pattern matching rules for well-known accounts.
 * Matches account names to their well-known addresses.
 */
export const WELL_KNOWN_PATTERNS: Array<{
  pattern: RegExp;
  address: Address;
}> = [
  { pattern: /^system[_-]?program$/i, address: WELL_KNOWN_PROGRAMS.systemProgram },
  { pattern: /^token[_-]?program$/i, address: WELL_KNOWN_PROGRAMS.tokenProgram },
  { pattern: /^token2022[_-]?program$/i, address: WELL_KNOWN_PROGRAMS.token2022Program },
  { pattern: /^associated[_-]?token[_-]?program$/i, address: WELL_KNOWN_PROGRAMS.associatedTokenProgram },
  { pattern: /^rent$/i, address: WELL_KNOWN_PROGRAMS.rent },
  { pattern: /^clock$/i, address: WELL_KNOWN_PROGRAMS.clock },
  { pattern: /^recent[_-]?blockhashes$/i, address: WELL_KNOWN_PROGRAMS.recentBlockhashes },
  { pattern: /^stake[_-]?history$/i, address: WELL_KNOWN_PROGRAMS.stakeHistory },
  { pattern: /^instructions$/i, address: WELL_KNOWN_PROGRAMS.instructions },
];

