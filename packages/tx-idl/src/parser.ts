/**
 * IDL parser and validator.
 *
 * @packageDocumentation
 */

import type {
  ProgramIdl,
  IdlInstruction,
  IdlType,
  IdlTypeDef,
  IdlEnumVariant,
  IdlAccountDef,
  IdlErrorCode,
  IdlAccountItem,
  IdlField,
  PdaSeed,
} from './types.js';

/**
 * Validation errors for IDL parsing.
 */
export class IdlValidationError extends Error {
  constructor(message: string, public readonly path?: string) {
    super(message);
    this.name = 'IdlValidationError';
  }
}

/**
 * Parse and validate an IDL structure.
 *
 * @param idl - Raw IDL object
 * @returns Validated and normalized IDL
 * @throws IdlValidationError if IDL is invalid
 */
export function parseIdl(idl: unknown): ProgramIdl {
  if (!idl || typeof idl !== 'object') {
    throw new IdlValidationError('IDL must be an object');
  }

  const idlObj = idl as Record<string, unknown>;

  // Validate required fields
  if (typeof idlObj.version !== 'string') {
    throw new IdlValidationError('IDL must have a version string');
  }

  if (typeof idlObj.name !== 'string') {
    throw new IdlValidationError('IDL must have a name string');
  }

  if (!Array.isArray(idlObj.instructions)) {
    throw new IdlValidationError('IDL must have an instructions array');
  }

  // Parse instructions
  const instructions = idlObj.instructions.map((inst, index) =>
    parseInstruction(inst, `instructions[${index}]`)
  );

  // Parse optional fields
  const accounts: IdlAccountDef[] | undefined = idlObj.accounts
    ? Array.isArray(idlObj.accounts)
      ? idlObj.accounts.map((acc, index) => parseAccountDef(acc, `accounts[${index}]`))
      : undefined
    : undefined;

  const types: IdlTypeDef[] | undefined = idlObj.types
    ? Array.isArray(idlObj.types)
      ? idlObj.types.map((type, index) => parseTypeDef(type, `types[${index}]`))
      : undefined
    : undefined;

  const errors: IdlErrorCode[] | undefined = idlObj.errors
    ? Array.isArray(idlObj.errors)
      ? idlObj.errors.map((err, index) => parseErrorCode(err, `errors[${index}]`))
      : undefined
    : undefined;

  const metadata: { address: string } | undefined = idlObj.metadata
    ? typeof idlObj.metadata === 'object' && idlObj.metadata !== null
      ? typeof (idlObj.metadata as Record<string, unknown>).address === 'string'
        ? {
            address: (idlObj.metadata as Record<string, unknown>).address as string,
          }
        : undefined
      : undefined
    : undefined;

  const result: ProgramIdl = {
    version: idlObj.version,
    name: idlObj.name,
    instructions,
  };

  if (accounts) {
    result.accounts = accounts;
  }
  if (types) {
    result.types = types;
  }
  if (errors) {
    result.errors = errors;
  }
  if (metadata) {
    result.metadata = metadata;
  }

  return result;
}

/**
 * Parse an instruction definition.
 */
function parseInstruction(inst: unknown, path: string): IdlInstruction {
  if (!inst || typeof inst !== 'object') {
    throw new IdlValidationError(`Instruction at ${path} must be an object`);
  }

  const instObj = inst as Record<string, unknown>;

  if (typeof instObj.name !== 'string') {
    throw new IdlValidationError(`Instruction at ${path} must have a name`);
  }

  if (!Array.isArray(instObj.accounts)) {
    throw new IdlValidationError(`Instruction at ${path} must have accounts array`);
  }

  if (!Array.isArray(instObj.args)) {
    throw new IdlValidationError(`Instruction at ${path} must have args array`);
  }

  const accounts = instObj.accounts.map((acc, index) =>
    parseAccountItem(acc, `${path}.accounts[${index}]`)
  );

  const args = instObj.args.map((arg, index) => parseField(arg, `${path}.args[${index}]`));

  const discriminant = instObj.discriminant
    ? parseDiscriminant(instObj.discriminant, `${path}.discriminant`)
    : undefined;

  const docs = instObj.docs
    ? Array.isArray(instObj.docs)
      ? instObj.docs.map((doc) => (typeof doc === 'string' ? doc : String(doc)))
      : undefined
    : undefined;

  const result: IdlInstruction = {
    name: instObj.name,
    accounts,
    args,
  };

  if (discriminant) {
    result.discriminant = discriminant;
  }

  if (docs) {
    result.docs = docs;
  }

  return result;
}

