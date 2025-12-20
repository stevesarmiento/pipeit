/**
 * Standalone test for TPU native client.
 *
 * Run with: node example.mjs
 * Requires: RPC_URL and WS_URL environment variables
 */

import { TpuClient } from './index.js';

const RPC_URL = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
const WS_URL = process.env.WS_URL || 'wss://api.mainnet-beta.solana.com';

console.log('🚀 Testing TPU Native Client (Enhanced)\n');

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

        // NEW: Get comprehensive client stats
        console.log('📈 Client Statistics:');
        const stats = await client.getStats();
        console.log(`   Ready state: ${stats.readyState}`);
        console.log(`   Current slot: ${stats.currentSlot}`);
        console.log(`   QUIC endpoints: ${stats.endpointCount}`);
        console.log(`   Active connections: ${stats.connectionCount}`);
        console.log(`   Known validators: ${stats.knownValidators}`);
        console.log(`   Uptime: ${stats.uptimeSecs}s\n`);

        // Information about new features
        console.log('✨ New Features in this version:');
        console.log('   • Per-leader send results with error codes');
        console.log('   • Internal retry logic (2 attempts per leader)');
        console.log('   • Detailed error classification');
        console.log('   • Client health/stats API\n');

        // Create a dummy transaction (simple transfer)
        // In a real scenario, you'd have a properly signed transaction
        console.log('⚠️  Note: To actually send transactions, you need a signed transaction buffer');
        console.log('   This example only demonstrates client initialization.\n');

        // Example of what sending would look like with the new response format:
        console.log('📝 Enhanced sendTransaction response format:');
        console.log(`   {
     delivered: boolean,
     latencyMs: number,
     leaderCount: number,
     retryCount: number,      // NEW: total retries made
     leaders: [               // NEW: per-leader breakdown
       {
         identity: string,
         address: string,
         success: boolean,
         latencyMs: number,
         attempts: number,
         error?: string,
         errorCode?: string,  // CONNECTION_FAILED, STREAM_CLOSED, etc.
       }
     ]
   }\n`);

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
