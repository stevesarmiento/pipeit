'use client';

import { useState, useCallback } from 'react';
import type { TpuErrorCode } from '@pipeit/core';

/**
 * Per-leader result from TPU submission.
 */
export interface TpuLeaderResult {
    identity: string;
    address: string;
    success: boolean;
    latencyMs: number;
    error?: string;
    errorCode?: TpuErrorCode;
    attempts: number;
}

/**
 * Enhanced TPU submission result with per-leader breakdown.
 */
export interface TpuSubmissionResult {
    delivered: boolean;
    leaderCount: number;
    latencyMs: number;
    leaders: TpuLeaderResult[];
    retryCount: number;
    error?: string;
}

/**
 * State for tracking TPU submission in real-time.
 */
export type TpuSubmissionState =
    | { status: 'idle' }
    | { status: 'preparing' }
    | { status: 'sending'; startTime: number }
    | { status: 'complete'; result: TpuSubmissionResult }
    | { status: 'error'; message: string };

/**
 * Hook for managing TPU submission with real-time feedback.
 *
 * This hook provides direct access to the TPU API route and captures
 * the enhanced per-leader response for visualization.
 *
 * @example
 * ```tsx
 * const { state, result, submit, reset } = useTpuSubmission();
 *
 * // Submit a transaction
 * await submit(signedTransactionBase64);
 *
 * // Check per-leader results
 * if (result) {
 *   result.leaders.forEach(leader => {
 *     console.log(`${leader.identity}: ${leader.success ? '✅' : '❌'}`);
 *   });
 * }
 * ```
 */
export function useTpuSubmission(apiRoute: string = '/api/tpu') {
    const [state, setState] = useState<TpuSubmissionState>({ status: 'idle' });
    const [result, setResult] = useState<TpuSubmissionResult | null>(null);

    const submit = useCallback(
        async (transactionBase64: string): Promise<TpuSubmissionResult> => {
            setState({ status: 'preparing' });
            setResult(null);

            const startTime = Date.now();

            try {
                setState({ status: 'sending', startTime });

                const response = await fetch(apiRoute, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        transaction: transactionBase64,
                    }),
                });

                const data = await response.json();

                const submissionResult: TpuSubmissionResult = {
                    delivered: data.delivered,
                    leaderCount: data.leaderCount,
                    latencyMs: data.latencyMs || Date.now() - startTime,
                    leaders: data.leaders || [],
                    retryCount: data.retryCount || 0,
                    error: data.error,
                };

                if (!response.ok || data.error) {
                    setState({ status: 'error', message: data.error || 'TPU submission failed' });
                    setResult(submissionResult);
                    throw new Error(data.error || 'TPU submission failed');
                }

                setState({ status: 'complete', result: submissionResult });
                setResult(submissionResult);

                return submissionResult;
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Unknown error';
                setState({ status: 'error', message });
                throw error;
            }
        },
        [apiRoute],
    );

    const reset = useCallback(() => {
        setState({ status: 'idle' });
        setResult(null);
    }, []);

    return {
        state,
        result,
        submit,
        reset,
        isIdle: state.status === 'idle',
        isPreparing: state.status === 'preparing',
        isSending: state.status === 'sending',
        isComplete: state.status === 'complete',
        isError: state.status === 'error',
    };
}

/**
 * Format a TPU error code for display.
 */
export function formatTpuErrorCode(code: TpuErrorCode): string {
    const labels: Record<TpuErrorCode, string> = {
        CONNECTION_FAILED: 'Connection Failed',
        STREAM_CLOSED: 'Stream Closed',
        RATE_LIMITED: 'Rate Limited',
        NO_LEADERS: 'No Leaders',
        TIMEOUT: 'Timeout',
        VALIDATOR_UNREACHABLE: 'Validator Unreachable',
        ZERO_RTT_REJECTED: '0-RTT Rejected',
    };
    return labels[code] || code;
}

/**
 * Check if a TPU error code is retryable.
 */
export function isTpuErrorRetryable(code: TpuErrorCode): boolean {
    const retryable: TpuErrorCode[] = ['CONNECTION_FAILED', 'STREAM_CLOSED', 'RATE_LIMITED', 'TIMEOUT'];
    return retryable.includes(code);
}
