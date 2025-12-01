/**
 * Compute unit estimation and instruction creation.
 *
 * @packageDocumentation
 */

import type { Instruction } from '@solana/instructions';
import { COMPUTE_BUDGET_PROGRAM } from './priority-fees.js';
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
 * Create SetComputeUnitLimit instruction.
 * Sets the maximum compute units a transaction can consume.
 *
 * @param units - Maximum compute units (max: 1,400,000)
 * @returns Instruction to set compute unit limit
 *
 * @example
 * ```ts
 * const ix = createSetComputeUnitLimitInstruction(300_000);
 * // Sets max CU to 300,000
 * ```
 */
export function createSetComputeUnitLimitInstruction(units: number): Instruction {
  // Clamp to maximum
  const clampedUnits = Math.min(units, MAX_COMPUTE_UNIT_LIMIT);

  // Instruction data: [2, units as u32 LE]
  const data = new Uint8Array(5);
  data[0] = 2; // SetComputeUnitLimit discriminator
  new DataView(data.buffer).setUint32(1, clampedUnits, true);

  return {
    programAddress: COMPUTE_BUDGET_PROGRAM,
    accounts: [],
    data,
  };
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
  config: ComputeUnitConfig
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
  const clampedUnits = Math.min(
    Math.max(bufferedUnits, 0),
    MAX_COMPUTE_UNIT_LIMIT
  );

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
export function getComputeUnitLimit(
  config: ComputeUnitConfig,
  simulatedUnits?: bigint
): number {
  const estimate = estimateComputeUnits(simulatedUnits, config);
  return estimate.units;
}
