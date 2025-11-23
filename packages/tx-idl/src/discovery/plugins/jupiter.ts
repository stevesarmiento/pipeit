/**
 * Jupiter swap account resolution plugin.
 *
 * Automatically resolves accounts for Jupiter swap instructions by calling
 * Jupiter's quote and swap APIs to get the required pool and vault addresses.
 *
 * @packageDocumentation
 */

import { address, getProgramDerivedAddress, getAddressEncoder, type Address } from '@solana/addresses';
import type { Rpc, GetAccountInfoApi } from '@solana/rpc';
import type { IdlInstruction } from '../../types.js';
import type { ProtocolAccountPlugin } from './plugin.js';
import type { DiscoveryContext } from '../types.js';
import { WELL_KNOWN_PROGRAMS } from '../strategies/constants.js';

/**
 * Jupiter V6 program address.
 */
export const JUPITER_V6_PROGRAM = address('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4');

/**
 * Configuration options for Jupiter API endpoints.
 * Allows custom proxy URLs for environments with network restrictions.
 */
export interface JupiterApiConfig {
  /** Base URL for Jupiter quote API (default: https://lite-api.jup.ag/swap/v1) */
  quoteApiUrl?: string;
  /** URL for swap instructions endpoint (default: https://lite-api.jup.ag/swap/v1/swap-instructions) */
  swapInstructionsUrl?: string;
}

/**
 * Plugin for resolving Jupiter swap instruction accounts.
 *
 * This plugin:
 * 1. Calls Jupiter's quote API to get optimal route
 * 2. Calls Jupiter's swap-instructions API to get all required accounts
 * 3. Maps Jupiter's account array to IDL account names
 */
export class JupiterSwapPlugin implements ProtocolAccountPlugin {
  id = 'jupiter-swap';
  programId = JUPITER_V6_PROGRAM;
  instructions = ['shared_accounts_route', 'route', 'route_with_token_ledger'];
  private config: JupiterApiConfig;

  constructor(config: JupiterApiConfig = {}) {
    this.config = {
      quoteApiUrl: config.quoteApiUrl || 'https://lite-api.jup.ag/swap/v1',
      swapInstructionsUrl: config.swapInstructionsUrl || 'https://lite-api.jup.ag/swap/v1/swap-instructions',
    };
  }

