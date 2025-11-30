/**
 * Unified transaction builder with type-safe state tracking and smart defaults.
 *
 * Features:
 * - Type-safe builder with compile-time validation
 * - Auto-blockhash fetching
 * - Auto-retry with configurable backoff
 * - Built-in validation
 * - Simulation support
 * - Export in multiple formats
 * - Compute budget (priority fees & compute limits)
 * - Comprehensive logging
 *
 * @example
 * ```ts
 * // Build message only
 * const message = await new TransactionBuilder({ rpc })
 *   .setFeePayer(address)
 *   .addInstruction(ix)
 *   .build();
 *
 * // Execute with retry
 * const signature = await new TransactionBuilder({ rpc, autoRetry: true })
 *   .setFeePayer(address)
 *   .addInstruction(ix)
 *   .execute({ rpcSubscriptions });
 *
 * // Simulate first
 * const result = await new TransactionBuilder({ rpc })
 *   .setFeePayer(address)
 *   .addInstruction(ix)
 *   .simulate();
 *
 * // Export for custom transport
 * const { data: base64Tx } = await new TransactionBuilder({ rpc })
 *   .setFeePayer(address)
 *   .addInstruction(ix)
 *   .export('base64');
 * ```
 *
 * @packageDocumentation
 */

import type { Address } from '@solana/addresses';
import type { Instruction } from '@solana/instructions';
import type { TransactionMessage } from '@solana/transaction-messages';
import type { Blockhash } from '@solana/rpc-types';
import type {
  Rpc,
  GetLatestBlockhashApi,
  GetAccountInfoApi,
  GetEpochInfoApi,
  GetSignatureStatusesApi,
  SendTransactionApi,
  SimulateTransactionApi,
} from '@solana/rpc';
import type {
  RpcSubscriptions,
  SignatureNotificationsApi,
  SlotNotificationsApi,
} from '@solana/rpc-subscriptions';
import { pipe } from '@solana/functional';
import {
  createTransactionMessage,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  setTransactionMessageLifetimeUsingDurableNonce,
  appendTransactionMessageInstruction,
} from '@solana/transaction-messages';
import { signTransactionMessageWithSigners, addSignersToTransactionMessage, type TransactionSigner } from '@solana/signers';
import { sendAndConfirmTransactionFactory, getSignatureFromTransaction } from '@solana/kit';
import { 
  getBase64EncodedWireTransaction,
  getTransactionEncoder,
  getTransactionMessageSize,
  TRANSACTION_SIZE_LIMIT,
  type Base64EncodedWireTransaction,
} from '@solana/transactions';
import { getBase58Decoder } from '@solana/codecs-strings';
import { SolanaError, SOLANA_ERROR__TRANSACTION__FEE_PAYER_MISSING } from '@solana/errors';
import type { BuilderState, RequiredState, LifetimeConstraint, ExecuteConfig } from '../types.js';
import { validateTransaction, validateTransactionSize } from '../validation/index.js';
import { packInstructions } from '../packing/index.js';

// Import new modules
import {
  type PriorityFeeConfig,
  type ComputeUnitConfig,
  createSetComputeUnitPriceInstruction,
  createSetComputeUnitLimitInstruction,
  estimatePriorityFee,
  PRIORITY_FEE_LEVELS,
  type PriorityFeeLevel,
} from '../compute-budget/index.js';
import { fetchNonceValue, type DurableNonceConfig } from '../nonce/index.js';
import {
  type AddressesByLookupTableAddress,
  fetchAddressLookupTables,
  compressTransactionMessage,
} from '../lookup-tables/index.js';

// ============================================================================
// Export Types
// ============================================================================

/**
 * Supported transaction export formats.
 * - `base64`: Default RPC format, compatible with sendTransaction
 * - `base58`: Human-readable, useful for block explorers and sharing
 * - `bytes`: Raw bytes, useful for hardware wallets
 */
export type ExportFormat = 'base64' | 'base58' | 'bytes';

