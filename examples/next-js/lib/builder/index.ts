/**
 * Visual Transaction Builder library.
 *
 * @packageDocumentation
 */

// Types
export type {
    NodeType,
    NodeCategory,
    BuilderNode,
    BuilderEdge,
    BuilderNodeData,
    BuilderConfig,
    BuilderGraph,
    CompileContext,
    NodeCompileResult,
    GraphCompileResult,
    NodeDefinition,
    SizeInfo,
    SimulationFeedback,
    BuilderFeedback,
    ExecutionState,
} from './types';

// Store
export { useBuilderStore, useNodes, useEdges, useSelectedNodeId, useConfig, useExecutionState } from './store';

// Node definitions
export { nodeDefinitions, getNodeDefinition, getAllNodeDefinitions, getNodeDefinitionsByCategory } from './node-definitions';

// Compiler
export { compileGraph, validateGraph } from './compiler';

// Hooks
export { useBuilderFeedback } from './use-builder-feedback';
