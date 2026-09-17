/**
 * Tests for compute unit estimation and configuration.
 */

import { describe, it, expect } from 'vitest';
import {
    DEFAULT_COMPUTE_UNIT_LIMIT,
    MAX_COMPUTE_UNIT_LIMIT,
    DEFAULT_COMPUTE_BUFFER,
    MAX_LOADED_ACCOUNTS_DATA_SIZE_LIMIT,
    LOADED_ACCOUNTS_DATA_SIZE_PAGE,
    roundUpToLoadedAccountsDataSizePage,
    applyBuffer,
    estimateComputeUnits,
    shouldAddComputeUnitInstruction,
    getComputeUnitLimit,
} from '../compute-units.js';

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

describe('applyBuffer', () => {
    it('is exact where naive float multiplication is not', () => {
        expect(100_000 * 1.1).not.toBe(110_000); // the IEEE artifact this guards against
        expect(applyBuffer(100_000, 1.1)).toBe(110_000);
        expect(applyBuffer(200_000, 1.1)).toBe(220_000);
    });

    it('rounds up fractional results', () => {
        expect(applyBuffer(3, 1.1)).toBe(4);
        expect(applyBuffer(100_000, 1)).toBe(100_000);
    });
});

describe('roundUpToLoadedAccountsDataSizePage', () => {
    it('never returns less than one 32 KiB page', () => {
        expect(roundUpToLoadedAccountsDataSizePage(0)).toBe(LOADED_ACCOUNTS_DATA_SIZE_PAGE);
        expect(roundUpToLoadedAccountsDataSizePage(1)).toBe(32_768);
    });

    it('keeps exact page multiples and rounds everything else up', () => {
        expect(roundUpToLoadedAccountsDataSizePage(32_768)).toBe(32_768);
        expect(roundUpToLoadedAccountsDataSizePage(32_769)).toBe(65_536);
        expect(roundUpToLoadedAccountsDataSizePage(44_000)).toBe(65_536);
    });

    it('caps at the 64 MiB runtime maximum', () => {
        expect(roundUpToLoadedAccountsDataSizePage(MAX_LOADED_ACCOUNTS_DATA_SIZE_LIMIT + 1)).toBe(
            MAX_LOADED_ACCOUNTS_DATA_SIZE_LIMIT,
        );
    });
});

describe('constants', () => {
    it('should have correct default values', () => {
        expect(DEFAULT_COMPUTE_UNIT_LIMIT).toBe(200_000);
        expect(MAX_COMPUTE_UNIT_LIMIT).toBe(1_400_000);
        expect(DEFAULT_COMPUTE_BUFFER).toBe(1.1);
        expect(LOADED_ACCOUNTS_DATA_SIZE_PAGE).toBe(32 * 1024);
    });
});
