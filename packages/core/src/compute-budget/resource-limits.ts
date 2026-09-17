/**
 * Simulation-based resource limit estimation with headroom.
 *
 * @packageDocumentation
 */

import type { Rpc, SimulateTransactionApi } from '@solana/rpc';
import { estimateResourceLimitsFactory, estimateAndSetResourceLimitsFactory } from '@solana/kit';
import { translateVersionError } from '../errors/version-errors.js';
import {
    DEFAULT_COMPUTE_BUFFER,
    MAX_COMPUTE_UNIT_LIMIT,
    applyBuffer,
    roundUpToLoadedAccountsDataSizePage,
} from './compute-units.js';

/**
 * Configuration for {@link createBufferedResourceLimitsEstimator}.
 */
export interface BufferedResourceLimitsConfig {
    /**
     * RPC client used to simulate the transaction.
     */
    rpc: Rpc<SimulateTransactionApi>;

    /**
     * Multiplier applied to the simulated compute units and loaded accounts
     * data size. Simulation reflects chain state at simulation time; state can
     * change before the transaction lands, so headroom is required.
     * @default 1.1
     */
    buffer?: number;
}

/**
 * Create a function that estimates a transaction message's resource limits by
 * simulation and writes them onto the message.
 *
 * On top of Kit's estimator this:
 * - pads the compute unit limit by `buffer`, capped at 1,400,000
 * - pads the loaded accounts data size by `buffer` and rounds it up to the
 *   next 32 KiB page (version 1 only; Kit does not report or set it for
 *   legacy/v0 unless the RPC happens to return it)
 * - translates "this RPC cannot simulate v1" errors into Pipeit errors
 *
 * Kit only replaces provisory values: a compute unit limit that is unset,
 * 0, or exactly the maximum is re-estimated, and a loaded accounts data size
 * limit that is unset or 0 is estimated. Explicit values are left alone, so a
 * message with a fixed compute unit limit gets only its data size estimated.
 *
 * @example
 * ```ts
 * const estimateAndSet = createBufferedResourceLimitsEstimator({ rpc, buffer: 1.2 });
 * const ready = await estimateAndSet(message);
 * ```
 */
export function createBufferedResourceLimitsEstimator(config: BufferedResourceLimitsConfig) {
    const { rpc, buffer = DEFAULT_COMPUTE_BUFFER } = config;
    const estimateResourceLimits = estimateResourceLimitsFactory({ rpc });

    const estimateWithBuffer = (async (
        message: Parameters<typeof estimateResourceLimits>[0],
        estimateConfig: Parameters<typeof estimateResourceLimits>[1],
    ) => {
        let limits: { computeUnitLimit: number; loadedAccountsDataSizeLimit?: number };
        try {
            limits = await estimateResourceLimits(message, estimateConfig);
        } catch (error) {
            throw translateVersionError(error, message.version);
        }
        return {
            ...limits,
            computeUnitLimit: Math.min(applyBuffer(limits.computeUnitLimit, buffer), MAX_COMPUTE_UNIT_LIMIT),
            ...(limits.loadedAccountsDataSizeLimit !== undefined && {
                loadedAccountsDataSizeLimit: roundUpToLoadedAccountsDataSizePage(
                    applyBuffer(limits.loadedAccountsDataSizeLimit, buffer),
                ),
            }),
        };
    }) as typeof estimateResourceLimits;

    return estimateAndSetResourceLimitsFactory(estimateWithBuffer);
}
