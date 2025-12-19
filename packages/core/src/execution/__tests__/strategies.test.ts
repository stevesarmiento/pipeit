/**
 * Tests for execution strategy resolution.
 */

import { describe, it, expect } from 'vitest';
import { resolveExecutionConfig, isJitoEnabled, isParallelEnabled, getTipAmount } from '../strategies.js';
import { JITO_BLOCK_ENGINES, JITO_DEFAULT_TIP_LAMPORTS } from '../jito.js';

describe('resolveExecutionConfig', () => {
    describe('preset resolution', () => {
        it('should resolve "standard" preset correctly', () => {
            const config = resolveExecutionConfig('standard');

            expect(config.jito.enabled).toBe(false);
            expect(config.jito.tipLamports).toBe(0n);
            expect(config.parallel.enabled).toBe(false);
        });

        it('should resolve "economical" preset correctly', () => {
            const config = resolveExecutionConfig('economical');

            expect(config.jito.enabled).toBe(true);
            expect(config.jito.tipLamports).toBe(JITO_DEFAULT_TIP_LAMPORTS);
            expect(config.jito.mevProtection).toBe(true);
            expect(config.parallel.enabled).toBe(false);
        });

        it('should resolve "fast" preset correctly', () => {
            const config = resolveExecutionConfig('fast');

            expect(config.jito.enabled).toBe(true);
            expect(config.jito.tipLamports).toBe(JITO_DEFAULT_TIP_LAMPORTS);
            expect(config.parallel.enabled).toBe(true);
            expect(config.parallel.raceWithDefault).toBe(true);
        });

        it('should default to "standard" when undefined', () => {
            const config = resolveExecutionConfig(undefined);

            expect(config.jito.enabled).toBe(false);
            expect(config.parallel.enabled).toBe(false);
        });
    });

    describe('object configuration', () => {
        it('should enable Jito with custom tip amount', () => {
            const config = resolveExecutionConfig({
                jito: {
                    enabled: true,
                    tipLamports: 50_000n,
                },
            });

            expect(config.jito.enabled).toBe(true);
            expect(config.jito.tipLamports).toBe(50_000n);
            expect(config.jito.blockEngineUrl).toBe(JITO_BLOCK_ENGINES.mainnet);
        });

        it('should resolve block engine region to URL', () => {
            const config = resolveExecutionConfig({
                jito: {
                    enabled: true,
                    blockEngineUrl: 'ny',
                },
            });

            expect(config.jito.blockEngineUrl).toBe(JITO_BLOCK_ENGINES.ny);
        });

        it('should use custom block engine URL directly', () => {
            const customUrl = 'https://custom.block-engine.example.com';
            const config = resolveExecutionConfig({
                jito: {
                    enabled: true,
                    blockEngineUrl: customUrl,
                },
            });

            expect(config.jito.blockEngineUrl).toBe(customUrl);
        });

        it('should enable parallel with custom endpoints', () => {
            const endpoints = ['https://rpc1.example.com', 'https://rpc2.example.com'];
            const config = resolveExecutionConfig({
                parallel: {
                    enabled: true,
                    endpoints,
                },
            });

            expect(config.parallel.enabled).toBe(true);
            expect(config.parallel.endpoints).toEqual(endpoints);
            expect(config.parallel.raceWithDefault).toBe(true);
        });

        it('should disable race with default when specified', () => {
            const config = resolveExecutionConfig({
                parallel: {
                    enabled: true,
                    raceWithDefault: false,
                },
            });

            expect(config.parallel.raceWithDefault).toBe(false);
        });

        it('should combine Jito and parallel config', () => {
            const config = resolveExecutionConfig({
                jito: {
                    enabled: true,
                    tipLamports: 25_000n,
                },
                parallel: {
                    enabled: true,
                    endpoints: ['https://rpc.example.com'],
                },
            });

            expect(config.jito.enabled).toBe(true);
            expect(config.jito.tipLamports).toBe(25_000n);
            expect(config.parallel.enabled).toBe(true);
            expect(config.parallel.endpoints).toHaveLength(1);
        });
    });

    describe('default values', () => {
        it('should fill in default tip amount when not specified', () => {
            const config = resolveExecutionConfig({
                jito: { enabled: true },
            });

            expect(config.jito.tipLamports).toBe(JITO_DEFAULT_TIP_LAMPORTS);
        });

        it('should default MEV protection to true', () => {
            const config = resolveExecutionConfig({
                jito: { enabled: true },
            });

            expect(config.jito.mevProtection).toBe(true);
        });

        it('should default to mainnet block engine', () => {
            const config = resolveExecutionConfig({
                jito: { enabled: true },
            });

            expect(config.jito.blockEngineUrl).toBe(JITO_BLOCK_ENGINES.mainnet);
        });

        it('should default endpoints to empty array', () => {
            const config = resolveExecutionConfig({
                parallel: { enabled: true },
            });

            expect(config.parallel.endpoints).toEqual([]);
        });
    });
});

describe('utility functions', () => {
    describe('isJitoEnabled', () => {
        it('should return true for "economical" preset', () => {
            expect(isJitoEnabled('economical')).toBe(true);
        });

        it('should return true for "fast" preset', () => {
            expect(isJitoEnabled('fast')).toBe(true);
        });

        it('should return false for "standard" preset', () => {
            expect(isJitoEnabled('standard')).toBe(false);
        });

        it('should return false for undefined', () => {
            expect(isJitoEnabled(undefined)).toBe(false);
        });

        it('should return true when jito.enabled is true', () => {
            expect(isJitoEnabled({ jito: { enabled: true } })).toBe(true);
        });

        it('should return false when jito.enabled is false', () => {
            expect(isJitoEnabled({ jito: { enabled: false } })).toBe(false);
        });
    });

    describe('isParallelEnabled', () => {
        it('should return true for "fast" preset', () => {
            expect(isParallelEnabled('fast')).toBe(true);
        });

        it('should return false for "economical" preset', () => {
            expect(isParallelEnabled('economical')).toBe(false);
        });

        it('should return false for "standard" preset', () => {
            expect(isParallelEnabled('standard')).toBe(false);
        });

        it('should return true when parallel.enabled is true', () => {
            expect(isParallelEnabled({ parallel: { enabled: true } })).toBe(true);
        });
    });

    describe('getTipAmount', () => {
        it('should return tip amount for "economical" preset', () => {
            expect(getTipAmount('economical')).toBe(JITO_DEFAULT_TIP_LAMPORTS);
        });

        it('should return 0 for "standard" preset', () => {
            expect(getTipAmount('standard')).toBe(0n);
        });

        it('should return custom tip amount', () => {
            expect(getTipAmount({ jito: { enabled: true, tipLamports: 50_000n } })).toBe(50_000n);
        });

        it('should return 0 when Jito is disabled', () => {
            expect(getTipAmount({ jito: { enabled: false, tipLamports: 50_000n } })).toBe(0n);
        });
    });
});




