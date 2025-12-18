/**
 * Zustand store for the visual transaction builder.
 *
 * Manages:
 * - Nodes and edges (React Flow state)
 * - Selected node for inspector
 * - Builder configuration
 * - Execution state
 *
 * @packageDocumentation
 */

import { create } from 'zustand';

// Simple ID generator (avoid external dependency)
function generateId(): string {
    return Math.random().toString(36).substring(2, 10);
}
import type {
    BuilderNode,
    BuilderEdge,
    BuilderConfig,
    NodeType,
    BuilderNodeData,
    ExecutionState,
    BatchGroup,
} from './types';
import { isVerticalEdge, isHorizontalEdge, HANDLE_NAMES } from './types';
import { getNodeDefinition } from './node-definitions';

// =============================================================================
// Store Interface
// =============================================================================

interface BuilderStore {
    // Graph state
    nodes: BuilderNode[];
    edges: BuilderEdge[];
    selectedNodeId: string | null;

    // Configuration
    config: BuilderConfig;

    // Execution state
    executionState: ExecutionState;

    // Node actions
    addNode: (type: NodeType, position: { x: number; y: number }) => string;
    updateNodeData: (id: string, data: Partial<BuilderNodeData>) => void;
    updateNodePosition: (id: string, position: { x: number; y: number }) => void;
    removeNode: (id: string) => void;
    selectNode: (id: string | null) => void;

    // Edge actions
    setEdges: (edges: BuilderEdge[]) => void;
    addEdge: (edge: Omit<BuilderEdge, 'id'>) => void;
    removeEdge: (id: string) => void;

    // Bulk update (for React Flow callbacks)
    setNodes: (nodes: BuilderNode[]) => void;
    onNodesChange: (changes: any[]) => void;
    onEdgesChange: (changes: any[]) => void;

    // Config actions
    updateConfig: (config: Partial<BuilderConfig>) => void;

    // Execution actions
    setExecutionState: (state: ExecutionState) => void;

    // Utility
    getSelectedNode: () => BuilderNode | null;
    reset: () => void;
}

// =============================================================================
// Initial State
// =============================================================================

const initialConfig: BuilderConfig = {
    priorityFee: 'medium',
    computeUnits: 'auto',
};

const initialExecutionState: ExecutionState = { status: 'idle' };

/**
 * Create the default nodes for a new builder canvas.
 * Places Wallet at top and Execute at bottom to establish vertical flow.
 */
function createDefaultNodes(): BuilderNode[] {
    const walletDef = getNodeDefinition('wallet');
    const executeDef = getNodeDefinition('execute');

    return [
        {
            id: 'default-wallet',
            type: 'wallet' as const,
            position: { x: 300, y: 50 },  // Top center
            data: { ...walletDef.defaultData } as BuilderNodeData,
        },
        {
            id: 'default-execute',
            type: 'execute' as const,
            position: { x: 300, y: 400 }, // Bottom center
            data: { ...executeDef.defaultData } as BuilderNodeData,
        },
    ];
}

/**
 * Create the default edge connecting Wallet to Execute.
 * Shows a dotted animated line to indicate the flow path.
 */
function createDefaultEdges(): BuilderEdge[] {
    return [
        {
            id: 'default-edge',
            source: 'default-wallet',
            target: 'default-execute',
            sourceHandle: HANDLE_NAMES.FLOW_OUT,
            targetHandle: HANDLE_NAMES.FLOW_IN,
            animated: true,
            style: { strokeDasharray: '5,5', stroke: '#9ca3af' },
        },
    ];
}

// =============================================================================
// Store Implementation
// =============================================================================

