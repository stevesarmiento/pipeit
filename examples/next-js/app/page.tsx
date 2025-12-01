import { Hero, Benefits, CodeComparison, FeatureExample, PipelineExample } from '@/components/landing';

const beforeCode = `import { 
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  signTransaction,
  sendTransaction,
  address,
  lamports,
  pipe
} from '@solana/kit';
import { getTransferSolInstruction } from '@solana-program/system';

const rpc = createSolanaRpc(rpcUrl);
const rpcSubscriptions = createSolanaRpcSubscriptions(rpcUrl.replace('http', 'ws'));
const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

const transferInstruction = getTransferSolInstruction({
  source: signer.address,
  destination: address(recipientAddress),
  amount: lamports(BigInt(amount * 1_000_000_000)),
});

const transactionMessage = pipe(
  createTransactionMessage({ version: 0 }),
  tx => setTransactionMessageFeePayer(signer.address, tx),
  tx => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
  tx => appendTransactionMessageInstructions([transferInstruction], tx)
);

const signedTransaction = await signTransaction([signer], transactionMessage);
const signature = await sendTransaction(rpc, signedTransaction).send();`;

const afterCode = `import { TransactionBuilder } from '@pipeit/core';
import { getTransferSolInstruction } from '@solana-program/system';
import { address, lamports } from '@solana/kit';

const LAMPORTS_PER_SOL = 1_000_000_000n;

const transferInstruction = getTransferSolInstruction({
  source: signer,
  destination: address(recipientAddress),
  amount: lamports(BigInt(amount * LAMPORTS_PER_SOL)),
});

const signature = await new TransactionBuilder({ 
  rpc,
  autoRetry: true, 
  priorityLevel: 'medium' 
})
  .setFeePayer(signer.address)
  .addInstruction(transferInstruction)
  .execute({
    rpcSubscriptions,
    commitment: 'confirmed',
  });`;

export default function Home() {
    return (
        <div className="max-w-7xl mx-auto min-h-screen bg-bg1 border-r border-l border-sand-200">
            <main className="container mx-auto">
                <Hero />
                <Benefits />
                <CodeComparison 
                    beforeTitle="SolanaKit"
                    beforeDescription="Transfer SOL using Solana Kit - manual blockhash, signing, and sending"
                    beforeCode={beforeCode}
                    afterTitle="PipeIt"
                    afterDescription="Transfer SOL using Pipe It - automatic blockhash, retry, and confirmation"
                    afterCode={afterCode}
                />
                <FeatureExample />
                <PipelineExample />
            </main>
        </div>
    );
}
