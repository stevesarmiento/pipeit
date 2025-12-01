/**
 * Address lookup table utilities for transaction size optimization.
 *
 * @packageDocumentation
 */

// Types
export type {
  AddressesByLookupTableAddress,
  LookupTableState,
  LookupTableAccountData,
  FetchLookupTableResult,
  LookupTableConfig,
} from './types.js';

// Fetch
export {
  ADDRESS_LOOKUP_TABLE_PROGRAM,
  fetchAddressLookupTable,
  fetchAddressLookupTables,
  LookupTableNotFoundError,
  LookupTableInvalidError,
} from './fetch.js';

// Compress
export {
  compressTransactionMessage,
  calculateLookupTableSavings,
} from './compress.js';
