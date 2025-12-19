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

import { address, lamports, getProgramDerivedAddress, getAddressEncoder } from '@solana/kit';
import { getTransferSolInstruction } from '@solana-program/system';
import { getTransferInstruction, TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import type {
    NodeDefinition,
    NodeType,
    WalletNodeData,
    TransferSolNodeData,
    TransferTokenNodeData,
    SwapNodeData,
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

/**
 * Associated Token Account Program address.
 */
const ASSOCIATED_TOKEN_PROGRAM_ADDRESS = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';

/**
 * Derives the Associated Token Address (ATA) for a given owner and mint.
 * ATAs are PDAs derived from: [owner, token_program, mint]
 */
async function getAssociatedTokenAddress(owner: string, mint: string): Promise<string> {
    const addressEncoder = getAddressEncoder();
    const [ata] = await getProgramDerivedAddress({
        programAddress: address(ASSOCIATED_TOKEN_PROGRAM_ADDRESS),
        seeds: [
            addressEncoder.encode(address(owner)),
            addressEncoder.encode(address(TOKEN_PROGRAM_ADDRESS)),
            addressEncoder.encode(address(mint)),
        ],
    });
    return ata;
}

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

        const amount = parseFloat(data.amount);
        if (isNaN(amount) || amount <= 0) {
            return { instructions: [], outputs: {} };
        }

        try {
            // Derive source and destination ATAs
            const [sourceAta, destinationAta] = await Promise.all([
                getAssociatedTokenAddress(ctx.walletAddress, data.mint),
                getAssociatedTokenAddress(data.destination, data.mint),
            ]);

            console.log('[TransferToken] Derived ATAs:', {
                source: sourceAta,
                destination: destinationAta,
            });

            // Convert amount to smallest units using decimals
            const amountInSmallestUnits = BigInt(
                Math.floor(amount * Math.pow(10, data.decimals))
            );

            // Create transfer instruction
            const instruction = getTransferInstruction({
                source: address(sourceAta),
                destination: address(destinationAta),
                authority: ctx.signer,
                amount: amountInSmallestUnits,
            });

            console.log('[TransferToken] Transfer instruction created:', {
                mint: data.mint,
                amount: amountInSmallestUnits.toString(),
                from: ctx.walletAddress,
                to: data.destination,
            });

            return {
                instructions: [instruction],
                outputs: {
                    amount: amountInSmallestUnits,
                    mint: data.mint,
                    destination: data.destination,
                },
                computeUnits: 30_000, // Token transfer typically uses ~20-30k CU
                tokenTransfer: {
                    mint: data.mint,
                    amount: amountInSmallestUnits,
                    decimals: data.decimals,
                    destination: data.destination,
                },
            };
        } catch (error) {
            console.error('[TransferToken] Error creating transfer instruction:', error);
            return { instructions: [], outputs: {} };
        }
    },
};

// =============================================================================
// Swap Node (Jupiter)
// =============================================================================

/**
 * Common token mints for convenience.
 */
export const COMMON_TOKENS = {
    SOL: 'So11111111111111111111111111111111111111112',
    USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    USDT: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
} as const;

/**
 * Known token decimals for display formatting.
 */
const TOKEN_DECIMALS: Record<string, number> = {
    [COMMON_TOKENS.SOL]: 9,
    [COMMON_TOKENS.USDC]: 6,
    [COMMON_TOKENS.USDT]: 6,
};

/**
 * Get token symbol for known tokens.
 */
function getTokenSymbol(mint: string): string {
    if (mint === COMMON_TOKENS.SOL) return 'SOL';
    if (mint === COMMON_TOKENS.USDC) return 'USDC';
    if (mint === COMMON_TOKENS.USDT) return 'USDT';
    // Truncate unknown mints
    return mint.length > 10 ? `${mint.slice(0, 4)}...${mint.slice(-4)}` : mint;
}

/**
 * Get decimals for a token (defaults to 9 for unknown tokens).
 */
function getTokenDecimals(mint: string): number {
    return TOKEN_DECIMALS[mint] ?? 9;
}