/**
 * Exported transaction in various formats.
 */
export type ExportedTransaction = 
  | { format: 'base64'; data: Base64EncodedWireTransaction }
  | { format: 'base58'; data: string }
  | { format: 'bytes'; data: Uint8Array };

// Note: Compute budget constants and helpers are now imported from ../compute-budget/index.js

/**
 * Configuration for transaction builder.
 */
export interface TransactionBuilderConfig {
  /**
   * Transaction version (0 for versioned transactions, 'legacy' for legacy).
   */
  version?: 0 | 'legacy';
  
  /**
   * RPC client for auto-fetching blockhash when not explicitly provided.
   */
  rpc?: Rpc<GetLatestBlockhashApi & GetAccountInfoApi>;
  
  /**
   * Auto-retry failed transactions.
   * - `true`: Use default retry (3 attempts, exponential backoff)
   * - `false`: No retry
   * - Object: Custom retry configuration
   */
  autoRetry?: boolean | { maxAttempts: number; backoff: 'linear' | 'exponential' };
  
  /**
   * Logging level.
   */
  logLevel?: 'silent' | 'minimal' | 'verbose';
  
  /**
   * Priority fee configuration.
   * - PriorityFeeLevel string: Use preset level ('none', 'low', 'medium', 'high', 'veryHigh')
   * - PriorityFeeConfig object: Use custom configuration with strategy
   */
  priorityFee?: PriorityFeeLevel | PriorityFeeConfig;
  
  /**
   * Compute unit configuration.
   * - 'auto': Use default (200,000 CU, no explicit instruction)
   * - number: Use fixed compute unit limit
   * - ComputeUnitConfig object: Use custom configuration with strategy
   */
  computeUnits?: 'auto' | number | ComputeUnitConfig;
  
  /**
   * Address lookup table addresses to fetch and use for compression.
   * Only works with version 0 transactions.
   */
  lookupTableAddresses?: Address[];
  
  /**
   * Pre-fetched lookup table data.
   * Use this to avoid fetching if you already have the data.
   */
  addressesByLookupTable?: AddressesByLookupTableAddress;
}

/**
 * Result from transaction simulation.
 */
export interface SimulationResult {
  /**
   * Error if simulation failed, null otherwise.
   */
  err: unknown | null;
  /**
   * Log messages from simulation.
   */
  logs: string[] | null;
  /**
   * Compute units consumed during simulation.
   */
  unitsConsumed: bigint | undefined;
  /**
   * Return data from program execution.
   */
  returnData: any;
}

/**
 * Unified transaction builder with type-safe state tracking and smart defaults.
 */
export class TransactionBuilder<TState extends BuilderState = BuilderState> {
  private feePayer?: Address;
  private feePayerSigner?: TransactionSigner;
  private lifetime?: LifetimeConstraint;
  private instructions: Instruction[] = [];
  
  private config: {
    version: 0 | 'legacy';
    rpc: Rpc<GetLatestBlockhashApi & GetAccountInfoApi> | undefined;
    autoRetry: boolean | { maxAttempts: number; backoff: 'linear' | 'exponential' };
    logLevel: 'silent' | 'minimal' | 'verbose';
    priorityFee: PriorityFeeLevel | PriorityFeeConfig;
    computeUnits: 'auto' | number | ComputeUnitConfig;
    lookupTableAddresses?: Address[];
    addressesByLookupTable?: AddressesByLookupTableAddress;
  };

  constructor(config: TransactionBuilderConfig = {}) {
    this.config = {
      version: config.version ?? 0,
      rpc: config.rpc,
      autoRetry: config.autoRetry ?? { maxAttempts: 3, backoff: 'exponential' },
      logLevel: config.logLevel ?? 'minimal',
      priorityFee: config.priorityFee ?? 'medium',
      computeUnits: config.computeUnits ?? 'auto',
      ...(config.lookupTableAddresses && { lookupTableAddresses: config.lookupTableAddresses }),
      ...(config.addressesByLookupTable && { addressesByLookupTable: config.addressesByLookupTable }),
    };
  }

