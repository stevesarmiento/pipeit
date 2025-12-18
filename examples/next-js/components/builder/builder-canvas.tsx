'use client';

import { useCallback, useRef } from 'react';
import {
    ReactFlow,
    Background,
    Controls,
    MiniMap,
    addEdge,
    type Connection,
    type ReactFlowInstance,
    BackgroundVariant,
    ConnectionLineType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { useBuilderStore } from '@/lib/builder/store';
import { nodeTypes } from './nodes';
import type { NodeType } from '@/lib/builder/types';

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

    // Handle new connections
    const onConnect = useCallback(
        (connection: Connection) => {
            setEdges(addEdge(connection, edges));
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

    return (
        <div ref={reactFlowWrapper} className="flex-1 h-full">
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
                <MiniMap
                    position="bottom-right"
                    nodeColor={(node) => {
                        switch (node.type) {
                            case 'wallet':
                                return '#9333ea';
                            case 'transfer-sol':
                            case 'transfer-token':
                                return '#2563eb';
                            case 'create-ata':
                                return '#16a34a';
                            case 'memo':
                                return '#ea580c';
                            default:
                                return '#64748b';
                        }
                    }}
                    maskColor="rgba(0, 0, 0, 0.1)"
                    pannable
                    zoomable
                />
            </ReactFlow>
        </div>
    );
}
