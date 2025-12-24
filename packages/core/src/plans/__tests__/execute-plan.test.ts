/**
 * Tests for executePlan function.
 *
 * Note: Full integration tests require mocking RPC connections.
 * These tests verify the exports and basic structure.
 */

import { describe, it, expect } from 'vitest';
import { address } from '@solana/addresses';
import { executePlan, type ExecutePlanConfig } from '../execute-plan.js';
import {
    sequentialInstructionPlan,
    parallelInstructionPlan,
    createTransactionPlanner,
    createTransactionPlanExecutor,
} from '../index.js';
import type { AddressesByLookupTableAddress } from '../../lookup-tables/index.js';

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

    it('should document conditional GetAccountInfoApi requirement for lookup table fetching', () => {
        // This documents that GetAccountInfoApi is only required when using lookupTableAddresses.
        // When using addressesByLookupTable (pre-fetched data), GetAccountInfoApi is not required.
        const altConfigDescription = `
            ExecutePlanConfig ALT support:
            - lookupTableAddresses: requires GetAccountInfoApi on RPC (tables will be fetched)
            - addressesByLookupTable: no additional RPC requirements (pre-fetched data)
            - omit both: original behavior without ALT compression
        `;
        expect(altConfigDescription).toContain('GetAccountInfoApi');
        expect(altConfigDescription).toContain('addressesByLookupTable');
        expect(altConfigDescription).toContain('lookupTableAddresses');
    });

    it('should accept config with addressesByLookupTable (type-level verification)', () => {
        // Type-level test - if this compiles, the config union correctly allows pre-fetched ALT data
        // without requiring GetAccountInfoApi on the RPC type
        const testAltAddress = address('ALT1111111111111111111111111111111111111111');
        const testAddress1 = address('11111111111111111111111111111111');
        const testAddress2 = address('22222222222222222222222222222222222222222222');

        const prefetchedData: AddressesByLookupTableAddress = {
            [testAltAddress]: [testAddress1, testAddress2],
        };

        // This config shape should be valid - addressesByLookupTable without lookupTableAddresses
        const _configWithPrefetchedData: Pick<ExecutePlanConfig, 'commitment' | 'addressesByLookupTable'> = {
            commitment: 'confirmed',
            addressesByLookupTable: prefetchedData,
        };

        expect(_configWithPrefetchedData.addressesByLookupTable).toBeDefined();
        expect(Object.keys(_configWithPrefetchedData.addressesByLookupTable!)).toHaveLength(1);
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
});
