/**
 * Transaction flow API for multi-step transaction orchestration.
 * 
 * @packageDocumentation
 */

export { createFlow, TransactionFlow } from './flow.js';
export type {
  // Shared types (used by both tx-builder and @pipeit/actions)
  FlowRpcApi,
  FlowRpcSubscriptionsApi,
  BaseContext,
  // Flow-specific types
  FlowConfig,
  FlowContext,
  FlowHooks,
  FlowStep,
  FlowStepResult,
  StepCreator,
  ExecutionStrategy,
  InstructionStep,
  TransactionStep,
  AtomicGroupStep,
} from './types.js';

