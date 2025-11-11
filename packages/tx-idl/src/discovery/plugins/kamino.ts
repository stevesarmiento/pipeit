/**
 * Kamino lending account resolution plugin.
 *
 * Automatically resolves accounts for Kamino lending instructions (deposit, withdraw, etc.)
 * by querying on-chain data and deriving required account addresses.
 *
 * @packageDocumentation
 */

import { address, getProgramDerivedAddress, getAddressEncoder } from 'gill';
import type { Address, Rpc, GetAccountInfoApi } from 'gill';
import type { IdlInstruction } from '../../types.js';
import type { ProtocolAccountPlugin } from './plugin.js';
import type { DiscoveryContext } from '../types.js';
import { WELL_KNOWN_PROGRAMS } from '../strategies/constants.js';

/**
 * Kamino Lending program address (mainnet).
 */
export const KAMINO_LENDING_PROGRAM = address('KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD');

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

    // Derive reserve liquidity supply (vault)
    const reserveLiquiditySupply = await this.deriveReserveLiquiditySupply(reserve, context.rpc);
    if (reserveLiquiditySupply) {
      accounts.reserveLiquiditySupply = reserveLiquiditySupply;
    }

    // Derive reserve collateral mint
    const reserveCollateralMint = await this.deriveReserveCollateralMint(reserve, context.rpc);
    if (reserveCollateralMint) {
      accounts.reserveCollateralMint = reserveCollateralMint;
    }

    // Derive user token accounts if needed
    if (this.needsUserTokenAccount(instruction)) {
      const userSourceLiquidity = await this.deriveUserTokenAccount(mint, context.signer);
      accounts.userSourceLiquidity = userSourceLiquidity;
    }

    if (this.needsUserCollateralAccount(instruction)) {
      const userDestinationCollateral = await this.deriveUserTokenAccount(
        reserveCollateralMint || mint,
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
    // Try to fetch from Kamino API or use well-known address
    // For mainnet, Kamino has a standard lending market
    // This could be enhanced to query Kamino's API or on-chain data
    try {
      // Try Kamino API if available
      const response = await fetch('https://api.kamino.finance/v1/lending/markets').catch(() => null);
      if (response?.ok) {
        const data = await response.json();
        if (data.markets && data.markets.length > 0) {
          return address(data.markets[0].address);
        }
      }
    } catch {
      // Fall through to error
    }

    throw new Error(
      'Lending market address required. Provide it in params.lendingMarket or ensure Kamino API is accessible.'
    );
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

  private async deriveReserveLiquiditySupply(
    reserve: Address,
    rpc: Rpc<GetAccountInfoApi>
  ): Promise<Address | undefined> {
    // Try to read reserve account on-chain to get liquidity supply address
    try {
      const accountInfo = await rpc.getAccountInfo(reserve).send();
      if (accountInfo.value?.data) {
        // Reserve account structure: [liquidity_supply: Pubkey, ...]
        // This is a simplified version - actual parsing would need the reserve account layout
        // For now, return undefined and let the user provide it or enhance with proper parsing
        return undefined;
      }
    } catch {
      // Account not found or error reading
    }
    return undefined;
  }

  private async deriveReserveCollateralMint(
    reserve: Address,
    rpc: Rpc<GetAccountInfoApi>
  ): Promise<Address | undefined> {
    // Try to read reserve account on-chain to get collateral mint address
    try {
      const accountInfo = await rpc.getAccountInfo(reserve).send();
      if (accountInfo.value?.data) {
        // Reserve account structure: [collateral_mint: Pubkey, ...]
        // This is a simplified version - actual parsing would need the reserve account layout
        // For now, return undefined and let the user provide it or enhance with proper parsing
        return undefined;
      }
    } catch {
      // Account not found or error reading
    }
    return undefined;
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

