/**
 * Middleware composition utilities.
 *
 * @packageDocumentation
 */

import type { Middleware, MiddlewareContext } from './types.js';

/**
 * Compose multiple middleware functions into a single middleware.
 */
export function composeMiddleware(...middlewares: Middleware[]): Middleware {
  return async (tx, context, next) => {
    // Build the middleware chain from right to left
    let middlewareChain = next;

    for (let i = middlewares.length - 1; i >= 0; i--) {
      const middleware = middlewares[i];
      const currentNext = middlewareChain;
      middlewareChain = () => middleware(tx, context, currentNext);
    }

    return middlewareChain();
  };
}

/**
 * Apply middleware to a transaction execution function.
 */
export function applyMiddleware<T extends (...args: unknown[]) => Promise<unknown>>(
  fn: T,
  ...middlewares: Middleware[]
): T {
  const composed = composeMiddleware(...middlewares);

  return (async (...args: Parameters<T>) => {
    // Extract transaction and context from args
    const [tx, context = {}] = args as unknown as [unknown, MiddlewareContext?];

    const next = async () => {
      const result = await fn(...args);
      return { success: true, result };
    };

    return composed(tx as Parameters<Middleware>[0], context as MiddlewareContext, next);
  }) as T;
}

