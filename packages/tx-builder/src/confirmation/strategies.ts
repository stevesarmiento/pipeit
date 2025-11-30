/**
 * Transaction confirmation strategies wrapping Kit's confirmation utilities.
 *
 * @packageDocumentation
 */

import type { Signature } from '@solana/kit';
import type { Rpc, GetEpochInfoApi, GetSignatureStatusesApi } from '@solana/rpc';
import type { RpcSubscriptions, SignatureNotificationsApi, SlotNotificationsApi } from '@solana/rpc-subscriptions';
import type { Commitment } from '@solana/rpc-types';
import type { ConfirmationResult, WaitForConfirmationOptions } from './types.js';

/**
 * Default timeout for confirmation (60 seconds).
 */
export const DEFAULT_CONFIRMATION_TIMEOUT = 60_000;

/**
 * RPC API requirements for confirmation strategies.
 */
export type ConfirmationRpc = Rpc<GetEpochInfoApi & GetSignatureStatusesApi>;

/**
 * RPC Subscriptions requirements for confirmation strategies.
 */
export type ConfirmationRpcSubscriptions = RpcSubscriptions<SignatureNotificationsApi & SlotNotificationsApi>;

/**
 * Create a promise that resolves when a signature reaches the target commitment.
 *
 * @param rpc - RPC client
 * @param rpcSubscriptions - RPC subscriptions client
 * @param signature - Transaction signature
 * @param commitment - Target commitment level
 * @param abortSignal - Optional abort signal
 * @returns Promise that resolves on confirmation
 */
