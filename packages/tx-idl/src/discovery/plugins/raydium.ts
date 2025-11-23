/**
 * Raydium CLMM swap account resolution plugin.
 *
 * Automatically resolves accounts for Raydium CLMM swap instructions by:
 * - Deriving pool address from token mints (deterministic PDA)
 * - Querying on-chain pool state to get vaults and config
 * - Deriving user Associated Token Accounts
 *
 * @packageDocumentation
 */

import { address, getProgramDerivedAddress, getAddressEncoder, getAddressDecoder, type Address } from '@solana/addresses';
import type { Rpc, GetAccountInfoApi } from '@solana/rpc';
import type { Instruction } from '@solana/instructions';
import type { IdlInstruction } from '../../types.js';
import type { ProtocolAccountPlugin } from './plugin.js';
import type { DiscoveryContext } from '../types.js';
import { WELL_KNOWN_PROGRAMS } from '../strategies/constants.js';
import {
  SOL_MINT,
  wrapSolInstructions,
  unwrapSolInstruction,
} from '../utils/wsol.js';

const MAX_SQRT_PRICE_X64 = 79228162514264337593543950336n; // 2^96, TickMath::MAX_SQRT_PRICE_X64
const MIN_SQRT_PRICE_X64 = 4295128739n; // TickMath::MIN_SQRT_PRICE_X64

function readBigUint128LE(bytes: Uint8Array): bigint {
  let result = 0n;
  for (let i = 0; i < 16; i++) {
    result |= BigInt(bytes[i] ?? 0) << BigInt(8 * i);
  }
  return result;
}

/**
 * Raydium CLMM program address.
 */
export const RAYDIUM_CLMM_PROGRAM = address('CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK');

/**
 * Plugin for resolving Raydium CLMM swap instruction accounts.
 *
 * This plugin automatically resolves:
 * - Pool address (derived from token mints + amm config)
 * - Pool state (queried on-chain to get vaults, observation state, amm config)
 * - User token accounts (ATAs for input/output tokens)
 * - Well-known program accounts
 */
export class RaydiumSwapPlugin implements ProtocolAccountPlugin {
  id = 'raydium-swap';
  programId = RAYDIUM_CLMM_PROGRAM;
  instructions = ['swap_v2'];

  /**
   * Prepare parameters by transforming camelCase to snake_case for IDL.
   * Keeps non-IDL parameters (inputMint, outputMint, poolAddress) for account discovery.
   * Automatically sets sqrt_price_limit_x64 if not provided based on swap direction.
   */
  async prepareParams(
    params: Record<string, unknown>,
    context: DiscoveryContext
  ): Promise<Record<string, unknown>> {
    const prepared: Record<string, unknown> = { ...params };

    const inputMint = this.getMintFromParams(params, 'inputMint', 'input_mint');
    const outputMint = this.getMintFromParams(params, 'outputMint', 'output_mint');
    const [sortedMint0, sortedMint1] =
      inputMint && outputMint ? this.sortMints(inputMint, outputMint) : [null, null];
    const defaultIsZeroForOne =
      inputMint && sortedMint0 ? this.addressEquals(inputMint, sortedMint0) : true;

    // Transform camelCase to snake_case for IDL parameters
    if (prepared.otherAmountThreshold !== undefined) {
      prepared.other_amount_threshold = prepared.otherAmountThreshold;
      delete prepared.otherAmountThreshold;
    }
    
    // Handle sqrt_price_limit_x64
    if (prepared.sqrtPriceLimitX64 !== undefined) {
      prepared.sqrt_price_limit_x64 = prepared.sqrtPriceLimitX64;
      delete prepared.sqrtPriceLimitX64;
    } else if (prepared.sqrt_price_limit_x64 === undefined) {
      if (inputMint && outputMint && context.rpc) {
        try {
          const poolAddressParam = this.getMintFromParams(params, 'poolAddress', 'pool_address');
          const resolved = await this.resolvePoolState(
            poolAddressParam,
            sortedMint0 ?? inputMint,
            sortedMint1 ?? outputMint,
            params,
            context.rpc,
            inputMint,
            outputMint
          );
          const isZeroForOne = this.addressEquals(inputMint, resolved.poolData.tokenMint0);
          // sqrt_price_limit_x64 is the maximum price movement allowed
          // For zero-for-one (price decreasing): set to MIN to allow full downward movement
          // For one-for-zero (price increasing): set to MAX to allow full upward movement
          prepared.sqrt_price_limit_x64 = isZeroForOne
            ? MIN_SQRT_PRICE_X64
            : MAX_SQRT_PRICE_X64;
        } catch (error) {
          console.warn('[Raydium Plugin] Failed to derive sqrt_price_limit_x64, using fallback:', error);
          prepared.sqrt_price_limit_x64 = defaultIsZeroForOne
            ? MIN_SQRT_PRICE_X64
            : MAX_SQRT_PRICE_X64;
        }
      } else {
        prepared.sqrt_price_limit_x64 = defaultIsZeroForOne
          ? MIN_SQRT_PRICE_X64
          : MAX_SQRT_PRICE_X64;
      }
    }
    
    if (prepared.isBaseInput !== undefined) {
      prepared.is_base_input = prepared.isBaseInput;
      delete prepared.isBaseInput;
    }

    // Note: inputMint, outputMint, poolAddress, ammConfigIndex are kept for account discovery
    // They will be filtered out during instruction encoding since they're not in the IDL args

    return prepared;
  }