  /**
   * Create a TransactionBuilder configured for durable nonce transactions.
   * Automatically fetches the current nonce value from the account.
   *
   * @param config - Durable nonce configuration
   * @returns TransactionBuilder with nonce lifetime already set
   *
   * @example
   * ```ts
   * const builder = await TransactionBuilder.withDurableNonce({
   *   rpc,
   *   nonceAccountAddress: address('...'),
   *   nonceAuthorityAddress: address('...'),
   * });
   * 
   * await builder
   *   .setFeePayer(feePayer)
   *   .addInstruction(ix)
   *   .execute({ rpcSubscriptions });
   * ```
   */
  static async withDurableNonce(
    config: DurableNonceConfig & { rpc: Rpc<GetLatestBlockhashApi & GetAccountInfoApi> } & Omit<TransactionBuilderConfig, 'rpc'>
  ): Promise<TransactionBuilder<{ lifetime: true }>> {
    const { nonceAccountAddress, nonceAuthorityAddress, nonce: providedNonce, rpc, ...builderConfig } = config;
    
    // Fetch nonce if not provided
    const nonce = providedNonce ?? await fetchNonceValue(rpc, nonceAccountAddress);
    
    // Create builder with nonce lifetime already set
    const builder = new TransactionBuilder({ rpc, ...builderConfig });
    builder.lifetime = {
      type: 'nonce',
      nonce,
      nonceAccountAddress,
      nonceAuthorityAddress,
    };
    
    return builder as TransactionBuilder<{ lifetime: true }>;
  }

  /**
   * Set the fee payer for the transaction using just an address.
   * Note: When using execute(), you should use setFeePayerSigner() instead
   * to properly sign the transaction.
   */
  setFeePayer<TAddress extends string>(
    feePayer: Address<TAddress>
  ): TransactionBuilder<TState & { feePayer: true }> {
    const builder = this.clone();
    builder.feePayer = feePayer;
    return builder as TransactionBuilder<TState & { feePayer: true }>;
  }

