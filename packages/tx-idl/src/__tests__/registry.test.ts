/**
 * Tests for IDL registry and instruction building.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { IdlProgramRegistry } from '../registry.js';
import type { ProgramIdl } from '../types.js';

// Simple test IDL with minimal instructions
const testIdl: ProgramIdl = {
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
        {
          name: 'to',
          isMut: true,
          isSigner: false,
        },
      ],
      args: [
        {
          name: 'amount',
          type: 'u64',
        },
      ],
      discriminant: {
        type: 'u8',
        value: 0,
      },
    },
    {
      name: 'createAccount',
      accounts: [
        {
          name: 'payer',
          isMut: true,
          isSigner: true,
        },
        {
          name: 'newAccount',
          isMut: true,
          isSigner: false,
        },
      ],
      args: [
        {
          name: 'space',
          type: 'u64',
        },
      ],
      discriminant: {
        type: 'u8',
        value: 1,
      },
    },
  ],
  metadata: {
    address: 'TestProgram1111111111111111111111111111111111',
  },
};

describe('IdlProgramRegistry', () => {
  let registry: IdlProgramRegistry;

  beforeEach(() => {
    registry = new IdlProgramRegistry();
  });

  describe('registerProgramFromJson', () => {
    it('should register a program from IDL JSON', () => {
      registry.registerProgramFromJson(
        'TestProgram1111111111111111111111111111111111' as any,
        testIdl
      );

      expect(registry.isRegistered('TestProgram1111111111111111111111111111111111' as any)).toBe(
        true
      );
    });

    it('should create builders for all instructions', () => {
      registry.registerProgramFromJson(
        'TestProgram1111111111111111111111111111111111' as any,
        testIdl
      );

      const instructions = registry.getInstructions(
        'TestProgram1111111111111111111111111111111111' as any
      );
      expect(instructions).toHaveLength(2);
      expect(instructions[0].name).toBe('transfer');
      expect(instructions[1].name).toBe('createAccount');
    });
  });

  describe('getInstructions', () => {
    it('should return instructions for registered program', () => {
      registry.registerProgramFromJson(
        'TestProgram1111111111111111111111111111111111' as any,
        testIdl
      );

      const instructions = registry.getInstructions(
        'TestProgram1111111111111111111111111111111111' as any
      );
      expect(instructions).toHaveLength(2);
    });

    it('should throw if program not registered', () => {
      expect(() => {
        registry.getInstructions('UnknownProgram111111111111111111111111111111' as any);
      }).toThrow('not registered');
    });
  });

  describe('getInstructionBuilder', () => {
    it('should return builder for instruction', () => {
      registry.registerProgramFromJson(
        'TestProgram1111111111111111111111111111111111' as any,
        testIdl
      );

      const builder = registry.getInstructionBuilder(
        'TestProgram1111111111111111111111111111111111' as any,
        'transfer'
      );

      expect(builder).toBeDefined();
      const schema = builder.getParamSchema();
      expect(schema.properties).toHaveProperty('amount');
      expect(schema.properties?.amount.type).toBe('number');
    });

    it('should throw if instruction not found', () => {
      registry.registerProgramFromJson(
        'TestProgram1111111111111111111111111111111111' as any,
        testIdl
      );

      expect(() => {
        registry.getInstructionBuilder(
          'TestProgram1111111111111111111111111111111111' as any,
          'nonexistent'
        );
      }).toThrow('not found');
    });
  });

  describe('getAccountRequirements', () => {
    it('should return account requirements', () => {
      registry.registerProgramFromJson(
        'TestProgram1111111111111111111111111111111111' as any,
        testIdl
      );

      const builder = registry.getInstructionBuilder(
        'TestProgram1111111111111111111111111111111111' as any,
        'transfer'
      );

      const requirements = builder.getAccountRequirements();
      expect(requirements).toHaveLength(2);
      expect(requirements[0].name).toBe('from');
      expect(requirements[0].isSigner).toBe(true);
      expect(requirements[0].isMut).toBe(true);
      expect(requirements[1].name).toBe('to');
      expect(requirements[1].isSigner).toBe(false);
      expect(requirements[1].isMut).toBe(true);
    });
  });
});