export const useBuilderStore = create<BuilderStore>((set, get) => ({
    // Initial state - start with Wallet and Execute nodes connected
    nodes: createDefaultNodes(),
    edges: createDefaultEdges(),
    selectedNodeId: null,
    config: initialConfig,
    executionState: initialExecutionState,

    // Node actions
    addNode: (type, position) => {
        const def = getNodeDefinition(type);
        const id = generateId();

        const newNode: BuilderNode = {
            id,
            type,
            position,
            data: { ...def.defaultData } as BuilderNodeData,
        };

        set(state => {
            // Remove the default placeholder edge when adding instruction nodes
            // (keeps the canvas clean once user starts building)
            const isInstructionNode = type !== 'wallet' && type !== 'execute';
            const edges = isInstructionNode 
                ? state.edges.filter(e => e.id !== 'default-edge')
                : state.edges;

            return {
                nodes: [...state.nodes, newNode],
                edges,
                selectedNodeId: id,
            };
        });

        return id;
    },

    updateNodeData: (id, data) => {
        set(state => ({
            nodes: state.nodes.map(node =>
                node.id === id
                    ? { ...node, data: { ...node.data, ...data } }
                    : node
            ),
        }));
    },

    updateNodePosition: (id, position) => {
        set(state => ({
            nodes: state.nodes.map(node =>
                node.id === id ? { ...node, position } : node
            ),
        }));
    },

    removeNode: (id) => {
        set(state => ({
            nodes: state.nodes.filter(node => node.id !== id),
            edges: state.edges.filter(
                edge => edge.source !== id && edge.target !== id
            ),
            selectedNodeId: state.selectedNodeId === id ? null : state.selectedNodeId,
        }));
    },

    selectNode: (id) => {
        set({ selectedNodeId: id });
    },

    // Edge actions
    setEdges: (edges) => {
        set({ edges });
    },

    addEdge: (edge) => {
        const id = generateId();
        set(state => ({
            edges: [...state.edges, { ...edge, id }],
        }));
    },

    removeEdge: (id) => {
        set(state => ({
            edges: state.edges.filter(edge => edge.id !== id),
        }));
    },

    // Bulk updates for React Flow
    setNodes: (nodes) => {
        set({ nodes });
    },

    onNodesChange: (changes) => {
        set(state => {
            let nodes = [...state.nodes];
            let selectedNodeId = state.selectedNodeId;

            for (const change of changes) {
                if (change.type === 'position' && change.position) {
                    const idx = nodes.findIndex(n => n.id === change.id);
                    if (idx !== -1) {
                        nodes[idx] = {
                            ...nodes[idx],
                            position: change.position,
                        };
                    }
                } else if (change.type === 'remove') {
                    nodes = nodes.filter(n => n.id !== change.id);
                    if (selectedNodeId === change.id) {
                        selectedNodeId = null;
                    }
                } else if (change.type === 'select') {
                    if (change.selected) {
                        selectedNodeId = change.id;
                    }
                }
            }

            return { nodes, selectedNodeId };
        });
    },

    onEdgesChange: (changes) => {
        set(state => {
            let edges = [...state.edges];

            for (const change of changes) {
                if (change.type === 'remove') {
                    edges = edges.filter(e => e.id !== change.id);
                }
            }

            return { edges };
        });
    },

    // Config actions
    updateConfig: (config) => {
        set(state => ({
            config: { ...state.config, ...config },
        }));
    },

    // Execution actions
    setExecutionState: (executionState) => {
        set({ executionState });
    },

    // Utility
    getSelectedNode: () => {
        const { nodes, selectedNodeId } = get();
        return nodes.find(n => n.id === selectedNodeId) ?? null;
    },

    reset: () => {
        set({
            nodes: createDefaultNodes(),
            edges: createDefaultEdges(),
            selectedNodeId: null,
            config: initialConfig,
            executionState: initialExecutionState,
        });
    },
}));

// =============================================================================
// Selector Hooks
// =============================================================================

export const useNodes = () => useBuilderStore(state => state.nodes);
export const useEdges = () => useBuilderStore(state => state.edges);
export const useSelectedNodeId = () => useBuilderStore(state => state.selectedNodeId);
export const useConfig = () => useBuilderStore(state => state.config);
export const useExecutionState = () => useBuilderStore(state => state.executionState);

// =============================================================================
// Batching Selectors
// =============================================================================

/**
 * Get the set of node IDs that are part of a vertical sequence.
 * A node is "in sequence" if it has at least one vertical edge connection.
 * Only instruction nodes (not wallet/execute) can show batch handles.
 */
