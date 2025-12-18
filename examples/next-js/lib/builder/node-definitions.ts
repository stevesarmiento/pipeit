/**
 * Node type definitions and registry for the visual transaction builder.
 *
 * Each node type defines:
 * - Metadata (label, icon, category)
 * - Default data
 * - Input/output handles
 * - Compile function to produce Solana instructions
 *
 * @packageDocumentation
 */

import { address, lamports } from '@solana/kit';
import { getTransferSolInstruction } from '@solana-program/system';
import type {
    NodeDefinition,
    NodeType,
    WalletNodeData,
    TransferSolNodeData,
    TransferTokenNodeData,
    CreateAtaNodeData,
    MemoNodeData,
    ExecuteNodeData,
    CompileContext,
    NodeCompileResult,
} from './types';
import { HANDLE_NAMES } from './types';

// =============================================================================
// Wallet Node
// =============================================================================

export const walletNodeDef: NodeDefinition<WalletNodeData> = {
    type: 'wallet',
    label: 'Wallet',
    category: 'source',
    description: 'Connected wallet address',
    icon: 'wallet',
    defaultData: {
        label: 'My Wallet',
    },
    inputs: {},
    outputs: {
        [HANDLE_NAMES.FLOW_OUT]: { type: 'any', label: 'Output' },
    },
    compile: async (_data, _inputs, ctx): Promise<NodeCompileResult> => {
        // Wallet node doesn't produce instructions, just provides address
        return {
            instructions: [],
            outputs: {
                [HANDLE_NAMES.FLOW_OUT]: ctx.walletAddress,
            },
        };
    },
};

// =============================================================================
// Transfer SOL Node
// =============================================================================

export const transferSolNodeDef: NodeDefinition<TransferSolNodeData> = {
    type: 'transfer-sol',
    label: 'Transfer SOL',
    category: 'transfer',
    description: 'Send SOL to another address',
    icon: 'send',
    defaultData: {
        amount: '',
        destination: '',
    },
    inputs: {
        [HANDLE_NAMES.FLOW_IN]: { type: 'any', label: 'Input' },
        [HANDLE_NAMES.BATCH_IN]: { type: 'any', label: 'Batch In' },
    },
    outputs: {
        [HANDLE_NAMES.FLOW_OUT]: { type: 'any', label: 'Output' },
        [HANDLE_NAMES.BATCH_OUT]: { type: 'any', label: 'Batch Out' },
    },
    compile: async (data, _inputs, ctx): Promise<NodeCompileResult> => {
        if (!data.amount || !data.destination) {
            return { instructions: [], outputs: {} };
        }

        // Convert amount to lamports (assuming input is in SOL)
        const amountLamports = BigInt(Math.floor(parseFloat(data.amount) * 1_000_000_000));

        const instruction = getTransferSolInstruction({
            source: ctx.signer,
            destination: address(data.destination),
            amount: lamports(amountLamports),
        });

        return {
            instructions: [instruction],
            outputs: {},
            computeUnits: 300, // SOL transfer is very cheap
            solTransferLamports: amountLamports,
        };
    },
};

// =============================================================================
// Transfer Token Node
// =============================================================================

export const transferTokenNodeDef: NodeDefinition<TransferTokenNodeData> = {
    type: 'transfer-token',
    label: 'Transfer Token',
    category: 'transfer',
    description: 'Send SPL tokens to another address',
    icon: 'coins',
    defaultData: {
        mint: '',
        amount: '',
        destination: '',
        decimals: 9,
    },
    inputs: {
        [HANDLE_NAMES.FLOW_IN]: { type: 'any', label: 'Input' },
        [HANDLE_NAMES.BATCH_IN]: { type: 'any', label: 'Batch In' },
    },
    outputs: {
        [HANDLE_NAMES.FLOW_OUT]: { type: 'any', label: 'Output' },
        [HANDLE_NAMES.BATCH_OUT]: { type: 'any', label: 'Batch Out' },
    },
    compile: async (data, _inputs, ctx): Promise<NodeCompileResult> => {
        if (!data.mint || !data.amount || !data.destination) {
            return { instructions: [], outputs: {} };
        }

        // For now, return empty - full SPL token transfer requires:
        // 1. Getting/creating source ATA
        // 2. Getting/creating destination ATA
        // 3. Transfer instruction
        // This will be enhanced in a future iteration
        console.log('[TransferToken] Would transfer:', {
            mint: data.mint,
            amount: data.amount,
            destination: data.destination,
            from: ctx.walletAddress,
        });

        return {
            instructions: [],
            outputs: {},
            computeUnits: 50_000, // Estimate for token transfer
        };
    },
};

// =============================================================================
// Create ATA Node
// =============================================================================

