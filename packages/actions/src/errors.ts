/**
 * Error types for @pipeit/actions.
 * 
 * These are actions-specific errors for common failure cases.
 * For general Solana/transaction errors, use @solana/errors or @pipeit/core.
 * 
 * @packageDocumentation
 */

/**
 * Error thrown when attempting to execute a pipe with no actions.
 */
export class NoActionsError extends Error {
  constructor() {
    super('No actions to execute. Add at least one action to the pipe.');
    this.name = 'NoActionsError';
    Object.setPrototypeOf(this, NoActionsError.prototype);
  }
}

/**
 * Error thrown when an adapter is required but not configured.
 * 
 * @example
 * ```ts
 * // This would throw NoAdapterError if swap adapter not configured
 * pipe({ rpc, rpcSubscriptions, signer })
 *   .swap({ inputMint: SOL, outputMint: USDC, amount: 1000000n })
 * ```
 */
export class NoAdapterError extends Error {
  constructor(
    /** The type of adapter that was missing */
    public readonly adapterType: string
  ) {
    super(
      `No ${adapterType} adapter configured. Pass a ${adapterType} adapter in pipe config:\n` +
      `pipe({ ..., adapters: { ${adapterType}: yourAdapter() } })`
    );
    this.name = 'NoAdapterError';
    Object.setPrototypeOf(this, NoAdapterError.prototype);
  }
}

/**
 * Error thrown when an action fails during execution.
 * Wraps the original error with the action index for debugging.
 */
export class ActionExecutionError extends Error {
  constructor(
    /** Index of the action that failed (0-based) */
    public readonly actionIndex: number,
    /** The original error that caused the failure */
    public readonly cause: Error
  ) {
    super(`Action ${actionIndex} failed: ${cause.message}`);
    this.name = 'ActionExecutionError';
    Object.setPrototypeOf(this, ActionExecutionError.prototype);
  }
}

/**
 * Type guard to check if an error is a NoActionsError.
 */
export function isNoActionsError(error: unknown): error is NoActionsError {
  return error instanceof NoActionsError || (error instanceof Error && error.name === 'NoActionsError');
}

/**
 * Type guard to check if an error is a NoAdapterError.
 */
export function isNoAdapterError(error: unknown): error is NoAdapterError {
  return error instanceof NoAdapterError || (error instanceof Error && error.name === 'NoAdapterError');
}

/**
 * Type guard to check if an error is an ActionExecutionError.
 */
export function isActionExecutionError(error: unknown): error is ActionExecutionError {
  return error instanceof ActionExecutionError || (error instanceof Error && error.name === 'ActionExecutionError');
}
