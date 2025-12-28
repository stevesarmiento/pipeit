import { Hero, Benefits, CodeComparison, Playground } from '@/components/landing';

const beforeCode = `import { 
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstruction,
  pipe,
  sendAndConfirmTransactionFactory,
  address,
  lamports,
} from '@solana/kit';
import { signTransactionMessageWithSigners } from '@solana/signers';
import { getTransferSolInstruction } from '@solana-program/system';

const rpc = createSolanaRpc(rpcUrl);
const rpcSubscriptions = createSolanaRpcSubscriptions(wsUrl);

const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

const message = pipe(
  createTransactionMessage({ version: 0 }),
  tx => setTransactionMessageFeePayer(signer.address, tx),
  tx => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
  tx => appendTransactionMessageInstruction(
    getTransferSolInstruction({
      source: signer,
      destination: address(recipient),
      amount: lamports(1_000_000_000n),
    }),
    tx
  )
);

const signedTx = await signTransactionMessageWithSigners(message);
const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });
await sendAndConfirm(signedTx, { commitment: 'confirmed' });`;

const afterCode = `import { TransactionBuilder } from '@pipeit/core';
import { getTransferSolInstruction } from '@solana-program/system';
import { address, lamports } from '@solana/kit';

const signature = await new TransactionBuilder({ 
  rpc,
  autoRetry: true, 
  priorityFee: 'medium',
})
  .setFeePayerSigner(signer)
  .addInstruction(
    getTransferSolInstruction({
      source: signer,
      destination: address(recipient),
      amount: lamports(1_000_000_000n),
    })
  )
  .execute({
    rpcSubscriptions,
    commitment: 'confirmed',
  });`;

export default function Home() {
    return (
        <div className="max-w-7xl mx-auto border-r border-l border-sand-200">
            {/* Landing content - scrolls normally */}
            <div className="relative z-0 bg-bg1">
                <Hero />
                <Benefits />
                <CodeComparison
                    beforeTitle="@solana/kit"
                    beforeDescription="Manual blockhash fetching, message building, signing, and confirmation"
                    beforeCode={beforeCode}
                    afterTitle="@pipeit/core"
                    afterDescription="Automatic blockhash, retry logic, priority fees, and confirmation"
                    afterCode={afterCode}
                />
            </div>

            {/* Playground - sticky at top, covers content as it scrolls behind */}
            <Playground />
        </div>
    );
}