export function getNodesInSequence(nodes: BuilderNode[], edges: BuilderEdge[]): Set<string> {
    const inSequence = new Set<string>();
    
    // Find all vertical edges
    const verticalEdges = edges.filter(isVerticalEdge);
    
    for (const edge of verticalEdges) {
        // Check if source or target is an instruction node (not wallet or execute)
        const sourceNode = nodes.find(n => n.id === edge.source);
        const targetNode = nodes.find(n => n.id === edge.target);
        
        // Only mark instruction nodes as "in sequence"
        if (sourceNode && sourceNode.type !== 'wallet' && sourceNode.type !== 'execute') {
            inSequence.add(edge.source);
        }
        if (targetNode && targetNode.type !== 'wallet' && targetNode.type !== 'execute') {
            inSequence.add(edge.target);
        }
    }
    
    return inSequence;
}

/**
 * Hook to get nodes in sequence.
 */
export function useNodesInSequence(): Set<string> {
    const nodes = useBuilderStore(state => state.nodes);
    const edges = useBuilderStore(state => state.edges);
    return getNodesInSequence(nodes, edges);
}

/**
 * Check if ANY instruction nodes are connected in the graph.
 * Used to determine if batch handles should be shown on ALL instruction nodes.
 * Once a user has built any flow, all instruction nodes should show batch handles.
 */
export function hasAnySequence(nodes: BuilderNode[], edges: BuilderEdge[]): boolean {
    const nodesInSequence = getNodesInSequence(nodes, edges);
    return nodesInSequence.size > 0;
}

/**
 * Hook to check if any sequence exists.
 * When true, ALL instruction nodes should show batch handles.
 */
export function useHasAnySequence(): boolean {
    const nodes = useBuilderStore(state => state.nodes);
    const edges = useBuilderStore(state => state.edges);
    return hasAnySequence(nodes, edges);
}

/**
 * Compute batch groups from horizontal edges.
 * Nodes connected horizontally are batched into the same transaction.
 */
export function getBatchGroups(nodes: BuilderNode[], edges: BuilderEdge[]): BatchGroup[] {
    const horizontalEdges = edges.filter(isHorizontalEdge);
    
    if (horizontalEdges.length === 0) {
        return [];
    }
    
    // Use Union-Find to group connected nodes
    const parent = new Map<string, string>();
    
    function find(id: string): string {
        if (!parent.has(id)) {
            parent.set(id, id);
        }
        if (parent.get(id) !== id) {
            parent.set(id, find(parent.get(id)!));
        }
        return parent.get(id)!;
    }
    
    function union(a: string, b: string) {
        const rootA = find(a);
        const rootB = find(b);
        if (rootA !== rootB) {
            parent.set(rootB, rootA);
        }
    }
    
    // Group nodes by horizontal connections
    for (const edge of horizontalEdges) {
        union(edge.source, edge.target);
    }
    
    // Collect groups
    const groups = new Map<string, string[]>();
    for (const edge of horizontalEdges) {
        const nodeIds = [edge.source, edge.target];
        for (const nodeId of nodeIds) {
            const root = find(nodeId);
            if (!groups.has(root)) {
                groups.set(root, []);
            }
            const group = groups.get(root)!;
            if (!group.includes(nodeId)) {
                group.push(nodeId);
            }
        }
    }
    
    // Find anchor node for each group (the one connected to vertical flow)
    const verticalEdges = edges.filter(isVerticalEdge);
    const nodesWithVerticalConnection = new Set<string>();
    for (const edge of verticalEdges) {
        nodesWithVerticalConnection.add(edge.source);
        nodesWithVerticalConnection.add(edge.target);
    }
    
    // Convert to BatchGroup array
    const batchGroups: BatchGroup[] = [];
    let groupIndex = 0;
    
    for (const [_, nodeIds] of groups) {
        // Find the anchor (node with vertical connection)
        const anchorNodeId = nodeIds.find(id => nodesWithVerticalConnection.has(id)) ?? nodeIds[0];
        
        batchGroups.push({
            id: `batch-${groupIndex++}`,
            nodeIds,
            anchorNodeId,
        });
    }
    
    return batchGroups;
}

/**
 * Hook to get batch groups.
 */
export function useBatchGroups(): BatchGroup[] {
    const nodes = useBuilderStore(state => state.nodes);
    const edges = useBuilderStore(state => state.edges);
    return getBatchGroups(nodes, edges);
}
