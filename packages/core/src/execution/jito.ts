/**
 * Jito bundle client for MEV-protected transaction submission.
 *
 * Jito provides:
 * - Bundle auctions for guaranteed transaction ordering
 * - MEV protection from sandwich attacks
 * - Higher landing probability for time-sensitive transactions
 *
 * @packageDocumentation
 */

import { address, type Address } from '@solana/addresses';
import type { Instruction, AccountRole } from '@solana/instructions';
import type { JitoBundleResponse, JitoBundleStatusResponse, JitoBlockEngineRegion } from './types.js';

// ============================================================================
// Constants
// ============================================================================

/**
 * Jito block engine regional endpoints.
 * Use 'mainnet' for automatic load balancing across regions.
 */
export const JITO_BLOCK_ENGINES: Record<JitoBlockEngineRegion, string> = {
    mainnet: 'https://mainnet.block-engine.jito.wtf',
    ny: 'https://ny.mainnet.block-engine.jito.wtf',
    amsterdam: 'https://amsterdam.mainnet.block-engine.jito.wtf',
    frankfurt: 'https://frankfurt.mainnet.block-engine.jito.wtf',
    tokyo: 'https://tokyo.mainnet.block-engine.jito.wtf',
    singapore: 'https://singapore.mainnet.block-engine.jito.wtf',
    slc: 'https://slc.mainnet.block-engine.jito.wtf',
} as const;

/**
 * Jito tip accounts.
 * One should be randomly selected per bundle to reduce contention.
 * These are the official Jito tip payment program accounts.
 */
export const JITO_TIP_ACCOUNTS: Address[] = [
    address('96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5'),
    address('HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe'),
    address('Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY'),
    address('ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49'),
    address('DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh'),
    address('ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt'),
    address('DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL'),
    address('3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT'),
];

/**
 * System Program address for SOL transfers.
 */
const SYSTEM_PROGRAM = address('11111111111111111111111111111111');

/**
 * Minimum tip amount in lamports (1000 lamports = 0.000001 SOL).
 */
export const JITO_MIN_TIP_LAMPORTS = 1_000n;

/**
 * Default tip amount in lamports (10,000 lamports = 0.00001 SOL).
 */
export const JITO_DEFAULT_TIP_LAMPORTS = 10_000n;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get a random tip account to reduce contention.
 * Each bundle should use a different tip account when possible.
 *
 * @returns A randomly selected Jito tip account address
 */
export function getRandomTipAccount(): Address {
    const index = Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length);
    return JITO_TIP_ACCOUNTS[index];
}

/**
 * Resolve block engine URL from region name or full URL.
 *
 * @param urlOrRegion - Region name or full URL
 * @returns Full block engine URL
 */
export function resolveBlockEngineUrl(urlOrRegion?: string | JitoBlockEngineRegion): string {
    if (!urlOrRegion) {
        return JITO_BLOCK_ENGINES.mainnet;
    }

    // Check if it's a region key
    if (urlOrRegion in JITO_BLOCK_ENGINES) {
        return JITO_BLOCK_ENGINES[urlOrRegion as JitoBlockEngineRegion];
    }

    // Assume it's a full URL
    return urlOrRegion;
}

/**
 * Create a SOL transfer instruction for Jito tip payment.
 * This instruction transfers SOL from the fee payer to a Jito tip account.
 *
 * @param source - Address paying the tip (usually fee payer)
 * @param lamports - Amount to tip in lamports
 * @param tipAccount - Optional specific tip account (random if not provided)
 * @returns System program transfer instruction
 *
 * @example
 * ```ts
 * const tipIx = createTipInstruction(
 *   feePayer.address,
 *   10_000n, // 0.00001 SOL
 * );
 * ```
 */
export function createTipInstruction(source: Address, lamports: bigint, tipAccount?: Address): Instruction {
    const destination = tipAccount ?? getRandomTipAccount();

    // System program transfer instruction data layout:
    // [0-3]: instruction discriminator (2 = transfer)
    // [4-11]: lamports as u64 LE
    const data = new Uint8Array(12);
    const view = new DataView(data.buffer);

    // Transfer instruction discriminator
    view.setUint32(0, 2, true);
    // Lamports as u64 LE
    view.setBigUint64(4, lamports, true);

    return {
        programAddress: SYSTEM_PROGRAM,
        accounts: [
            {
                address: source,
                role: 3 as AccountRole, // WRITABLE_SIGNER
            },
            {
                address: destination,
                role: 1 as AccountRole, // WRITABLE
            },
        ],
        data,
    };
}

// ============================================================================
// Jito API Client
// ============================================================================

/**
 * Error thrown when Jito bundle submission fails.
 */
export class JitoBundleError extends Error {
    readonly code: number | undefined;
    readonly bundleId: string | undefined;

    constructor(message: string, options?: { code?: number; bundleId?: string }) {
        super(message);
        this.name = 'JitoBundleError';
        this.code = options?.code;
        this.bundleId = options?.bundleId;
    }
}

/**
 * Options for sending a Jito bundle.
 */
export interface SendBundleOptions {
    /**
     * Block engine URL or region.
     * @default 'mainnet'
     */
    blockEngineUrl?: string | JitoBlockEngineRegion;

