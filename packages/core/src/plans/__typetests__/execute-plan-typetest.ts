/**
 * Type tests for ExecutePlanConfig.
 *
 * These tests verify that the ExecutePlanConfig type union correctly enforces
 * RPC API requirements based on the lookup table configuration provided.
 */

import type { Address } from '@solana/addresses';
import type {
    Rpc,
    GetLatestBlockhashApi,
    GetAccountInfoApi,
    GetEpochInfoApi,
    GetSignatureStatusesApi,
    SendTransactionApi,
    SimulateTransactionApi,
} from '@solana/rpc';
import type { RpcSubscriptions, SignatureNotificationsApi, SlotNotificationsApi } from '@solana/rpc-subscriptions';
import type { TransactionSigner } from '@solana/signers';

import type { ExecutePlanConfig } from '../execute-plan.js';
import type { AddressesByLookupTableAddress } from '../../lookup-tables/index.js';

// Mock types for testing
type BaseRpcApi = GetEpochInfoApi &
    GetSignatureStatusesApi &
    SendTransactionApi &
    GetLatestBlockhashApi &
    SimulateTransactionApi;

type RpcApiWithAccountInfo = BaseRpcApi & GetAccountInfoApi;

const baseRpc = null as unknown as Rpc<BaseRpcApi>;
const rpcWithAccountInfo = null as unknown as Rpc<RpcApiWithAccountInfo>;
const rpcSubscriptions = null as unknown as RpcSubscriptions<SignatureNotificationsApi & SlotNotificationsApi>;
const signer = null as unknown as TransactionSigner;
const altAddress = null as unknown as Address;
const addressesByLookupTable = null as unknown as AddressesByLookupTableAddress;

// [DESCRIBE] ExecutePlanConfig without ALT support
{
    // It accepts config with base RPC when no lookup tables are provided
    {
        const config: ExecutePlanConfig = {
            rpc: baseRpc,
            rpcSubscriptions,
            signer,
        };
        config satisfies ExecutePlanConfig;
    }

    // It accepts config with optional commitment
    {
        const config: ExecutePlanConfig = {
            rpc: baseRpc,
            rpcSubscriptions,
            signer,
            commitment: 'confirmed',
        };
        config satisfies ExecutePlanConfig;
    }

    // It accepts config with optional abortSignal
    {
        const config: ExecutePlanConfig = {
            rpc: baseRpc,
            rpcSubscriptions,
            signer,
            abortSignal: new AbortController().signal,
        };
        config satisfies ExecutePlanConfig;
    }
}

// [DESCRIBE] ExecutePlanConfig with lookupTableAddresses
{
    // It requires RPC with GetAccountInfoApi when lookupTableAddresses is provided
    {
        const config: ExecutePlanConfig = {
            rpc: rpcWithAccountInfo,
            rpcSubscriptions,
            signer,
            lookupTableAddresses: [altAddress],
        };
        config satisfies ExecutePlanConfig;
    }

    // @ts-expect-error It rejects base RPC (without GetAccountInfoApi) when lookupTableAddresses is provided
    const _invalidConfig: ExecutePlanConfig = {
        rpc: baseRpc,
        rpcSubscriptions,
        signer,
        lookupTableAddresses: [altAddress],
    };
}

// [DESCRIBE] ExecutePlanConfig with addressesByLookupTable (pre-fetched)
{
    // It accepts base RPC when using pre-fetched addressesByLookupTable
    {
        const config: ExecutePlanConfig = {
            rpc: baseRpc,
            rpcSubscriptions,
            signer,
            addressesByLookupTable,
        };
        config satisfies ExecutePlanConfig;
    }

    // It does not require GetAccountInfoApi since tables are pre-fetched
    {
        const config: ExecutePlanConfig = {
            rpc: baseRpc, // Base RPC is sufficient
            rpcSubscriptions,
            signer,
            addressesByLookupTable,
            commitment: 'finalized',
        };
        config satisfies ExecutePlanConfig;
    }
}

// [DESCRIBE] ExecutePlanConfig mutual exclusivity
{
    // @ts-expect-error It rejects config with both lookupTableAddresses and addressesByLookupTable
    const _invalidConfig: ExecutePlanConfig = {
        rpc: rpcWithAccountInfo,
        rpcSubscriptions,
        signer,
        lookupTableAddresses: [altAddress],
        addressesByLookupTable,
    };
}
