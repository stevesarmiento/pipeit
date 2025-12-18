/**
 * Types for the visual transaction builder.
 *
 * @packageDocumentation
 */

import type { Node, Edge } from '@xyflow/react';
import type { Instruction, TransactionSigner, Rpc, RpcSubscriptions } from '@solana/kit';

/**
 * Priority fee level for transaction configuration.
 * Matches the levels from @pipeit/core.
 */
export type PriorityFeeLevel = 'low' | 'medium' | 'high' | 'veryHigh' | 'unsafeMax';

/**
 * Address type alias for Solana addresses.
 */
export type Address = string;

// =============================================================================
// Node Types
// =============================================================================

/**
 * Available node types in the builder.
 */
export type NodeType =
    | 'wallet'
    | 'transfer-sol'
    | 'transfer-token'
    | 'create-ata'
    | 'memo'
    | 'execute';

/**
 * Node categories for the palette.
 */
export type NodeCategory = 'source' | 'transfer' | 'token' | 'utility' | 'execution';

/**
 * Execution strategy presets matching @pipeit/core.
 */
export type ExecutionStrategy = 'standard' | 'economical' | 'fast' | 'ultra';

/**
 * Jito block engine regions.
 */
export type JitoRegion = 'mainnet' | 'ny' | 'amsterdam' | 'frankfurt' | 'tokyo' | 'singapore' | 'slc';

/**
 * Base type for all node data with index signature for React Flow compatibility.
 */
export interface BaseNodeData {
    [key: string]: unknown;
}

/**
 * Data structure for wallet node.
 */
export interface WalletNodeData extends BaseNodeData {
    label: string;
}

/**
 * Data structure for transfer SOL node.
 */
export interface TransferSolNodeData extends BaseNodeData {
    amount: string;
    destination: string;
}

/**
 * Data structure for transfer token node.
 */
export interface TransferTokenNodeData extends BaseNodeData {
    mint: string;
    amount: string;
    destination: string;
    decimals: number;
}

/**
 * Data structure for create ATA node.
 */
export interface CreateAtaNodeData extends BaseNodeData {
    mint: string;
    owner: string;
}

/**
 * Data structure for memo node.
 */
export interface MemoNodeData extends BaseNodeData {
    message: string;
}

/**
 * Data structure for execute node.
 * Configures how the transaction should be submitted.
 */
export interface ExecuteNodeData extends BaseNodeData {
    /** Execution strategy preset */
    strategy: ExecutionStrategy;
    /** Jito tip amount in lamports (as string for UI input) */
    jitoTipLamports: string;
    /** Jito block engine region */
    jitoRegion: JitoRegion;
    /** Whether TPU direct submission is enabled (for ultra strategy) */
    tpuEnabled: boolean;
}

/**
 * Union of all node data types.
 */
export type BuilderNodeData =
    | WalletNodeData
    | TransferSolNodeData
    | TransferTokenNodeData
    | CreateAtaNodeData
    | MemoNodeData
    | ExecuteNodeData;

/**
 * A builder node extending React Flow's Node type.
 */
export type BuilderNode = Node<BuilderNodeData, NodeType>;

/**
 * A builder edge extending React Flow's Edge type.
 */
export type BuilderEdge = Edge;

// =============================================================================
// Handle Types
// =============================================================================

/**
 * Handle value types for data flow.
 */
export type HandleValueType = 'address' | 'amount' | 'any';

/**
 * Handle definition for node inputs/outputs.
 */
export interface HandleDef {
    type: HandleValueType;
    label: string;
    defaultFromWallet?: boolean;
}

// =============================================================================
// Graph Configuration
// =============================================================================

/**
 * Builder graph configuration.
 */
export interface BuilderConfig {
    priorityFee: PriorityFeeLevel;
    computeUnits: 'auto' | number;
}

/**
 * Complete builder graph state.
 */
export interface BuilderGraph {
    nodes: BuilderNode[];
    edges: BuilderEdge[];
    config: BuilderConfig;
}

// =============================================================================
// Compilation Types
// =============================================================================

/**
 * Context passed to node compile functions.
 */
export interface CompileContext {
    signer: TransactionSigner;
    rpc: Rpc<any>;
    rpcSubscriptions: RpcSubscriptions<any>;
    walletAddress: Address;
}

/**
 * Result from compiling a single node.
 */
export interface NodeCompileResult {
    instructions: Instruction[];
    outputs: Record<string, unknown>;
    computeUnits?: number;
    addressLookupTables?: Address[];
    /** SOL amount transferred by this node (in lamports) */
    solTransferLamports?: bigint;
}

/**
 * Result from compiling the entire graph.
 */
