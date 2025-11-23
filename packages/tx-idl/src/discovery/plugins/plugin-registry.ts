/**
 * Protocol plugin registry.
 *
 * Manages registration and lookup of protocol-specific account resolution plugins.
 *
 * @packageDocumentation
 */

import type { Address } from '@solana/addresses';
import type { ProtocolAccountPlugin } from './plugin.js';

/**
 * Registry for protocol-specific account plugins.
 *
 * Plugins are keyed by program ID and can be looked up by program + instruction name.
 */
export class ProtocolPluginRegistry {
  private plugins = new Map<string, ProtocolAccountPlugin[]>();

  /**
   * Register a protocol plugin.
   *
   * @param plugin - Plugin to register
   */
  register(plugin: ProtocolAccountPlugin): void {
    const key = plugin.programId;
    const existing = this.plugins.get(key) || [];
    existing.push(plugin);
    this.plugins.set(key, existing);
  }

  /**
   * Get a plugin for a specific program and instruction.
   *
   * @param programId - Program ID
   * @param instructionName - Instruction name
   * @returns Matching plugin, or undefined if none found
   */
  getPlugin(
    programId: Address,
    instructionName: string
  ): ProtocolAccountPlugin | undefined {
    const plugins = this.plugins.get(programId) || [];
    return plugins.find(
      (p) => p.instructions === '*' || p.instructions.includes(instructionName)
    );
  }

  /**
   * Unregister a plugin by ID.
   *
   * @param pluginId - Plugin ID to remove
   */
  unregister(pluginId: string): void {
    for (const [key, plugins] of this.plugins.entries()) {
      this.plugins.set(key, plugins.filter((p) => p.id !== pluginId));
    }
  }

  /**
   * Get all plugins for a program.
   *
   * @param programId - Program ID
   * @returns Array of plugins for the program
   */
  getPluginsForProgram(programId: Address): readonly ProtocolAccountPlugin[] {
    return this.plugins.get(programId) || [];
  }

  /**
   * Clear all registered plugins.
   */
  clear(): void {
    this.plugins.clear();
  }
}


