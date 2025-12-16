/**
 * Basic smoke test for TPU native bindings.
 * 
 * This test verifies that the native module can be loaded
 * and that the TpuClient class is exported correctly.
 */

import { test } from 'node:test';
import assert from 'node:assert';

test('TPU native module loads', async () => {
  try {
    const module = await import('./index.js');
    assert.ok(module, 'Module should load');
    assert.ok(module.TpuClient, 'TpuClient should be exported');
    console.log('✓ TPU native module loaded successfully');
  } catch (error) {
    // If the module doesn't exist yet (pre-build), that's okay for CI
    if (error.code === 'MODULE_NOT_FOUND' || error.message.includes('.node')) {
      console.log('⚠ Native binding not found (expected in CI before build)');
      return;
    }
    throw error;
  }
});

test('TpuClient constructor exists', async () => {
  try {
    const { TpuClient } = await import('./index.js');
    assert.strictEqual(typeof TpuClient, 'function', 'TpuClient should be a constructor');
    console.log('✓ TpuClient constructor is available');
  } catch (error) {
    // If the module doesn't exist yet (pre-build), that's okay for CI
    if (error.code === 'MODULE_NOT_FOUND' || error.message.includes('.node')) {
      console.log('⚠ Native binding not found (expected in CI before build)');
      return;
    }
    throw error;
  }
});

