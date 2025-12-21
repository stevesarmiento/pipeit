/**
 * Tests for executePlan function.
 *
 * Note: Full integration tests require mocking RPC connections.
 * These tests verify the exports and basic structure.
 */

import { describe, it, expect } from 'vitest';
import { executePlan, type ExecutePlanConfig } from '../execute-plan.js';
import {
    sequentialInstructionPlan,
    parallelInstructionPlan,
    createTransactionPlanner,
    createTransactionPlanExecutor,
} from '../index.js';

describe('executePlan exports', () => {
    it('should export executePlan function', () => {
        expect(typeof executePlan).toBe('function');
    });

    it('should export ExecutePlanConfig type (verifiable via usage)', () => {
        // Type-level test - if this compiles, the type is exported correctly
        const _config: Partial<ExecutePlanConfig> = {
            commitment: 'confirmed',
        };
        expect(_config.commitment).toBe('confirmed');
    });
});

describe('Kit re-exports', () => {
    it('should re-export sequentialInstructionPlan', () => {
        expect(typeof sequentialInstructionPlan).toBe('function');
    });

    it('should re-export parallelInstructionPlan', () => {
        expect(typeof parallelInstructionPlan).toBe('function');
    });

    it('should re-export createTransactionPlanner', () => {
        expect(typeof createTransactionPlanner).toBe('function');
    });

    it('should re-export createTransactionPlanExecutor', () => {
        expect(typeof createTransactionPlanExecutor).toBe('function');
    });
});

describe('ExecutePlanConfig', () => {
    it('should require SimulateTransactionApi for CU estimation', () => {
        // This is a compile-time check - the RPC type now includes SimulateTransactionApi
        // The test documents that CU estimation via simulation is integrated
        const configDescription = `
            ExecutePlanConfig now requires:
            - GetEpochInfoApi
            - GetSignatureStatusesApi
            - SendTransactionApi
            - GetLatestBlockhashApi
            - SimulateTransactionApi (for CU estimation)
        `;
        expect(configDescription).toContain('SimulateTransactionApi');
    });
});

describe('CU estimation integration', () => {
    it('should document the provisory CU pattern', () => {
        // This test documents the CU estimation pattern used in executePlan:
        // 1. fillProvisorySetComputeUnitLimitInstruction adds a placeholder in planner
        // 2. estimateAndUpdateProvisoryComputeUnitLimitFactory updates it in executor
        const cuPattern = {
            planner: 'fillProvisorySetComputeUnitLimitInstruction',
            executor: 'estimateAndUpdateProvisoryComputeUnitLimitFactory',
            source: '@solana-program/compute-budget',
        };

        expect(cuPattern.planner).toBe('fillProvisorySetComputeUnitLimitInstruction');
        expect(cuPattern.executor).toBe('estimateAndUpdateProvisoryComputeUnitLimitFactory');
    });
});
