/**
 * Kamino lending account resolution plugin.
 *
 * Automatically resolves accounts for Kamino lending instructions (deposit, withdraw, etc.)
 * by querying on-chain data and deriving required account addresses.
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
 * Kamino Lending program address (mainnet).
 */
export const KAMINO_LENDING_PROGRAM = address('KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD');

/**
 * Well-known Kamino lending market address (mainnet).
 * This is the primary lending market for Kamino on Solana mainnet.
 * Fallback when API is unavailable.
 */
export const KAMINO_MAINNET_LENDING_MARKET = address('7u3HeHXQqHiU9EXerTSiuQbFTqQ6p7ZEe1v8g4axEpxU');

/**
 * Plugin for resolving Kamino lending instruction accounts.
 *
 * This plugin automatically resolves:
 * - Lending market addresses
 * - Reserve addresses (from mint)
 * - Reserve liquidity/collateral accounts
 * - User token accounts (ATAs)
 * - Well-known program accounts
 */
export class KaminoLendingPlugin implements ProtocolAccountPlugin {
  id = 'kamino-lending';
  programId = KAMINO_LENDING_PROGRAM;
  instructions = [
    'depositReserveLiquidity',
    'withdrawReserveLiquidity',
    'depositReserveLiquidityAndObligationCollateral',
    'withdrawObligationCollateralAndRedeemReserveCollateral',
    'refreshReserve',
    'refreshObligation',
  ];

  async resolveAccounts(
    instruction: IdlInstruction,
    params: Record<string, unknown>,
    context: DiscoveryContext
  ): Promise<Record<string, Address>> {
    const accounts: Record<string, Address> = {};

    // Get mint address from params
    const mint = this.getMintFromParams(params, context);
    if (!mint) {
      throw new Error('Kamino lending instructions require a mint address (reserve mint)');
    }

    // Resolve lending market (can be provided or use default)
    const lendingMarket =
      (params.lendingMarket as Address | undefined) ||
      context.providedAccounts.lendingMarket ||
      (await this.findLendingMarket(context.rpc));

    accounts.lendingMarket = lendingMarket;

    // Derive lending market authority PDA
    const lendingMarketAuthority = await this.deriveLendingMarketAuthority(lendingMarket);
    accounts.lendingMarketAuthority = lendingMarketAuthority;

    // Find reserve address from mint
    const reserve = await this.findReserve(mint, lendingMarket, context.rpc);
    accounts.reserve = reserve;

    // Get reserve details from Kamino API or on-chain
    const reserveDetails = await this.getReserveDetails(reserve, mint, lendingMarket, context.rpc);
    accounts.reserveLiquiditySupply = reserveDetails.liquiditySupply;
    accounts.reserveCollateralMint = reserveDetails.collateralMint;

    // Derive user token accounts if needed
    if (this.needsUserTokenAccount(instruction)) {
      const userSourceLiquidity = await this.deriveUserTokenAccount(mint, context.signer);
      accounts.userSourceLiquidity = userSourceLiquidity;
    }

    if (this.needsUserCollateralAccount(instruction)) {
      const userDestinationCollateral = await this.deriveUserTokenAccount(
        reserveDetails.collateralMint,
        context.signer
      );
      accounts.userDestinationCollateral = userDestinationCollateral;
    }

    // Add well-known programs
    for (const account of instruction.accounts) {
      const name = account.name.toLowerCase();
      if (name.includes('system') && name.includes('program')) {
        accounts[account.name] = WELL_KNOWN_PROGRAMS.systemProgram;
      } else if (name.includes('token') && name.includes('program')) {
        accounts[account.name] = WELL_KNOWN_PROGRAMS.tokenProgram;
      } else if (name === 'rent') {
        accounts[account.name] = WELL_KNOWN_PROGRAMS.rent;
      } else if (name.includes('clock')) {
        accounts[account.name] = WELL_KNOWN_PROGRAMS.clock;
      }
    }

    // Owner is typically the signer
    const ownerAccount = instruction.accounts.find((acc) => acc.name.toLowerCase() === 'owner');
    if (ownerAccount) {
      accounts[ownerAccount.name] = context.signer;
    }

    return accounts;
  }

