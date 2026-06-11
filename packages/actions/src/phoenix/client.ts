/**
 * Phoenix Rise client defaults for actions.
 *
 * @packageDocumentation
 */

import { createPhoenixClient } from '@ellipsis-labs/rise';
import type { PhoenixClient, PhoenixClientConfig } from '@ellipsis-labs/rise';

export type PhoenixActionsClient = PhoenixClient;
export type PhoenixActionsClientConfig = PhoenixClientConfig;

export function createPhoenixActionsClient(config?: PhoenixActionsClientConfig): PhoenixActionsClient {
    return createPhoenixClient({
        apiUrl: 'https://perp-api.phoenix.trade',
        ws: false,
        exchangeMetadata: { stream: false },
        ...config,
    });
}
