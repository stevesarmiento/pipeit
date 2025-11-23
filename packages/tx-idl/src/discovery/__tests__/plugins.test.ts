import { describe, it, expect, vi } from 'vitest';
import { ProtocolPluginRegistry } from '../plugins/plugin-registry.js';
import type { ProtocolAccountPlugin } from '../plugins/plugin.js';
import { address } from '@solana/addresses';

describe('ProtocolPluginRegistry', () => {
  it('should register and retrieve plugins', () => {
    const registry = new ProtocolPluginRegistry();

    const plugin: ProtocolAccountPlugin = {
      id: 'test-plugin',
      programId: address('11111111111111111111111111111111'),
      instructions: ['test'],
      resolveAccounts: vi.fn().mockResolvedValue({}),
    };

    registry.register(plugin);
    const retrieved = registry.getPlugin(
      address('11111111111111111111111111111111'),
      'test'
    );

    expect(retrieved).toBe(plugin);
  });

  it('should support wildcard instructions', () => {
    const registry = new ProtocolPluginRegistry();

    const plugin: ProtocolAccountPlugin = {
      id: 'wildcard-plugin',
      programId: address('11111111111111111111111111111111'),
      instructions: '*',
      resolveAccounts: vi.fn().mockResolvedValue({}),
    };

    registry.register(plugin);
    const retrieved = registry.getPlugin(
      address('11111111111111111111111111111111'),
      'any-instruction'
    );

    expect(retrieved).toBe(plugin);
  });

  it('should return undefined for non-matching plugins', () => {
    const registry = new ProtocolPluginRegistry();

    const plugin: ProtocolAccountPlugin = {
      id: 'test-plugin',
      programId: address('11111111111111111111111111111111'),
      instructions: ['test'],
      resolveAccounts: vi.fn().mockResolvedValue({}),
    };

    registry.register(plugin);
    const retrieved = registry.getPlugin(
      address('11111111111111111111111111111111'),
      'other-instruction'
    );

    expect(retrieved).toBeUndefined();
  });

  it('should unregister plugins', () => {
    const registry = new ProtocolPluginRegistry();

    const plugin: ProtocolAccountPlugin = {
      id: 'test-plugin',
      programId: address('11111111111111111111111111111111'),
      instructions: ['test'],
      resolveAccounts: vi.fn().mockResolvedValue({}),
    };

    registry.register(plugin);
    registry.unregister('test-plugin');

    const retrieved = registry.getPlugin(
      address('11111111111111111111111111111111'),
      'test'
    );

    expect(retrieved).toBeUndefined();
  });
});