  /**
   * Prepare instructions to wrap/unwrap SOL if needed.
   * Automatically handles wSOL wrapping for SOL input and unwrapping for SOL output.
   */
  async prepareInstructions(
    instruction: IdlInstruction,
    params: Record<string, unknown>,
    context: DiscoveryContext
  ): Promise<{
    preInstructions?: Instruction[];
    postInstructions?: Instruction[];
  }> {
    // Log RPC URL to verify which network we're on
    console.log('[Raydium Plugin] prepareInstructions - RPC available:', !!context.rpc);
    
    const preInstructions: Instruction[] = [];
    const postInstructions: Instruction[] = [];

    // Get input and output mints from params
    const inputMint = this.getMintFromParams(params, 'inputMint', 'input_mint');
    const outputMint = this.getMintFromParams(params, 'outputMint', 'output_mint');

    if (!inputMint || !outputMint) {
      // Can't determine if wrapping is needed without mints
      return { preInstructions, postInstructions };
    }

    // Check if input is SOL - need to wrap before swap
    if (this.addressEquals(inputMint, SOL_MINT)) {
      // Get amount from params (could be 'amount' or 'amountIn' or similar)
      const amount = this.getAmountFromParams(params);
      if (amount && amount > 0n) {
        const wrapInstructions = await wrapSolInstructions(context.signer, amount);
        preInstructions.push(...wrapInstructions);
      }
    } else {
      // For non-SOL input, check if input ATA exists and create if needed
      const inputAta = await this.deriveAta(inputMint, context.signer, context.rpc);
      const inputAtaInfo = await context.rpc.getAccountInfo(inputAta, { encoding: 'base64' }).send();
      if (!inputAtaInfo.value) {
        console.log(`[Raydium Plugin] Creating input ATA for ${inputMint.toString()}`);
        const createAtaIx = await this.createAtaInstruction(inputMint, context.signer, context.signer, context.rpc);
        preInstructions.push(createAtaIx);
      }
    }

    // Check if output ATA exists and create if needed (unless it's SOL, which is handled separately)
    if (!this.addressEquals(outputMint, SOL_MINT)) {
      const outputAta = await this.deriveAta(outputMint, context.signer, context.rpc);
      const outputAtaInfo = await context.rpc.getAccountInfo(outputAta, { encoding: 'base64' }).send();
      if (!outputAtaInfo.value) {
        console.log(`[Raydium Plugin] Creating output ATA for ${outputMint.toString()}`);
        const createAtaIx = await this.createAtaInstruction(outputMint, context.signer, context.signer, context.rpc);        preInstructions.push(createAtaIx);
      }
    }

    // Check if output is SOL - need to unwrap after swap
    if (this.addressEquals(outputMint, SOL_MINT)) {
      const unwrapIx = await unwrapSolInstruction(context.signer);
      postInstructions.push(unwrapIx);
    }

    const result: {
      preInstructions?: Instruction[];
      postInstructions?: Instruction[];
    } = {};

    if (preInstructions && preInstructions.length > 0) {
      result.preInstructions = preInstructions;
    }
    if (postInstructions && postInstructions.length > 0) {
      result.postInstructions = postInstructions;
    }

    return result;
  }

