/**
 * Phoenix Rise client defaults for actions.
 *
 * @packageDocumentation
 */

import { createPhoenixClient } from '@ellipsis-labs/rise';
import type { PhoenixClient, PhoenixClientConfig } from '@ellipsis-labs/rise';

export type PhoenixActionsClient = PhoenixClient;
export type PhoenixActionsClientConfig = PhoenixClientConfig;

/**
 * Creates a Rise client preconfigured for the Phoenix perps API with
 * streaming disabled (plan builders only need snapshot metadata).
 *
 * The client holds HTTP, exchange-metadata cache, and RPC resources: reuse
 * one instance across plan calls and call `client.dispose()` when done.
 * Plan builders that create a client internally (when no `client` option is
 * passed) dispose it automatically, at the cost of re-fetching exchange
 * metadata on every call.
 *
 * @example
 * ```ts
 * const client = createPhoenixActionsClient();
 * try {
 *     const open = await getPhoenixOpenPositionPlan({ client, ... });
 *     const close = await getPhoenixClosePositionPlan({ client, ... });
 * } finally {
 *     client.dispose();
 * }
 * ```
 */
export function createPhoenixActionsClient(config?: PhoenixActionsClientConfig): PhoenixActionsClient {
    return createPhoenixClient({
        apiUrl: 'https://perp-api.phoenix.trade',
        ws: false,
        exchangeMetadata: { stream: false },
        ...config,
    });
}
