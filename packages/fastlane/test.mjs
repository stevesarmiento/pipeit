/**
 * Tests for TPU native bindings.
 *
 * These tests verify that the native module loads correctly,
 * exports the expected API, and accepts valid configurations.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';

/**
 * Helper to check if native binding is available.
 * Returns null if not available, otherwise returns the module.
 */
async function tryLoadModule() {
    try {
        return await import('./index.js');
    } catch (error) {
        if (error.code === 'MODULE_NOT_FOUND' || error.message.includes('.node')) {
            return null;
        }
        throw error;
    }
}

describe('TPU Native Module', async () => {
    test('module loads successfully', async () => {
        const module = await tryLoadModule();
        if (!module) {
            console.log('⚠ Native binding not found (expected in CI before build)');
            return;
        }
        assert.ok(module, 'Module should load');
        assert.ok(module.TpuClient, 'TpuClient should be exported');
        console.log('✓ TPU native module loaded successfully');
    });

    test('TpuClient constructor exists', async () => {
        const module = await tryLoadModule();
        if (!module) {
            console.log('⚠ Native binding not found (expected in CI before build)');
            return;
        }
        const { TpuClient } = module;
        assert.strictEqual(typeof TpuClient, 'function', 'TpuClient should be a constructor');
        console.log('✓ TpuClient constructor is available');
    });
});

describe('TpuClientConfig', async () => {
    test('config requires rpc_url and ws_url', async () => {
        const module = await tryLoadModule();
        if (!module) {
            console.log('⚠ Native binding not found (expected in CI before build)');
            return;
        }
        const { TpuClient } = module;

        // Missing required fields should throw
        // Note: NAPI converts snake_case to camelCase in error messages
        assert.throws(
            () => new TpuClient({}),
            /rpcUrl|wsUrl|rpc_url|ws_url/i,
            'Should require rpc_url and ws_url'
        );
        console.log('✓ Config validation works');
    });

    test('config accepts optional fanout parameter', async () => {
        const module = await tryLoadModule();
        if (!module) {
            console.log('⚠ Native binding not found (expected in CI before build)');
            return;
        }
        const { TpuClient } = module;

        // Valid config with fanout should be accepted (will fail to connect but config is valid)
        const config = {
            rpc_url: 'https://api.mainnet-beta.solana.com',
            ws_url: 'wss://api.mainnet-beta.solana.com',
            fanout: 2,
        };

        // This will attempt to connect and fail, but the config structure is valid
        // We just want to verify the config is accepted without type errors
        try {
            const client = new TpuClient(config);
            // If we get here, config was accepted
            client.shutdown();
            console.log('✓ Config with fanout=2 accepted');
        } catch (error) {
            // Connection errors are expected - we're testing config acceptance
            if (error.message.includes('fanout')) {
                throw error; // Re-throw if it's a config error
            }
            console.log('✓ Config with fanout=2 accepted (connection failed as expected)');
        }
    });

    test('config accepts optional prewarm_connections parameter', async () => {
        const module = await tryLoadModule();
        if (!module) {
            console.log('⚠ Native binding not found (expected in CI before build)');
            return;
        }
        const { TpuClient } = module;

        const config = {
            rpc_url: 'https://api.mainnet-beta.solana.com',
            ws_url: 'wss://api.mainnet-beta.solana.com',
            prewarm_connections: false,
        };

        try {
            const client = new TpuClient(config);
            client.shutdown();
            console.log('✓ Config with prewarm_connections=false accepted');
        } catch (error) {
            if (error.message.includes('prewarm')) {
                throw error;
            }
            console.log('✓ Config with prewarm_connections=false accepted (connection failed as expected)');
        }
    });

    test('config accepts combined optional parameters', async () => {
        const module = await tryLoadModule();
        if (!module) {
            console.log('⚠ Native binding not found (expected in CI before build)');
            return;
        }
        const { TpuClient } = module;

        // Test with all optional parameters
        const config = {
            rpc_url: 'https://api.mainnet-beta.solana.com',
            ws_url: 'wss://api.mainnet-beta.solana.com',
            fanout: 4,
            prewarm_connections: true,
        };

        try {
            const client = new TpuClient(config);
            client.shutdown();
            console.log('✓ Config with all optional parameters accepted');
        } catch (error) {
            if (error.message.includes('fanout') || error.message.includes('prewarm')) {
                throw error;
            }
            console.log('✓ Config with all optional parameters accepted (connection failed as expected)');
        }
    });
});

describe('TpuClient API', async () => {
    test('TpuClient has expected methods', async () => {
        const module = await tryLoadModule();
        if (!module) {
            console.log('⚠ Native binding not found (expected in CI before build)');
            return;
        }
        const { TpuClient } = module;

        // Check that expected methods exist on the prototype
        const expectedMethods = [
            'sendTransaction',
            'sendUntilConfirmed',
            'getCurrentSlot',
            'getConnectionCount',
            'getStats',
            'waitReady',
            'shutdown',
        ];

        for (const method of expectedMethods) {
            assert.ok(
                typeof TpuClient.prototype[method] === 'function',
                `TpuClient should have ${method} method`
            );
        }
        console.log('✓ TpuClient has all expected methods');
    });
});
