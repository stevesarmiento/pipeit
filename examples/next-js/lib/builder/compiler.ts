/**
 * Graph compiler - converts a builder graph to Solana instructions.
 *
 * The compiler:
 * 1. Topologically sorts nodes by edges (respecting dependencies)
 * 2. Resolves input values for each node
 * 3. Calls each node's compile function
 * 4. Collects all instructions into a single array
 *
 * @packageDocumentation
 */

import type { Instruction } from '@solana/kit';
import type {
    BuilderNode,
    BuilderEdge,
    CompileContext,
    GraphCompileResult,
    NodeCompileResult,
    Address,
    NodeType,
    ExecuteNodeData,
    ExtractedExecutionConfig,
    BatchGroup,
} from './types';
import { isVerticalEdge, isHorizontalEdge, HANDLE_NAMES } from './types';
import { getNodeDefinition } from './node-definitions';
import { getBatchGroups } from './store';

// =============================================================================
// Execution Config Extraction
// =============================================================================

/**
 * Extract execution configuration from an Execute node in the graph.
 * Returns default config if no Execute node is found.
 */
export function extractExecutionConfig(nodes: BuilderNode[]): ExtractedExecutionConfig {
    // Find the execute node
    const executeNode = nodes.find(node => node.type === 'execute');
    
    if (!executeNode) {
        // Default to standard strategy
        return {
            strategy: 'standard',
        };
    }

    const data = executeNode.data as ExecuteNodeData;
    const strategy = data.strategy || 'standard';
    
    // Parse Jito tip amount
    const tipLamports = data.jitoTipLamports 
        ? BigInt(data.jitoTipLamports) 
        : BigInt(10_000);

    // Build config based on strategy
    const config: ExtractedExecutionConfig = {
        strategy,
    };

    // Jito is enabled for economical and fast strategies (NOT ultra - that's TPU only)
    if (strategy === 'economical' || strategy === 'fast') {
        config.jito = {
            enabled: true,
            tipLamports,
            region: data.jitoRegion || 'mainnet',
        };
    }

    // TPU is enabled for ultra strategy (standalone, no Jito)
    if (strategy === 'ultra') {
        config.tpu = {
            enabled: true,
        };
    }

    console.log('[Compiler] Extracted execution config:', config);
    return config;
}

// =============================================================================
// Topological Sort
// =============================================================================

/**
 * Topologically sort nodes based on edge dependencies.
 * Nodes with no incoming edges come first.
 */
function topoSort(nodes: BuilderNode[], edges: BuilderEdge[]): BuilderNode[] {
    // Build adjacency list and in-degree count
    const inDegree = new Map<string, number>();
    const adjacency = new Map<string, string[]>();

    for (const node of nodes) {
        inDegree.set(node.id, 0);
        adjacency.set(node.id, []);
    }

    for (const edge of edges) {
        const current = inDegree.get(edge.target) ?? 0;
        inDegree.set(edge.target, current + 1);
        adjacency.get(edge.source)?.push(edge.target);
    }

    // Kahn's algorithm
    const queue: string[] = [];
    for (const [id, degree] of inDegree) {
        if (degree === 0) {
            queue.push(id);
        }
    }

    const sorted: BuilderNode[] = [];
    while (queue.length > 0) {
        const nodeId = queue.shift()!;
        const node = nodes.find(n => n.id === nodeId);
        if (node) {
            sorted.push(node);
        }

        for (const neighbor of adjacency.get(nodeId) ?? []) {
            const degree = inDegree.get(neighbor) ?? 0;
            inDegree.set(neighbor, degree - 1);
            if (degree - 1 === 0) {
                queue.push(neighbor);
            }
        }
    }

    // If sorted length !== nodes length, there's a cycle
    if (sorted.length !== nodes.length) {
        console.warn('[Compiler] Graph contains cycles, some nodes may be skipped');
    }

    return sorted;
}

// =============================================================================
// Input Resolution
// =============================================================================

/**
 * Resolve input values for a node from edges and previous node outputs.
 */
function resolveInputs(
    node: BuilderNode,
    edges: BuilderEdge[],
    nodeOutputs: Map<string, Record<string, unknown>>,
    ctx: CompileContext
): Record<string, unknown> {
    const def = getNodeDefinition(node.type);
    const inputs: Record<string, unknown> = {};

    for (const [inputName, inputDef] of Object.entries(def.inputs)) {
        // Check if there's an edge providing this input
        const incomingEdge = edges.find(
            e => e.target === node.id && e.targetHandle === inputName
        );

        if (incomingEdge) {
            // Get value from source node's outputs
            const sourceOutputs = nodeOutputs.get(incomingEdge.source);
            const sourceHandle = incomingEdge.sourceHandle ?? 'default';
            inputs[inputName] = sourceOutputs?.[sourceHandle];
        } else if (inputDef.defaultFromWallet) {
            // Use wallet address as default
            inputs[inputName] = ctx.walletAddress;
        }
    }

    return inputs;
}

