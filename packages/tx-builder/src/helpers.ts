/**
 * Helper functions for common transaction operations.
 *
 * @packageDocumentation
 */

import type {
  Rpc,
  GetLatestBlockhashApi,
  GetEpochInfoApi,
  GetSignatureStatusesApi,
  SendTransactionApi,
} from '@solana/rpc';
import type { TransactionSigner } from '@solana/signers';
import type {
  RpcSubscriptions,
  SignatureNotificationsApi,
  SlotNotificationsApi,
} from '@solana/rpc-subscriptions';
import { transaction } from './builder/opinionated.js';
import type { TransactionBuilderConfig } from './builder/opinionated.js';

/**
 * Quick transfer SOL between accounts.
 * 
 * Note: This helper requires the instruction to be created separately.
 * Use Kit's getTransferSolInstruction from '@solana-program/system' to create the instruction.
 */
export async function quickTransfer(
  rpc: Rpc<GetEpochInfoApi & GetSignatureStatusesApi & SendTransactionApi & GetLatestBlockhashApi>,
  rpcSubscriptions: RpcSubscriptions<SignatureNotificationsApi & SlotNotificationsApi>,
  opts: {
    instruction: Parameters<typeof transaction>[0] extends undefined ? never : any; // Instruction type from Kit
    feePayer: TransactionSigner;
    config?: TransactionBuilderConfig;
  }
): Promise<string> {
  const builder = transaction(opts.config);
  
  // Note: Users need to add the instruction themselves
  // This is intentional - keeps the API flexible
  return builder
    .addInstruction(opts.instruction)
    .execute({
      feePayer: opts.feePayer,
      rpc,
      rpcSubscriptions,
    });
}