  private getMintFromParams(
    params: Record<string, unknown>,
    context: DiscoveryContext
  ): Address | undefined {
    // Try various mint parameter names
    return (
      (params.mint as Address | undefined) ||
      (params.reserveMint as Address | undefined) ||
      (params.liquidityMint as Address | undefined) ||
      context.providedAccounts.mint ||
      context.providedAccounts.reserveMint
    );
  }

  private async findLendingMarket(rpc: Rpc<GetAccountInfoApi>): Promise<Address> {
    // Try multiple strategies to find the lending market:
    // 1. Try Kamino API
    // 2. Try alternative API endpoints
    // 3. Verify well-known address on-chain
    // 4. Fall back to well-known address

    // Strategy 1: Try Kamino API (primary endpoint)
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
      const response = await fetch('https://api.kamino.finance/v1/lending/markets', {
        signal: controller.signal,
      }).catch(() => null);
      clearTimeout(timeoutId);
      
      if (response?.ok) {
        const data = await response.json();
        if (data.markets && Array.isArray(data.markets) && data.markets.length > 0) {
          const marketAddress = data.markets[0].address;
          if (marketAddress) {
            return address(marketAddress);
          }
        }
        // Try alternative response format
        if (data.address) {
          return address(data.address);
        }
      }
    } catch (error) {
      console.warn('Kamino API unavailable, trying fallback methods:', error);
    }

    // Strategy 2: Try alternative API endpoint
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const response = await fetch('https://api.kamino.finance/v1/markets', {
        signal: controller.signal,
      }).catch(() => null);
      clearTimeout(timeoutId);
      