  /**
   * Prepare parameters by transforming user-friendly names to IDL parameter names.
   * Also ensures required parameters are present and properly formatted.
   */
  async prepareParams(
    params: Record<string, unknown>,
    context: DiscoveryContext
  ): Promise<Record<string, unknown>> {
    const prepared: Record<string, unknown> = { ...params };

    // Handle shared_accounts_route specific parameters
    if (context.instruction.name === 'shared_accounts_route') {
      // Add default id if not provided (typically 0 for standard swaps)
      if (prepared.id === undefined) {
        prepared.id = 0;
      }

      // Transform amountIn -> in_amount for IDL
      if (params.amountIn !== undefined) {
        prepared.in_amount = params.amountIn;
      // Keep amountIn for plugin's own use (account resolution)
    }

      // Transform camelCase to snake_case for IDL parameters
      if (prepared.routePlan !== undefined) {
        prepared.route_plan = prepared.routePlan;
      }
      if (prepared.quotedOutAmount !== undefined) {
        prepared.quoted_out_amount = prepared.quotedOutAmount;
      }
      if (prepared.slippageBps !== undefined) {
        prepared.slippage_bps = prepared.slippageBps;
      }
      if (prepared.platformFeeBps !== undefined) {
        prepared.platform_fee_bps = prepared.platformFeeBps;
      }
    }

    // Ensure route_plan is an array (default to empty if not provided)
    const routePlan = prepared.route_plan ?? prepared.routePlan;
    if (!routePlan || !Array.isArray(routePlan)) {
      prepared.route_plan = [];
    }

    // Ensure quoted_out_amount is a BigInt if provided as string/number
    const quotedOutAmount = prepared.quoted_out_amount ?? prepared.quotedOutAmount;
    if (quotedOutAmount !== undefined && quotedOutAmount !== null) {
      if (typeof quotedOutAmount === 'string') {
        const str = quotedOutAmount.trim();
        if (str === '' || str === '0') {
          prepared.quoted_out_amount = 0n;
        } else {
          prepared.quoted_out_amount = BigInt(str);
        }
      } else if (typeof quotedOutAmount === 'number') {
        prepared.quoted_out_amount = BigInt(Math.floor(quotedOutAmount));
      } else if (typeof quotedOutAmount === 'bigint') {
        prepared.quoted_out_amount = quotedOutAmount;
      }
    }

    // Ensure in_amount is a BigInt if provided as string/number
    const inAmount = prepared.in_amount ?? prepared.inAmount;
    if (inAmount !== undefined && inAmount !== null) {
      if (typeof inAmount === 'string') {
        const str = inAmount.trim();
        if (str === '') {
          throw new Error('in_amount cannot be an empty string');
        }
        prepared.in_amount = BigInt(str);
      } else if (typeof inAmount === 'number') {
        prepared.in_amount = BigInt(Math.floor(inAmount));
      } else if (typeof inAmount === 'bigint') {
        prepared.in_amount = inAmount;
      }
    }

    // Ensure slippage_bps is a number
    const slippageBps = prepared.slippage_bps ?? prepared.slippageBps;
    if (slippageBps !== undefined && slippageBps !== null) {
      prepared.slippage_bps = Number(slippageBps);
    }

    // Ensure platform_fee_bps is a number (default to 0 if not provided)
    const platformFeeBps = prepared.platform_fee_bps ?? prepared.platformFeeBps;
    if (platformFeeBps === undefined || platformFeeBps === null) {
      prepared.platform_fee_bps = 0;
    } else {
      prepared.platform_fee_bps = Number(platformFeeBps);
    }

    // Ensure id is a number (for shared_accounts_route)
    if (prepared.id !== undefined && prepared.id !== null) {
      prepared.id = Number(prepared.id);
    }

    return prepared;
  }

  async resolveAccounts(
    instruction: IdlInstruction,
    params: Record<string, unknown>,
    context: DiscoveryContext
  ): Promise<Record<string, Address>> {
    // 1. Get Jupiter quote (use provided quote or fetch)
    let quote: any;
    if (params.quoteResponse && typeof params.quoteResponse === 'object') {
      // Use provided quote if available
      quote = params.quoteResponse;
    } else {
      // Fetch quote from API
      quote = await this.fetchQuote(params, context);
    }

    // 2. Get swap instruction data from Jupiter API (or use provided data)
    let swapData: any;
    
    // Check if swap data was already fetched and provided
    if (params.__jupiterSwapData && typeof params.__jupiterSwapData === 'object') {
      swapData = params.__jupiterSwapData;
      console.log('[Jupiter Plugin] Using provided swap data (no API call)');
    } else {
      // Fetch from API
      try {
        const response = await fetch(this.config.swapInstructionsUrl!, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            quoteResponse: quote,
            userPublicKey: context.signer.toString(),
            wrapAndUnwrapSol: params.wrapAndUnwrapSol ?? true,
            dynamicComputeUnitLimit: params.dynamicComputeUnitLimit ?? true,
            prioritizationFeeLamports: params.prioritizationFeeLamports ?? 'auto',
          }),
        });

        if (!response.ok) {
          throw new Error(`Jupiter swap-instructions API error: ${response.status} ${response.statusText}`);
        }