export interface GraphCompileResult {
    instructions: Instruction[];
    computeUnits?: number;
    addressLookupTables?: Address[];
    /** Total SOL being transferred across all instructions (in lamports) */
    totalSolTransferLamports?: bigint;
}

// =============================================================================
// Node Definition Types
// =============================================================================

/**
 * Definition for a node type, including metadata and compile function.
 */
export interface NodeDefinition<TData extends BuilderNodeData = BuilderNodeData> {
    type: NodeType;
    label: string;
    category: NodeCategory;
    description: string;
    icon: string;
    defaultData: TData;
    inputs: Record<string, HandleDef>;
    outputs: Record<string, HandleDef>;
    compile: (
        data: TData,
        inputs: Record<string, unknown>,
        ctx: CompileContext
    ) => Promise<NodeCompileResult>;
}

// =============================================================================
// Feedback Types
// =============================================================================

/**
 * Transaction size information.
 */
export interface SizeInfo {
    size: number;
    limit: number;
    remaining: number;
    percentUsed: number;
    canFitMore: boolean;
}

/**
 * Simulation result for feedback.
 */
export interface SimulationFeedback {
    success: boolean;
    computeUnits?: number;
    error?: string;
    logs?: string[];
}

/**
 * Compute unit estimation info.
 */
export interface ComputeUnitInfo {
    /** Estimated compute units from node definitions */
    estimated: number;
    /** Max compute units (default limit) */
    limit: number;
    /** Percentage of limit used */
    percentUsed: number;
}

/**
 * Complete feedback state.
 */
export interface BuilderFeedback {
    isCompiling: boolean;
    isSimulating: boolean;
    sizeInfo: SizeInfo | null;
    computeUnitInfo: ComputeUnitInfo | null;
    simulation: SimulationFeedback | null;
    error: string | null;
}

// =============================================================================
// Execution Types
// =============================================================================

/**
 * Extracted execution configuration from Execute node.
 * Used by the toolbar to configure TransactionBuilder.
 */
export interface ExtractedExecutionConfig {
    strategy: ExecutionStrategy;
    jito?: {
        enabled: boolean;
        tipLamports: bigint;
        region: JitoRegion;
    };
    tpu?: {
        enabled: boolean;
    };
}

/**
 * Execution state for the builder.
 */
export type ExecutionState =
    | { status: 'idle' }
    | { status: 'compiling' }
    | { status: 'signing' }
    | { status: 'sending' }
    | { status: 'confirming' }
    | { status: 'success'; signature: string }
    | { status: 'error'; error: Error };

// =============================================================================
// Batching Types
// =============================================================================

/**
 * Edge direction for determining sequential vs batched execution.
 * - vertical: Sequential execution (separate transactions)
 * - horizontal: Batched execution (same transaction)
 */
export type EdgeDirection = 'vertical' | 'horizontal';

/**
 * Handle types for different connection directions.
 */
export const HANDLE_NAMES = {
    // Vertical flow handles (sequential)
    FLOW_IN: 'flow-in',
    FLOW_OUT: 'flow-out',
    // Horizontal batch handles
    BATCH_IN: 'batch-in',
    BATCH_OUT: 'batch-out',
} as const;

/**
 * A group of nodes that should be batched into a single transaction.
 * All nodes in a batch group are connected horizontally.
 */
export interface BatchGroup {
    /** Unique identifier for the batch group */
    id: string;
    /** Node IDs in this batch (all executed in same transaction) */
    nodeIds: string[];
    /** The "anchor" node - the one connected to the main vertical flow */
    anchorNodeId: string;
}

/**
 * Classify an edge as vertical or horizontal based on handle names.
 */
export function getEdgeDirection(edge: BuilderEdge): EdgeDirection {
    const sourceHandle = edge.sourceHandle ?? '';
    const targetHandle = edge.targetHandle ?? '';
    
    // Horizontal connections use batch handles
    if (
        sourceHandle.includes('batch') || 
        targetHandle.includes('batch') ||
        sourceHandle === HANDLE_NAMES.BATCH_OUT ||
        targetHandle === HANDLE_NAMES.BATCH_IN
    ) {
        return 'horizontal';
    }
    
    // Default to vertical (flow handles)
    return 'vertical';
}

/**
 * Check if an edge is a vertical (sequential) connection.
 */
export function isVerticalEdge(edge: BuilderEdge): boolean {
    return getEdgeDirection(edge) === 'vertical';
}

/**
 * Check if an edge is a horizontal (batch) connection.
 */
export function isHorizontalEdge(edge: BuilderEdge): boolean {
    return getEdgeDirection(edge) === 'horizontal';
}