      if (response?.ok) {
        const data = await response.json();
        if (data.address) {
          return address(data.address);
        }
        if (Array.isArray(data) && data.length > 0 && data[0].address) {
          return address(data[0].address);
        }
      }
    } catch {
      // Continue to next strategy
    }

    // Strategy 3: Verify well-known address exists on-chain
    try {
      const accountInfo = await rpc.getAccountInfo(KAMINO_MAINNET_LENDING_MARKET).send();
      if (accountInfo.value) {
        console.log('Using well-known Kamino lending market address (verified on-chain)');
        return KAMINO_MAINNET_LENDING_MARKET;
      }
    } catch {
      // Account might not exist or RPC error - continue to fallback
    }

    // Strategy 4: Fall back to well-known address (may not be verified)
    console.warn(
      'Kamino API unavailable and on-chain verification failed. Using well-known lending market address as fallback.'
    );
    return KAMINO_MAINNET_LENDING_MARKET;
  }

  private async deriveLendingMarketAuthority(lendingMarket: Address): Promise<Address> {
    // Lending market authority is typically a PDA
    // Seeds: ["lending_market_authority", lending_market]
    const authoritySeed = Buffer.from('lending_market_authority');
    const lendingMarketBytes = new Uint8Array(getAddressEncoder().encode(lendingMarket));

    const [authority] = await getProgramDerivedAddress({
      programAddress: this.programId,
      seeds: [authoritySeed, lendingMarketBytes],
    });

    return authority;
  }

  private async findReserve(
    mint: Address,
    lendingMarket: Address,
    rpc: Rpc<GetAccountInfoApi>
  ): Promise<Address> {
    // Reserve is typically a PDA derived from lending market and mint
    // Seeds: [lending_market, mint]
    const lendingMarketBytes = new Uint8Array(getAddressEncoder().encode(lendingMarket));
    const mintBytes = new Uint8Array(getAddressEncoder().encode(mint));

    const [reserve] = await getProgramDerivedAddress({
      programAddress: this.programId,
      seeds: [lendingMarketBytes, mintBytes],
    });

    return reserve;
  }

  /**
   * Get reserve details from Kamino API.
   * Returns liquidity supply and collateral mint addresses from the reserve.
   */
  private async getReserveDetails(
    reserve: Address,
    mint: Address,
    lendingMarket: Address,
    rpc: Rpc<GetAccountInfoApi>
  ): Promise<{ liquiditySupply: Address; collateralMint: Address }> {
    // Strategy 1: Try Kamino API to get reserve details
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(
        `https://api.kamino.finance/v1/reserves/${reserve.toString()}`,
        { signal: controller.signal }
      ).catch(() => null);
      clearTimeout(timeoutId);

      if (response?.ok) {
        const data = await response.json();
        if (data.liquiditySupply && data.collateralMint) {
          return {
            liquiditySupply: address(data.liquiditySupply),
            collateralMint: address(data.collateralMint),
          };
        }
      }
    } catch {
      // Continue to next strategy
    }

    // Strategy 2: Try fetching all reserves from API and find by mint
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(
        `https://api.kamino.finance/v1/lending/markets/${lendingMarket.toString()}/reserves`,
        { signal: controller.signal }
      ).catch(() => null);
      clearTimeout(timeoutId);

      if (response?.ok) {
        const data = await response.json();
        if (Array.isArray(data.reserves)) {
          const reserveData = data.reserves.find(
            (r: any) => r.mintAddress === mint.toString() || r.address === reserve.toString()
          );
          if (reserveData?.liquiditySupply && reserveData?.collateralMint) {
            return {
              liquiditySupply: address(reserveData.liquiditySupply),
              collateralMint: address(reserveData.collateralMint),
            };
          }
        }
      }
    } catch {
      // Continue to next strategy
    }

    // Strategy 3: Parse reserve account data directly
    // The reserve account contains these addresses at specific offsets
    try {
      const accountInfo = await rpc.getAccountInfo(reserve).send();
      if (accountInfo.value?.data) {
        let data: Uint8Array;
        if (typeof accountInfo.value.data === 'string') {
          throw new Error('Base58 data not supported yet');
        } else {
          data = accountInfo.value.data;
        }

        // Kamino reserve account layout (approximate):
        // - 8 bytes: discriminator
        // - 1 byte: version
        // - 1 byte: last update slot
        // - 32 bytes: lending market (offset 10)
        // - 32 bytes: liquidity mint (offset 42)
        // - 1 byte: mint decimals (offset 74)
        // - 32 bytes: liquidity supply pubkey (offset 75)
        // - 32 bytes: collateral mint (offset 107+)
        
        if (data.length >= 200) {
          try {
            // Extract liquidity supply at offset ~75
            const liquiditySupplyBytes = data.slice(75, 107);
            const liquiditySupply = address(
              Array.from(liquiditySupplyBytes)
                .map((b) => b.toString(16).padStart(2, '0'))
                .join('')
            );

            // Extract collateral mint at offset ~140 (approximate, may vary)
            const collateralMintBytes = data.slice(140, 172);
            const collateralMint = address(
              Array.from(collateralMintBytes)
                .map((b) => b.toString(16).padStart(2, '0'))
                .join('')
            );

            return { liquiditySupply, collateralMint };
          } catch {
            // Parsing failed
          }
        }
      }
    } catch {
      // Account read failed
    }

    throw new Error(
      `Unable to resolve reserve details for ${mint.toString()}. ` +
        `Please provide reserveLiquiditySupply and reserveCollateralMint manually.`
    );
  }

  private async deriveUserTokenAccount(mint: Address, owner: Address): Promise<Address> {
    // Derive Associated Token Address
    const ownerBytes = new Uint8Array(getAddressEncoder().encode(owner));
    const tokenProgramBytes = new Uint8Array(
      getAddressEncoder().encode(WELL_KNOWN_PROGRAMS.tokenProgram)
    );
    const mintBytes = new Uint8Array(getAddressEncoder().encode(mint));

    const [ata] = await getProgramDerivedAddress({
      programAddress: WELL_KNOWN_PROGRAMS.associatedTokenProgram,
      seeds: [ownerBytes, tokenProgramBytes, mintBytes],
    });

    return ata;
  }

  private needsUserTokenAccount(instruction: IdlInstruction): boolean {
    return instruction.accounts.some(
      (acc) =>
        acc.name.toLowerCase().includes('user') &&
        (acc.name.toLowerCase().includes('source') || acc.name.toLowerCase().includes('liquidity'))
    );
  }

  private needsUserCollateralAccount(instruction: IdlInstruction): boolean {
    return instruction.accounts.some(
      (acc) =>
        acc.name.toLowerCase().includes('user') &&
        (acc.name.toLowerCase().includes('dest') ||
          acc.name.toLowerCase().includes('collateral'))
    );
  }
}

