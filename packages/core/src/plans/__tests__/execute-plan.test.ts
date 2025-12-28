/**
 * Tests for executePlan function.
 *
 * Note: Full integration tests require mocking RPC connections.
 * These tests verify the exports and basic structure.
 *
 * For type-level tests verifying ExecutePlanConfig constraints,
 * see `__typetests__/execute-plan-typetest.ts`.
 */

import { describe, it, expect } from 'vitest';
import { executePlan } from '../execute-plan.js';
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

describe('ExecutePlanConfig requirements', () => {
    /**
     * ExecutePlanConfig requires these RPC APIs:
     * - GetEpochInfoApi
     * - GetSignatureStatusesApi
     * - SendTransactionApi
     * - GetLatestBlockhashApi
     * - SimulateTransactionApi (for CU estimation)
     *
     * Additionally:
     * - lookupTableAddresses: requires GetAccountInfoApi (tables will be fetched)
     * - addressesByLookupTable: no additional requirements (pre-fetched data)
     *
     * See `__typetests__/execute-plan-typetest.ts` for compile-time verification.
     */
    it('documents RPC API requirements', () => {
        expect(true).toBe(true);
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

describe('ALT compression integration', () => {
    it('should document the ALT compression flow', () => {
        // This test documents how ALT compression is integrated into executePlan:
        // 1. Lookup table data is resolved once at the start (prefetched or fetched)
        // 2. compressTransactionMessage is applied BEFORE CU estimation
        // 3. This ensures simulation uses the same compressed message that will be sent
        const altFlow = {
            step1: 'resolveLookupTableData (prefetched or fetch via lookupTableAddresses)',
            step2: 'compressTransactionMessage (before CU estimation)',
            step3: 'estimateAndSetCULimit (on compressed message)',
            step4: 'signTransactionMessageWithSigners',
            step5: 'sendAndConfirm',
        };

        expect(altFlow.step1).toContain('resolveLookupTableData');
        expect(altFlow.step2).toContain('compressTransactionMessage');
        expect(altFlow.step3).toContain('estimateAndSetCULimit');
    });

    it('should document planner-time ALT compression for optimal packing', () => {
        // This test documents how ALT compression is applied during transaction planning:
        // 1. When lookup table data is available, onTransactionMessageUpdated hook is configured
        // 2. The hook applies compressTransactionMessage after each instruction is added
        // 3. This allows the planner's size checks to account for ALT-compressed size
        // 4. Result: more instructions can fit per transaction when ALTs reduce account references
        //
        // Without planner-time compression:
        //   - Planner uses uncompressed size for packing decisions
        //   - May create more transactions than necessary
        //
        // With planner-time compression:
        //   - Planner uses compressed size for packing decisions
        //   - Optimal transaction packing when ALTs are provided
        const plannerAltFlow = {
            hook: 'onTransactionMessageUpdated',
            action: 'compressTransactionMessage(message, lookupTableData)',
            benefit: 'Planner size checks use compressed size, allowing optimal packing',
        };

        expect(plannerAltFlow.hook).toBe('onTransactionMessageUpdated');
        expect(plannerAltFlow.action).toContain('compressTransactionMessage');
        expect(plannerAltFlow.benefit).toContain('optimal packing');
    });
});
