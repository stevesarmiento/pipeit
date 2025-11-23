/**
 * Instruction data serialization using @solana/codecs.
 *
 * @packageDocumentation
 */

import {
  combineCodec,
  getBooleanEncoder,
  getBooleanDecoder,
  getU8Encoder,
  getU8Decoder,
  getU16Encoder,
  getU16Decoder,
  getU32Encoder,
  getU32Decoder,
  getU64Encoder,
  getU64Decoder,
  getU128Encoder,
  getU128Decoder,
  getI8Encoder,
  getI8Decoder,
  getI16Encoder,
  getI16Decoder,
  getI32Encoder,
  getI32Decoder,
  getI64Encoder,
  getI64Decoder,
  getI128Encoder,
  getI128Decoder,
  getF32Encoder,
  getF32Decoder,
  getF64Encoder,
  getF64Decoder,
  getBytesEncoder,
  getBytesDecoder,
  getArrayEncoder,
  getArrayDecoder,
  getOptionEncoder,
  getOptionDecoder,
  getStructEncoder,
  getStructDecoder,
  getTupleEncoder,
  getTupleDecoder,
  type Codec,
  type Encoder,
  type Decoder,
} from '@solana/codecs';
import { getAddressEncoder, getAddressDecoder } from '@solana/addresses';
import type { IdlInstruction, IdlType, IdlTypeDef, ProgramIdl } from './types.js';
import { resolveTypeReference } from './parser.js';

/**
 * Context for type resolution during serialization.
 */
export interface SerializationContext {
  idl: ProgramIdl;
  resolvedTypes: Map<string, IdlTypeDef>;
}

/**
 * Instruction encoder type - encodes Record<string, unknown> to Uint8Array.
 */
type InstructionEncoder = Encoder<Record<string, unknown>>;

/**
 * Instruction decoder type - decodes Uint8Array to Record<string, unknown>.
 */
type InstructionDecoder = Decoder<Record<string, unknown>>;

/**
 * Instruction codec type - encodes and decodes instruction parameters.
 */
type InstructionCodec = Codec<Record<string, unknown>, Record<string, unknown>>;

/**
 * Create an encoder for an instruction's data.
 * Includes the discriminator prefix if present.
 *
 * @param instruction - Instruction definition
 * @param context - Serialization context with IDL and type definitions
 * @returns Encoder for instruction data
 */
export function createInstructionEncoder(
  instruction: IdlInstruction,
  context: SerializationContext
): InstructionEncoder {
  // Build encoder for instruction args
  const fieldEncoders: Array<readonly [string, Encoder<unknown>]> = instruction.args.map((arg) => [
    arg.name,
    idlTypeToEncoder(arg.type, context),
  ] as const);

  const argsEncoder = fieldEncoders.length > 0 ? getStructEncoder(fieldEncoders) : null;

  // Add discriminator if present
  if (instruction.discriminant) {
    // Handle both single-byte and byte array discriminators
    const discriminatorEncoder =
      instruction.discriminant.type === 'bytes' && Array.isArray(instruction.discriminant.value)
        ? (getArrayEncoder(getU8Encoder(), { size: 8 }) as Encoder<unknown>)
        : (getU8Encoder() as Encoder<unknown>);

    if (argsEncoder) {
      // Combine discriminator + args
      return getStructEncoder([
        ['discriminator', discriminatorEncoder],
        ...fieldEncoders,
      ]) as InstructionEncoder;
    }
    // Only discriminator, no args - wrap in struct encoder
    return getStructEncoder([['discriminator', discriminatorEncoder]]) as InstructionEncoder;
  }

  if (argsEncoder) {
    return argsEncoder as InstructionEncoder;
  }

  // No args - return empty encoder (encodes empty object to empty bytes)
  return getStructEncoder([]) as InstructionEncoder;
}

/**
 * Create a decoder for an instruction's data.
 * Handles the discriminator prefix if present.
 *
 * @param instruction - Instruction definition
 * @param context - Serialization context with IDL and type definitions
 * @returns Decoder for instruction data
 */
