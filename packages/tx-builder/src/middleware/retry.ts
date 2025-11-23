/**
 * Retry middleware for transactions.
 *
 * @packageDocumentation
 */

import type { Middleware } from './types.js';
import { isNetworkError, isBlockhashExpiredError } from '../errors/index.js';

/**
 * Options for retry middleware.
 */
export interface RetryOptions {
  /**
   * Maximum number of retry attempts.
   */
  attempts: number;
  /**
   * Base delay in milliseconds.
   */
  baseDelay?: number;
  /**
   * Maximum delay in milliseconds.
   */
  maxDelay?: number;
  /**
   * Whether to use exponential backoff.
   */
  exponentialBackoff?: boolean;
  /**
   * Retry only on specific error types.
   */
  retryOn?: (error: unknown) => boolean;
}

/**
 * Calculate delay for retry attempt.
 */
function calculateDelay(
  attempt: number,
  baseDelay: number,
  maxDelay: number,
  exponentialBackoff: boolean
): number {
  if (!exponentialBackoff) {
    return baseDelay;
  }

  const delay = baseDelay * Math.pow(2, attempt);
  return Math.min(delay, maxDelay);
}

/**
 * Sleep for specified milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Default retry predicate - retry on network errors and expired blockhashes.
 */
function defaultRetryOn(error: unknown): boolean {
  return isNetworkError(error) || isBlockhashExpiredError(error);
}

/**
 * Create retry middleware.
 */
export function withRetry(options: RetryOptions): Middleware {
  const {
    attempts,
    baseDelay = 1000,
    maxDelay = 10000,
    exponentialBackoff = true,
    retryOn = defaultRetryOn,
  } = options;

  return async (tx, context, next) => {
    let lastError: unknown;
    const maxAttempts = attempts + 1; // +1 for initial attempt

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const result = await next();
        if (result.success) {
          return result;
        }

        // Check if we should retry this error
        if (result.error && retryOn(result.error)) {
          lastError = result.error;
          // Only sleep if we have more attempts
          if (attempt < maxAttempts - 1) {
            const delay = calculateDelay(
              attempt,
              baseDelay,
              maxDelay,
              exponentialBackoff
            );
            await sleep(delay);
          }
        } else {
          // Don't retry this error
          return result;
        }
      } catch (error) {
        lastError = error;
        if (retryOn(error) && attempt < maxAttempts - 1) {
          const delay = calculateDelay(
            attempt,
            baseDelay,
            maxDelay,
            exponentialBackoff
          );
          await sleep(delay);
        } else {
          throw error;
        }
      }
    }

    return {
      success: false,
      error: lastError as any,
    };
  };
}

