/**
 * Flash Trade client defaults for actions.
 *
 * @packageDocumentation
 */

import { PerpetualsClient, PoolConfig } from 'flash-sdk';
import type { FlashActionsClientConfig, FlashActionsContext } from './types.js';

/**
 * Creates a flash-sdk `PerpetualsClient` plus resolved pool configuration
 * for the plan builders.
 *
 * The AnchorProvider must point at a live RPC endpoint: flash-sdk simulates
 * quotes and checks account existence through `provider.connection` while
 * plans are being built (plan building is not offline). The provider wallet
 * is the trader — every instruction is built for
 * `provider.wallet.publicKey`.
 *
 * @example
 * ```ts
 * const context = createFlashActionsClient({ provider });
 * const { plan } = await getFlashOpenPositionPlan({ context, ... });
 * ```
 */
export function createFlashActionsClient(config: FlashActionsClientConfig): FlashActionsContext {
    const cluster = config.cluster ?? 'mainnet-beta';
    const poolName = config.poolName ?? 'Crypto.1';
    const poolConfig = PoolConfig.fromIdsByName(poolName, cluster);
    const client = new PerpetualsClient(
        config.provider,
        poolConfig.programId,
        poolConfig.perpComposibilityProgramId,
        poolConfig.fbNftRewardProgramId,
        poolConfig.rewardDistributionProgram.programId,
        config.opts ?? {},
        config.useExtOracleAccount,
    );

    return {
        client,
        poolConfig,
        cluster,
        poolName,
    };
}
