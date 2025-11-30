/**
 * Protocol adapters for @pipeit/actions.
 * 
 * Import adapters from this module or from their individual paths:
 * 
 * @example
 * ```ts
 * // Import all adapters
 * import { jupiter } from '@pipeit/actions/adapters'
 * 
 * // Or import individually (better for tree-shaking)
 * import { jupiter } from '@pipeit/actions/adapters/jupiter'
 * ```
 * 
 * @packageDocumentation
 */

// Jupiter adapter for swaps
export { jupiter, type JupiterConfig } from './jupiter.js';