/**
 * Parse an account item.
 */
function parseAccountItem(acc: unknown, path: string) {
  if (!acc || typeof acc !== 'object') {
    throw new IdlValidationError(`Account at ${path} must be an object`);
  }

  const accObj = acc as Record<string, unknown>;

  if (typeof accObj.name !== 'string') {
    throw new IdlValidationError(`Account at ${path} must have a name`);
  }

  if (typeof accObj.isMut !== 'boolean') {
    throw new IdlValidationError(`Account at ${path} must have isMut boolean`);
  }

  if (typeof accObj.isSigner !== 'boolean') {
    throw new IdlValidationError(`Account at ${path} must have isSigner boolean`);
  }

  const result: IdlAccountItem = {
    name: accObj.name,
    isMut: accObj.isMut,
    isSigner: accObj.isSigner,
  };

  if (typeof accObj.isOptional === 'boolean') {
    result.isOptional = accObj.isOptional;
  }

  const docs = Array.isArray(accObj.docs)
    ? accObj.docs.map((doc) => (typeof doc === 'string' ? doc : String(doc)))
    : undefined;
  if (docs) {
    result.docs = docs;
  }

  if (accObj.pda) {
    result.pda = parsePda(accObj.pda, `${path}.pda`);
  }

  return result;
}

/**
 * Parse a field definition.
 */
function parseField(field: unknown, path: string) {
  if (!field || typeof field !== 'object') {
    throw new IdlValidationError(`Field at ${path} must be an object`);
  }

  const fieldObj = field as Record<string, unknown>;

  if (typeof fieldObj.name !== 'string') {
    throw new IdlValidationError(`Field at ${path} must have a name`);
  }

  const type = parseType(fieldObj.type, `${path}.type`);

  const result: IdlField = {
    name: fieldObj.name,
    type,
  };

  const docs = Array.isArray(fieldObj.docs)
    ? fieldObj.docs.map((doc) => (typeof doc === 'string' ? doc : String(doc)))
    : undefined;
  if (docs) {
    result.docs = docs;
  }

  return result;
}

/**
 * Parse an IDL type.
 */
function parseType(type: unknown, path: string): IdlType {
  if (typeof type === 'string') {
    // Primitive type
    return type as IdlType;
  }

  if (typeof type === 'object' && type !== null) {
    const typeObj = type as Record<string, unknown>;

    if ('vec' in typeObj) {
      return { vec: parseType(typeObj.vec, `${path}.vec`) };
    }

    if ('option' in typeObj) {
      return { option: parseType(typeObj.option, `${path}.option`) };
    }

    if ('coption' in typeObj) {
      return { coption: parseType(typeObj.coption, `${path}.coption`) };
    }

    if ('array' in typeObj && Array.isArray(typeObj.array)) {
      const arr = typeObj.array as [unknown, unknown];
      return { array: [parseType(arr[0], `${path}.array[0]`), Number(arr[1])] };
    }

    if ('tuple' in typeObj && Array.isArray(typeObj.tuple)) {
      return {
        tuple: typeObj.tuple.map((t, i) => parseType(t, `${path}.tuple[${i}]`)),
      };
    }

    if ('defined' in typeObj && typeof typeObj.defined === 'string') {
      return { defined: typeObj.defined };
    }
  }

  throw new IdlValidationError(`Invalid type at ${path}`);
}

/**
 * Parse a discriminant.
 */
