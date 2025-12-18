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
} from './types';
import { getNodeDefinition } from './node-definitions';

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
// Main Compiler
// =============================================================================

/**
 * Compile a builder graph into Solana instructions.
 */
export async function compileGraph(
    nodes: BuilderNode[],
    edges: BuilderEdge[],
    ctx: CompileContext
): Promise<GraphCompileResult> {
    console.log('[Compiler] compileGraph called with', nodes.length, 'nodes');

    // Skip if no nodes
    if (nodes.length === 0) {
        console.log('[Compiler] No nodes to compile');
        return {
            instructions: [],
        };
    }

    // Sort nodes topologically
    const sortedNodes = topoSort(nodes, edges);
    console.log('[Compiler] Sorted nodes:', sortedNodes.map(n => ({ id: n.id, type: n.type })));

    // Track outputs from each node
    const nodeOutputs = new Map<string, Record<string, unknown>>();

    // Collect all instructions
    const allInstructions: Instruction[] = [];
    const allALTs: Address[] = [];
    let totalComputeUnits = 0;

    // Compile each node in order
    for (const node of sortedNodes) {
        try {
            console.log('[Compiler] Compiling node:', node.id, 'type:', node.type, 'data:', JSON.stringify(node.data));
            
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
        } catch (error) {
            console.error(`[Compiler] Error compiling node ${node.id}:`, error);
            throw new Error(
                `Failed to compile node "${node.type}": ${error instanceof Error ? error.message : 'Unknown error'}`
            );
        }
    }

    console.log('[Compiler] Total instructions:', allInstructions.length);
    return {
        instructions: allInstructions,
        computeUnits: totalComputeUnits > 0 ? totalComputeUnits : undefined,
        addressLookupTables: allALTs.length > 0 ? allALTs : undefined,
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

    // Check for empty graph
    if (nodes.length === 0) {
        errors.push('Graph is empty - add at least one node');
        return errors;
    }

    // Check each node has required data
    for (const node of nodes) {
        const def = getNodeDefinition(node.type);

        // Check required inputs have sources
        for (const [inputName, inputDef] of Object.entries(def.inputs)) {
            const hasEdge = edges.some(
                e => e.target === node.id && e.targetHandle === inputName
            );
            const hasDefault = inputDef.defaultFromWallet;

            if (!hasEdge && !hasDefault) {
                errors.push(
                    `Node "${node.id}" (${def.label}) is missing required input: ${inputDef.label}`
                );
            }
        }
    }

    // Check for cycles (topoSort will handle, but we can warn)
    const sortedLength = topoSort(nodes, edges).length;
    if (sortedLength !== nodes.length) {
        errors.push('Graph contains cycles - remove circular dependencies');
    }

    return errors;
}