    /**
     * Abort signal for cancellation.
     */
    abortSignal?: AbortSignal;
}

/**
 * Submit a bundle of transactions to Jito block engine.
 *
 * Bundles are executed sequentially and atomically - all transactions
 * succeed or none are included. The bundle competes in Jito's auction
 * against other bundles, with tip amount determining priority.
 *
 * @param transactions - Array of base64-encoded signed transactions (max 5)
 * @param options - Submission options
 * @returns Bundle ID (SHA-256 hash of transaction signatures)
 * @throws {JitoBundleError} If submission fails
 *
 * @example
 * ```ts
 * const bundleId = await sendBundle(
 *   [base64Tx1, base64Tx2, tipTx],
 *   { blockEngineUrl: 'ny' }
 * );
 * ```
 */
export async function sendBundle(transactions: string[], options: SendBundleOptions = {}): Promise<string> {
    if (transactions.length === 0) {
        throw new JitoBundleError('Bundle must contain at least one transaction');
    }

    if (transactions.length > 5) {
        throw new JitoBundleError('Bundle cannot contain more than 5 transactions');
    }

    const blockEngineUrl = resolveBlockEngineUrl(options.blockEngineUrl);
    const url = `${blockEngineUrl}/api/v1/bundles`;

    const fetchOptions: RequestInit = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'sendBundle',
            params: [transactions, { encoding: 'base64' }],
        }),
    };

    if (options.abortSignal) {
        fetchOptions.signal = options.abortSignal;
    }

    const response = await fetch(url, fetchOptions);

    if (!response.ok) {
        const errorText = await response.text();
        throw new JitoBundleError(`Jito block engine error: ${response.status} - ${errorText}`);
    }

    const data: JitoBundleResponse = await response.json();

    if (data.error) {
        throw new JitoBundleError(data.error.message, { code: data.error.code });
    }

    if (!data.result) {
        throw new JitoBundleError('No bundle ID returned from Jito');
    }

    return data.result;
}

/**
 * Options for getting bundle status.
 */
export interface GetBundleStatusOptions {
    /**
     * Block engine URL or region.
     * @default 'mainnet'
     */
    blockEngineUrl?: string | JitoBlockEngineRegion;

    /**
     * Abort signal for cancellation.
     */
    abortSignal?: AbortSignal;
}

/**
 * Bundle status result.
 */
export interface BundleStatus {
    bundleId: string;
    transactions: string[];
    slot: number;
    confirmationStatus: 'processed' | 'confirmed' | 'finalized';
    error: { Ok: null } | { Err: unknown } | null;
}

/**
 * Get the status of submitted bundles.
 *
 * Use this to check if a bundle has landed on-chain after submission.
 * Note: Jito only searches recent history, so check soon after submission.
 *
 * @param bundleIds - Array of bundle IDs to check (max 5)
 * @param options - Request options
 * @returns Array of bundle statuses (null if not found)
 *
 * @example
 * ```ts
 * const [status] = await getBundleStatuses([bundleId]);
 * if (status?.confirmationStatus === 'confirmed') {
 *   console.log('Bundle landed!');
 * }
 * ```
 */
export async function getBundleStatuses(
    bundleIds: string[],
    options: GetBundleStatusOptions = {},
): Promise<Array<BundleStatus | null>> {
    if (bundleIds.length === 0) {
        return [];
    }

    if (bundleIds.length > 5) {
        throw new JitoBundleError('Cannot query more than 5 bundle IDs at once');
    }

    const blockEngineUrl = resolveBlockEngineUrl(options.blockEngineUrl);
    const url = `${blockEngineUrl}/api/v1/getBundleStatuses`;

    const fetchOptions: RequestInit = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'getBundleStatuses',
            params: [bundleIds],
        }),
    };

    if (options.abortSignal) {
        fetchOptions.signal = options.abortSignal;
    }

    const response = await fetch(url, fetchOptions);

    if (!response.ok) {
        const errorText = await response.text();
        throw new JitoBundleError(`Jito block engine error: ${response.status} - ${errorText}`);
    }

    const data: JitoBundleStatusResponse = await response.json();

    if (data.error) {
        throw new JitoBundleError(data.error.message, { code: data.error.code });
    }

    if (!data.result?.value) {
        return bundleIds.map(() => null);
    }

    return data.result.value.map(status => {
        if (!status) return null;
        return {
            bundleId: status.bundle_id,
            transactions: status.transactions,
            slot: status.slot,
            confirmationStatus: status.confirmation_status,
            error: status.err,
        };
    });
}

/**
 * Send a single transaction via Jito as a bundle.
 * Automatically creates a tip instruction if not present.
 *
 * This is a convenience wrapper for sending single transactions
 * with Jito's MEV protection.
 *
 * @param transaction - Base64-encoded signed transaction
 * @param options - Submission options including tip configuration
 * @returns Bundle ID
 *
 * @example
 * ```ts
 * const bundleId = await sendTransactionViaJito(base64Tx, {
 *   blockEngineUrl: 'ny',
 * });
 * ```
 */
export async function sendTransactionViaJito(transaction: string, options: SendBundleOptions = {}): Promise<string> {
    // Single transaction bundles are valid in Jito
    return sendBundle([transaction], options);
}



