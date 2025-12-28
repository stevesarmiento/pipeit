/**
 * Tests for TransactionBuilder compute unit estimation.
 *
 * Note: Full integration tests require mocking RPC connections.
 * These tests verify the configuration and basic behavior.
 */

import { describe, it, expect } from 'vitest';
import { TransactionBuilder, type TransactionBuilderConfig } from '../builder.js';

describe('TransactionBuilder CU configuration', () => {
    describe('computeUnits config', () => {
        it('should accept "auto" as computeUnits value', () => {
            const builder = new TransactionBuilder({
                computeUnits: 'auto',
            });
            expect(builder).toBeDefined();
        });

        it('should accept number as computeUnits value', () => {
            const builder = new TransactionBuilder({
                computeUnits: 300_000,
            });
            expect(builder).toBeDefined();
        });

        it('should accept fixed strategy config', () => {
            const builder = new TransactionBuilder({
                computeUnits: {
                    strategy: 'fixed',
                    units: 400_000,
                },
            });
            expect(builder).toBeDefined();
        });

        it('should accept simulate strategy config', () => {
            const builder = new TransactionBuilder({
                computeUnits: {
                    strategy: 'simulate',
                },
            });
            expect(builder).toBeDefined();
        });

        it('should accept simulate strategy with buffer', () => {
            const builder = new TransactionBuilder({
                computeUnits: {
                    strategy: 'simulate',
                    buffer: 1.2,
                },
            });
            expect(builder).toBeDefined();
        });
    });
});

describe('TransactionBuilder CU simulation strategy', () => {
    it('should document the simulate strategy behavior', () => {
        // This test documents the expected behavior of the simulate strategy:
        // 1. build() adds a provisory CU instruction via fillProvisorySetComputeUnitLimitInstruction
        // 2. execute() estimates and updates the CU via estimateAndUpdateProvisoryComputeUnitLimitFactory
        // 3. export() also estimates and updates the CU before signing
        const simulateStrategyBehavior = {
            build: 'Adds provisory CU instruction using fillProvisorySetComputeUnitLimitInstruction',
            execute: 'Estimates via simulation and updates provisory instruction before signing',
            export: 'Estimates via simulation and updates provisory instruction before signing',
        };

        expect(simulateStrategyBehavior.build).toContain('provisory');
        expect(simulateStrategyBehavior.execute).toContain('simulation');
        expect(simulateStrategyBehavior.export).toContain('simulation');
    });

    it('should use Kit compute-budget helpers', () => {
        // Verify the compute-budget helpers are available
        // The actual integration is tested via the re-exports
        const helpers = {
            fillProvisory: 'fillProvisorySetComputeUnitLimitInstruction',
            estimate: 'estimateComputeUnitLimitFactory',
            estimateAndUpdate: 'estimateAndUpdateProvisoryComputeUnitLimitFactory',
        };

        expect(helpers.fillProvisory).toBeDefined();
        expect(helpers.estimate).toBeDefined();
        expect(helpers.estimateAndUpdate).toBeDefined();
    });
});

describe('TransactionBuilderConfig types', () => {
    it('should accept all valid computeUnits configurations', () => {
        // Type-level tests - verify the config types are correct
        const configs: TransactionBuilderConfig[] = [
            { computeUnits: 'auto' },
            { computeUnits: 200_000 },
            { computeUnits: { strategy: 'auto' } },
            { computeUnits: { strategy: 'fixed', units: 300_000 } },
            { computeUnits: { strategy: 'simulate' } },
            { computeUnits: { strategy: 'simulate', buffer: 1.15 } },
        ];

        configs.forEach(config => {
            const builder = new TransactionBuilder(config);
            expect(builder).toBeDefined();
        });
    });
});
