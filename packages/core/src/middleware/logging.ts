/**
 * Logging middleware for transactions.
 *
 * @packageDocumentation
 */

import type { Middleware } from './types.js';

/**
 * Options for logging middleware.
 */
export interface LoggingOptions {
  /**
   * Custom logger function.
   */
  logger?: (message: string, data?: Record<string, unknown>) => void;
  /**
   * Log level.
   */
  level?: 'debug' | 'info' | 'warn' | 'error';
}

/**
 * Default logger (console).
 */
function defaultLogger(message: string, data?: Record<string, unknown>): void {
  if (data) {
    console.log(`[Transaction] ${message}`, data);
  } else {
    console.log(`[Transaction] ${message}`);
  }
}

/**
 * Create logging middleware.
 */
export function withLogging(options: LoggingOptions = {}): Middleware {
  const logger = options.logger ?? defaultLogger;

  return async (tx, context, next) => {
    const startTime = Date.now();

    logger(`Starting transaction execution`, {
      attempt: context.attempt,
      maxAttempts: context.maxAttempts,
    });

    try {
      const result = await next();

      const duration = Date.now() - startTime;

      if (result.success) {
        logger(`Transaction succeeded`, {
          signature: result.signature,
          duration,
        });
      } else {
        logger(`Transaction failed`, {
          error: result.error,
          duration,
        });
      }

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      logger(`Transaction error`, {
        error,
        duration,
      });
      throw error;
    }
  };
}

