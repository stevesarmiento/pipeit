import { TransactionFlow, type FlowConfig, type FlowStepResult } from '@pipeit/core';

/**
 * State of an individual pipeline step.
 */
export type StepState =
  | { type: 'idle' }
  | { type: 'building' }
  | { type: 'signing' }
  | { type: 'sending' }
  | { type: 'confirmed'; signature: string; cost: number }
  | { type: 'failed'; error: Error };

/**
 * Factory function that creates a TransactionFlow with the given config.
 */
export type FlowFactory = (config: FlowConfig) => TransactionFlow;

/**
 * Parameters for executing a visual pipeline.
 */
export type ExecuteParams = Omit<FlowConfig, 'strategy' | 'commitment'> & {
  strategy?: FlowConfig['strategy'];
  commitment?: FlowConfig['commitment'];
};

/**
 * Visual wrapper around TransactionFlow that tracks execution state.
 * Similar to VisualEffect in the Visual Effect project.
 */
export class VisualPipeline {
  private stepStates = new Map<string, StepState>();
  private listeners = new Set<() => void>();
  private executionStartTime: number | null = null;
  private executionEndTime: number | null = null;
  private totalCost = 0;

  state: 'idle' | 'executing' | 'completed' | 'failed' = 'idle';

  constructor(
    public name: string,
    public flowFactory: FlowFactory,
    public steps: Array<{ name: string; type: 'instruction' | 'transaction' }>
  ) {
    // Initialize all steps to idle
    steps.forEach((step) => {
      this.stepStates.set(step.name, { type: 'idle' });
    });
  }

  /**
   * Execute the flow with visual state tracking.
   */
  async execute(params: ExecuteParams): Promise<Map<string, FlowStepResult>> {
    this.state = 'executing';
    this.executionStartTime = Date.now();
    this.totalCost = 0;
    this.notifyListeners();

    // Create the flow with the provided params
    const flow = this.flowFactory({
      rpc: params.rpc,
      rpcSubscriptions: params.rpcSubscriptions,
      signer: params.signer,
      strategy: params.strategy ?? 'auto',
      commitment: params.commitment ?? 'confirmed',
    });

    // Hook into flow events to track state
    flow
      .onStepStart((stepName: string) => {
        this.setStepState(stepName, { type: 'building' });
      })
      .onStepComplete((stepName: string, result: FlowStepResult) => {
        // Extract signature and estimate cost
        const signature = result?.signature || '';
        const cost = 0.000005; // Base transaction fee in SOL (estimate)

        this.setStepState(stepName, {
          type: 'confirmed',
          signature,
          cost,
        });

        this.totalCost += cost;
      })
      .onStepError((stepName: string, error: Error) => {
        console.error(`Step ${stepName} failed:`, error);
        this.setStepState(stepName, { type: 'failed', error });
        this.state = 'failed';
        this.executionEndTime = Date.now();
        this.notifyListeners();
      });

    try {
      // Simulate signing phase for transaction steps
      this.steps.forEach((step) => {
        if (step.type === 'transaction') {
          // Transaction steps go through signing
          setTimeout(() => {
            const currentState = this.getStepState(step.name);
            if (currentState.type === 'building') {
              this.setStepState(step.name, { type: 'signing' });
            }
          }, 100);
        }
      });

      const results = await flow.execute();

      // Mark all completed steps as confirmed if not already
      results.forEach((result: FlowStepResult, stepName: string) => {
        const currentState = this.getStepState(stepName);
        if (currentState.type !== 'confirmed' && currentState.type !== 'failed') {
          const signature = result?.signature || '';
          this.setStepState(stepName, {
            type: 'confirmed',
            signature,
            cost: 0.000005,
          });
        }
      });

      this.state = 'completed';
      this.executionEndTime = Date.now();
      this.notifyListeners();

      return results;
    } catch (error) {
      this.steps.forEach((step) => {
        const currentState = this.getStepState(step.name);
        if (currentState.type !== 'confirmed' && currentState.type !== 'failed') {
          this.setStepState(step.name, { type: 'failed', error: error as Error });
        }
      });
      this.state = 'failed';
      this.executionEndTime = Date.now();
      this.notifyListeners();
      throw error;
    }
  }

  /**
   * Get the current state of a specific step.
   */
  getStepState(stepName: string): StepState {
    return this.stepStates.get(stepName) || { type: 'idle' };
  }

  /**
   * Set the state of a specific step and notify listeners.
   */
  private setStepState(stepName: string, state: StepState): void {
    this.stepStates.set(stepName, state);
    this.notifyListeners();
  }

  /**
   * Get execution duration in milliseconds.
   */
  getExecutionDuration(): number | null {
    if (this.executionStartTime === null) return null;
    const endTime = this.executionEndTime || Date.now();
    return endTime - this.executionStartTime;
  }

  /**
   * Get total cost in SOL.
   */
  getTotalCost(): number {
    return this.totalCost;
  }

  /**
   * Reset all steps to idle state.
   */
  reset(): void {
    this.steps.forEach((step) => {
      this.stepStates.set(step.name, { type: 'idle' });
    });
    this.state = 'idle';
    this.executionStartTime = null;
    this.executionEndTime = null;
    this.totalCost = 0;
    this.notifyListeners();
  }

  /**
   * Subscribe to state changes.
   * Returns unsubscribe function.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Notify all listeners of state changes.
   */
  private notifyListeners(): void {
    this.listeners.forEach((listener) => listener());
  }
}