export function createInstructionDecoder(
  instruction: IdlInstruction,
  context: SerializationContext
): InstructionDecoder {
  // Build decoder for instruction args
  const fieldDecoders: Array<readonly [string, Decoder<unknown>]> = instruction.args.map((arg) => [
    arg.name,
    idlTypeToDecoder(arg.type, context),
  ] as const);

  const argsDecoder = fieldDecoders.length > 0 ? getStructDecoder(fieldDecoders) : null;

  // Add discriminator if present
  if (instruction.discriminant) {
    // Handle both single-byte and byte array discriminators
    const discriminatorDecoder =
      instruction.discriminant.type === 'bytes' && Array.isArray(instruction.discriminant.value)
        ? (getArrayDecoder(getU8Decoder(), { size: 8 }) as Decoder<unknown>)
        : (getU8Decoder() as Decoder<unknown>);

    if (argsDecoder) {
      // Combine discriminator + args
      return getStructDecoder([
        ['discriminator', discriminatorDecoder],
        ...fieldDecoders,
      ]) as InstructionDecoder;
    }
    // Only discriminator, no args - wrap in struct decoder
    return getStructDecoder([['discriminator', discriminatorDecoder]]) as InstructionDecoder;
  }

  if (argsDecoder) {
    return argsDecoder as InstructionDecoder;
  }

  // No args - return empty decoder
  return getStructDecoder([]) as InstructionDecoder;
}

/**
 * Create a codec for an instruction's data.
 * Includes the discriminator prefix if present.
 *
 * @param instruction - Instruction definition
 * @param context - Serialization context with IDL and type definitions
 * @returns Codec for instruction data
 */
export function createInstructionCodec(
  instruction: IdlInstruction,
  context: SerializationContext
): InstructionCodec {
  const encoder = createInstructionEncoder(instruction, context);
  const decoder = createInstructionDecoder(instruction, context);
  return combineCodec(encoder, decoder);
}

/**
 * Convert an IDL type to a @solana/codecs encoder.
 *
 * @param type - IDL type definition
 * @param context - Serialization context
 * @returns Encoder for the type
 */
export function idlTypeToEncoder(type: IdlType, context: SerializationContext): Encoder<unknown> {
  // Handle primitive types
  if (typeof type === 'string') {
    switch (type) {
      case 'bool':
        return getBooleanEncoder() as Encoder<unknown>;
      case 'u8':
        return getU8Encoder() as Encoder<unknown>;
      case 'u16':
        return getU16Encoder() as Encoder<unknown>;
      case 'u32':
        return getU32Encoder() as Encoder<unknown>;
      case 'u64':
        return getU64Encoder() as Encoder<unknown>;
      case 'u128':
        return getU128Encoder() as Encoder<unknown>;
      case 'i8':
        return getI8Encoder() as Encoder<unknown>;
      case 'i16':
        return getI16Encoder() as Encoder<unknown>;
      case 'i32':
        return getI32Encoder() as Encoder<unknown>;
      case 'i64':
        return getI64Encoder() as Encoder<unknown>;
      case 'i128':
        return getI128Encoder() as Encoder<unknown>;
      case 'f32':
        return getF32Encoder() as Encoder<unknown>;
      case 'f64':
        return getF64Encoder() as Encoder<unknown>;
      case 'string':
        // String encoding requires special handling - using bytes as fallback
        return getBytesEncoder() as Encoder<unknown>;
      case 'publicKey':
        return getAddressEncoder() as Encoder<unknown>;
      case 'bytes':
        return getBytesEncoder() as Encoder<unknown>;
      default:
        throw new Error(`Unsupported primitive type: ${type}`);
    }
  }

  // Handle complex types
  if (typeof type === 'object' && type !== null) {
    if ('vec' in type) {
      const itemEncoder = idlTypeToEncoder(type.vec, context);
      return getArrayEncoder(itemEncoder) as Encoder<unknown>;
    }

    if ('option' in type) {
      const itemEncoder = idlTypeToEncoder(type.option, context);
      return getOptionEncoder(itemEncoder) as Encoder<unknown>;
    }

    if ('coption' in type && type.coption) {
      // COption is similar to Option but with different encoding
      const itemEncoder = idlTypeToEncoder(type.coption, context);
      return getOptionEncoder(itemEncoder) as Encoder<unknown>;
    }

    if ('array' in type) {
      const [itemType, length] = type.array;
      const itemEncoder = idlTypeToEncoder(itemType, context);
      return getArrayEncoder(itemEncoder, { size: length }) as Encoder<unknown>;
    }

    if ('tuple' in type) {
      const tupleEncoders = type.tuple.map((t) => idlTypeToEncoder(t, context));
      return getTupleEncoder(tupleEncoders) as Encoder<unknown>;
    }

    if ('defined' in type) {
      // Resolve type reference
      const typeDef = resolveTypeReference(context.idl, type);
      if (!typeDef) {
        throw new Error(`Type definition not found: ${type.defined}`);
      }

      // Check if we've already resolved this type (avoid infinite recursion)
      if (context.resolvedTypes.has(type.defined)) {
        const resolved = context.resolvedTypes.get(type.defined)!;
        return typeDefToEncoder(resolved, context);
      }

      context.resolvedTypes.set(type.defined, typeDef);
      return typeDefToEncoder(typeDef, context);
    }
  }

  throw new Error(`Unsupported IDL type: ${JSON.stringify(type)}`);
}

