/**
 * Standalone test for TPU native client.
 * 
 * Run with: node example.mjs
 * Requires: RPC_URL and WS_URL environment variables
 */

import { TpuClient } from './index.js';

const RPC_URL = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
const WS_URL = process.env.WS_URL || 'wss://api.mainnet-beta.solana.com';

console.log('🚀 Testing TPU Native Client\n');

async function main() {
  try {
    console.log('📡 Creating TPU client...');
    console.log(`   RPC: ${RPC_URL}`);
    console.log(`   WS:  ${WS_URL}\n`);

    const client = new TpuClient({
      rpcUrl: RPC_URL,
      wsUrl: WS_URL,
      fanout: 2,
    });

    console.log('⏳ Waiting for client to be ready...');
    await client.waitReady();
    console.log('✅ Client is ready!\n');

    // Get current slot
    const slot = client.getCurrentSlot();
    console.log(`📊 Current slot: ${slot}`);

    // Get connection count
    const connections = await client.getConnectionCount();
    console.log(`🔌 Active connections: ${connections}\n`);

    // Create a dummy transaction (simple transfer)
    // In a real scenario, you'd have a properly signed transaction
    console.log('⚠️  Note: To actually send transactions, you need a signed transaction buffer');
    console.log('   This example only demonstrates client initialization.\n');

    // Example of what sending would look like:
    // const txBuffer = Buffer.from(signedTransactionBase64, 'base64');
    // const result = await client.sendTransaction(txBuffer);
    // console.log(`✅ Transaction sent: ${result.delivered ? 'SUCCESS' : 'FAILED'}`);
    // console.log(`   Leaders reached: ${result.leaderCount}`);
    // console.log(`   Latency: ${result.latencyMs}ms`);

    console.log('🎉 TPU client test completed successfully!');
    
    // Cleanup
    client.shutdown();
    console.log('🛑 Client shut down');

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error);
    process.exit(1);
  }
}

main();

