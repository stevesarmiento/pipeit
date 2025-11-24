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
import { TransactionBuilder } from './builder/builder.js';
import type { TransactionBuilderConfig } from './builder/builder.js';

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
    instruction: any; // Instruction type from Kit
    feePayer: TransactionSigner;
    config?: TransactionBuilderConfig;
  }
): Promise<string> {
  const builder = new TransactionBuilder({ rpc, ...opts.config });
  
  return builder
    .setFeePayer(opts.feePayer.address)
    .addInstruction(opts.instruction)
    .execute({ rpcSubscriptions });
}

