/**
 * TPU-specific error types and utilities.
 *
 * Provides error classes and type guards for TPU submission failures,
 * enabling smart retry logic and detailed error reporting.
 *
 * @packageDocumentation
 */

/**
 * TPU-specific error codes.
 *
 * Maps to error codes from @pipeit/fastlane's Rust client.
 */
export type TpuErrorCode =
    | 'CONNECTION_FAILED'
    | 'STREAM_CLOSED'
    | 'RATE_LIMITED'
    | 'NO_LEADERS'
    | 'TIMEOUT'
    | 'VALIDATOR_UNREACHABLE'
    | 'ZERO_RTT_REJECTED'
    | 'UNKNOWN';

/**
 * Set of all valid TPU error codes for runtime validation.
 */
const TPU_ERROR_CODES: ReadonlySet<string> = new Set<TpuErrorCode>([
    'CONNECTION_FAILED',
    'STREAM_CLOSED',
    'RATE_LIMITED',
    'NO_LEADERS',
    'TIMEOUT',
    'VALIDATOR_UNREACHABLE',
    'ZERO_RTT_REJECTED',
    'UNKNOWN',
]);

/**
 * Type guard to check if a string is a valid TpuErrorCode.
 */
function isTpuErrorCode(code: string): code is TpuErrorCode {
    return TPU_ERROR_CODES.has(code);
}

/**
 * Error codes that are safe to retry.
 */
export const TPU_RETRYABLE_ERRORS: TpuErrorCode[] = [
    'CONNECTION_FAILED',
    'STREAM_CLOSED',
    'RATE_LIMITED',
    'TIMEOUT',
];

/**
 * Error thrown when TPU submission fails.
 *
 * Provides detailed information about what went wrong during
 * direct TPU submission, including the specific error code
 * and which validator (if any) was involved.
 *
 * @example
 * ```typescript
 * try {
 *   await client.sendTransaction(tx);
 * } catch (error) {
 *   if (isTpuSubmissionError(error)) {
 *     console.log(`TPU error: ${error.code}`);
 *     if (error.retryable) {
 *       // Safe to retry
 *     }
 *   }
 * }
 * ```
 */
export class TpuSubmissionError extends Error {
    /** Error name for instanceof checks. */
    override readonly name = 'TpuSubmissionError' as const;

    constructor(
        /** TPU error code for programmatic handling. */
        public readonly code: TpuErrorCode,
        message: string,
        /** Validator identity pubkey (if known). */
        public readonly validatorIdentity?: string,
        /** Whether this error is safe to retry. */
        public readonly retryable: boolean = TPU_RETRYABLE_ERRORS.includes(code),
    ) {
        super(message);
        // Restore prototype chain (needed for instanceof in ES5)
        Object.setPrototypeOf(this, TpuSubmissionError.prototype);
    }

    /**
     * Creates a TpuSubmissionError from a raw error code string.
     *
     * Validates the code against known TpuErrorCode values. If the code
     * is not recognized, falls back to UNKNOWN and includes the original
     * code in the error message.
     */
    static fromCode(
        code: string,
        message?: string,
        validatorIdentity?: string,
    ): TpuSubmissionError {
        const normalizedCode = code.toUpperCase();

        if (isTpuErrorCode(normalizedCode)) {
            return new TpuSubmissionError(
                normalizedCode,
                message || `TPU submission failed: ${code}`,
                validatorIdentity,
            );
        }

        // Invalid code: use UNKNOWN fallback and include original code in message
        return new TpuSubmissionError(
            'UNKNOWN',
            message || `TPU submission failed with unrecognized code: ${code}`,
            validatorIdentity,
        );
    }
}

/**
 * Check if error is a TPU submission error.
 */
export function isTpuSubmissionError(error: unknown): error is TpuSubmissionError {
    return error instanceof TpuSubmissionError;
}

/**
 * Check if TPU error is retryable.
 *
 * Returns true only for TpuSubmissionError instances that have
 * a retryable error code.
 */
export function isTpuRetryableError(error: unknown): boolean {
    if (!isTpuSubmissionError(error)) return false;
    return error.retryable;
}

/**
 * Per-leader send result from TPU submission.
 *
 * Provides detailed information about what happened when
 * sending to a specific validator leader.
 */
export interface TpuLeaderResult {
    /** Validator identity pubkey. */
    identity: string;
    /** TPU socket address (ip:port). */
    address: string;
    /** Whether the send succeeded. */
    success: boolean;
    /** Latency in milliseconds. */
    latencyMs: number;
    /** Error message (if failed). */
    error?: string;
    /** Error code for programmatic handling. */
    errorCode?: TpuErrorCode;
    /** Number of attempts made. */
    attempts: number;
}

/**
 * Enhanced TPU submission result with per-leader breakdown.
 */
export interface TpuSubmissionDetails {
    /** Per-leader send results. */
    leaders: TpuLeaderResult[];
    /** Total retry attempts made across all leaders. */
    retryCount: number;
}
