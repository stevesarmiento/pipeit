/**
 * Type tests for TransactionBuilder.build().
 *
 * These tests verify that build() is only callable once a fee payer and a
 * lifetime are known, and that its result is accepted by Kit's
 * compileTransaction without a cast.
 */

import type { Address } from '@solana/addresses';
import type { Rpc, GetLatestBlockhashApi, GetAccountInfoApi } from '@solana/rpc';
import type { Blockhash } from '@solana/rpc-types';
import type { TransactionSigner } from '@solana/signers';
import type { TransactionMessage } from '@solana/transaction-messages';
import {
    compileTransaction,
    getBase64EncodedWireTransaction,
    type TransactionWithLifetime,
} from '@solana/transactions';

import { TransactionBuilder } from '../builder.js';
import type { TransactionBuilderConfig } from '../builder.js';
import type { BuiltTransactionMessage } from '../../types.js';

// Mock values for testing
const rpc = null as unknown as Rpc<GetLatestBlockhashApi & GetAccountInfoApi>;
const maybeRpc = null as unknown as Rpc<GetLatestBlockhashApi & GetAccountInfoApi> | undefined;
const feePayer = null as unknown as Address;
const signer = null as unknown as TransactionSigner;
const blockhash = null as unknown as Blockhash;
const nonceAccountAddress = null as unknown as Address;
const nonceAuthorityAddress = null as unknown as Address;

// [DESCRIBE] build() result
async () => {
    // It is accepted by compileTransaction without a cast
    {
        const message = await new TransactionBuilder()
            .setFeePayer(feePayer)
            .setBlockhashLifetime(blockhash, 1n)
            .build();
        message satisfies BuiltTransactionMessage;
        const transaction = compileTransaction(message);
        transaction satisfies TransactionWithLifetime;
        getBase64EncodedWireTransaction(transaction) satisfies string;
    }

    // It is still assignable where a plain TransactionMessage is expected
    {
        const message: TransactionMessage = await new TransactionBuilder({ rpc }).setFeePayer(feePayer).build();
        message satisfies TransactionMessage;
    }

    // It compiles for every version and for durable nonce lifetimes
    {
        compileTransaction(await new TransactionBuilder({ rpc, version: 'legacy' }).setFeePayer(feePayer).build());
        compileTransaction(await new TransactionBuilder({ rpc, version: 1 }).setFeePayerSigner(signer).build());
        compileTransaction(
            await new TransactionBuilder()
                .setFeePayer(feePayer)
                .setDurableNonceLifetime('nonce', nonceAccountAddress, nonceAuthorityAddress)
                .build(),
        );
        const nonceBuilder = await TransactionBuilder.withDurableNonce({
            rpc,
            nonceAccountAddress,
            nonceAuthorityAddress,
        });
        compileTransaction(await nonceBuilder.setFeePayer(feePayer).build());
    }
};

// [DESCRIBE] build() state requirements
async () => {
    // It accepts a fee payer plus an explicit lifetime, in either order
    {
        await new TransactionBuilder().setFeePayer(feePayer).setBlockhashLifetime(blockhash, 1n).build();
        await new TransactionBuilder().setBlockhashLifetime(blockhash, 1n).setFeePayerSigner(signer).build();
    }

    // It accepts a fee payer plus an rpc, which auto-fetches the blockhash
    {
        await new TransactionBuilder({ rpc }).setFeePayer(feePayer).addInstructions([]).build();
    }

    // It rejects a builder with nothing set
    {
        // @ts-expect-error fee payer and lifetime are missing
        await new TransactionBuilder().build();
    }

    // It rejects a builder without a fee payer
    {
        // @ts-expect-error fee payer is missing
        await new TransactionBuilder().setBlockhashLifetime(blockhash, 1n).build();
        // @ts-expect-error fee payer is missing
        await new TransactionBuilder({ rpc }).build();
    }

    // It rejects a builder without a lifetime or an rpc
    {
        // @ts-expect-error lifetime is missing
        await new TransactionBuilder().setFeePayer(feePayer).build();
        // @ts-expect-error lifetime is missing
        await new TransactionBuilder({ version: 1 }).setFeePayer(feePayer).build();
    }

    // It rejects a builder whose rpc is not known to be present
    {
        // @ts-expect-error rpc may be undefined, so the lifetime is not guaranteed
        await new TransactionBuilder({ rpc: maybeRpc }).setFeePayer(feePayer).build();
        const config: TransactionBuilderConfig = { rpc };
        // @ts-expect-error rpc is optional in TransactionBuilderConfig
        await new TransactionBuilder(config).setFeePayer(feePayer).build();
        // An explicit lifetime still satisfies it
        await new TransactionBuilder(config).setFeePayer(feePayer).setBlockhashLifetime(blockhash, 1n).build();
    }
};