function parseDiscriminant(disc: unknown, path: string) {
  if (!disc || typeof disc !== 'object') {
    throw new IdlValidationError(`Discriminant at ${path} must be an object`);
  }

  const discObj = disc as Record<string, unknown>;

  if (typeof discObj.type !== 'string') {
    throw new IdlValidationError(`Discriminant at ${path} must have a type`);
  }

  if (typeof discObj.value !== 'number') {
    throw new IdlValidationError(`Discriminant at ${path} must have a numeric value`);
  }

  return {
    type: discObj.type,
    value: discObj.value,
  };
}

/**
 * Parse a PDA definition.
 */
function parsePda(pda: unknown, path: string): { seeds: PdaSeed[] } {
  if (!pda || typeof pda !== 'object') {
    throw new IdlValidationError(`PDA at ${path} must be an object`);
  }

  const pdaObj = pda as Record<string, unknown>;

  if (!Array.isArray(pdaObj.seeds)) {
    throw new IdlValidationError(`PDA at ${path} must have seeds array`);
  }

  // Simplified PDA parsing - full implementation would parse seed types
  // For now, cast to PdaSeed[] - proper parsing would validate each seed
  return {
    seeds: pdaObj.seeds as PdaSeed[],
  };
}

/**
 * Parse an account type definition.
 */
function parseAccountDef(acc: unknown, path: string): IdlAccountDef {
  if (!acc || typeof acc !== 'object') {
    throw new IdlValidationError(`Account def at ${path} must be an object`);
  }

  const accObj = acc as Record<string, unknown>;

  if (typeof accObj.name !== 'string') {
    throw new IdlValidationError(`Account def at ${path} must have a name`);
  }

  const result: IdlAccountDef = {
    name: accObj.name,
    type: accObj.type as { kind: 'struct' | 'enum'; fields?: IdlField[]; variants?: IdlEnumVariant[] },
  };

  const docs = Array.isArray(accObj.docs)
    ? accObj.docs.map((doc) => (typeof doc === 'string' ? doc : String(doc)))
    : undefined;
  if (docs) {
    result.docs = docs;
  }

  return result;
}

/**
 * Parse a type definition.
 */
function parseTypeDef(type: unknown, path: string): IdlTypeDef {
  if (!type || typeof type !== 'object') {
    throw new IdlValidationError(`Type def at ${path} must be an object`);
  }

  const typeObj = type as Record<string, unknown>;

  if (typeof typeObj.name !== 'string') {
    throw new IdlValidationError(`Type def at ${path} must have a name`);
  }

  const result: IdlTypeDef = {
    name: typeObj.name,
    type: typeObj.type as { kind: 'struct' | 'enum'; fields?: IdlField[]; variants?: IdlEnumVariant[] },
  };

  const docs = Array.isArray(typeObj.docs)
    ? typeObj.docs.map((doc) => (typeof doc === 'string' ? doc : String(doc)))
    : undefined;
  if (docs) {
    result.docs = docs;
  }

  return result;
}

/**
 * Parse an error code.
 */
function parseErrorCode(err: unknown, path: string) {
  if (!err || typeof err !== 'object') {
    throw new IdlValidationError(`Error code at ${path} must be an object`);
  }

  const errObj = err as Record<string, unknown>;

  if (typeof errObj.code !== 'number') {
    throw new IdlValidationError(`Error code at ${path} must have a numeric code`);
  }

  if (typeof errObj.name !== 'string') {
    throw new IdlValidationError(`Error code at ${path} must have a name`);
  }

  if (typeof errObj.msg !== 'string') {
    throw new IdlValidationError(`Error code at ${path} must have a msg`);
  }

  return {
    code: errObj.code,
    name: errObj.name,
    msg: errObj.msg,
  };
}

/**
 * Resolve a type reference (e.g., { defined: "TypeName" }).
 * Looks up the type definition in the IDL's types array.
 */
export function resolveTypeReference(
  idl: ProgramIdl,
  typeRef: { defined: string }
): IdlTypeDef | undefined {
  if (!idl.types) {
    return undefined;
  }

  return idl.types.find((type) => type.name === typeRef.defined);
}