  async resolveAccounts(
    instruction: IdlInstruction,
    params: Record<string, unknown>,
    context: DiscoveryContext
  ): Promise<Record<string, Address>> {
    const accounts: Record<string, Address> = {};

    // Get input and output mints from params
    const inputMint = this.getMintFromParams(params, 'inputMint', 'input_mint');
    const outputMint = this.getMintFromParams(params, 'outputMint', 'output_mint');

    if (!inputMint || !outputMint) {
      throw new Error(
        'Raydium swap requires inputMint and outputMint parameters. ' +
          'Provide them as inputMint/outputMint or input_mint/output_mint.'
      );
    }

    // Check if pool address is provided directly (highest priority)
    const poolAddressParam = this.getMintFromParams(params, 'poolAddress', 'pool_address');
    const [tokenMint0, tokenMint1] = this.sortMints(inputMint, outputMint);

    // Resolve pool state and data
    const resolved = await this.resolvePoolState(
      poolAddressParam,
      tokenMint0,
      tokenMint1,
      params,
      context.rpc,
      inputMint,
      outputMint
    );
    const { poolData, poolState, ammConfig } = resolved;

    // Determine which token is input/output based on swap direction
    const isZeroForOne = this.addressEquals(inputMint, poolData.tokenMint0);
    const inputVault = isZeroForOne ? poolData.tokenVault0 : poolData.tokenVault1;
    const outputVault = isZeroForOne ? poolData.tokenVault1 : poolData.tokenVault0;
    const inputVaultMint = isZeroForOne ? poolData.tokenMint0 : poolData.tokenMint1;
    const outputVaultMint = isZeroForOne ? poolData.tokenMint1 : poolData.tokenMint0;

    // Derive user token accounts (ATAs) using correct token program
    const inputTokenAccount = await this.deriveAta(inputMint, context.signer, context.rpc);
    const outputTokenAccount = await this.deriveAta(outputMint, context.signer, context.rpc);

    console.log('[Raydium Plugin] Pool token configuration:', {
      pool_address: poolState.toString(),
      pool_token0: poolData.tokenMint0.toString(),
      pool_token1: poolData.tokenMint1.toString(), 
      input_vault_mint: inputVaultMint.toString(),
      output_vault_mint: outputVaultMint.toString(),
      user_input: inputMint.toString(),
      user_output: outputMint.toString(),
      is_zero_for_one: isZeroForOne,
      tokens_match: {
        input_matches_token0: poolData.tokenMint0.toString() === inputMint.toString(),
        input_matches_token1: poolData.tokenMint1.toString() === inputMint.toString(),
        output_matches_token0: poolData.tokenMint0.toString() === outputMint.toString(),
        output_matches_token1: poolData.tokenMint1.toString() === outputMint.toString(),
      }
    });
    
    // Validate that the tokens match
    const inputMatchesPool = 
      poolData.tokenMint0.toString() === inputMint.toString() ||
      poolData.tokenMint1.toString() === inputMint.toString();
    const outputMatchesPool = 
      poolData.tokenMint0.toString() === outputMint.toString() ||
      poolData.tokenMint1.toString() === outputMint.toString();
      
    if (!inputMatchesPool || !outputMatchesPool) {
      throw new Error(
        `Token mismatch! Pool contains [${poolData.tokenMint0.toString()}, ${poolData.tokenMint1.toString()}] ` +
        `but you're trying to swap [${inputMint.toString()}] → [${outputMint.toString()}]. ` +
        `Make sure you're using the correct pool address for these tokens.`
      );
    }

    // Map accounts to IDL account names
    accounts.payer = context.signer;
    accounts.amm_config = ammConfig;
    accounts.pool_state = poolState;
    accounts.input_token_account = inputTokenAccount;
    accounts.output_token_account = outputTokenAccount;
    accounts.input_vault = inputVault;
    accounts.output_vault = outputVault;
    accounts.observation_state = poolData.observationKey;
    accounts.token_program = WELL_KNOWN_PROGRAMS.tokenProgram;
    accounts.token_program_2022 = WELL_KNOWN_PROGRAMS.token2022Program;
    accounts.memo_program = address('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
    accounts.input_vault_mint = inputVaultMint;
    accounts.output_vault_mint = outputVaultMint;

    return accounts;
  }

  /**
   * Get mint address from params (supports multiple naming conventions).
   */
  private getMintFromParams(
    params: Record<string, unknown>,
    ...keys: string[]
  ): Address | null {
    for (const key of keys) {
      const value = params[key];
      if (value) {
        return address(value as string);
      }
    }
    return null;
  }

  /**
   * Get amount from params (supports multiple naming conventions).
   */
  private getAmountFromParams(params: Record<string, unknown>): bigint | null {
    const amountKeys = ['amount', 'amountIn', 'amount_in', 'inputAmount', 'input_amount'];
    for (const key of amountKeys) {
      const value = params[key];
      if (value !== undefined && value !== null) {
        if (typeof value === 'bigint') {
          return value;
        }
        if (typeof value === 'number') {
          return BigInt(value);
        }
        if (typeof value === 'string') {
          return BigInt(value);
        }
      }
    }
    return null;
  }

  /**
   * Sort two mints so mint0 < mint1 (required for pool PDA derivation).
   */
  private sortMints(mint1: Address, mint2: Address): [Address, Address] {
    // Compare addresses lexicographically
    const m1 = mint1.toString();
    const m2 = mint2.toString();
    return m1 < m2 ? [mint1, mint2] : [mint2, mint1];
  }

  /**
   * Check if two addresses are equal.
   */
  private addressEquals(addr1: Address, addr2: Address): boolean {
    return addr1.toString() === addr2.toString();
  }

  /**
   * Resolve pool state by trying different strategies.
   */
  private async resolvePoolState(
    poolAddressParam: Address | null,
    tokenMint0: Address,
    tokenMint1: Address,
    params: Record<string, unknown>,
    rpc: Rpc<GetAccountInfoApi>,
    inputMint: Address,
    outputMint: Address
  ): Promise<{
    poolData: {
      ammConfig: Address;
      tokenMint0: Address;
      tokenMint1: Address;
      tokenVault0: Address;
      tokenVault1: Address;
      observationKey: Address;
      sqrtPriceX64: bigint;
    };
    poolState: Address;
    ammConfig: Address;
  }> {
    if (poolAddressParam) {
      // Use provided pool address directly
      const poolData = await this.getPoolState(poolAddressParam, rpc);
      return {
        poolData,
        poolState: poolAddressParam,
        ammConfig: poolData.ammConfig,
      };
    }

    // Try to derive pool address
    const specifiedAmmConfigIndex = params.ammConfigIndex as number | undefined;

    if (specifiedAmmConfigIndex !== undefined) {
      // Use specified index
      const ammConfig = await this.deriveAmmConfig(specifiedAmmConfigIndex);
      const poolState = await this.derivePoolState(ammConfig, tokenMint0, tokenMint1);
      const poolData = await this.getPoolState(poolState, rpc);
      return { poolData, poolState, ammConfig };
    }

    // Try multiple AMM config indices to find a valid pool
    const maxAttempts = 5;
    let lastAttemptedPool: Address | null = null;

    for (let i = 0; i < maxAttempts; i++) {
      try {
        const ammConfig = await this.deriveAmmConfig(i);
        const poolState = await this.derivePoolState(ammConfig, tokenMint0, tokenMint1);
        lastAttemptedPool = poolState;
        const poolData = await this.getPoolState(poolState, rpc);
        return { poolData, poolState, ammConfig };
      } catch (error) {
        // Continue to next index
        if (i === maxAttempts - 1) {
          // Last attempt failed, throw error with helpful message
          throw new Error(
            `Pool not found for ${inputMint.toString()}/${outputMint.toString()} after trying ${maxAttempts} AMM config indices (0-${maxAttempts - 1}). ` +
              `Last attempted pool: ${lastAttemptedPool?.toString() || 'unknown'}. ` +
              `Try specifying a poolAddress parameter with a known pool address, or a different ammConfigIndex parameter, or verify the pool exists on Raydium CLMM.`
          );
        }
      }
    }

    // This should never be reached, but TypeScript needs it
    throw new Error('Failed to resolve pool state');
  }

  /**
   * Derive AMM config PDA.
   * Seeds: ["amm_config", index]
   */
  private async deriveAmmConfig(index: number): Promise<Address> {
    const ammConfigBytes = Buffer.from('amm_config');
    const indexBytes = Buffer.allocUnsafe(2);
    indexBytes.writeUInt16LE(index, 0);

    const [ammConfig] = await getProgramDerivedAddress({
      programAddress: this.programId,
      seeds: [ammConfigBytes, indexBytes],
    });

    return ammConfig;
  }

  /**
   * Derive pool state PDA.
   * Seeds: ["pool", amm_config, token_mint_0, token_mint_1]
   */
  private async derivePoolState(
    ammConfig: Address,
    tokenMint0: Address,
    tokenMint1: Address
  ): Promise<Address> {
    const poolBytes = Buffer.from('pool');
    const ammConfigBytes = new Uint8Array(getAddressEncoder().encode(ammConfig));
    const mint0Bytes = new Uint8Array(getAddressEncoder().encode(tokenMint0));
    const mint1Bytes = new Uint8Array(getAddressEncoder().encode(tokenMint1));

    const [poolState] = await getProgramDerivedAddress({
      programAddress: this.programId,
      seeds: [poolBytes, ammConfigBytes, mint0Bytes, mint1Bytes],
    });

    return poolState;
  }

  /**
   * Get remaining accounts (tick arrays) needed for swap_v2.
   * Raydium CLMM requires tick arrays as remaining accounts that aren't in the IDL.
   *
   * For swaps, we need multiple tick arrays:
   * - The tick array containing the current tick
   * - Additional tick arrays in the swap direction (lower for zero-for-one, upper for one-for-zero)
   *
   * The program will traverse these tick arrays during the swap to find liquidity.
   */
  async getRemainingAccounts(
    instruction: IdlInstruction,
    params: Record<string, unknown>,
    context: DiscoveryContext
  ): Promise<Array<{ address: Address; role: number }>> {
    // Only handle swap_v2
    if (instruction.name !== 'swap_v2') {
      return [];
    }

    if (!context.rpc) {
      console.warn('[Raydium Plugin] No RPC available for tick array discovery');
      return [];
    }

    // Get pool address
    const inputMint = this.getMintFromParams(params, 'inputMint', 'input_mint');
    const outputMint = this.getMintFromParams(params, 'outputMint', 'output_mint');
    if (!inputMint || !outputMint) {
      return [];
    }

    const poolAddressParam = this.getMintFromParams(params, 'poolAddress', 'pool_address');
    const [tokenMint0, tokenMint1] = this.sortMints(inputMint, outputMint);

    try {
      const resolved = await this.resolvePoolState(
        poolAddressParam,
        tokenMint0,
        tokenMint1,
        params,
        context.rpc,
        inputMint,
        outputMint
      );
      const { poolState, poolData } = resolved;

      // Get current tick to determine swap direction
      const poolStateData = await this.getPoolState(poolState, context.rpc);
      const tickSpacing = poolStateData.tickSpacing;
      const currentTick = poolStateData.tickCurrent;
      const isZeroForOne = this.addressEquals(inputMint, poolData.tokenMint0);

      console.log('[Raydium Plugin] === Starting Remaining Accounts Discovery ===');
      console.log('[Raydium Plugin] Pool:', {
        address: poolState.toString(),
        token0: poolData.tokenMint0.toString(),
        token1: poolData.tokenMint1.toString(),
        ammConfig: poolData.ammConfig.toString(),
      });
      console.log('[Raydium Plugin] Swap direction:', {
        isZeroForOne,
        inputMint: inputMint.toString(),
        outputMint: outputMint.toString(),
        inputMatchesToken0: this.addressEquals(inputMint, poolData.tokenMint0),
        inputMatchesToken1: this.addressEquals(inputMint, poolData.tokenMint1),
      });
      console.log('[Raydium Plugin] Current pool state:', {
        currentTick,
        tickSpacing,
        sqrtPriceX64: poolStateData.sqrtPriceX64.toString(),
      });

      // Use the bitmap from pool state to find initialized tick arrays
      const initializedStarts = this.findInitializedTickArrays(
        poolStateData.bitmap,
        currentTick,
        tickSpacing,
        isZeroForOne,
        4 // Find up to 4 tick arrays
      );

      console.log('[Raydium Plugin] Found initialized tick arrays from bitmap:', {
        count: initializedStarts.length,
        startIndexes: initializedStarts,
        bitmapLength: poolStateData.bitmap.length,
        bitmapSetBits: Array.from(poolStateData.bitmap).reduce((sum, byte) => sum + (byte ? 1 : 0), 0),
      });

      if (initializedStarts.length === 0) {
        throw new Error(
          `[Raydium Plugin] No initialized tick arrays found in bitmap for pool ${poolState.toString()}. ` +
          `Current tick: ${currentTick}, Tick spacing: ${tickSpacing}. ` +
          `This pool may not have sufficient liquidity for this swap.`
        );
      }

      // Build remaining accounts list - must include TickArrayBitmapExtension first
      const remainingAccounts: Array<{ address: Address; role: number }> = [];

      // 1. Always include TickArrayBitmapExtension first (required by swap_v2)
      // Error 6040: MissingTickArrayBitmapExtensionAccount indicates this is mandatory
      // The program expects this account even if it's not initialized for older pools
      let extensionAddress: Address | null = null;
      try {
        extensionAddress = await this.deriveTickArrayBitmapExtension(poolState);
        // Extension is read-only (not writable) - role 0
        remainingAccounts.push({ address: extensionAddress, role: 0 });
        
        // Check if extension account exists on-chain for logging
        if (context.rpc) {
          try {
            const extensionInfo = await context.rpc.getAccountInfo(extensionAddress, { encoding: 'base64' }).send();
            if (extensionInfo.value) {
              console.log('[Raydium Plugin] ✓ TickArrayBitmapExtension account EXISTS:', {
                address: extensionAddress.toString(),
                owner: extensionInfo.value.owner?.toString(),
                dataLength: extensionInfo.value.data ? (Array.isArray(extensionInfo.value.data) ? (extensionInfo.value.data[0] as any)?.length || 0 : (extensionInfo.value.data as any).length || 0) : 0,
              });
            } else {
              console.log('[Raydium Plugin] ⚠ TickArrayBitmapExtension account NOT INITIALIZED (will be included anyway):', extensionAddress.toString());
            }
          } catch (error) {
            console.warn('[Raydium Plugin] Could not verify TickArrayBitmapExtension existence:', error);
          }
        } else {
          console.log('[Raydium Plugin] Adding TickArrayBitmapExtension (RPC unavailable for verification):', extensionAddress.toString());
        }
      } catch (error) {
        console.error('[Raydium Plugin] Failed to derive TickArrayBitmapExtension:', error);
        throw new Error(`Failed to derive TickArrayBitmapExtension for pool ${poolState.toString()}: ${error}`);
      }

      // 2. Derive addresses for the initialized tick arrays
      console.log('[Raydium Plugin] Deriving tick array addresses...');
      for (let i = 0; i < initializedStarts.length; i++) {
        const startIndex = initializedStarts[i];
        try {
          const tickArrayAddress = await this.deriveTickArray(poolState, startIndex);
          remainingAccounts.push({ address: tickArrayAddress, role: 1 }); // Tick arrays are writable
          console.log(`[Raydium Plugin]   [${i + 1}/${initializedStarts.length}] Tick array ${startIndex} → ${tickArrayAddress.toString()}`);
        } catch (error) {
          console.error(`[Raydium Plugin] Failed to derive tick array for start ${startIndex}:`, error);
        }
      }

      if (remainingAccounts.length === 0) {
        throw new Error(
          `[Raydium Plugin] Failed to derive any remaining account addresses for pool ${poolState.toString()}.`
        );
      }

      // Log summary of selected remaining accounts
      const tickArraysCount = remainingAccounts.length - 1; // Subtract 1 for extension
      console.log('[Raydium Plugin] === Remaining Accounts Summary ===');
      console.log('[Raydium Plugin] Total remaining accounts:', remainingAccounts.length);
      console.log('[Raydium Plugin] Account breakdown:', {
        extension: extensionAddress ? { address: extensionAddress.toString(), role: 'read-only (0)' } : null,
        tickArrays: {
          count: tickArraysCount,
          indexes: initializedStarts,
          role: 'writable (1)',
        },
      });
      console.log('[Raydium Plugin] Full account list (in order):');
      remainingAccounts.forEach((acc, idx) => {
        const isExtension = idx === 0 && extensionAddress && acc.address.toString() === extensionAddress.toString();
        console.log(`[Raydium Plugin]   [${idx}] ${isExtension ? 'EXTENSION' : `TICK_ARRAY_${idx - 1}`}: ${acc.address.toString()} (role: ${acc.role})`);
      });
      console.log('[Raydium Plugin] === End Remaining Accounts ===');

      // Return remaining accounts in correct order:
      // 1. TickArrayBitmapExtension (if exists, read-only)
      // 2. Tick arrays in swap traversal order (writable)
      return remainingAccounts;
    } catch (error) {
      console.error('[Raydium Plugin] Failed to discover tick arrays:', error);
      throw error; // Re-throw instead of returning empty array
    }
  }

  /**
   * Query pool state account to get vaults and observation state.
   */
  private async getPoolState(
    poolAddress: Address,
    rpc: Rpc<GetAccountInfoApi>
  ): Promise<{
    ammConfig: Address;
    tokenMint0: Address;
    tokenMint1: Address;
    tokenVault0: Address;
    tokenVault1: Address;
    observationKey: Address;
    sqrtPriceX64: bigint;
    tickSpacing: number;
    tickCurrent: number;
    bitmap: Uint8Array;
  }> {
    // Use base64 encoding to avoid RPC errors for large account data
    const accountInfo = await rpc.getAccountInfo(poolAddress, { encoding: 'base64' }).send();

    if (!accountInfo.value?.data) {
      throw new Error(`Pool state account not found: ${poolAddress.toString()}`);
    }

    // With base64 encoding, data is a tuple: [base64String, 'base64']
    const accountData = accountInfo.value.data;
    let data: Uint8Array;
    
    if (Array.isArray(accountData) && accountData.length === 2) {
      // Base64EncodedDataResponse format: [base64String, 'base64']
      const base64String = accountData[0];
      if (typeof base64String === 'string') {
        // Decode base64 string to Uint8Array
        data = Uint8Array.from(atob(base64String), c => c.charCodeAt(0));
      } else {
        throw new Error(`Unexpected base64 data format: expected string, got ${typeof base64String}`);
      }
    } else if (typeof accountData === 'string') {
      // Fallback: direct string (shouldn't happen with base64 encoding, but handle it)
      data = Uint8Array.from(atob(accountData), c => c.charCodeAt(0));
    } else if (accountData instanceof Uint8Array) {
      // Fallback: already Uint8Array
      data = accountData;
    } else {
      throw new Error(`Unexpected account data type: ${typeof accountData}. Expected tuple [string, 'base64'] or string.`);
    }

    // Raydium PoolState account layout:
    // - 8 bytes: discriminator (offset 0-8)
    // - 1 byte: bump (offset 8)
    // - 32 bytes: amm_config (offset 9)
    // - 32 bytes: owner (offset 41)
    // - 32 bytes: token_mint_0 (offset 73)
    // - 32 bytes: token_mint_1 (offset 105)
    // - 32 bytes: token_vault_0 (offset 137)
    // - 32 bytes: token_vault_1 (offset 169)
    // - 32 bytes: observation_key (offset 201)

    if (data.length < 233) {
      throw new Error(`Invalid pool state account data length: ${data.length}`);
    }

    console.log('[Raydium Plugin] Pool state data length:', data.length);

    // Extract addresses from account data (accounting for 8-byte discriminator)
    const addressDecoder = getAddressDecoder();
    const ammConfigBytes = data.slice(9, 41);
    const tokenMint0Bytes = data.slice(73, 105);
    const tokenMint1Bytes = data.slice(105, 137);
    const tokenVault0Bytes = data.slice(137, 169);
    const tokenVault1Bytes = data.slice(169, 201);
    const observationKeyBytes = data.slice(201, 233);
    const tickSpacingBytes = data.slice(235, 237);
    const liquidityBytes = data.slice(237, 253);
    const sqrtPriceBytes = data.slice(253, 269);
    const tickCurrentBytes = data.slice(269, 273);

    // Convert bytes to addresses
    const ammConfig = addressDecoder.decode(ammConfigBytes) as Address;
    const tokenMint0 = addressDecoder.decode(tokenMint0Bytes) as Address;
    const tokenMint1 = addressDecoder.decode(tokenMint1Bytes) as Address;
    const tokenVault0 = addressDecoder.decode(tokenVault0Bytes) as Address;
    const tokenVault1 = addressDecoder.decode(tokenVault1Bytes) as Address;
    const observationKey = addressDecoder.decode(observationKeyBytes) as Address;
    const tickSpacing = (tickSpacingBytes[0] ?? 0) | ((tickSpacingBytes[1] ?? 0) << 8);
    const liquidity = readBigUint128LE(liquidityBytes);
    const sqrtPriceX64 = readBigUint128LE(sqrtPriceBytes);
    
    // Extract tick_current (i32, signed)
    const tickCurrent =
      (tickCurrentBytes[0] ?? 0) |
      ((tickCurrentBytes[1] ?? 0) << 8) |
      ((tickCurrentBytes[2] ?? 0) << 16) |
      ((tickCurrentBytes[3] ?? 0) << 24);
    // Convert to signed i32
    const tickCurrentSigned = tickCurrent > 0x7FFFFFFF ? tickCurrent - 0x100000000 : tickCurrent;

    // The bitmap is U1024 (128 bytes / 16 x u64) at offset 904
    // Calculated from PoolState struct (after 8-byte discriminator):
    // bump(1) + amm_config(32) + owner(32) + token_mint_0(32) + token_mint_1(32) +
    // token_vault_0(32) + token_vault_1(32) + observation_key(32) + mint_decimals_0(1) +
    // mint_decimals_1(1) + tick_spacing(2) + liquidity(16) + sqrt_price_x64(16) +
    // tick_current(4) + padding3(2) + padding4(2) + fee_growth_global_0_x64(16) +
    // fee_growth_global_1_x64(16) + protocol_fees_token_0(8) + protocol_fees_token_1(8) +
    // swap_in_amount_token_0(16) + swap_out_amount_token_1(16) + swap_in_amount_token_1(16) +
    // swap_out_amount_token_0(16) + status(1) + padding(7) + reward_infos(3*169=507) = 904 bytes
    const bitmapStartOffset = 904;
    const bitmapBytes = data.slice(bitmapStartOffset, bitmapStartOffset + 128);

    // Count set bits in bitmap to verify it's not all zeros
    let setBitsCount = 0;
    const setBitPositions: number[] = [];
    for (let byteIdx = 0; byteIdx < bitmapBytes.length; byteIdx++) {
      const byte = bitmapBytes[byteIdx] ?? 0;
      for (let bitIdx = 0; bitIdx < 8; bitIdx++) {
        if ((byte & (1 << bitIdx)) !== 0) {
          setBitsCount++;
          const bitPos = byteIdx * 8 + bitIdx;
          if (setBitPositions.length < 10) {
            setBitPositions.push(bitPos);
          }
        }
      }
    }

    console.log('[Raydium Plugin] Extracted from pool state:', {
      poolAddress: poolAddress.toString(),
      ammConfig: ammConfig.toString(),
      tokenMint0: tokenMint0.toString(),
      tokenMint1: tokenMint1.toString(),
      tokenVault0: tokenVault0.toString(),
      tokenVault1: tokenVault1.toString(),
      observationKey: observationKey.toString(),
      tickSpacing,
      liquidity: liquidity.toString(),
      sqrtPriceX64: sqrtPriceX64.toString(),
      tickCurrent: tickCurrentSigned,
      bitmapLength: bitmapBytes.length,
      bitmapSetBits: setBitsCount,
      firstSetBits: setBitPositions,
    });

    return {
      ammConfig,
      tokenMint0,
      tokenMint1,
      tokenVault0,
      tokenVault1,
      observationKey,
      sqrtPriceX64,
      tickSpacing,
      tickCurrent: tickCurrentSigned,
      bitmap: bitmapBytes,
    };
  }

  /**
   * Check if a bit is set in the bitmap (U1024 represented as 128 bytes)
   */
  private isBitSet(bitmap: Uint8Array, bitPosition: number): boolean {
    if (bitPosition < 0 || bitPosition >= 1024) {
      return false;
    }
    const byteIndex = Math.floor(bitPosition / 8);
    const bitIndex = bitPosition % 8;
    return ((bitmap[byteIndex] ?? 0) & (1 << bitIndex)) !== 0;
  }

  /**
   * Check if a tick array is initialized using the bitmap
   * Formula from Raydium CLMM: compressed = floor(start / (tickSpacing * 60)) + 512
   * 
   * The bitmap is a U1024 (1024 bits), where bit position = compressed value.
   * Compressed values range from 0-1023, representing tick arrays from
   * -512*multiplier to +511*multiplier.
   */
  private isTickArrayInitialized(
    bitmap: Uint8Array,
    tickArrayStartIndex: number,
    tickSpacing: number,
    debug: boolean = false
  ): boolean {
    const TICK_ARRAY_SIZE = 60;
    const multiplier = tickSpacing * TICK_ARRAY_SIZE;

    // Calculate compressed index: floor(start / multiplier) + 512
    // Math.floor correctly rounds towards negative infinity for negative numbers
    const compressed = Math.floor(tickArrayStartIndex / multiplier) + 512;

    // Compressed should be in range [0, 1023] for valid tick arrays
    if (compressed < 0 || compressed >= 1024) {
      if (debug) {
        console.log(`[Raydium Plugin] Tick array ${tickArrayStartIndex} has invalid compressed value: ${compressed}`);
      }
      return false;
    }

    const bitPos = compressed;
    const isSet = this.isBitSet(bitmap, bitPos);

    if (debug) {
      console.log(`[Raydium Plugin] Bitmap check for tick array ${tickArrayStartIndex}:`, {
        multiplier,
        compressed,
        bitPos,
        isSet,
        calculation: `floor(${tickArrayStartIndex} / ${multiplier}) + 512 = ${compressed}`
      });
    }

    return isSet;
  }

  /**
   * Find initialized tick arrays near the current tick
   */
  private findInitializedTickArrays(
    bitmap: Uint8Array,
    currentTick: number,
    tickSpacing: number,
    isZeroForOne: boolean,
    limit: number = 3
  ): number[] {
    const TICK_ARRAY_SIZE = 60;
    const multiplier = tickSpacing * TICK_ARRAY_SIZE;

    // Calculate the current tick array start
    const currentTickArrayStart = Math.floor(currentTick / multiplier) * multiplier;

    console.log('[Raydium Plugin] Searching for tick arrays:', {
      currentTick,
      currentTickArrayStart,
      tickSpacing,
      multiplier,
      isZeroForOne,
    });

    const initializedArrays: number[] = [];

    // For swaps, we need to find tick arrays in the DIRECTION of the swap
    // For zero-for-one (price down, tick down): we need arrays at or below current tick
    // For one-for-zero (price up, tick up): we need arrays at or above current tick

    // Start from current and search in the swap direction
    const direction = isZeroForOne ? -1 : 1;

    // First check current tick array
    console.log(`[Raydium Plugin] === Checking CURRENT tick array ===`);
    const currentInit = this.isTickArrayInitialized(bitmap, currentTickArrayStart, tickSpacing, true);
    if (currentInit) {
      initializedArrays.push(currentTickArrayStart);
    }

    // Then search in the swap direction
    for (let offset = 1; offset <= 20 && initializedArrays.length < limit; offset++) {
      const tickArrayStart = currentTickArrayStart + (direction * offset * multiplier);
      const debug = offset <= 3;

      if (debug) {
        const label = isZeroForOne ? `DOWN_${offset}` : `UP_${offset}`;
        console.log(`[Raydium Plugin] === Checking ${label} tick array ===`);
      }

      const isInit = this.isTickArrayInitialized(bitmap, tickArrayStart, tickSpacing, debug);

      if (isInit) {
        initializedArrays.push(tickArrayStart);
      }
    }

    // Sort arrays in the direction of swap traversal:
    // For zero-for-one (tick decreasing): descending order (high to low)
    // For one-for-zero (tick increasing): ascending order (low to high)
    initializedArrays.sort((a, b) => isZeroForOne ? b - a : a - b);

    return initializedArrays;
  }

  /**
   * Derive TickArrayBitmapExtension PDA.
   * Seeds: ["pool_tick_array_bitmap_extension", pool_state]
   */
  private async deriveTickArrayBitmapExtension(
    poolState: Address
  ): Promise<Address> {
    const extensionBytes = Buffer.from('pool_tick_array_bitmap_extension');
    const poolStateBytes = new Uint8Array(getAddressEncoder().encode(poolState));

    const [extension] = await getProgramDerivedAddress({
      programAddress: this.programId,
      seeds: [extensionBytes, poolStateBytes],
    });

    return extension;
  }

  /**
   * Derive tick array PDA.
   * Seeds: ["tick_array", pool_state, start_tick_index]
   */
  private async deriveTickArray(
    poolState: Address,
    startTickIndex: number
  ): Promise<Address> {
    const tickArrayBytes = Buffer.from('tick_array');
    const poolStateBytes = new Uint8Array(getAddressEncoder().encode(poolState));

    // Convert startTickIndex to i32 bytes (little-endian, signed)
    const startTickBytes = Buffer.allocUnsafe(4);
    startTickBytes.writeInt32LE(startTickIndex, 0);

    const [tickArray] = await getProgramDerivedAddress({
      programAddress: this.programId,
      seeds: [tickArrayBytes, poolStateBytes, startTickBytes],
    });

    return tickArray;
  }

  /**
   * Create an Associated Token Account instruction using the correct token program.
   */
  private async createAtaInstruction(
    mint: Address,
    payer: Address,
    owner: Address,
    rpc?: Rpc<GetAccountInfoApi>
  ): Promise<Instruction> {
    console.log(`[Raydium Plugin] createAtaInstruction called for mint ${mint.toString()}, has RPC: ${!!rpc}`);
    
    // First determine which token program owns this mint
    let tokenProgram: Address = WELL_KNOWN_PROGRAMS.tokenProgram;
    
    if (rpc) {
      try {
        // Try to extract RPC URL for debugging
        const rpcDebug = (rpc as any)?._rpcUrl || (rpc as any)?._transport?._url || 'unknown';
        console.log(`[Raydium Plugin] Querying mint ${mint.toString()} on RPC:`, rpcDebug);
        
        const mintInfo = await rpc.getAccountInfo(mint, { encoding: 'base64' }).send();
        console.log(`[Raydium Plugin] Mint info received:`, {
          exists: !!mintInfo.value,
          hasOwner: !!mintInfo.value?.owner,
          owner: mintInfo.value?.owner?.toString()
        });
        
        if (mintInfo.value?.owner) {
          const mintOwner = mintInfo.value.owner.toString();
          console.log(`[Raydium Plugin] Mint ${mint.toString()} owner: ${mintOwner}`);
          console.log(`[Raydium Plugin] Comparing with Token-2022: ${WELL_KNOWN_PROGRAMS.token2022Program.toString()}`);
          
          if (mintOwner === WELL_KNOWN_PROGRAMS.token2022Program.toString()) {
            tokenProgram = WELL_KNOWN_PROGRAMS.token2022Program;
            console.log(`[Raydium Plugin] ✓ Mint ${mint.toString()} is Token-2022, using Token-2022 for ATA creation`);
          } else {
            console.log(`[Raydium Plugin] ✓ Mint ${mint.toString()} is legacy Token, using Token Program for ATA creation`);
          }
        } else {
          console.warn(`[Raydium Plugin] Mint ${mint.toString()} has no owner in response`);
        }
      } catch (error) {
        // Fall back to legacy Token Program
        console.error(`[Raydium Plugin] ERROR querying mint ${mint.toString()}:`, error);
      }
    } else {
      console.warn(`[Raydium Plugin] No RPC provided for mint ${mint.toString()}, defaulting to legacy Token Program`);
    }

    const ata = await this.deriveAta(mint, owner, rpc);
    const isPayerOwner = payer.toString() === owner.toString();
  
    const data = new Uint8Array([1]); // CreateIdempotent instruction discriminator

    return {
      programAddress: WELL_KNOWN_PROGRAMS.associatedTokenProgram,
      accounts: [
        { address: payer, role: isPayerOwner ? 3 : 2 }, // payer
        { address: ata, role: 1 }, // associated token account (writable)
        { address: owner, role: 0 }, // owner (readonly)
        { address: mint, role: 0 }, // mint (readonly)
        { address: WELL_KNOWN_PROGRAMS.systemProgram, role: 0 }, // system program
        { address: tokenProgram, role: 0 }, // token program owner of mint
        { address: WELL_KNOWN_PROGRAMS.rent, role: 0 }, // rent sysvar (required for create)
      ],
      data,
    };
  }

  /**
   * Derive Associated Token Account address using the correct token program.
   * Checks the mint's owner to determine if it's a Token or Token-2022 mint.
   */
  private async deriveAta(
    mint: Address,
    owner: Address,
    rpc?: Rpc<GetAccountInfoApi>
  ): Promise<Address> {
    let tokenProgram: Address = WELL_KNOWN_PROGRAMS.tokenProgram;

    // If RPC is available, check which token program owns this mint
    if (rpc) {
      try {
        const mintInfo = await rpc.getAccountInfo(mint, { encoding: 'base64' }).send();
        if (mintInfo.value?.owner) {
          const mintOwner = mintInfo.value.owner.toString();
          // If mint is owned by Token-2022, use Token-2022 for ATA derivation
          if (mintOwner === WELL_KNOWN_PROGRAMS.token2022Program.toString()) {
            tokenProgram = WELL_KNOWN_PROGRAMS.token2022Program;
            console.log(
              `[Raydium Plugin] Mint ${mint.toString()} is Token-2022, using Token-2022 for ATA derivation`
            );
          } else {
            console.log(
              `[Raydium Plugin] Mint ${mint.toString()} is legacy Token, using Token Program for ATA derivation`
            );
          }
        }
      } catch (error) {
        // If we can't query the mint, fall back to legacy Token Program
        console.warn(
          `[Raydium Plugin] Could not query mint ${mint.toString()}, assuming legacy Token Program`
        );
      }
    }

    const ownerBytes = new Uint8Array(getAddressEncoder().encode(owner));
    const tokenProgramBytes = new Uint8Array(getAddressEncoder().encode(tokenProgram));
    const mintBytes = new Uint8Array(getAddressEncoder().encode(mint));

    const [ata] = await getProgramDerivedAddress({
      programAddress: WELL_KNOWN_PROGRAMS.associatedTokenProgram,
      seeds: [ownerBytes, tokenProgramBytes, mintBytes],
    });

    return ata;
  }
}

