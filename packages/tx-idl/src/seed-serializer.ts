/**
 * Seed value serialization utilities for PDA derivation.
 *
 * @packageDocumentation
 */

import {
  getU8Encoder,
  getU16Encoder,
  getU32Encoder,
  getU64Encoder,
  getI8Encoder,
  getI16Encoder,
  getI32Encoder,
  getI64Encoder,
} from '@solana/codecs';
import { getAddressEncoder, type Address } from '@solana/addresses';
import type { IdlType } from './types.js';

/**
 * Serialize a seed value to bytes based on its IDL type.
 *
 * @param value - The seed value to serialize
 * @param type - The IDL type of the seed value, or 'inferred' to infer from value
 * @returns Serialized seed value as Uint8Array
 * @throws Error if type is unsupported or value cannot be serialized
 */
export function serializeSeedValue(value: unknown, type: IdlType | 'inferred'): Uint8Array {
  if (type === 'inferred') {
    // Infer type from value
    if (typeof value === 'string') {
      return Buffer.from(value);
    }
    if (typeof value === 'number') {
      // Default to u64 for numbers
      const encoded = getU64Encoder().encode(BigInt(value));
      return new Uint8Array(encoded);
    }
    if (typeof value === 'bigint') {
      const encoded = getU64Encoder().encode(value);
      return new Uint8Array(encoded);
    }
    if (value instanceof Uint8Array) {
      return value;
    }
    if (value instanceof Buffer) {
      return value;
    }
    throw new Error(`Cannot infer seed type for value: ${JSON.stringify(value)}`);
  }

  // Use explicit type
  if (typeof type === 'string') {
    switch (type) {
      case 'u8': {
        const encoded = getU8Encoder().encode(value as number);
        return new Uint8Array(encoded);
      }
      case 'u16': {
        const encoded = getU16Encoder().encode(value as number);
        return new Uint8Array(encoded);
      }
      case 'u32': {
        const encoded = getU32Encoder().encode(value as number);
        return new Uint8Array(encoded);
      }
      case 'u64': {
        const encoded = getU64Encoder().encode(BigInt(value as number | bigint));
        return new Uint8Array(encoded);
      }
      case 'i8': {
        const encoded = getI8Encoder().encode(value as number);
        return new Uint8Array(encoded);
      }
      case 'i16': {
        const encoded = getI16Encoder().encode(value as number);
        return new Uint8Array(encoded);
      }
      case 'i32': {
        const encoded = getI32Encoder().encode(value as number);
        return new Uint8Array(encoded);
      }
      case 'i64': {
        const encoded = getI64Encoder().encode(BigInt(value as number | bigint));
        return new Uint8Array(encoded);
      }
      case 'publicKey': {
        const encoded = getAddressEncoder().encode(value as Address);
        return new Uint8Array(encoded);
      }
      case 'string':
        if (typeof value === 'string') {
          return Buffer.from(value);
        }
        throw new Error(`Expected string value for string type, got: ${typeof value}`);
      case 'bytes':
        if (value instanceof Uint8Array || value instanceof Buffer) {
          return value instanceof Buffer ? value : Buffer.from(value);
        }
        throw new Error(`Expected Uint8Array or Buffer for bytes type, got: ${typeof value}`);
      default:
        throw new Error(`Unsupported seed type: ${type}`);
    }
  }

  // Handle complex types (not commonly used in PDA seeds, but handle for completeness)
  if (typeof type === 'object' && type !== null) {
    if ('array' in type) {
      // Array type - serialize as concatenated bytes
      if (Array.isArray(value)) {
        const [itemType] = type.array;
        const serializedItems = value.map((item) => serializeSeedValue(item, itemType));
        // Concatenate all items
        const totalLength = serializedItems.reduce((sum, item) => sum + item.length, 0);
        const result = new Uint8Array(totalLength);
        let offset = 0;
        for (const item of serializedItems) {
          result.set(item, offset);
          offset += item.length;
        }
        return result;
      }
      throw new Error(`Expected array value for array type`);
    }
    // Other complex types (vec, option, tuple, defined) are not typically used in PDA seeds
    throw new Error(`Complex seed types not yet supported: ${JSON.stringify(type)}`);
  }

  throw new Error(`Unsupported seed type: ${JSON.stringify(type)}`);
}

