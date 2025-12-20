/**
 * TPU Events - Simple event system for capturing real TPU submission results.
 *
 * This module listens for CustomEvents dispatched by @pipeit/core when
 * TPU submissions complete, allowing UI components to display real-time data.
 */

import type { TpuSubmissionResult } from '@/components/pipeline/examples/tpu-direct';

type TpuEventListener = (result: TpuSubmissionResult) => void;
type TpuStartListener = () => void;

class TpuEventEmitter {
    private resultListeners = new Set<TpuEventListener>();
    private startListeners = new Set<TpuStartListener>();
    private isListening = false;
    private boundHandleStart: ((e: Event) => void) | null = null;
    private boundHandleResult: ((e: Event) => void) | null = null;

    /**
     * Subscribe to TPU results.
     */
    onResult(listener: TpuEventListener): () => void {
        this.resultListeners.add(listener);
        return () => this.resultListeners.delete(listener);
    }

    /**
     * Subscribe to TPU start events.
     */
    onStart(listener: TpuStartListener): () => void {
        this.startListeners.add(listener);
        return () => this.startListeners.delete(listener);
    }

    /**
     * Emit a TPU result to all listeners.
     */
    emit(result: TpuSubmissionResult): void {
        this.resultListeners.forEach(listener => listener(result));
    }

    /**
     * Emit start event.
     */
    emitStart(): void {
        this.startListeners.forEach(listener => listener());
    }

    /**
     * Start listening for TPU CustomEvents from @pipeit/core.
     */
    startIntercepting(): void {
        if (this.isListening || typeof window === 'undefined') return;

        this.isListening = true;

        // Handle TPU start event
        this.boundHandleStart = () => {
            console.log('🔵 [TPU Events] TPU submission starting');
            this.emitStart();
        };

        // Handle TPU result event
        this.boundHandleResult = (e: Event) => {
            const customEvent = e as CustomEvent;
            const data = customEvent.detail;
            console.log('🟢 [TPU Events] TPU result received:', data);

            if (data && (typeof data.confirmed !== 'undefined' || typeof data.delivered !== 'undefined')) {
                const result: TpuSubmissionResult = {
                    // Required fields
                    confirmed: data.confirmed ?? data.delivered ?? false,
                    signature: data.signature || '',
                    rounds: data.rounds || 0,
                    totalLeadersSent: data.totalLeadersSent || data.leaderCount || 0,
                    latencyMs: data.latencyMs || 0,
                    error: data.error,
                    // Backwards compat fields
                    delivered: data.delivered ?? data.confirmed ?? false,
                    leaderCount: data.leaderCount || data.totalLeadersSent || 0,
                    leaders: (data.leaders || []).map((l: any) => ({
                        identity: l.identity || 'Unknown',
                        address: l.address || 'Unknown',
                        success: l.success ?? data.delivered ?? data.confirmed ?? false,
                        latencyMs: l.latencyMs || 0,
                        error: l.error,
                        errorCode: l.errorCode,
                        attempts: l.attempts || 1,
                    })),
                    retryCount: data.retryCount || 0,
                };
                console.log('🟣 [TPU Events] Emitting to UI:', result);
                this.emit(result);
            }
        };

        window.addEventListener('pipeit:tpu:start', this.boundHandleStart);
        window.addEventListener('pipeit:tpu:result', this.boundHandleResult);

        console.log('✅ [TPU Events] Now listening for pipeit:tpu:* events');
    }

    /**
     * Stop listening for events.
     */
    stopIntercepting(): void {
        if (!this.isListening || typeof window === 'undefined') return;

        if (this.boundHandleStart) {
            window.removeEventListener('pipeit:tpu:start', this.boundHandleStart);
        }
        if (this.boundHandleResult) {
            window.removeEventListener('pipeit:tpu:result', this.boundHandleResult);
        }

        this.boundHandleStart = null;
        this.boundHandleResult = null;
        this.isListening = false;
    }

    /**
     * Clear all listeners.
     */
    clear(): void {
        this.resultListeners.clear();
        this.startListeners.clear();
    }
}

// Singleton instance
export const tpuEvents = new TpuEventEmitter();