// =============================================================================
// Batch-Aware Compilation
// =============================================================================

/**
 * Represents a compilation unit - either a single node or a batch of nodes.
 * All nodes in a batch are compiled together (same transaction).
 */
interface CompilationUnit {
    type: 'single' | 'batch';
    nodeIds: string[];
}

/**
 * Build compilation units from nodes and edges.
 * Groups horizontally-connected nodes into batches.
 */
function buildCompilationUnits(nodes: BuilderNode[], edges: BuilderEdge[]): CompilationUnit[] {
    const batchGroups = getBatchGroups(nodes, edges);
    const nodesInBatch = new Set<string>();
    
    // Mark all nodes that are part of a batch
    for (const group of batchGroups) {
        for (const nodeId of group.nodeIds) {
            nodesInBatch.add(nodeId);
        }
    }
    
    // Get instruction nodes (not wallet or execute)
    const instructionNodes = nodes.filter(n => n.type !== 'execute' && n.type !== 'wallet');
    const instructionNodeIds = new Set(instructionNodes.map(n => n.id));
    
    // Get vertical edges ONLY between instruction nodes
    // This is critical: edges from wallet→instruction or instruction→execute
    // should NOT be included because wallet/execute are not in instructionNodes,
    // which would cause topoSort to never process them and never decrement inDegree
    const verticalEdges = edges.filter(isVerticalEdge);
    const relevantEdges = verticalEdges.filter(
        e => instructionNodeIds.has(e.source) && instructionNodeIds.has(e.target)
    );
    
    // Build units: batches and single nodes
    const units: CompilationUnit[] = [];
    const processedBatches = new Set<string>();
    
    // Topologically sort instruction nodes using only inter-instruction edges
    // If there are no relevant edges (single node connected to wallet/execute),
    // topoSort will still return all nodes with inDegree=0 (which is all of them)
    const sortedNodes = topoSort(instructionNodes, relevantEdges);
    
    console.log('[Compiler] buildCompilationUnits:', {
        instructionNodes: instructionNodes.map(n => n.id),
        relevantEdges: relevantEdges.length,
        sortedNodes: sortedNodes.map(n => n.id),
    });
    
    for (const node of sortedNodes) {
        if (nodesInBatch.has(node.id)) {
            // Find which batch this node belongs to
            const batch = batchGroups.find(g => g.nodeIds.includes(node.id));
            if (batch && !processedBatches.has(batch.id)) {
                processedBatches.add(batch.id);
                units.push({
                    type: 'batch',
                    nodeIds: batch.nodeIds,
                });
            }
        } else {
            units.push({
                type: 'single',
                nodeIds: [node.id],
            });
        }
    }
    
    return units;
}

// =============================================================================
// Main Compiler
// =============================================================================

/**
 * Compile a builder graph into Solana instructions.
 * Handles both sequential (vertical) and batched (horizontal) node arrangements.
 */
