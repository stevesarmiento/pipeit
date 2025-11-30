'use client';

import { useMemo } from 'react';
import { 
  executePlan, 
  sequentialInstructionPlan,
  createFlow,
  type FlowConfig,
  type TransactionFlow,
} from '@pipeit/tx-builder';
import { VisualPipeline } from '@/lib/visual-pipeline';
import { getTransferSolInstruction } from '@solana-program/system';
import { lamports } from '@solana/kit';

/**
 * Instruction plan example - using Kit's static instruction planning.
 * 
 * Demonstrates executePlan API which uses Kit's TransactionPlanner to
 * automatically batch instructions into transactions. All instructions
 * must be known upfront (static), unlike createFlow which allows dynamic
 * instruction creation with context.
 * 
 * Note: This example uses createFlow for visualization compatibility,
 * but demonstrates the executePlan pattern in the code snippet.
 */
export function useInstructionPlanPipeline() {
  const visualPipeline = useMemo(() => {
    // Create a FlowFactory that demonstrates the executePlan pattern
    // We use createFlow for visualization, but show executePlan in code
    const flowFactory = (config: FlowConfig): TransactionFlow => {
      // Build instructions upfront (static, like executePlan requires)
      const instruction1 = getTransferSolInstruction({
        source: config.signer,
        destination: config.signer.address, // Self-transfer for demo
        amount: lamports(BigInt(1_000_000)),
      });
      
      const instruction2 = getTransferSolInstruction({
        source: config.signer,
        destination: config.signer.address, // Self-transfer for demo
        amount: lamports(BigInt(2_000_000)),
      });
      
      const instruction3 = getTransferSolInstruction({
        source: config.signer,
        destination: config.signer.address, // Self-transfer for demo
        amount: lamports(BigInt(3_000_000)),
      });

      // Use createFlow for visualization, but this demonstrates the static
      // instruction pattern that executePlan uses
      return createFlow(config)
        .step('transfer-1', () => instruction1)
        .step('transfer-2', () => instruction2)
        .step('transfer-3', () => instruction3);
    };

    return new VisualPipeline('instruction-plan', flowFactory, [
      { name: 'transfer-1', type: 'instruction' },
      { name: 'transfer-2', type: 'instruction' },
      { name: 'transfer-3', type: 'instruction' },
    ]);
  }, []);

  return visualPipeline;
}

export const instructionPlanCode = `import { 
  executePlan, 
  sequentialInstructionPlan 
} from '@pipeit/tx-builder';
import { getTransferSolInstruction } from '@solana-program/system';
import { address, lamports } from '@solana/kit';

// Build static plan - all instructions known upfront
const plan = sequentialInstructionPlan([
  getTransferSolInstruction({
    source: signer,
    destination: address(recipient1),
    amount: lamports(BigInt(1_000_000)),
  }),
  getTransferSolInstruction({
    source: signer,
    destination: address(recipient2),
    amount: lamports(BigInt(2_000_000)),
  }),
  getTransferSolInstruction({
    source: signer,
    destination: address(recipient3),
    amount: lamports(BigInt(3_000_000)),
  }),
]);

// Execute using Kit's TransactionPlanner
// Kit automatically batches instructions into transactions
const result = await executePlan(plan, {
  rpc,
  rpcSubscriptions,
  signer,
  commitment: 'confirmed',
});

// Result contains transaction plan execution details
console.log('Plan executed:', result.type);`;
