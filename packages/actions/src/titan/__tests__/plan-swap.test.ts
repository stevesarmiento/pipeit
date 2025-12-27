/**
 * Tests for Titan swap plan builder.
 */

import { describe, it, expect } from 'vitest';
import {
    selectTitanRoute,
    getTitanSwapInstructionPlanFromRoute,
    NoRoutesError,
    ProviderNotFoundError,
    NoInstructionsError,
} from '../plan-swap.js';
import type { SwapQuotes, SwapRoute, TitanInstruction } from '../types.js';

/**
 * Create a mock swap route for testing.
 */
function createMockRoute(overrides: Partial<SwapRoute> = {}): SwapRoute {
    return {
        inAmount: 1_000_000_000n,
        outAmount: 100_000_000n,
        slippageBps: 50,
        steps: [],
        instructions: [
            {
                p: new Uint8Array(32),
                a: [],
                d: new Uint8Array([1, 2, 3, 4]),
            },
        ],
        addressLookupTables: [],
        ...overrides,
    };
}

/**
 * Create mock swap quotes for testing.
 */
function createMockQuotes(overrides: Partial<SwapQuotes> = {}): SwapQuotes {
    return {
        id: 'test-quote-id',
        inputMint: new Uint8Array(32),
        outputMint: new Uint8Array(32),
        swapMode: 'ExactIn',
        amount: 1_000_000_000n,
        quotes: {
            'provider-a': createMockRoute({ outAmount: 100_000_000n }),
            'provider-b': createMockRoute({ outAmount: 120_000_000n }),
            'provider-c': createMockRoute({ outAmount: 95_000_000n }),
        },
        ...overrides,
    };
}

describe('selectTitanRoute', () => {
    describe('ExactIn mode', () => {
        it('should select the route with maximum outAmount', () => {
            const quotes = createMockQuotes();
            const { providerId, route } = selectTitanRoute(quotes);

            expect(providerId).toBe('provider-b');
            expect(route.outAmount).toBe(120_000_000n);
        });

        it('should select first route if all have same outAmount', () => {
            const quotes = createMockQuotes({
                quotes: {
                    'provider-a': createMockRoute({ outAmount: 100_000_000n }),
                    'provider-b': createMockRoute({ outAmount: 100_000_000n }),
                },
            });
            const { providerId } = selectTitanRoute(quotes);

            // Should select first one
            expect(providerId).toBe('provider-a');
        });
    });

    describe('ExactOut mode', () => {
        it('should select the route with minimum inAmount', () => {
            const quotes = createMockQuotes({
                swapMode: 'ExactOut',
                quotes: {
                    'provider-a': createMockRoute({ inAmount: 1_000_000_000n }),
                    'provider-b': createMockRoute({ inAmount: 900_000_000n }),
                    'provider-c': createMockRoute({ inAmount: 1_100_000_000n }),
                },
            });
            const { providerId, route } = selectTitanRoute(quotes);

            expect(providerId).toBe('provider-b');
            expect(route.inAmount).toBe(900_000_000n);
        });
    });

    describe('specific provider selection', () => {
        it('should select the specified provider', () => {
            const quotes = createMockQuotes();
            const { providerId, route } = selectTitanRoute(quotes, { providerId: 'provider-c' });

            expect(providerId).toBe('provider-c');
            expect(route.outAmount).toBe(95_000_000n);
        });

        it('should throw ProviderNotFoundError for unknown provider', () => {
            const quotes = createMockQuotes();

            expect(() => selectTitanRoute(quotes, { providerId: 'unknown-provider' }))
                .toThrow(ProviderNotFoundError);
        });

        it('should include available providers in error', () => {
            const quotes = createMockQuotes();

            try {
                selectTitanRoute(quotes, { providerId: 'unknown-provider' });
                expect.fail('Should have thrown');
            } catch (error) {
                expect(error).toBeInstanceOf(ProviderNotFoundError);
                const providerError = error as ProviderNotFoundError;
                expect(providerError.providerId).toBe('unknown-provider');
                expect(providerError.availableProviders).toContain('provider-a');
                expect(providerError.availableProviders).toContain('provider-b');
                expect(providerError.availableProviders).toContain('provider-c');
            }
        });
    });

    describe('error handling', () => {
        it('should throw NoRoutesError when no quotes available', () => {
            const quotes = createMockQuotes({ quotes: {} });

            expect(() => selectTitanRoute(quotes)).toThrow(NoRoutesError);
        });

        it('should include quote ID in error', () => {
            const quotes = createMockQuotes({ id: 'my-quote-id', quotes: {} });

            try {
                selectTitanRoute(quotes);
                expect.fail('Should have thrown');
            } catch (error) {
                expect(error).toBeInstanceOf(NoRoutesError);
                expect((error as NoRoutesError).quoteId).toBe('my-quote-id');
            }
        });
    });
});

describe('getTitanSwapInstructionPlanFromRoute', () => {
    it('should create a single instruction plan for one instruction', () => {
        const route = createMockRoute({
            instructions: [
                {
                    p: new Uint8Array(32),
                    a: [],
                    d: new Uint8Array([1]),
                },
            ],
        });

        const plan = getTitanSwapInstructionPlanFromRoute(route);

        expect(plan.kind).toBe('single');
    });

    it('should create a sequential plan for multiple instructions', () => {
        const route = createMockRoute({
            instructions: [
                { p: new Uint8Array(32), a: [], d: new Uint8Array([1]) },
                { p: new Uint8Array(32), a: [], d: new Uint8Array([2]) },
                { p: new Uint8Array(32), a: [], d: new Uint8Array([3]) },
            ],
        });

        const plan = getTitanSwapInstructionPlanFromRoute(route);

        expect(plan.kind).toBe('sequential');
        if (plan.kind === 'sequential') {
            expect(plan.plans).toHaveLength(3);
        }
    });

    it('should throw NoInstructionsError when route has no instructions', () => {
        const route = createMockRoute({ instructions: [] });

        expect(() => getTitanSwapInstructionPlanFromRoute(route)).toThrow(NoInstructionsError);
    });
});