        swapData = await response.json();
      } catch (error) {
        // If API call fails, provide minimal accounts based on instruction structure
        // This allows the demo to work even if Jupiter API is unavailable
        console.warn('Jupiter API unavailable, using fallback account resolution:', error);
        return await this.getFallbackAccounts(instruction, params, context);
      }
    }
    
    // Debug: Log Jupiter API response structure
    console.log('[Jupiter Plugin] Swap API response keys:', Object.keys(swapData));
    console.log('[Jupiter Plugin] Accounts array:', swapData.accounts?.length, 'accounts');
    console.log('[Jupiter Plugin] Setup instructions:', swapData.setupInstructions?.length);
    console.log('[Jupiter Plugin] Swap instruction:', swapData.swapInstruction ? 'present' : 'missing');
    
    // Check for simulation errors from Jupiter
    console.log('[Jupiter Plugin] Jupiter simulationError field:', swapData.simulationError);
    if (swapData.simulationError && Object.keys(swapData.simulationError).length > 0) {
      console.error('[Jupiter Plugin] Jupiter pre-simulated this swap and it failed:', JSON.stringify(swapData.simulationError));
      console.warn('[Jupiter Plugin] This swap may not execute successfully.');
    }

    // 3. Map account indexes to IDL account names
    const resolvedAccounts = await this.mapJupiterAccountsToIdl(swapData, instruction, params, context);
    console.log('[Jupiter Plugin] Resolved accounts:', Object.keys(resolvedAccounts));
    
    // 4. Store Jupiter's instruction data in params for use by serializer
    // This allows us to use Jupiter's pre-encoded instruction data instead of building from IDL
    if (swapData.swapInstruction?.data) {
      // Store as base64 string (Jupiter returns it as base64)
      (params as any).__jupiterInstructionData = swapData.swapInstruction.data;
      console.log('[Jupiter Plugin] Stored Jupiter instruction data for direct use');
    }
    
    // 5. Store setup instructions for inclusion in transaction
    if (swapData.setupInstructions && Array.isArray(swapData.setupInstructions) && swapData.setupInstructions.length > 0) {
      (params as any).__jupiterSetupInstructions = swapData.setupInstructions;
      console.log('[Jupiter Plugin] Stored', swapData.setupInstructions.length, 'setup instructions');
    }
    
    return resolvedAccounts;
  }

  private async fetchQuote(
    params: Record<string, unknown>,
    context: DiscoveryContext
  ): Promise<any> {
    const inputMint = params.inputMint as string | undefined;
    const outputMint = params.outputMint as string | undefined;
    const amountIn = params.amountIn as string | number | bigint | undefined;

    if (!inputMint || !outputMint || amountIn === undefined) {
      throw new Error(
        'Jupiter swap requires inputMint, outputMint, and amountIn parameters'
      );
    }

    const queryParams = new URLSearchParams({
      inputMint,
      outputMint,
      amount: amountIn.toString(),
      slippageBps: (params.slippageBps as string | number | undefined)?.toString() || '50',
      onlyDirectRoutes: (params.onlyDirectRoutes as boolean | undefined)?.toString() || 'false',
      asLegacyTransaction: (params.asLegacyTransaction as boolean | undefined)?.toString() || 'false',
    });

    try {
      const url = this.config.quoteApiUrl!.endsWith('/quote')
        ? `${this.config.quoteApiUrl}?${queryParams}`
        : `${this.config.quoteApiUrl}/quote?${queryParams}`;
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Jupiter quote API error: ${response.status} ${response.statusText}`);
      }
      return await response.json();
    } catch (error) {
      // If fetch fails (CORS, network, etc.), throw a more helpful error
      if (error instanceof TypeError && error.message.includes('fetch')) {
        throw new Error(
          'Failed to fetch Jupiter quote. This may be due to network issues. ' +
          'Consider configuring a proxy URL via JupiterSwapPlugin constructor or providing quoteResponse in params.'
        );
      }
      throw error;
    }
  }

  private async mapJupiterAccountsToIdl(
    swapData: any,
    instruction: IdlInstruction,
    params: Record<string, unknown>,
    context: DiscoveryContext
  ): Promise<Record<string, Address>> {
    const accounts: Record<string, Address> = {};

    // Jupiter v1 API returns accounts in swapInstruction.accounts array
    // Each account is an object with { pubkey, isSigner, isWritable }
    let accountAddresses: string[] = [];
    
    if (swapData.swapInstruction?.accounts && Array.isArray(swapData.swapInstruction.accounts)) {
      // Extract pubkey strings from account objects
      accountAddresses = swapData.swapInstruction.accounts.map((acc: any) => {
        if (typeof acc === 'string') {
          return acc;
        } else if (acc && typeof acc.pubkey === 'string') {
          return acc.pubkey;
        } else {
          console.warn('[Jupiter Plugin] Unexpected account format:', acc);
          return null;
        }
      }).filter((addr: string | null): addr is string => addr !== null);
    }
    // Fallback: check for top-level accounts array (v6 format)
    else if (swapData.accounts && Array.isArray(swapData.accounts)) {
      accountAddresses = swapData.accounts.map((addr: any) => 
        typeof addr === 'string' ? addr : String(addr)
      );
    }

    // Map accounts based on instruction.accounts order
    if (accountAddresses.length > 0) {
      accountAddresses.forEach((addr: string, index: number) => {
        const idlAccount = instruction.accounts[index];
        if (idlAccount && addr) {
          try {
          accounts[idlAccount.name] = address(addr);
          } catch (error) {
            console.warn(`[Jupiter Plugin] Failed to parse account address at index ${index}:`, addr, error);
          }
        }
      });
      console.log('[Jupiter Plugin] Mapped', accountAddresses.length, 'accounts from API response');
    } else {
      console.warn('[Jupiter Plugin] No accounts found in API response, using fallback resolution');
    }

    // Also handle addressLookupTableAddresses if present
    if (swapData.addressLookupTableAddresses && Array.isArray(swapData.addressLookupTableAddresses)) {
      // These are typically used for address lookup tables
      // Map to any account that might need them
      swapData.addressLookupTableAddresses.forEach((addr: string, index: number) => {
        // Try to find an account that might be a lookup table
        const lookupTableAccount = instruction.accounts.find(
          (acc) => acc.name.toLowerCase().includes('lookup') || acc.name.toLowerCase().includes('alt')
        );
        if (lookupTableAccount && !accounts[lookupTableAccount.name]) {
          accounts[lookupTableAccount.name] = address(addr);
        }
      });
    }

    // Add well-known accounts that might not be in Jupiter's response
    for (const account of instruction.accounts) {
      const name = account.name.toLowerCase();

      // Jupiter program itself (always required)
      if (name === 'program' && !accounts[account.name]) {
        accounts[account.name] = this.programId;
      }
      // Program authority - derive PDA
      else if (name === 'program_authority' && !accounts[account.name]) {
        // Jupiter program authority PDA (typically derived with ["authority"] seed)
        const [pda] = await getProgramDerivedAddress({
          programAddress: this.programId,
          seeds: [new TextEncoder().encode('authority')],
        });
        accounts[account.name] = pda;
      }
      // Event authority (fixed address from IDL)
      else if (name === 'event_authority' && !accounts[account.name]) {
        accounts[account.name] = address('D8cy77BBepLMngZx6ZukaTff5hCt1HrWyKk3Hnd9oitf');
      }
      // Token program
      else if ((name === 'token_program' || (name.includes('token') && name.includes('program') && !name.includes('2022'))) && !accounts[account.name]) {
        accounts[account.name] = WELL_KNOWN_PROGRAMS.tokenProgram;
      }
      // Token 2022 program
      else if ((name === 'token_2022_program' || name.includes('token2022')) && !accounts[account.name]) {
        accounts[account.name] = address('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
      }
      // System program
      else if (name.includes('system') && name.includes('program') && !accounts[account.name]) {
        accounts[account.name] = WELL_KNOWN_PROGRAMS.systemProgram;
      }
      // User authority/signer
      else if ((account.isSigner || name.includes('user_transfer_authority')) && !accounts[account.name]) {
        accounts[account.name] = context.signer;
      }
      // Source mint
      else if (name === 'source_mint' && !accounts[account.name]) {
        const inputMint = params.inputMint as string | undefined;
        if (inputMint) {
          accounts[account.name] = address(inputMint);
        }
      }
      // Destination mint
      else if (name === 'destination_mint' && !accounts[account.name]) {
        const outputMint = params.outputMint as string | undefined;
        if (outputMint) {
          accounts[account.name] = address(outputMint);
        }
      }
      // Source token accounts - derive ATAs
      else if (name.includes('source') && name.includes('token') && name.includes('account') && !accounts[account.name]) {
        const inputMint = params.inputMint as string | undefined;
        if (inputMint) {
          const ata = await this.deriveAta(address(inputMint), context.signer, context.rpc);
          accounts[account.name] = ata;
        }
      }
      // Destination token accounts - derive ATAs
      else if ((name.includes('dest') || name.includes('destination')) && name.includes('token') && name.includes('account') && !accounts[account.name]) {
        const outputMint = params.outputMint as string | undefined;
        if (outputMint) {
          const ata = await this.deriveAta(address(outputMint), context.signer, context.rpc);
          accounts[account.name] = ata;
        }
      }
    }

    return accounts;
  }

  /**
   * Fallback account resolution when Jupiter API is unavailable.
   * Provides minimal accounts based on instruction structure.
   */
  private async getFallbackAccounts(
    instruction: IdlInstruction,
    params: Record<string, unknown>,
    context: DiscoveryContext
  ): Promise<Record<string, Address>> {
    const accounts: Record<string, Address> = {};

    // Resolve well-known accounts
    for (const account of instruction.accounts) {
      const name = account.name.toLowerCase();

      // Jupiter program itself
      if (name === 'program') {
        accounts[account.name] = this.programId;
      }
      // Event authority (fixed address from IDL)
      else if (name === 'event_authority') {
        accounts[account.name] = address('D8cy77BBepLMngZx6ZukaTff5hCt1HrWyKk3Hnd9oitf');
      }
      // Token program
      else if (name === 'token_program' || (name.includes('token') && name.includes('program') && !name.includes('2022'))) {
        accounts[account.name] = WELL_KNOWN_PROGRAMS.tokenProgram;
      }
      // Token 2022 program
      else if (name === 'token_2022_program' || name.includes('token2022')) {
        accounts[account.name] = address('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
      }
      // System program
      else if (name.includes('system') && name.includes('program')) {
        accounts[account.name] = WELL_KNOWN_PROGRAMS.systemProgram;
      }
      // User authority/signer
      else if (account.isSigner || name.includes('user_transfer_authority')) {
        accounts[account.name] = context.signer;
      }
      // Program authority - derive PDA
      else if (name === 'program_authority') {
        const [pda] = await getProgramDerivedAddress({
          programAddress: this.programId,
          seeds: [new TextEncoder().encode('authority')],
        });
        accounts[account.name] = pda;
      }
      // Source mint
      else if (name === 'source_mint') {
        const inputMint = params.inputMint as string | undefined;
        if (inputMint) {
          accounts[account.name] = address(inputMint);
        }
      }
      // Destination mint
      else if (name === 'destination_mint') {
        const outputMint = params.outputMint as string | undefined;
        if (outputMint) {
          accounts[account.name] = address(outputMint);
        }
      }
      // Source token accounts - derive ATAs
      else if (name.includes('source') && name.includes('token') && name.includes('account')) {
        const inputMint = params.inputMint as string | undefined;
        if (inputMint) {
          const ata = await this.deriveAta(address(inputMint), context.signer, context.rpc);
          accounts[account.name] = ata;
        }
      }
      // Destination token accounts - derive ATAs
      else if ((name.includes('dest') || name.includes('destination')) && name.includes('token') && name.includes('account')) {
        const outputMint = params.outputMint as string | undefined;
        if (outputMint) {
          const ata = await this.deriveAta(address(outputMint), context.signer, context.rpc);
          accounts[account.name] = ata;
        }
      }
    }

    return accounts;
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
          }
        }
      } catch (error) {
        // If we can't query the mint, fall back to legacy Token Program
        console.warn(
          `[Jupiter Plugin] Could not query mint ${mint.toString()}, assuming legacy Token Program`
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