/**
 * Convert a type definition to an encoder.
 */
function typeDefToEncoder(typeDef: IdlTypeDef, context: SerializationContext): Encoder<unknown> {
  if (typeDef.type.kind === 'struct') {
    if (!typeDef.type.fields) {
      throw new Error(`Struct ${typeDef.name} must have fields`);
    }

    const fieldEncoders: Array<readonly [string, Encoder<unknown>]> = typeDef.type.fields.map(
      (field) => [field.name, idlTypeToEncoder(field.type, context)] as const
    );

    return getStructEncoder(fieldEncoders) as Encoder<unknown>;
  }

  if (typeDef.type.kind === 'enum') {
    // Enums are typically encoded as a u8 discriminator + variant data
    // For now, we'll handle simple enums (just discriminator)
    // Complex enums with data would need more sophisticated handling
    return getU8Encoder() as Encoder<unknown>;
  }

  throw new Error(`Unsupported type definition kind: ${typeDef.type.kind}`);
}

/**
 * Convert an IDL type to a @solana/codecs decoder.
 *
 * @param type - IDL type definition
 * @param context - Serialization context
 * @returns Decoder for the type
 */
export function idlTypeToDecoder(type: IdlType, context: SerializationContext): Decoder<unknown> {
  // Handle primitive types
  if (typeof type === 'string') {
    switch (type) {
      case 'bool':
        return getBooleanDecoder() as Decoder<unknown>;
      case 'u8':
        return getU8Decoder() as Decoder<unknown>;
      case 'u16':
        return getU16Decoder() as Decoder<unknown>;
      case 'u32':
        return getU32Decoder() as Decoder<unknown>;
      case 'u64':
        return getU64Decoder() as Decoder<unknown>;
      case 'u128':
        return getU128Decoder() as Decoder<unknown>;
      case 'i8':
        return getI8Decoder() as Decoder<unknown>;
      case 'i16':
        return getI16Decoder() as Decoder<unknown>;
      case 'i32':
        return getI32Decoder() as Decoder<unknown>;
      case 'i64':
        return getI64Decoder() as Decoder<unknown>;
      case 'i128':
        return getI128Decoder() as Decoder<unknown>;
      case 'f32':
        return getF32Decoder() as Decoder<unknown>;
      case 'f64':
        return getF64Decoder() as Decoder<unknown>;
      case 'string':
        return getBytesDecoder() as Decoder<unknown>;
      case 'publicKey':
        return getAddressDecoder() as Decoder<unknown>;
      case 'bytes':
        return getBytesDecoder() as Decoder<unknown>;
      default:
        throw new Error(`Unsupported primitive type: ${type}`);
    }
  }

  // Handle complex types
  if (typeof type === 'object' && type !== null) {
    if ('vec' in type) {
      const itemDecoder = idlTypeToDecoder(type.vec, context);
      return getArrayDecoder(itemDecoder) as Decoder<unknown>;
    }

    if ('option' in type) {
      const itemDecoder = idlTypeToDecoder(type.option, context);
      return getOptionDecoder(itemDecoder) as Decoder<unknown>;
    }

    if ('coption' in type && type.coption) {
      const itemDecoder = idlTypeToDecoder(type.coption, context);
      return getOptionDecoder(itemDecoder) as Decoder<unknown>;
    }

    if ('array' in type) {
      const [itemType, length] = type.array;
      const itemDecoder = idlTypeToDecoder(itemType, context);
      return getArrayDecoder(itemDecoder, { size: length }) as Decoder<unknown>;
    }

    if ('tuple' in type) {
      const tupleDecoders = type.tuple.map((t) => idlTypeToDecoder(t, context));
      return getTupleDecoder(tupleDecoders) as Decoder<unknown>;
    }

    if ('defined' in type) {
      const typeDef = resolveTypeReference(context.idl, type);
      if (!typeDef) {
        throw new Error(`Type definition not found: ${type.defined}`);
      }

      if (context.resolvedTypes.has(type.defined)) {
        const resolved = context.resolvedTypes.get(type.defined)!;
        return typeDefToDecoder(resolved, context);
      }

      context.resolvedTypes.set(type.defined, typeDef);
      return typeDefToDecoder(typeDef, context);
    }
  }

  throw new Error(`Unsupported IDL type: ${JSON.stringify(type)}`);
}

