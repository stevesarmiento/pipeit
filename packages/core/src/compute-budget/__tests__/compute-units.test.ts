/**
 * Tests for compute unit estimation and configuration.
 */

import { describe, it, expect } from 'vitest';
import {
    DEFAULT_COMPUTE_UNIT_LIMIT,
    MAX_COMPUTE_UNIT_LIMIT,
    DEFAULT_COMPUTE_BUFFER,
    createSetComputeUnitLimitInstruction,
    estimateComputeUnits,
    shouldAddComputeUnitInstruction,
    getComputeUnitLimit,
} from '../compute-units.js';
import { COMPUTE_BUDGET_PROGRAM } from '../priority-fees.js';

describe('createSetComputeUnitLimitInstruction', () => {
    it('should create instruction with specified units', () => {
        const instruction = createSetComputeUnitLimitInstruction(300_000);

        expect(instruction.programAddress).toBe(COMPUTE_BUDGET_PROGRAM);
        expect(instruction.accounts).toHaveLength(0);
        expect(instruction.data[0]).toBe(2); // SetComputeUnitLimit discriminator
    });

    it('should clamp units to MAX_COMPUTE_UNIT_LIMIT', () => {
        const instruction = createSetComputeUnitLimitInstruction(2_000_000);

        // Read the u32 from bytes 1-4
        const dataView = new DataView(instruction.data.buffer);
        const units = dataView.getUint32(1, true);

        expect(units).toBe(MAX_COMPUTE_UNIT_LIMIT);
    });

    it('should encode units as little-endian u32', () => {
        const instruction = createSetComputeUnitLimitInstruction(400_000);

        const dataView = new DataView(instruction.data.buffer);
        const units = dataView.getUint32(1, true);

        expect(units).toBe(400_000);
    });
});

describe('estimateComputeUnits', () => {
    it('should return fixed units when strategy is fixed', () => {
        const estimate = estimateComputeUnits(undefined, {
            strategy: 'fixed',
            units: 250_000,
        });

        expect(estimate.units).toBe(250_000);
        expect(estimate.buffer).toBe(1);
    });

    it('should return default when strategy is fixed without units', () => {
        const estimate = estimateComputeUnits(undefined, {
            strategy: 'fixed',
        });

        expect(estimate.units).toBe(DEFAULT_COMPUTE_UNIT_LIMIT);
    });

    it('should return default when strategy is auto', () => {
        const estimate = estimateComputeUnits(undefined, {
            strategy: 'auto',
        });

        expect(estimate.units).toBe(DEFAULT_COMPUTE_UNIT_LIMIT);
        expect(estimate.buffer).toBe(1);
    });

    it('should apply buffer to simulated units for simulate strategy', () => {
        const simulatedUnits = 150_000n;
        const buffer = 1.2;

        const estimate = estimateComputeUnits(simulatedUnits, {
            strategy: 'simulate',
            buffer,
        });

        expect(estimate.units).toBe(Math.ceil(150_000 * 1.2));
        expect(estimate.simulatedUnits).toBe(simulatedUnits);
        expect(estimate.buffer).toBe(buffer);
    });

    it('should use default buffer for simulate strategy', () => {
        const simulatedUnits = 100_000n;

        const estimate = estimateComputeUnits(simulatedUnits, {
            strategy: 'simulate',
        });

        expect(estimate.units).toBe(Math.ceil(100_000 * DEFAULT_COMPUTE_BUFFER));
        expect(estimate.buffer).toBe(DEFAULT_COMPUTE_BUFFER);
    });

    it('should return default when simulate strategy but no simulation data', () => {
        const estimate = estimateComputeUnits(undefined, {
            strategy: 'simulate',
        });

        expect(estimate.units).toBe(DEFAULT_COMPUTE_UNIT_LIMIT);
    });

    it('should clamp simulated units to MAX_COMPUTE_UNIT_LIMIT', () => {
        const simulatedUnits = 1_500_000n;

        const estimate = estimateComputeUnits(simulatedUnits, {
            strategy: 'simulate',
            buffer: 1.1,
        });

        expect(estimate.units).toBe(MAX_COMPUTE_UNIT_LIMIT);
    });
});

describe('shouldAddComputeUnitInstruction', () => {
    it('should return false for auto strategy', () => {
        expect(shouldAddComputeUnitInstruction({ strategy: 'auto' })).toBe(false);
    });

    it('should return true for fixed strategy', () => {
        expect(shouldAddComputeUnitInstruction({ strategy: 'fixed' })).toBe(true);
    });

    it('should return true for simulate strategy', () => {
        expect(shouldAddComputeUnitInstruction({ strategy: 'simulate' })).toBe(true);
    });
});

describe('getComputeUnitLimit', () => {
    it('should return configured units for fixed strategy', () => {
        const limit = getComputeUnitLimit({ strategy: 'fixed', units: 500_000 });
        expect(limit).toBe(500_000);
    });

    it('should include simulated units with buffer', () => {
        const limit = getComputeUnitLimit({ strategy: 'simulate', buffer: 1.1 }, 200_000n);
        expect(limit).toBe(Math.ceil(200_000 * 1.1));
    });
});

describe('constants', () => {
    it('should have correct default values', () => {
        expect(DEFAULT_COMPUTE_UNIT_LIMIT).toBe(200_000);
        expect(MAX_COMPUTE_UNIT_LIMIT).toBe(1_400_000);
        expect(DEFAULT_COMPUTE_BUFFER).toBe(1.1);
    });
});
