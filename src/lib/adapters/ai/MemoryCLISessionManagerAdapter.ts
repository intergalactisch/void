/**
 * MemoryCLISessionManagerAdapter - In-memory mock for testing
 *
 * Simulates CLI process execution with configurable delays and responses.
 * CLI-agnostic: accepts binary + args like the real adapter.
 *
 * Part of the Hexagonal Architecture secondary adapters layer.
 */

import { ok, err, type Result } from '$lib/core/result';
import type {
  CLISessionManagerPort,
  CLISpawnRequest,
  CLIProcessHandle,
  CLIProcessInfo,
  CLIProcessEvent,
} from '$lib/ports/outbound/CLISessionManagerPort';

export interface MemoryCLIOptions {
  /** Simulated delay in ms before completion */
  delay?: number;
  /** Default response text */
  defaultResponse?: string;
  /** Whether spawns should fail */
  shouldFail?: boolean;
}

export class MemoryCLISessionManagerAdapter implements CLISessionManagerPort {
  #subscribers: Set<(event: CLIProcessEvent) => void> = new Set();
  #processes: Map<string, CLIProcessInfo> = new Map();
  #delay: number;
  #defaultResponse: string;
  #shouldFail: boolean;
  #nextId = 0;

  constructor(options?: MemoryCLIOptions) {
    this.#delay = options?.delay ?? 100;
    this.#defaultResponse = options?.defaultResponse ?? 'Mock AI response for testing.';
    this.#shouldFail = options?.shouldFail ?? false;
  }

  async spawn(request: CLISpawnRequest): Promise<Result<CLIProcessHandle, Error>> {
    if (this.#shouldFail) {
      return err(new Error('Mock: spawn failed'));
    }

    const processId = `mock_${++this.#nextId}`;
    const info: CLIProcessInfo = {
      processId,
      operationId: request.operationId,
      startedAt: Date.now(),
    };
    this.#processes.set(processId, info);

    this.#emit({ type: 'started', processId, operationId: request.operationId });

    // Simulate async completion
    setTimeout(() => {
      this.#processes.delete(processId);
      this.#emit({
        type: 'completed',
        processId,
        operationId: request.operationId,
        stdout: this.#defaultResponse,
        stderr: '',
        exitCode: 0,
      });
    }, this.#delay);

    const handle: CLIProcessHandle = {
      processId,
      operationId: request.operationId,
    };
    return ok(handle);
  }

  async cancel(processId: string): Promise<Result<void, Error>> {
    const info = this.#processes.get(processId);
    if (!info) {
      return err(new Error(`Process not found: ${processId}`));
    }
    this.#processes.delete(processId);
    this.#emit({ type: 'cancelled', processId, operationId: info.operationId });
    return ok(undefined);
  }

  getActiveProcesses(): CLIProcessInfo[] {
    return Array.from(this.#processes.values());
  }

  getActiveCount(): number {
    return this.#processes.size;
  }

  subscribe(callback: (event: CLIProcessEvent) => void): () => void {
    this.#subscribers.add(callback);
    return () => {
      this.#subscribers.delete(callback);
    };
  }

  #emit(event: CLIProcessEvent): void {
    for (const sub of this.#subscribers) {
      sub(event);
    }
  }
}