  /**
   * Set the fee payer for the transaction using a signer.
   * This is the recommended method when using execute() as it properly
   * signs the transaction.
   */
  setFeePayerSigner(
    signer: TransactionSigner
  ): TransactionBuilder<TState & { feePayer: true }> {
    const builder = this.clone();
    builder.feePayer = signer.address;
    builder.feePayerSigner = signer;
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
   * Automatically prepends compute budget instructions if configured.
   * Applies address lookup table compression if configured (version 0 only).
   */
  async build(
    this: TransactionBuilder<RequiredState>
  ): Promise<TransactionMessage> {
    if (!this.feePayer) {
      throw new SolanaError(SOLANA_ERROR__TRANSACTION__FEE_PAYER_MISSING);
    }

    // AUTO-FETCH: If lifetime not set but RPC available, fetch latest blockhash
    if (!this.lifetime && this.config.rpc) {
      const { value } = await this.config.rpc.getLatestBlockhash().send();
      this.lifetime = {
        type: 'blockhash',
        blockhash: value.blockhash,
        lastValidBlockHeight: value.lastValidBlockHeight,
      };
    }

    if (!this.lifetime) {
      throw new Error(
        'Lifetime required. Provide blockhash via setBlockhashLifetime() or pass rpc to constructor for auto-fetch.'
      );
    }

    // Fetch lookup tables if addresses provided but data not
    let lookupTableData = this.config.addressesByLookupTable;
    if (!lookupTableData && this.config.lookupTableAddresses?.length && this.config.rpc) {
      lookupTableData = await fetchAddressLookupTables(
        this.config.rpc,
        this.config.lookupTableAddresses
      );
    }

    // Build using Kit's functional API with pipe
    let message: any = pipe(
      createTransactionMessage({ version: this.config.version }),
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
    
    // Attach fee payer signer if available
    if (this.feePayerSigner) {
      message = addSignersToTransactionMessage([this.feePayerSigner], message);
    }

    // ADD COMPUTE BUDGET INSTRUCTIONS FIRST (if configured)
    // Order matters: limit first, then price
    
    // 1. Compute unit limit
    const computeUnits = await this.resolveComputeUnits();
    if (computeUnits !== null) {
      message = appendTransactionMessageInstruction(
        createSetComputeUnitLimitInstruction(computeUnits),
        message
      );
    }
    
    // 2. Priority fee / compute unit price
    const priorityFee = await this.resolvePriorityFee();
    if (priorityFee > 0) {
      message = appendTransactionMessageInstruction(
        createSetComputeUnitPriceInstruction(priorityFee),
        message
      );
    }

    // Add user's instructions after compute budget instructions
    for (const instruction of this.instructions) {
      message = appendTransactionMessageInstruction(instruction, message);
    }

    // Apply address lookup table compression (version 0 only)
    if (lookupTableData && this.config.version === 0) {
      message = compressTransactionMessage(message, lookupTableData);
    }

    // Auto-validate before returning
    validateTransaction(message);
    validateTransactionSize(message);

    return message;
  }

  /**
   * Resolve priority fee based on configuration.
   */
  private async resolvePriorityFee(): Promise<number> {
    const { priorityFee } = this.config;
    
    // String level (preset)
    if (typeof priorityFee === 'string') {
      return PRIORITY_FEE_LEVELS[priorityFee] ?? 0;
    }
    
    // Config object
    if (priorityFee.strategy === 'none') {
      return 0;
    }
    
    if (priorityFee.strategy === 'fixed') {
      return priorityFee.microLamports ?? 0;
    }
    
    // Percentile strategy - requires RPC
    if (priorityFee.strategy === 'percentile' && this.config.rpc) {
      const estimate = await estimatePriorityFee(
        this.config.rpc as any,
        priorityFee
      );
      return estimate.microLamports;
    }
    
    // Fallback to medium
    return PRIORITY_FEE_LEVELS.medium;
  }

  /**
   * Resolve compute units based on configuration.
   * Returns null if no compute unit instruction should be added.
   */
  private async resolveComputeUnits(): Promise<number | null> {
    const { computeUnits } = this.config;
    
    // 'auto' = no explicit instruction
    if (computeUnits === 'auto') {
      return null;
    }
    
    // Fixed number
    if (typeof computeUnits === 'number') {
      return computeUnits;
    }
    
    // Config object
    if (computeUnits.strategy === 'auto') {
      return null;
    }
    
    if (computeUnits.strategy === 'fixed') {
      return computeUnits.units ?? 200_000;
    }
    
    // Simulate strategy - would need simulation first
    // For now, return a sensible default
    if (computeUnits.strategy === 'simulate') {
      // Simulation-based compute unit estimation would be done during execute()
      // For build(), return a safe default
      return computeUnits.units ?? 200_000;
    }
    
    return null;
  }

  /**
   * Simulate the transaction without sending it.
   * Useful for testing and debugging before execution.
   * 
   * Note: Requires feePayer to be set and RPC in config.
   */
  async simulate(params?: {
    commitment?: 'processed' | 'confirmed' | 'finalized';
  }): Promise<SimulationResult> {
    const commitment = params?.commitment ?? 'confirmed';
    
    if (!this.feePayer) {
      throw new SolanaError(SOLANA_ERROR__TRANSACTION__FEE_PAYER_MISSING);
    }
    
    if (!this.config.rpc) {
      throw new Error('RPC required for simulation. Pass rpc in constructor.');
    }
    
    // Build message using the unified build method
    const message = await (this as any).build();
    
    // Sign for simulation
    const signedTransaction: any = await signTransactionMessageWithSigners(message);
    
    // Simulate using Kit's API
    const rpcWithSim = this.config.rpc as unknown as Rpc<SimulateTransactionApi>;
    const result = await rpcWithSim.simulateTransaction(signedTransaction, { 
      commitment,
      replaceRecentBlockhash: true,
    }).send();
    
    return {
      err: result.value.err,
      logs: result.value.logs,
      unitsConsumed: result.value.unitsConsumed,
      returnData: result.value.returnData,
    };
  }

  /**
   * Sign and export the transaction in specified format WITHOUT sending.
   * 
   * Use this when you want to:
   * - Send via custom transport or different RPC
   * - Store signed transactions for batch sending
   * - Use with hardware wallets
   * - Generate QR codes for mobile wallets
   * - Pass transactions to other systems
   * 
   * @param format - Export format: 'base64' (default), 'base58', or 'bytes'
   * @returns Serialized signed transaction
   * 
   * @example
   * ```ts
   * // Export for custom RPC
   * const { data: base64Tx } = await builder.export('base64');
   * await customRpc.sendTransaction(base64Tx, { encoding: 'base64' });
   * 
   * // Export for hardware wallet
   * const { data: bytes } = await builder.export('bytes');
   * await ledger.signTransaction(bytes);
   * 
   * // Export for QR code
   * const { data: base58Tx } = await builder.export('base58');
   * displayQRCode(base58Tx);
   * ```
   */
  async export(format: ExportFormat = 'base64'): Promise<ExportedTransaction> {
    if (!this.feePayer) {
      throw new SolanaError(SOLANA_ERROR__TRANSACTION__FEE_PAYER_MISSING);
    }
    
    if (!this.config.rpc) {
      throw new Error('RPC required for export. Pass rpc in constructor.');
    }
    
    // Build message using the unified build method
    const message = await (this as any).build();
    
    // Sign transaction
    const signedTransaction: any = await signTransactionMessageWithSigners(message);
    
    // Serialize in requested format
    switch (format) {
      case 'base64': {
        const base64 = getBase64EncodedWireTransaction(signedTransaction);
        return { format: 'base64', data: base64 };
      }
      case 'base58': {
        const encoder = getTransactionEncoder();
        const bytes = encoder.encode(signedTransaction);
        const base58Decoder = getBase58Decoder();
        const base58 = base58Decoder.decode(new Uint8Array(bytes));
        return { format: 'base58', data: base58 };
      }
      case 'bytes': {
        const encoder = getTransactionEncoder();
        const bytes = encoder.encode(signedTransaction);
        return { format: 'bytes', data: new Uint8Array(bytes) };
      }
    }
  }

  /**
   * Execute the transaction with smart defaults.
   * 
   * Supports advanced sending options like skipPreflight and maxRetries.
   * 
   * Note: Requires feePayer to be set and RPC in config.
   *
   * @example
   * ```ts
   * // Basic execution
   * const sig = await builder.execute({ rpcSubscriptions });
   *
   * // With sending options
   * const sig = await builder.execute({
   *   rpcSubscriptions,
   *   skipPreflight: false,
   *   skipPreflightOnRetry: true,
   *   maxRetries: 5,
   *   preflightCommitment: 'confirmed',
   * });
   * ```
   */
  async execute(params: {
    rpcSubscriptions: RpcSubscriptions<SignatureNotificationsApi & SlotNotificationsApi>;
  } & ExecuteConfig): Promise<string> {
    const { 
      rpcSubscriptions, 
      commitment = 'confirmed',
      skipPreflight = false,
      skipPreflightOnRetry = true,
      preflightCommitment = 'confirmed',
      maxRetries,
    } = params;
    
    if (!this.feePayer) {
      throw new SolanaError(SOLANA_ERROR__TRANSACTION__FEE_PAYER_MISSING);
    }
    
    if (!this.config.rpc) {
      throw new Error('RPC required for execute. Pass rpc in constructor.');
    }
    
    const rpc = this.config.rpc as unknown as Rpc<GetEpochInfoApi & GetSignatureStatusesApi & SendTransactionApi & GetLatestBlockhashApi>;
    
    // Build message using the unified build method
    const message = await (this as any).build();
    
    // Sign transaction
    const signedTransaction: any = await signTransactionMessageWithSigners(message);
    
    // Use Kit's sendAndConfirmTransactionFactory
    const sendAndConfirm = sendAndConfirmTransactionFactory({ 
      rpc, 
      rpcSubscriptions 
    });
    
    // Add retry logic if enabled
    if (this.config.autoRetry) {
      return this.executeWithRetry(sendAndConfirm, signedTransaction, commitment, {
        skipPreflightOnRetry,
        preflightCommitment,
      });
    }
    
    // Prepare send options (avoid undefined for exactOptionalPropertyTypes)
    const sendOptions: Parameters<typeof sendAndConfirm>[1] = {
      commitment,
      ...(skipPreflight && { skipPreflight }),
      ...(!skipPreflight && { preflightCommitment }),
      ...(maxRetries !== undefined && { maxRetries: BigInt(maxRetries) }),
    };
    
    await sendAndConfirm(signedTransaction, sendOptions);
    return getSignatureFromTransaction(signedTransaction);
  }

  /**
   * Get current transaction size information.
   * Useful before calling build() to check if more instructions can fit.
   *
   * Note: This builds the message to calculate accurate size.
   * Requires feePayer to be set and RPC in config for auto-blockhash.
   *
   * @example
   * ```ts
   * const info = await builder.getSizeInfo();
   * console.log(`Using ${info.percentUsed.toFixed(1)}% of transaction space`);
   * console.log(`${info.remaining} bytes remaining`);
   * ```
   */
  async getSizeInfo(): Promise<{
    size: number;
    limit: number;
    remaining: number;
    percentUsed: number;
    canFitMore: boolean;
  }> {
    // Build message to get accurate size
    const message = await (this as any).build();
    const size = getTransactionMessageSize(message);
    return {
      size,
      limit: TRANSACTION_SIZE_LIMIT,
      remaining: TRANSACTION_SIZE_LIMIT - size,
      percentUsed: (size / TRANSACTION_SIZE_LIMIT) * 100,
      canFitMore: size < TRANSACTION_SIZE_LIMIT,
    };
  }

  /**
   * Add instructions with auto-packing. Returns overflow instructions that did not fit.
   * Useful for batching large instruction sets across multiple transactions.
   *
   * @param instructions - Array of instructions to add
   * @returns Object with the new builder (with packed instructions) and overflow array
   *
   * @example
   * ```ts
   * const { builder: packed, overflow } = await baseBuilder
   *   .addInstructionsWithPacking(manyInstructions);
   *
   * // Execute the first batch
   * await packed.execute({ rpcSubscriptions });
   *
   * // Handle overflow in another transaction
   * if (overflow.length > 0) {
   *   const { builder: packed2 } = await baseBuilder
   *     .addInstructionsWithPacking(overflow);
   *   await packed2.execute({ rpcSubscriptions });
   * }
   * ```
   */
  async addInstructionsWithPacking(
    instructions: readonly Instruction[]
  ): Promise<{ builder: TransactionBuilder<TState>; overflow: Instruction[] }> {
    if (!this.feePayer) {
      throw new SolanaError(SOLANA_ERROR__TRANSACTION__FEE_PAYER_MISSING);
    }
    
    if (!this.config.rpc) {
      throw new Error('RPC required for packing. Pass rpc in constructor.');
    }
    
    // Build a base message to calculate sizes against
    const baseMessage = await (this as any).build();
    
    // Pack instructions
    const result = packInstructions(baseMessage, [...instructions]);
    
    // Create a new builder with the packed instructions
    const builder = this.clone();
    builder.instructions = [...this.instructions, ...result.packed];
    
    return {
      builder,
      overflow: result.overflow,
    };
  }

  /**
   * Execute transaction with retry logic.
   */
  private async executeWithRetry(
    sendAndConfirm: ReturnType<typeof sendAndConfirmTransactionFactory>,
    transaction: any,
    commitment: 'processed' | 'confirmed' | 'finalized',
    options?: {
      skipPreflightOnRetry?: boolean;
      preflightCommitment?: 'processed' | 'confirmed' | 'finalized';
    }
  ): Promise<string> {
    const retryConfig = this.config.autoRetry === true 
      ? { maxAttempts: 3, backoff: 'exponential' as const }
      : this.config.autoRetry;
    
    if (!retryConfig || typeof retryConfig === 'boolean') {
      throw new Error('Invalid retry configuration');
    }
    
    const { maxAttempts, backoff } = retryConfig;
    const { skipPreflightOnRetry = true, preflightCommitment = 'confirmed' } = options ?? {};
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        if (this.config.logLevel !== 'silent') {
          console.log(`[Pipeit] Transaction attempt ${attempt}/${maxAttempts}`);
        }
        
        // Skip preflight on retry attempts if enabled
        const shouldSkipPreflight = attempt > 1 && skipPreflightOnRetry;
        const sendOptions: Parameters<typeof sendAndConfirm>[1] = {
          commitment,
          ...(shouldSkipPreflight && { skipPreflight: true }),
          ...(!shouldSkipPreflight && { preflightCommitment }),
        };
        
        await sendAndConfirm(transaction, sendOptions);
        return getSignatureFromTransaction(transaction);
      } catch (error) {
        if (attempt === maxAttempts) {
          if (this.config.logLevel === 'verbose') {
            console.error(`[Pipeit] Transaction failed after ${maxAttempts} attempts:`, error);
            const cause = (error as any)?.cause;
            if (cause) {
              console.error('[Pipeit] Error cause:', cause);
              const causeLogs =
                (cause as any)?.logs ??
                (cause as any)?.data?.logs ??
                (cause as any)?.simulationResponse?.logs;
              if (causeLogs) {
                const logs = Array.isArray(causeLogs) ? causeLogs : [String(causeLogs)];
                console.error('[Pipeit] Cause logs:\n' + logs.join('\n'));
              }
            }
            const context = (error as any)?.context ?? (error as any)?.data;
            if (context) {
              console.error('[Pipeit] Error context:', context);
            }
          }
          const maybeLogs =
            (error as any)?.logs ??
            (error as any)?.data?.logs ??
            (error as any)?.simulationResponse?.logs;
          if (maybeLogs) {
            const logs = Array.isArray(maybeLogs) ? maybeLogs : [String(maybeLogs)];
            console.error('[Pipeit] Simulation logs:\n' + logs.join('\n'));
          } else if (this.config.logLevel === 'verbose') {
            console.error('[Pipeit] Transaction error details (no logs found):', error);
          }
          throw error;
        }
        
        const delay = backoff === 'exponential' 
          ? Math.pow(2, attempt - 1) * 1000 
          : attempt * 1000;
        
        if (this.config.logLevel === 'verbose') {
          console.log(`[Pipeit] Retrying in ${delay}ms...`);
        }
        
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    throw new Error('Transaction failed after retries');
  }

  /**
   * Clone the builder for immutability.
   */
  private clone(): TransactionBuilder<TState> {
    const builder = new TransactionBuilder<TState>({ 
      version: this.config.version,
      ...(this.config.rpc && { rpc: this.config.rpc }),
      autoRetry: this.config.autoRetry,
      logLevel: this.config.logLevel,
      priorityFee: this.config.priorityFee,
      computeUnits: this.config.computeUnits,
      ...(this.config.lookupTableAddresses && { lookupTableAddresses: this.config.lookupTableAddresses }),
      ...(this.config.addressesByLookupTable && { addressesByLookupTable: this.config.addressesByLookupTable }),
    });
    if (this.feePayer !== undefined) {
      builder.feePayer = this.feePayer;
    }
    if (this.feePayerSigner !== undefined) {
      builder.feePayerSigner = this.feePayerSigner;
    }
    if (this.lifetime !== undefined) {
      builder.lifetime = this.lifetime;
    }
    builder.instructions = [...this.instructions];
    return builder;
  }
}

