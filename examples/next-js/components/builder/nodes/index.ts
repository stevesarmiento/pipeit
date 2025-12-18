/**
 * Node components for the visual transaction builder.
 *
 * All node types use the same BaseNode component with different
 * configurations defined in node-definitions.ts.
 *
 * @packageDocumentation
 */

import { BaseNode } from './base-node';
import type { NodeTypes } from '@xyflow/react';

/**
 * Node type registry for React Flow.
 * Maps node type strings to their React components.
 */
export const nodeTypes: NodeTypes = {
    'wallet': BaseNode,
    'transfer-sol': BaseNode,
    'transfer-token': BaseNode,
    'create-ata': BaseNode,
    'memo': BaseNode,
};

export { BaseNode } from './base-node';
