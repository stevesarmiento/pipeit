/**
 * Types for the visual transaction builder.
 *
 * @packageDocumentation
 */

import type { Node, Edge } from '@xyflow/react';
import type { Instruction, TransactionSigner, Rpc, RpcSubscriptions } from '@solana/kit';
import type { PriorityFeeLevel } from '@pipeit/core';

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
    | 'memo';

/**
 * Node categories for the palette.
 */
export type NodeCategory = 'source' | 'transfer' | 'token' | 'utility';

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
 * Union of all node data types.
 */
export type BuilderNodeData =
    | WalletNodeData
    | TransferSolNodeData
    | TransferTokenNodeData
    | CreateAtaNodeData
    | MemoNodeData;

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
}

/**
 * Result from compiling the entire graph.
 */
export interface GraphCompileResult {
    instructions: Instruction[];
    computeUnits?: number;
    addressLookupTables?: Address[];
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
 * Complete feedback state.
 */
export interface BuilderFeedback {
    isCompiling: boolean;
    isSimulating: boolean;
    sizeInfo: SizeInfo | null;
    simulation: SimulationFeedback | null;
    error: string | null;
}

// =============================================================================
// Execution Types
// =============================================================================

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
