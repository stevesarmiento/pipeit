/**
 * Kit instruction-plans re-exports and helpers.
 * 
 * This module re-exports Kit's instruction-plans package for advanced users
 * who need the full power of Kit's planning and execution system.
 * 
 * For simpler use cases, see {@link createFlow} which provides a more
 * ergonomic API for dynamic instruction creation with context.
 * 
 * @packageDocumentation
 */

// Re-export all of Kit's instruction-plans
export {
  // Instruction plan types and helpers
  type InstructionPlan,
  type SingleInstructionPlan,
  type ParallelInstructionPlan,
  type SequentialInstructionPlan,
  type MessagePackerInstructionPlan,
  type MessagePacker,
  singleInstructionPlan,
  parallelInstructionPlan,
  sequentialInstructionPlan,
  nonDivisibleSequentialInstructionPlan,
  getLinearMessagePackerInstructionPlan,
  getMessagePackerInstructionPlanFromInstructions,
  getReallocMessagePackerInstructionPlan,
  
  // Transaction plan types and helpers
  type TransactionPlan,
  type SingleTransactionPlan,
  type ParallelTransactionPlan,
  type SequentialTransactionPlan,
  singleTransactionPlan,
  parallelTransactionPlan,
  sequentialTransactionPlan,
  nonDivisibleSequentialTransactionPlan,
  getAllSingleTransactionPlans,
  
  // Transaction planner
  type TransactionPlanner,
  type TransactionPlannerConfig,
  createTransactionPlanner,
  
  // Transaction plan executor
  type TransactionPlanExecutor,
  type TransactionPlanExecutorConfig,
  createTransactionPlanExecutor,
  
  // Transaction plan results
  type TransactionPlanResult,
  type SingleTransactionPlanResult,
  type ParallelTransactionPlanResult,
  type SequentialTransactionPlanResult,
  type TransactionPlanResultContext,
  successfulSingleTransactionPlanResult,
  failedSingleTransactionPlanResult,
  canceledSingleTransactionPlanResult,
  parallelTransactionPlanResult,
  sequentialTransactionPlanResult,
  nonDivisibleSequentialTransactionPlanResult,
} from '@solana/instruction-plans';

// Export the executePlan helper
export { executePlan, type ExecutePlanConfig } from './execute-plan.js';