export const swapNodeDef: NodeDefinition<SwapNodeData> = {
    type: 'swap',
    label: 'Swap',
    category: 'transfer',
    description: 'Swap tokens via Jupiter',
    icon: 'arrow-left-right',
    defaultData: {
        inputMint: COMMON_TOKENS.SOL,
        outputMint: COMMON_TOKENS.USDC,
        amount: '',
        slippageBps: 50,
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
        if (!data.inputMint || !data.outputMint || !data.amount) {
            return { instructions: [], outputs: {} };
        }

        const amount = parseFloat(data.amount);
        if (isNaN(amount) || amount <= 0) {
            return { instructions: [], outputs: {} };
        }

        // Convert to lamports/smallest units (assuming 9 decimals for input)
        // For SOL, 1 SOL = 1e9 lamports
        const amountInSmallestUnits = Math.floor(amount * 1_000_000_000).toString();

        try {
            // 1. Get quote from Jupiter API (via Next.js proxy)
            const quoteParams = new URLSearchParams({
                inputMint: data.inputMint,
                outputMint: data.outputMint,
                amount: amountInSmallestUnits,
                slippageBps: data.slippageBps.toString(),
            });

            console.log('[Swap] Fetching quote:', quoteParams.toString());
            const quoteRes = await fetch(`/api/jupiter/quote?${quoteParams}`);
            
            if (!quoteRes.ok) {
                const errorText = await quoteRes.text();
                console.error('[Swap] Quote error:', errorText);
                throw new Error(`Failed to get swap quote: ${errorText}`);
            }

            const quote = await quoteRes.json();
            console.log('[Swap] Quote received:', {
                inAmount: quote.inAmount,
                outAmount: quote.outAmount,
                priceImpactPct: quote.priceImpactPct,
            });

            // 2. Get swap instructions from Jupiter API
            const swapRes = await fetch('/api/jupiter/swap-instructions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    quoteResponse: quote,
                    userPublicKey: ctx.walletAddress,
                    wrapAndUnwrapSol: true,
                    dynamicComputeUnitLimit: true,
                }),
            });

            if (!swapRes.ok) {
                const errorText = await swapRes.text();
                console.error('[Swap] Swap instructions error:', errorText);
                throw new Error(`Failed to get swap instructions: ${errorText}`);
            }

            const swapData = await swapRes.json();
            console.log('[Swap] Got swap instructions');

            // 3. Convert Jupiter instructions to Solana Kit format
            const instructions: any[] = [];

            // Add setup instructions (ATA creation, wSOL wrapping, etc.)
            if (swapData.setupInstructions?.length > 0) {
                for (const ix of swapData.setupInstructions) {
                    instructions.push(convertJupiterInstruction(ix));
                }
            }

            // Add main swap instruction
            instructions.push(convertJupiterInstruction(swapData.swapInstruction));

            // Add cleanup instruction (unwrap wSOL, etc.)
            if (swapData.cleanupInstruction) {
                instructions.push(convertJupiterInstruction(swapData.cleanupInstruction));
            }

            console.log('[Swap] Total instructions:', instructions.length);

            // Get decimals for formatting
            const inputDecimals = getTokenDecimals(data.inputMint);
            const outputDecimals = getTokenDecimals(data.outputMint);
            const inputSymbol = getTokenSymbol(data.inputMint);
            const outputSymbol = getTokenSymbol(data.outputMint);

            console.log('[Swap] Amounts:', {
                input: `${Number(quote.inAmount) / Math.pow(10, inputDecimals)} ${inputSymbol}`,
                output: `${Number(quote.outAmount) / Math.pow(10, outputDecimals)} ${outputSymbol}`,
            });

            return {
                instructions,
                outputs: {
                    inputAmount: BigInt(quote.inAmount),
                    outputAmount: BigInt(quote.outAmount),
                    inputMint: data.inputMint,
                    outputMint: data.outputMint,
                },
                computeUnits: swapData.computeUnitLimit || 300_000,
                addressLookupTables: swapData.addressLookupTableAddresses || [],
                // Show the input token being sold as the "transfer"
                tokenTransfer: {
                    mint: data.inputMint,
                    amount: BigInt(quote.inAmount),
                    decimals: inputDecimals,
                    destination: data.outputMint, // Use output mint as a reference
                },
            };
        } catch (error) {
            console.error('[Swap] Error:', error);
            // Return empty on error - the feedback panel will show validation errors
            return { instructions: [], outputs: {} };
        }
    },
};

/**
 * Convert Jupiter instruction format to Solana Kit Instruction format.
 */
function convertJupiterInstruction(ix: {
    programId: string;
    accounts: Array<{ pubkey: string; isSigner: boolean; isWritable: boolean }>;
    data: string;
}): any {
    return {
        programAddress: address(ix.programId),
        accounts: ix.accounts.map(acc => ({
            address: address(acc.pubkey),
            role: acc.isSigner && acc.isWritable ? 3 // WRITABLE_SIGNER
                : acc.isSigner ? 2 // READONLY_SIGNER
                : acc.isWritable ? 1 // WRITABLE
                : 0, // READONLY
        })),
        data: Buffer.from(ix.data, 'base64'),
    };
}

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
    'swap': swapNodeDef,
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

