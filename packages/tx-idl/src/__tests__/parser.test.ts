/**
 * Tests for IDL parsing and validation.
 */

import { describe, it, expect } from 'vitest';
import { parseIdl, IdlValidationError } from '../parser.js';

describe('parseIdl', () => {
  it('should parse valid IDL', () => {
    const idl = {
      version: '0.1.0',
      name: 'test_program',
      instructions: [
        {
          name: 'transfer',
          accounts: [
            {
              name: 'from',
              isMut: true,
              isSigner: true,
            },
          ],
          args: [
            {
              name: 'amount',
              type: 'u64',
            },
          ],
        },
      ],
    };

    const parsed = parseIdl(idl);
    expect(parsed.version).toBe('0.1.0');
    expect(parsed.name).toBe('test_program');
    expect(parsed.instructions).toHaveLength(1);
    expect(parsed.instructions[0].name).toBe('transfer');
  });

  it('should throw on invalid IDL', () => {
    expect(() => {
      parseIdl(null);
    }).toThrow(IdlValidationError);

    expect(() => {
      parseIdl({});
    }).toThrow(IdlValidationError);

    expect(() => {
      parseIdl({
        version: '0.1.0',
        name: 'test',
        // Missing instructions
      });
    }).toThrow(IdlValidationError);
  });

  it('should parse complex types', () => {
    const idl = {
      version: '0.1.0',
      name: 'test_program',
      instructions: [
        {
          name: 'complex',
          accounts: [],
          args: [
            {
              name: 'vec',
              type: { vec: 'u8' },
            },
            {
              name: 'option',
              type: { option: 'string' },
            },
            {
              name: 'array',
              type: { array: ['u8', 10] },
            },
            {
              name: 'tuple',
              type: { tuple: ['u64', 'string'] },
            },
            {
              name: 'defined',
              type: { defined: 'MyType' },
            },
          ],
        },
      ],
    };

    const parsed = parseIdl(idl);
    expect(parsed.instructions[0].args).toHaveLength(5);
  });
});