/**
 * Convert a type definition to a decoder.
 */
function typeDefToDecoder(typeDef: IdlTypeDef, context: SerializationContext): Decoder<unknown> {
  if (typeDef.type.kind === 'struct') {
    if (!typeDef.type.fields) {
      throw new Error(`Struct ${typeDef.name} must have fields`);
    }

    const fieldDecoders: Array<readonly [string, Decoder<unknown>]> = typeDef.type.fields.map(
      (field) => [field.name, idlTypeToDecoder(field.type, context)] as const
    );

    return getStructDecoder(fieldDecoders) as Decoder<unknown>;
  }

  if (typeDef.type.kind === 'enum') {
    return getU8Decoder() as Decoder<unknown>;
  }

  throw new Error(`Unsupported type definition kind: ${typeDef.type.kind}`);
}

/**
 * Encode instruction data with discriminator.
 *
 * @param instruction - Instruction definition
 * @param params - Instruction parameters
 * @param context - Serialization context
 * @returns Encoded instruction data
 */
export function encodeInstructionData(
  instruction: IdlInstruction,
  params: Record<string, unknown>,
  context: SerializationContext
): Uint8Array {
  // Check if pre-encoded instruction data is provided (e.g., from Jupiter API)
  // This allows plugins to provide their own instruction data instead of encoding from params
  if (params.__jupiterInstructionData && typeof params.__jupiterInstructionData === 'string') {
    // Jupiter returns instruction data as base64 string
    try {
      const decoded = Uint8Array.from(atob(params.__jupiterInstructionData), c => c.charCodeAt(0));
      console.log('[Serializer] Using pre-encoded Jupiter instruction data, length:', decoded.length);
      return decoded;
    } catch (error) {
      console.warn('[Serializer] Failed to decode Jupiter instruction data, falling back to IDL encoding:', error);
      // Fall through to normal encoding
    }
  }
  
  // Log discriminator information for debugging
  if (instruction.discriminant) {
    console.log('[Serializer] Encoding instruction with discriminator:', {
      instructionName: instruction.name,
      discriminantType: instruction.discriminant.type,
      discriminantValue:
        instruction.discriminant.type === 'bytes' && Array.isArray(instruction.discriminant.value)
          ? `[${instruction.discriminant.value.join(', ')}]`
          : instruction.discriminant.value,
    });
  }
  
  const encoder = createInstructionEncoder(instruction, context);
  
  // Filter params to only include fields defined in instruction.args
  // This removes non-IDL parameters like inputMint, outputMint, poolAddress, etc.
  const validArgNames = new Set(instruction.args.map(arg => arg.name));
  const filteredParams: Record<string, unknown> = {};
  
  for (const [key, value] of Object.entries(params)) {
    if (validArgNames.has(key)) {
      filteredParams[key] = value;
    }
  }
  
  console.log('[Serializer] Filtered params:', {
    instructionName: instruction.name,
    originalKeys: Object.keys(params),
    filteredKeys: Object.keys(filteredParams),
    expectedArgs: instruction.args.map(arg => arg.name),
  });
  
  // Validate that all required parameters are present and not undefined
  const missingParams: string[] = [];
  for (const arg of instruction.args) {
    if (!(arg.name in filteredParams) || filteredParams[arg.name] === undefined) {
      missingParams.push(arg.name);
    }
  }
  
  if (missingParams.length > 0) {
    throw new Error(
      `Missing required parameters for instruction ${instruction.name}: ${missingParams.join(', ')}. ` +
      `Provided params: ${Object.keys(params).join(', ')}`
    );
  }
  
  // If discriminator is present, the encoder expects it in the params
  // For byte array discriminators, pass the array; for single-byte, pass the number
  const paramsWithDiscriminator = instruction.discriminant
    ? {
        discriminator:
          instruction.discriminant.type === 'bytes' && Array.isArray(instruction.discriminant.value)
            ? instruction.discriminant.value
            : instruction.discriminant.value,
        ...filteredParams,
      }
    : filteredParams;
  
  // Convert ReadonlyUint8Array to Uint8Array
  // Type assertion needed because encoder expects specific types, but we're using Record<string, unknown>
  try {
    console.log('[Serializer] About to encode with discriminator:', {
      instructionName: instruction.name,
      hasDiscriminant: !!instruction.discriminant,
      discriminantType: instruction.discriminant?.type,
      discriminantValue: instruction.discriminant?.value,
      paramsWithDiscriminator,
    });
    
    const encoded = encoder.encode(paramsWithDiscriminator as Record<string, unknown>);
    const result = new Uint8Array(encoded);
    
    // Log encoded instruction data for debugging
    console.log('[Serializer] Encoded instruction data:', {
      instructionName: instruction.name,
      totalLength: result.length,
      firstBytes: `[${Array.from(result.slice(0, Math.min(32, result.length))).join(', ')}]`,
      discriminatorBytes: instruction.discriminant ? `[${Array.from(result.slice(0, 8)).join(', ')}]` : 'none',
      expectedDiscriminator: instruction.discriminant?.type === 'bytes' && Array.isArray(instruction.discriminant.value) 
        ? `[${instruction.discriminant.value.join(', ')}]` 
        : instruction.discriminant?.value,
    });
    
    return result;
  } catch (error) {
    // Provide more helpful error message if encoding fails
    if (error instanceof TypeError && error.message.includes('BigInt')) {
      const undefinedParams: string[] = [];
      for (const arg of instruction.args) {
        const value = params[arg.name];
        if (value === undefined || value === null) {
          undefinedParams.push(`${arg.name} (${JSON.stringify(arg.type)})`);
        }
      }
      throw new Error(
        `Failed to encode instruction ${instruction.name}: Cannot convert undefined/null to BigInt. ` +
        `Check these parameters: ${undefinedParams.join(', ')}`
      );
    }
    throw error;
  }
}
