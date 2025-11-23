/**
 * @pipeit/tx-orchestration
 *
 * Transaction orchestration for multi-step Solana transaction flows.
 *
 * @packageDocumentation
 */

export { createPipeline, TransactionPipeline } from './pipeline.js';
export type { StepContext, ExecuteParams } from './pipeline.js';
export type { InstructionStep, TransactionStep, AtomicGroupStep, PipelineStep, ExecutionStrategy, PipelineHooks } from './pipeline.js';

