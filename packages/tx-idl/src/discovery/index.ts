/**
 * Account discovery system.
 *
 * @packageDocumentation
 */

// Types
export type { AccountDiscoveryStrategy, DiscoveryContext } from './types.js';

// Registry
export { AccountDiscoveryRegistry } from './registry.js';

// Strategies
export { WellKnownProgramResolver } from './strategies/well-known.js';
export { AssociatedTokenAccountResolver } from './strategies/ata.js';
export { WELL_KNOWN_PROGRAMS, WELL_KNOWN_PATTERNS } from './strategies/constants.js';

// Plugins
export type { ProtocolAccountPlugin } from './plugins/plugin.js';
export { ProtocolPluginRegistry } from './plugins/plugin-registry.js';