export const createAtaNodeDef: NodeDefinition<CreateAtaNodeData> = {
    type: 'create-ata',
    label: 'Create ATA',
    category: 'token',
    description: 'Create an Associated Token Account',
    icon: 'plus-circle',
    defaultData: {
        mint: '',
        owner: '',
    },
    inputs: {
        [HANDLE_NAMES.FLOW_IN]: { type: 'any', label: 'Input' },
        [HANDLE_NAMES.BATCH_IN]: { type: 'any', label: 'Batch In' },
    },
    outputs: {
        [HANDLE_NAMES.FLOW_OUT]: { type: 'any', label: 'Output' },
        [HANDLE_NAMES.BATCH_OUT]: { type: 'any', label: 'Batch Out' },
        ata: { type: 'address', label: 'ATA Address' },
    },
    compile: async (data, _inputs, ctx): Promise<NodeCompileResult> => {
        if (!data.mint) {
            return { instructions: [], outputs: {} };
        }

        // For now, return empty - full ATA creation requires:
        // 1. Deriving ATA address
        // 2. Creating ATA instruction
        // This will be enhanced in a future iteration
        const owner = data.owner || String(ctx.walletAddress);
        console.log('[CreateATA] Would create ATA:', {
            mint: data.mint,
            owner,
            payer: ctx.walletAddress,
        });

        return {
            instructions: [],
            outputs: {
                // Would compute the ATA address here
                ata: null,
            },
            computeUnits: 30_000, // Estimate for ATA creation
        };
    },
};

// =============================================================================
// Memo Node
// =============================================================================

const MEMO_PROGRAM_ID = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';

export const memoNodeDef: NodeDefinition<MemoNodeData> = {
    type: 'memo',
    label: 'Memo',
    category: 'utility',
    description: 'Add a memo to the transaction',
    icon: 'message-square',
    defaultData: {
        message: '',
    },
    inputs: {
        [HANDLE_NAMES.FLOW_IN]: { type: 'any', label: 'Input' },
        [HANDLE_NAMES.BATCH_IN]: { type: 'any', label: 'Batch In' },
    },
    outputs: {
        [HANDLE_NAMES.FLOW_OUT]: { type: 'any', label: 'Output' },
        [HANDLE_NAMES.BATCH_OUT]: { type: 'any', label: 'Batch Out' },
    },
    compile: async (data, _inputs, ctx): Promise<NodeCompileResult> => {
        if (!data.message) {
            return { instructions: [], outputs: {} };
        }

        // Create memo instruction
        const instruction = {
            programAddress: address(MEMO_PROGRAM_ID),
            accounts: [
                {
                    address: address(ctx.walletAddress as string),
                    role: 2 as const, // READONLY_SIGNER
                },
            ],
            data: new TextEncoder().encode(data.message),
        } as any; // Type assertion needed due to complex instruction typing

        return {
            instructions: [instruction],
            outputs: {},
            computeUnits: 200, // Memo is very cheap
        };
    },
};

// =============================================================================
// Execute Node
// =============================================================================

/**
 * Strategy descriptions for UI display.
 */
export const STRATEGY_INFO: Record<string, { label: string; description: string; features: string[] }> = {
    standard: {
        label: 'Standard RPC',
        description: 'Default RPC submission. Simple and reliable.',
        features: ['No extra cost', 'Works on all clusters', 'Standard confirmation'],
    },
    economical: {
        label: 'Jito Bundle',
        description: 'MEV-protected bundle submission via Jito.',
        features: ['MEV protection', 'Configurable tip', 'Mainnet only'],
    },
    fast: {
        label: 'Fast (Jito + RPC)',
        description: 'Race Jito bundle against parallel RPC submissions.',
        features: ['Maximum landing probability', 'Jito + RPC race', 'Higher cost'],
    },
    ultra: {
        label: 'Ultra (TPU Direct)',
        description: 'Direct TPU submission via native QUIC. Fastest possible.',
        features: ['Lowest latency', 'Native QUIC protocol', 'Requires @pipeit/fastlane'],
    },
};

export const executeNodeDef: NodeDefinition<ExecuteNodeData> = {
    type: 'execute',
    label: 'Execute',
    category: 'execution',
    description: 'Configure how the transaction is submitted',
    icon: 'rocket',
    defaultData: {
        strategy: 'standard',
        jitoTipLamports: '10000',
        jitoRegion: 'mainnet',
        tpuEnabled: false,
    },
    inputs: {
        [HANDLE_NAMES.FLOW_IN]: { type: 'any', label: 'Input' },
    },
    outputs: {},
    compile: async (data, _inputs, _ctx): Promise<NodeCompileResult> => {
        // Execute node doesn't produce instructions
        // It's a configuration node that the toolbar reads
        console.log('[Execute] Strategy configured:', data.strategy);
        return {
            instructions: [],
            outputs: {
                strategy: data.strategy,
                jitoTipLamports: data.jitoTipLamports,
                jitoRegion: data.jitoRegion,
                tpuEnabled: data.tpuEnabled,
            },
        };
    },
};

// =============================================================================
// Node Registry
// =============================================================================

/**
 * Registry of all available node definitions.
 */
export const nodeDefinitions: Record<NodeType, NodeDefinition<any>> = {
    'wallet': walletNodeDef,
    'transfer-sol': transferSolNodeDef,
    'transfer-token': transferTokenNodeDef,
    'create-ata': createAtaNodeDef,
    'memo': memoNodeDef,
    'execute': executeNodeDef,
};

/**
 * Get a node definition by type.
 */
export function getNodeDefinition(type: NodeType): NodeDefinition<any> {
    const def = nodeDefinitions[type];
    if (!def) {
        throw new Error(`Unknown node type: ${type}`);
    }
    return def;
}

/**
 * Get all node definitions as an array.
 */
export function getAllNodeDefinitions(): NodeDefinition<any>[] {
    return Object.values(nodeDefinitions);
}

/**
 * Get node definitions by category.
 */
export function getNodeDefinitionsByCategory(category: string): NodeDefinition<any>[] {
    return getAllNodeDefinitions().filter(def => def.category === category);
}
