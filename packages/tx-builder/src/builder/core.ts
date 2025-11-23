/**
 * Base transaction builder with type-safe state tracking.
 *
 * @packageDocumentation
 */

import type { Address } from '@solana/addresses';
import type { Instruction } from '@solana/instructions';
import type { TransactionMessage } from '@solana/transaction-messages';
import type { Blockhash } from '@solana/rpc-types';
import type { Rpc, GetLatestBlockhashApi } from '@solana/rpc';
import { pipe } from '@solana/functional';
import {
  createTransactionMessage,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  setTransactionMessageLifetimeUsingDurableNonce,
  appendTransactionMessageInstruction,
} from '@solana/transaction-messages';
import type { BuilderState, RequiredState, BuilderConfig, LifetimeConstraint } from '../types.js';
import { InvalidTransactionError } from '../errors/index.js';
import { validateTransaction, validateTransactionSize } from '../validation/index.js';

/**
 * Type-safe transaction builder that tracks required fields.
 *
 * @example
 * ```ts
 * // With auto-blockhash fetch
 * const builder = new TransactionBuilder({ version: 0, rpc })
 *   .setFeePayer(address('...'))
 *   .addInstruction(instruction)
 *   .build(); // Blockhash auto-fetched!
 *
 * // Or with explicit blockhash
 * const builder = new TransactionBuilder({ version: 0 })
 *   .setFeePayer(address('...'))
 *   .setBlockhashLifetime(blockhash, lastValidBlockHeight)
 *   .addInstruction(instruction)
 *   .build();
 * ```
 */
export class TransactionBuilder<TState extends BuilderState = BuilderState> {
  private feePayer?: Address;
  private lifetime?: LifetimeConstraint;
  private instructions: Instruction[] = [];
  private readonly version: 0 | 'legacy';
  private rpc: Rpc<GetLatestBlockhashApi> | undefined;

  constructor(config: BuilderConfig = {}) {
    this.version = config.version ?? 0;
    this.rpc = config.rpc;
  }

  /**
   * Set the fee payer for the transaction.
   */
  setFeePayer<TAddress extends string>(
    feePayer: Address<TAddress>
  ): TransactionBuilder<TState & { feePayer: true }> {
    const builder = this.clone();
    builder.feePayer = feePayer;
    return builder as TransactionBuilder<TState & { feePayer: true }>;
  }

  /**
   * Set blockhash lifetime for the transaction.
   */
  setBlockhashLifetime(
    blockhash: Blockhash,
    lastValidBlockHeight: bigint
  ): TransactionBuilder<TState & { lifetime: true }> {
    const builder = this.clone();
    builder.lifetime = {
      type: 'blockhash',
      blockhash,
      lastValidBlockHeight,
    };
    return builder as TransactionBuilder<TState & { lifetime: true }>;
  }

  /**
   * Set durable nonce lifetime for the transaction.
   */
  setDurableNonceLifetime(
    nonce: string,
    nonceAccountAddress: Address,
    nonceAuthorityAddress: Address
  ): TransactionBuilder<TState & { lifetime: true }> {
    const builder = this.clone();
    builder.lifetime = {
      type: 'nonce',
      nonce,
      nonceAccountAddress,
      nonceAuthorityAddress,
    };
    return builder as TransactionBuilder<TState & { lifetime: true }>;
  }

  /**
   * Add a single instruction to the transaction.
   */
  addInstruction(
    instruction: Instruction
  ): TransactionBuilder<TState> {
    const builder = this.clone();
    builder.instructions.push(instruction);
    return builder;
  }

  /**
   * Add multiple instructions to the transaction.
   */
  addInstructions(
    instructions: readonly Instruction[]
  ): TransactionBuilder<TState> {
    const builder = this.clone();
    builder.instructions.push(...instructions);
    return builder;
  }

  /**
   * Build the transaction message.
   * Only available when all required fields (feePayer, lifetime) are set.
   * 
   * If RPC was provided in constructor and lifetime not set, automatically fetches latest blockhash.
   */
  async build(
    this: TransactionBuilder<RequiredState>
  ): Promise<TransactionMessage> {
    if (!this.feePayer) {
      throw new InvalidTransactionError(
        'Fee payer is required',
        ['feePayer']
      );
    }

    // AUTO-FETCH: If lifetime not set but RPC available, fetch latest blockhash
    if (!this.lifetime && this.rpc) {
      const { value } = await this.rpc.getLatestBlockhash().send();
      this.lifetime = {
        type: 'blockhash',
        blockhash: value.blockhash,
        lastValidBlockHeight: value.lastValidBlockHeight,
      };
    }

    if (!this.lifetime) {
      throw new InvalidTransactionError(
        'Lifetime required. Provide blockhash or pass rpc to constructor for auto-fetch.',
        ['lifetime']
      );
    }

    // Build using Kit's functional API with pipe
    let message: any = pipe(
      createTransactionMessage({ version: this.version }),
      (tx) => setTransactionMessageFeePayer(this.feePayer!, tx),
      (tx) => this.lifetime!.type === 'blockhash'
        ? setTransactionMessageLifetimeUsingBlockhash(
            {
              blockhash: this.lifetime!.blockhash as any,
              lastValidBlockHeight: this.lifetime!.lastValidBlockHeight,
            },
            tx
          )
        : setTransactionMessageLifetimeUsingDurableNonce(
            {
              nonce: this.lifetime!.nonce as any,
              nonceAccountAddress: this.lifetime!.nonceAccountAddress,
              nonceAuthorityAddress: this.lifetime!.nonceAuthorityAddress,
            },
            tx
          )
    );

    // Add instructions one by one using appendTransactionMessageInstruction
    for (const instruction of this.instructions) {
      message = appendTransactionMessageInstruction(instruction, message);
    }

    // Auto-validate before returning
    validateTransaction(message);
    validateTransactionSize(message);

    return message;
  }

  /**
   * Clone the builder for immutability.
   */
  private clone(): TransactionBuilder<TState> {
    const builder = new TransactionBuilder<TState>({ 
      version: this.version,
      ...(this.rpc && { rpc: this.rpc }),
    });
    if (this.feePayer !== undefined) {
      builder.feePayer = this.feePayer;
    }
    if (this.lifetime !== undefined) {
      builder.lifetime = this.lifetime;
    }
    builder.instructions = [...this.instructions];
    return builder;
  }
}

