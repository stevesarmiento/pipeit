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
    ComputeUnitInfo,
    SimulationFeedback,
    BuilderFeedback,
    ExecutionState,
    ExecutionStrategy,
    JitoRegion,
    ExecuteNodeData,
    ExtractedExecutionConfig,
    // Batch-related types
    EdgeDirection,
    BatchGroup,
} from './types';

// Type utilities
export {
    HANDLE_NAMES,
    getEdgeDirection,
    isVerticalEdge,
    isHorizontalEdge,
} from './types';

// Store
export {
    useBuilderStore,
    useNodes,
    useEdges,
    useSelectedNodeId,
    useConfig,
    useExecutionState,
    // Batch-related selectors
    useNodesInSequence,
    useBatchGroups,
    useHasAnySequence,
    getNodesInSequence,
    getBatchGroups,
    hasAnySequence,
} from './store';

// Node definitions
export { nodeDefinitions, getNodeDefinition, getAllNodeDefinitions, getNodeDefinitionsByCategory, STRATEGY_INFO } from './node-definitions';

// Compiler
export { compileGraph, validateGraph, extractExecutionConfig } from './compiler';

// Hooks
export { useBuilderFeedback } from './use-builder-feedback';

