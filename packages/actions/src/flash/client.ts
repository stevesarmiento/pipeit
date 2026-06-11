/**
 * Flash Trade client defaults for actions.
 *
 * @packageDocumentation
 */

import { PerpetualsClient, PoolConfig } from 'flash-sdk';
import type { FlashActionsClientConfig, FlashActionsContext } from './types.js';

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
