/**
 * Compute unit and loaded-accounts-data-size estimation helpers.
 *
 * @packageDocumentation
 */

import type { ComputeUnitConfig, ComputeUnitEstimate } from './types.js';

/**
 * Default compute unit limit if not specified.
 */
export const DEFAULT_COMPUTE_UNIT_LIMIT = 200_000;

/**
 * Maximum compute unit limit per transaction.
 */
export const MAX_COMPUTE_UNIT_LIMIT = 1_400_000;

/**
 * Default buffer multiplier for simulated compute units.
 */
export const DEFAULT_COMPUTE_BUFFER = 1.1;

/**
 * Maximum loaded accounts data size limit per transaction (64 MiB).
 *
 * Mirrors the runtime ceiling Kit uses when simulating; Kit does not export
 * this constant publicly.
 */
export const MAX_LOADED_ACCOUNTS_DATA_SIZE_LIMIT = 64 * 1024 * 1024;

/**
 * Granularity the runtime charges loaded account data in (32 KiB pages).
 * Loaded accounts data size limits are rounded up to this boundary.
 */
export const LOADED_ACCOUNTS_DATA_SIZE_PAGE = 32 * 1024;

/**
 * Apply a headroom multiplier and round up to a whole unit without
 * floating-point artifacts (`100_000 * 1.1` is `110000.00000000001` in IEEE
 * doubles, which a naive `Math.ceil` turns into 110_001).
 *
 * @param value - The simulated value (compute units or bytes)
 * @param buffer - Multiplier, e.g. 1.1 for 10% headroom (6 decimal places honoured)
 */
export function applyBuffer(value: number, buffer: number): number {
    const scaledBuffer = Math.round(buffer * 1_000_000);
    return Math.ceil((value * scaledBuffer) / 1_000_000);
}

/**
 * Round a loaded accounts data size up to the next 32 KiB page.
 *
 * Always returns at least one page so an estimate of zero bytes can never
 * collapse back into the provisory value of 0 (which a version 1 transaction
 * would fail on). Capped at {@link MAX_LOADED_ACCOUNTS_DATA_SIZE_LIMIT}.
 *
 * @param bytes - Loaded accounts data size in bytes
 * @returns Page-aligned size in bytes
 */
export function roundUpToLoadedAccountsDataSizePage(bytes: number): number {
    const pages = Math.max(1, Math.ceil(Math.max(0, bytes) / LOADED_ACCOUNTS_DATA_SIZE_PAGE));
    return Math.min(pages * LOADED_ACCOUNTS_DATA_SIZE_PAGE, MAX_LOADED_ACCOUNTS_DATA_SIZE_LIMIT);
}

/**
 * Estimate compute units from simulation result.
 *
 * @param simulatedUnits - Units consumed during simulation
 * @param config - Compute unit configuration
 * @returns Estimated compute units with buffer
 *
 * @example
 * ```ts
 * const estimate = estimateComputeUnits(150_000n, { strategy: 'simulate', buffer: 1.2 });
 * // Returns { units: 180_000, simulatedUnits: 150_000n, buffer: 1.2 }
 * ```
 */
export function estimateComputeUnits(
    simulatedUnits: bigint | undefined,
    config: ComputeUnitConfig,
): ComputeUnitEstimate {
    const { strategy, units, buffer = DEFAULT_COMPUTE_BUFFER } = config;

    // Fixed strategy
    if (strategy === 'fixed') {
        return {
            units: units ?? DEFAULT_COMPUTE_UNIT_LIMIT,
            buffer: 1,
        };
    }

    // Auto strategy - no explicit limit
    if (strategy === 'auto') {
        return {
            units: DEFAULT_COMPUTE_UNIT_LIMIT,
            buffer: 1,
        };
    }

    // Simulate strategy
    if (simulatedUnits === undefined) {
        // No simulation data, use default
        return {
            units: DEFAULT_COMPUTE_UNIT_LIMIT,
            buffer,
        };
    }

    // Apply buffer to simulated units
    const bufferedUnits = Math.ceil(Number(simulatedUnits) * buffer);

    // Clamp to reasonable bounds
    const clampedUnits = Math.min(Math.max(bufferedUnits, 0), MAX_COMPUTE_UNIT_LIMIT);

    return {
        units: clampedUnits,
        simulatedUnits,
        buffer,
    };
}

/**
 * Check if a compute unit limit instruction should be added.
 *
 * @param config - Compute unit configuration
 * @returns true if an instruction should be added
 */
export function shouldAddComputeUnitInstruction(config: ComputeUnitConfig): boolean {
    return config.strategy !== 'auto';
}

/**
 * Get compute unit limit based on configuration.
 *
 * @param config - Compute unit configuration
 * @param simulatedUnits - Optional simulation result
 * @returns Compute unit limit to use
 */
export function getComputeUnitLimit(config: ComputeUnitConfig, simulatedUnits?: bigint): number {
    const estimate = estimateComputeUnits(simulatedUnits, config);
    return estimate.units;
}
