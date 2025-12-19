'use client';

import { useCallback, useRef, useMemo } from 'react';
import {
    ReactFlow,
    ReactFlowProvider,
    Background,
    Controls,
    Panel,
    addEdge,
    useReactFlow,
    useViewport,
    type Connection,
    type ReactFlowInstance,
    BackgroundVariant,
    ConnectionLineType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { useBuilderStore, useBatchGroups } from '@/lib/builder/store';
import { nodeTypes } from './nodes';
import type { NodeType, BuilderNode } from '@/lib/builder/types';
import { Plus } from 'lucide-react';

// =============================================================================
// Batch Group Overlay Component
// =============================================================================

interface BatchGroupOverlayProps {
    nodes: BuilderNode[];
}

/**
 * Renders dotted-border overlays around batch groups.
 * Must be rendered inside ReactFlow context to access viewport.
 */
function BatchGroupOverlay({ nodes }: BatchGroupOverlayProps) {
    const batchGroups = useBatchGroups();
    const viewport = useViewport();
    
    if (batchGroups.length === 0) {
        return null;
    }
    
    return (
        <Panel position="top-left" className="!m-0 !p-0 pointer-events-none">
            <div className="absolute inset-0" style={{ width: '100vw', height: '100vh' }}>
                {batchGroups.map(group => {
                    // Find all nodes in this batch group
                    const groupNodes = nodes.filter(n => group.nodeIds.includes(n.id));
                    if (groupNodes.length < 2) return null;
                    
                    // Calculate bounding box with padding
                    const padding = 12;
                    const nodeWidth = 140; // Approximate node width
                    const nodeHeight = 70; // Approximate node height
                    
                    let minX = Infinity, minY = Infinity;
                    let maxX = -Infinity, maxY = -Infinity;
                    
                    for (const node of groupNodes) {
                        minX = Math.min(minX, node.position.x);
                        minY = Math.min(minY, node.position.y);
                        maxX = Math.max(maxX, node.position.x + nodeWidth);
                        maxY = Math.max(maxY, node.position.y + nodeHeight);
                    }
                    
                    // Transform to screen coordinates
                    const screenX = (minX - padding) * viewport.zoom + viewport.x;
                    const screenY = (minY - padding) * viewport.zoom + viewport.y;
                    const screenWidth = (maxX - minX + padding * 2) * viewport.zoom;
                    const screenHeight = (maxY - minY + padding * 2) * viewport.zoom;
                    
                    return (
                        <div
                            key={group.id}
                            className="absolute pointer-events-none"
                            style={{
                                left: screenX,
                                top: screenY,
                                width: screenWidth,
                                height: screenHeight,
                                border: '2px dashed #f59e0b',
                                borderRadius: Math.max(8, 12 * viewport.zoom),
                                backgroundColor: 'rgba(245, 158, 11, 0.05)',
                            }}
                        >
                            {/* Batch label */}
                            <div
                                className="absolute px-2 py-0.5 font-medium text-amber-600 bg-amber-50 rounded-full border border-amber-200 whitespace-nowrap"
                                style={{
                                    top: Math.max(-12, -10 * viewport.zoom),
                                    left: Math.max(8, 12 * viewport.zoom),
                                    fontSize: Math.max(9, 10 * viewport.zoom),
                                }}
                            >
                                Batch
                            </div>
                        </div>
                    );
                })}
            </div>
        </Panel>
    );
}

// =============================================================================
// Builder Canvas Component
// =============================================================================

export function BuilderCanvas() {
    const reactFlowWrapper = useRef<HTMLDivElement>(null);
    const reactFlowInstance = useRef<ReactFlowInstance<any, any> | null>(null);

    // Store state and actions
    const nodes = useBuilderStore(state => state.nodes);
    const edges = useBuilderStore(state => state.edges);
    const addNode = useBuilderStore(state => state.addNode);
    const setEdges = useBuilderStore(state => state.setEdges);
    const onNodesChange = useBuilderStore(state => state.onNodesChange);
    const onEdgesChange = useBuilderStore(state => state.onEdgesChange);
    const selectNode = useBuilderStore(state => state.selectNode);

    // Handle new connections - style based on handle type
    const onConnect = useCallback(
        (connection: Connection) => {
            // Determine if this is a horizontal (batch) connection
            const isBatchConnection = 
                connection.sourceHandle?.includes('batch') ||
                connection.targetHandle?.includes('batch');
            
            // Add appropriate styling based on connection type
            const styledConnection = {
                ...connection,
                ...(isBatchConnection ? {
                    // Horizontal batch edge styling
                    style: { stroke: '#f59e0b', strokeWidth: 2, strokeDasharray: '5,5' },
                    animated: true,
                    type: 'smoothstep',
                } : {
                    // Vertical sequential edge styling
                    style: { stroke: '#94a3b8', strokeWidth: 2 },
                    animated: true,
                    type: 'smoothstep',
                }),
            };
            
            setEdges(addEdge(styledConnection, edges));
        },
        [edges, setEdges]
    );

    // Handle node selection
    const onNodeClick = useCallback(
        (_: React.MouseEvent, node: any) => {
            selectNode(node.id);
        },
        [selectNode]
    );

    // Handle canvas click (deselect)
    const onPaneClick = useCallback(() => {
        selectNode(null);
    }, [selectNode]);

    // Handle drag over (for palette drag-drop)
    const onDragOver = useCallback((event: React.DragEvent) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
    }, []);

    // Handle drop from palette
    const onDrop = useCallback(
        (event: React.DragEvent) => {
            event.preventDefault();

            const type = event.dataTransfer.getData('application/reactflow') as NodeType;
            if (!type) return;

            // Get position relative to the canvas
            const reactFlowBounds = reactFlowWrapper.current?.getBoundingClientRect();
            if (!reactFlowBounds || !reactFlowInstance.current) return;

            const position = reactFlowInstance.current.screenToFlowPosition({
                x: event.clientX - reactFlowBounds.left,
                y: event.clientY - reactFlowBounds.top,
            });

            addNode(type, position);
        },
        [addNode]
    );

    // Store React Flow instance
    const onInit = useCallback((instance: ReactFlowInstance<any, any>) => {
        reactFlowInstance.current = instance;
    }, []);

    // Check if only default nodes exist (wallet + execute, no instruction nodes)
    const onlyDefaultNodes = useMemo(() => {
        const instructionNodes = nodes.filter(
            n => n.type !== 'wallet' && n.type !== 'execute'
        );
        return instructionNodes.length === 0;
    }, [nodes]);

    return (
        <div ref={reactFlowWrapper} className="flex-1 h-full relative">
            <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onNodeClick={onNodeClick}
                onPaneClick={onPaneClick}
                onDragOver={onDragOver}
                onDrop={onDrop}
                onInit={onInit}
                nodeTypes={nodeTypes}
                fitView
                snapToGrid
                snapGrid={[15, 15]}
                defaultEdgeOptions={{
                    type: 'smoothstep',
                    animated: true,
                }}
                connectionLineStyle={{ stroke: '#94a3b8', strokeWidth: 2 }}
                connectionLineType={ConnectionLineType.SmoothStep}
                proOptions={{ hideAttribution: true }}
            >
                <Background
                    variant={BackgroundVariant.Dots}
                    gap={20}
                    size={1}
                    color="#e2e8f0"
                />
                <Controls
                    showZoom
                    showFitView
                    showInteractive={false}
                    position="bottom-left"
                />
                
                {/* Batch group overlays */}
                <BatchGroupOverlay nodes={nodes} />
            </ReactFlow>

            {/* Empty state hint - shown when only default nodes exist */}
            {onlyDefaultNodes && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="text-center text-gray-400 bg-white/80 backdrop-blur-sm rounded-lg px-6 py-4 border border-dashed border-gray-300">
                        <Plus className="w-8 h-8 mx-auto mb-2 text-gray-300" />
                        <p className="text-sm font-medium text-gray-500">Drag instruction nodes here</p>
                        <p className="text-xs text-gray-400 mt-1">e.g. Transfer SOL, Memo, Token Transfer</p>
                    </div>
                </div>
            )}
        </div>
    );
}

