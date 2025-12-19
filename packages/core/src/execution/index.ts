/**
 * Execution strategies for optimized transaction submission.
 *
 * Provides Jito bundle integration and parallel RPC submission
 * for improved transaction landing speed and MEV protection.
 *
 * @packageDocumentation
 */

// Types
export type {
    ExecutionConfig,
    ExecutionPreset,
    ExecutionContext,
    ExecutionResult,
    ResolvedExecutionConfig,
    JitoConfig,
    ParallelConfig,
    JitoBlockEngineRegion,
    JitoBundleResponse,
    JitoBundleStatusResponse,
    ParallelSubmitOptions,
    ParallelSubmitResult,
} from './types.js';

// Jito client
export {
    JITO_BLOCK_ENGINES,
    JITO_TIP_ACCOUNTS,
    JITO_MIN_TIP_LAMPORTS,
    JITO_DEFAULT_TIP_LAMPORTS,
    getRandomTipAccount,
    resolveBlockEngineUrl,
    createTipInstruction,
    sendBundle,
    sendTransactionViaJito,
    getBundleStatuses,
    JitoBundleError,
    type SendBundleOptions,
    type GetBundleStatusOptions,
    type BundleStatus,
} from './jito.js';

// Parallel submission
export { submitParallel, submitToRpc, ParallelSubmitError } from './parallel.js';

// Strategy orchestration
export {
    resolveExecutionConfig,
    executeWithStrategy,
    isJitoEnabled,
    isParallelEnabled,
    getTipAmount,
    ExecutionStrategyError,
} from './strategies.js';