async function waitForSignatureConfirmation(
  rpc: Rpc<GetSignatureStatusesApi>,
  rpcSubscriptions: RpcSubscriptions<SignatureNotificationsApi>,
  signature: Signature,
  commitment: Commitment,
  abortSignal?: AbortSignal
): Promise<void> {
  const abortController = new AbortController();
  const signal = abortSignal ?? abortController.signal;

  if (abortSignal) {
    abortSignal.addEventListener('abort', () => abortController.abort(), { once: true });
  }

  try {
    // Subscribe to signature notifications
    const notifications = await rpcSubscriptions
      .signatureNotifications(signature, { commitment })
      .subscribe({ abortSignal: signal });

    // Also check current status
    const statusPromise = (async () => {
      const { value: statuses } = await rpc
        .getSignatureStatuses([signature])
        .send({ abortSignal: signal });

      const status = statuses[0];
      if (status?.confirmationStatus === commitment || 
          (commitment === 'confirmed' && status?.confirmationStatus === 'finalized') ||
          (commitment === 'processed' && (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized'))) {
        return;
      }
      if (status?.err) {
        throw new Error(`Transaction failed: ${JSON.stringify(status.err)}`);
      }
      // Keep waiting via subscription
      return new Promise<void>(() => {});
    })();

    // Wait for notification
    const notificationPromise = (async () => {
      for await (const notification of notifications) {
        if (notification.value.err) {
          throw new Error(`Transaction failed: ${JSON.stringify(notification.value.err)}`);
        }
        return;
      }
    })();

    await Promise.race([statusPromise, notificationPromise]);
  } finally {
    abortController.abort();
  }
}

/**
 * Create a promise that rejects when block height exceeds the last valid height.
 *
 * @param rpc - RPC client
 * @param rpcSubscriptions - RPC subscriptions client
 * @param lastValidBlockHeight - Last valid block height
 * @param commitment - Commitment level
 * @param abortSignal - Optional abort signal
 * @returns Promise that rejects on block height exceeded
 */
async function waitForBlockHeightExceedence(
  rpc: Rpc<GetEpochInfoApi>,
  rpcSubscriptions: RpcSubscriptions<SlotNotificationsApi>,
  lastValidBlockHeight: bigint,
  commitment: Commitment,
  abortSignal?: AbortSignal
): Promise<never> {
  const abortController = new AbortController();
  const signal = abortSignal ?? abortController.signal;

  if (abortSignal) {
    abortSignal.addEventListener('abort', () => abortController.abort(), { once: true });
  }

  try {
    // Get initial block height and slot-to-height difference
    const epochInfo = await rpc.getEpochInfo({ commitment }).send({ abortSignal: signal });
    let currentBlockHeight = epochInfo.blockHeight;
    let slotHeightDiff = epochInfo.absoluteSlot - epochInfo.blockHeight;

    if (currentBlockHeight > lastValidBlockHeight) {
      throw new BlockHeightExceededError(currentBlockHeight, lastValidBlockHeight);
    }

    // Subscribe to slot notifications
    const slotNotifications = await rpcSubscriptions
      .slotNotifications()
      .subscribe({ abortSignal: signal });

    for await (const notification of slotNotifications) {
      const estimatedBlockHeight = notification.slot - slotHeightDiff;

      if (estimatedBlockHeight > lastValidBlockHeight) {
        // Double-check with RPC
        const { blockHeight } = await rpc.getEpochInfo({ commitment }).send({ abortSignal: signal });
        currentBlockHeight = blockHeight;

        if (currentBlockHeight > lastValidBlockHeight) {
          throw new BlockHeightExceededError(currentBlockHeight, lastValidBlockHeight);
        }

        // Update difference (some slots may have been skipped)
        slotHeightDiff = notification.slot - blockHeight;
      }
    }

    // Should never reach here
    throw new Error('Slot notifications ended unexpectedly');
  } finally {
    abortController.abort();
  }
}

/**
 * Error thrown when block height is exceeded.
 */
export class BlockHeightExceededError extends Error {
  readonly currentBlockHeight: bigint;
  readonly lastValidBlockHeight: bigint;

  constructor(currentBlockHeight: bigint, lastValidBlockHeight: bigint) {
    super(
      `Block height exceeded: current ${currentBlockHeight}, last valid ${lastValidBlockHeight}`
    );
    this.name = 'BlockHeightExceededError';
    this.currentBlockHeight = currentBlockHeight;
    this.lastValidBlockHeight = lastValidBlockHeight;
  }
}

/**
 * Error thrown when confirmation times out.
 */
export class ConfirmationTimeoutError extends Error {
  readonly timeout: number;

  constructor(timeout: number) {
    super(`Transaction confirmation timed out after ${timeout}ms`);
    this.name = 'ConfirmationTimeoutError';
    this.timeout = timeout;
  }
}

/**
 * Wait for transaction confirmation using blockheight strategy.
 * Races signature confirmation against block height expiration.
 *
 * @param rpc - RPC client
 * @param rpcSubscriptions - RPC subscriptions client
 * @param options - Confirmation options
 * @returns Confirmation result
 */
export async function confirmWithBlockheight(
  rpc: ConfirmationRpc,
  rpcSubscriptions: ConfirmationRpcSubscriptions,
  options: WaitForConfirmationOptions
): Promise<ConfirmationResult> {
  const { signature, commitment, lastValidBlockHeight, abortSignal } = options;

  if (!lastValidBlockHeight) {
    throw new Error('lastValidBlockHeight required for blockheight confirmation strategy');
  }

  const abortController = new AbortController();
  if (abortSignal) {
    abortSignal.addEventListener('abort', () => abortController.abort(), { once: true });
  }

  try {
    const confirmationPromise = waitForSignatureConfirmation(
      rpc,
      rpcSubscriptions,
      signature,
      commitment,
      abortController.signal
    ).then(() => ({ confirmed: true as const }));

    const expirationPromise = waitForBlockHeightExceedence(
      rpc,
      rpcSubscriptions,
      lastValidBlockHeight,
      commitment,
      abortController.signal
    ).catch((error) => {
      if (error instanceof BlockHeightExceededError) {
        return { confirmed: false as const, error };
      }
      throw error;
    });

    const result = await Promise.race([confirmationPromise, expirationPromise]);

    if (result.confirmed) {
      return {
        signature,
        confirmed: true,
        reason: 'confirmed',
      };
    } else {
      return {
        signature,
        confirmed: false,
        error: result.error,
        reason: 'block_height_exceeded',
      };
    }
  } catch (error) {
    return {
      signature,
      confirmed: false,
      error: error instanceof Error ? error : new Error(String(error)),
      reason: 'error',
    };
  } finally {
    abortController.abort();
  }
}

/**
 * Wait for transaction confirmation using timeout strategy.
 * Races signature confirmation against a timeout.
 *
 * @param rpc - RPC client
 * @param rpcSubscriptions - RPC subscriptions client
 * @param options - Confirmation options
 * @returns Confirmation result
 */
export async function confirmWithTimeout(
  rpc: Rpc<GetSignatureStatusesApi>,
  rpcSubscriptions: RpcSubscriptions<SignatureNotificationsApi>,
  options: WaitForConfirmationOptions
): Promise<ConfirmationResult> {
  const { signature, commitment, timeout = DEFAULT_CONFIRMATION_TIMEOUT, abortSignal } = options;

  const abortController = new AbortController();
  if (abortSignal) {
    abortSignal.addEventListener('abort', () => abortController.abort(), { once: true });
  }

  try {
    const confirmationPromise = waitForSignatureConfirmation(
      rpc,
      rpcSubscriptions,
      signature,
      commitment,
      abortController.signal
    ).then(() => ({ confirmed: true as const }));

    const timeoutPromise = new Promise<{ confirmed: false }>((_, reject) => {
      const timer = setTimeout(() => {
        reject(new ConfirmationTimeoutError(timeout));
      }, timeout);

      abortController.signal.addEventListener('abort', () => clearTimeout(timer));
    });

    const result = await Promise.race([confirmationPromise, timeoutPromise]);

    return {
      signature,
      confirmed: result.confirmed,
      reason: result.confirmed ? 'confirmed' : 'timeout',
    };
  } catch (error) {
    if (error instanceof ConfirmationTimeoutError) {
      return {
        signature,
        confirmed: false,
        error,
        reason: 'timeout',
      };
    }
    return {
      signature,
      confirmed: false,
      error: error instanceof Error ? error : new Error(String(error)),
      reason: 'error',
    };
  } finally {
    abortController.abort();
  }
}

/**
 * Wait for transaction confirmation with automatic strategy selection.
 * - Uses blockheight strategy if lastValidBlockHeight is provided
 * - Falls back to timeout strategy otherwise
 *
 * @param rpc - RPC client
 * @param rpcSubscriptions - RPC subscriptions client
 * @param options - Confirmation options
 * @returns Confirmation result
 */
export async function confirmTransaction(
  rpc: ConfirmationRpc,
  rpcSubscriptions: ConfirmationRpcSubscriptions,
  options: WaitForConfirmationOptions
): Promise<ConfirmationResult> {
  if (options.lastValidBlockHeight) {
    return confirmWithBlockheight(rpc, rpcSubscriptions, options);
  }

  // Fall back to timeout
  return confirmWithTimeout(rpc, rpcSubscriptions, options);
}
