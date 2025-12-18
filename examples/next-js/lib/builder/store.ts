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
} from './types';
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

// =============================================================================
// Store Implementation
// =============================================================================

export const useBuilderStore = create<BuilderStore>((set, get) => ({
    // Initial state
    nodes: [],
    edges: [],
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

        set(state => ({
            nodes: [...state.nodes, newNode],
            selectedNodeId: id,
        }));

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
            nodes: [],
            edges: [],
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