export async function compileGraph(
    nodes: BuilderNode[],
    edges: BuilderEdge[],
    ctx: CompileContext
): Promise<GraphCompileResult> {
    console.log('[Compiler] compileGraph called with', nodes.length, 'nodes');

    // Filter out execute nodes - they're config nodes, not instruction nodes
    const instructionNodes = nodes.filter(node => node.type !== 'execute');
    
    // Skip if no instruction nodes (wallet-only is okay)
    const actionNodes = instructionNodes.filter(n => n.type !== 'wallet');
    if (actionNodes.length === 0) {
        console.log('[Compiler] No action nodes to compile');
        return {
            instructions: [],
        };
    }

    // Build compilation units (respecting batch groups)
    const units = buildCompilationUnits(nodes, edges);
    console.log('[Compiler] Compilation units:', units.map(u => ({
        type: u.type,
        nodes: u.nodeIds,
    })));

    // Track outputs from each node
    const nodeOutputs = new Map<string, Record<string, unknown>>();
    
    // First, compile the wallet node to get its output
    const walletNode = nodes.find(n => n.type === 'wallet');
    if (walletNode) {
        const walletDef = getNodeDefinition('wallet');
        const walletResult = await walletDef.compile(walletNode.data, {}, ctx);
        nodeOutputs.set(walletNode.id, walletResult.outputs);
    }

    // Collect all instructions
    const allInstructions: Instruction[] = [];
    const allALTs: Address[] = [];
    let totalComputeUnits = 0;
    let totalSolTransferLamports = BigInt(0);

    // Compile each unit
    for (const unit of units) {
        const unitNodes = unit.nodeIds
            .map(id => nodes.find(n => n.id === id))
            .filter((n): n is BuilderNode => n !== undefined);
        
        console.log(`[Compiler] Compiling ${unit.type} unit with ${unitNodes.length} nodes`);
        
        // Compile all nodes in this unit
        for (const node of unitNodes) {
            try {
                console.log('[Compiler] Compiling node:', node.id, 'type:', node.type);
                
                if (!node.type) {
                    console.error('[Compiler] Node has no type:', node);
                    continue;
                }
                
                const def = getNodeDefinition(node.type as NodeType);
                const inputs = resolveInputs(node, edges, nodeOutputs, ctx);
                console.log('[Compiler] Resolved inputs:', inputs);

                const result: NodeCompileResult = await def.compile(
                    node.data,
                    inputs,
                    ctx
                );
                console.log('[Compiler] Node result:', result.instructions.length, 'instructions');

                // Store outputs for downstream nodes
                nodeOutputs.set(node.id, result.outputs);

                // Collect instructions
                allInstructions.push(...result.instructions);

                // Collect ALTs
                if (result.addressLookupTables) {
                    allALTs.push(...result.addressLookupTables);
                }

                // Track compute units
                if (result.computeUnits) {
                    totalComputeUnits += result.computeUnits;
                }

                // Track SOL transfers
                if (result.solTransferLamports) {
                    totalSolTransferLamports += result.solTransferLamports;
                }
            } catch (error) {
                console.error(`[Compiler] Error compiling node ${node.id}:`, error);
                throw new Error(
                    `Failed to compile node "${node.type}": ${error instanceof Error ? error.message : 'Unknown error'}`
                );
            }
        }
        
        // Log batch boundaries for debugging
        if (unit.type === 'batch') {
            console.log(`[Compiler] Batch compiled: ${unit.nodeIds.length} nodes together`);
        }
    }

    console.log('[Compiler] Total instructions:', allInstructions.length);
    console.log('[Compiler] Total SOL transfer:', Number(totalSolTransferLamports) / 1_000_000_000, 'SOL');
    return {
        instructions: allInstructions,
        computeUnits: totalComputeUnits > 0 ? totalComputeUnits : undefined,
        addressLookupTables: allALTs.length > 0 ? allALTs : undefined,
        totalSolTransferLamports: totalSolTransferLamports > 0 ? totalSolTransferLamports : undefined,
    };
}

// =============================================================================
// Validation
// =============================================================================

/**
 * Validate that a graph can be compiled.
 * Returns an array of validation errors (empty if valid).
 */
export function validateGraph(
    nodes: BuilderNode[],
    edges: BuilderEdge[]
): string[] {
    const errors: string[] = [];
    
    // Filter out execute nodes for instruction validation
    const instructionNodes = nodes.filter(node => node.type !== 'execute' && node.type !== 'wallet');

    // Check for empty graph (execute-only graph is not useful)
    if (instructionNodes.length === 0) {
        errors.push('Graph is empty - add at least one instruction node');
        return errors;
    }

    // Check each instruction node has required data
    for (const node of instructionNodes) {
        const def = getNodeDefinition(node.type);

        // Check required inputs have sources (skip flow/batch handles)
        for (const [inputName, inputDef] of Object.entries(def.inputs)) {
            // Skip flow/batch handles - they're for visual connectivity, not data
            if (
                inputName === HANDLE_NAMES.FLOW_IN ||
                inputName === HANDLE_NAMES.BATCH_IN ||
                inputName === HANDLE_NAMES.FLOW_OUT ||
                inputName === HANDLE_NAMES.BATCH_OUT
            ) {
                continue;
            }

            const hasEdge = edges.some(
                e => e.target === node.id && e.targetHandle === inputName
            );
            const hasDefault = inputDef.defaultFromWallet;

            console.log('[Validate] Checking input:', inputName, 'hasEdge:', hasEdge, 'hasDefault:', hasDefault);

            if (!hasEdge && !hasDefault) {
                errors.push(
                    `Node "${node.id}" (${def.label}) is missing required input: ${inputDef.label}`
                );
            }
        }
    }
    
    console.log('[Validate] Total errors:', errors.length, errors);

    // Check for cycles using only edges between instruction nodes
    const instructionNodeIds = new Set(instructionNodes.map(n => n.id));
    const relevantEdges = edges.filter(
        e => instructionNodeIds.has(e.source) && instructionNodeIds.has(e.target)
    );
    const sortedLength = topoSort(instructionNodes, relevantEdges).length;
    if (sortedLength !== instructionNodes.length) {
        errors.push('Graph contains cycles - remove circular dependencies');
    }

    return errors;
}
