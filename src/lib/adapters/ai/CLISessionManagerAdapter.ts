/**
 * CLISessionManagerAdapter - Tauri implementation of CLISessionManagerPort
 *
 * Uses Tauri invoke() for spawning/cancelling processes and
 * listen() for receiving process lifecycle events.
 *
 * CLI-agnostic: receives binary + pre-built args, forwards to Rust.
 *
 * Part of the Hexagonal Architecture secondary adapters layer.
 */

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { ok, err, type Result } from '$lib/core/result';
import type {
  CLISessionManagerPort,
  CLISpawnRequest,
  CLIProcessHandle,
  CLIProcessInfo,
  CLIProcessEvent,
} from '$lib/ports/outbound/CLISessionManagerPort';
import type { OperationId } from '$lib/domain/values/OperationId';

export class CLISessionManagerAdapter implements CLISessionManagerPort {
  #subscribers: Set<(event: CLIProcessEvent) => void> = new Set();
  #unlisteners: UnlistenFn[] = [];
  #initialized = false;
  #activeCount = 0;

  async #ensureListeners(): Promise<void> {
    if (this.#initialized) return;
    this.#initialized = true;

    const events = [
      'cli:process:started',
      'cli:process:completed',
      'cli:process:failed',
      'cli:process:cancelled',
    ] as const;

    for (const eventName of events) {
      const unlisten = await listen(eventName, (event) => {
        const mapped = this.#mapEvent(eventName, event.payload as Record<string, unknown>);
        if (mapped) {
          for (const sub of this.#subscribers) {
            sub(mapped);
          }
        }
      });
      this.#unlisteners.push(unlisten);
    }
  }

  #mapEvent(
    eventName: string,
    payload: Record<string, unknown>
  ): CLIProcessEvent | null {
    const processId = payload.process_id as string;
    const operationId = payload.operation_id as OperationId;

    switch (eventName) {
      case 'cli:process:started':
        this.#activeCount++;
        return { type: 'started', processId, operationId };
      case 'cli:process:completed':
        this.#activeCount = Math.max(0, this.#activeCount - 1);
        return {
          type: 'completed',
          processId,
          operationId,
          stdout: payload.stdout as string,
          stderr: payload.stderr as string,
          exitCode: payload.exit_code as number,
          ...(payload.session_id ? { sessionId: payload.session_id as string } : {}),
        };
      case 'cli:process:failed':
        this.#activeCount = Math.max(0, this.#activeCount - 1);
        return { type: 'failed', processId, operationId, error: payload.error as string };
      case 'cli:process:cancelled':
        this.#activeCount = Math.max(0, this.#activeCount - 1);
        return { type: 'cancelled', processId, operationId };
      default:
        return null;
    }
  }

  async spawn(request: CLISpawnRequest): Promise<Result<CLIProcessHandle, Error>> {
    await this.#ensureListeners();

    try {
      const result = await invoke<{ process_id: string }>('spawn_cli_process', {
        operationId: request.operationId,
        binary: request.binary,
        args: request.args,
        workingDirectory: request.workingDirectory ?? null,
        timeoutMs: request.timeoutMs ?? null,
      });

      const handle: CLIProcessHandle = {
        processId: result.process_id,
        operationId: request.operationId,
      };
      return ok(handle);
    } catch (e) {
      return err(new Error(String(e)));
    }
  }

  async cancel(processId: string): Promise<Result<void, Error>> {
    try {
      await invoke('cancel_cli_process', { processId });
      return ok(undefined);
    } catch (e) {
      return err(new Error(String(e)));
    }
  }

  getActiveProcesses(): CLIProcessInfo[] {
    // Synchronous query not available via Tauri invoke (async).
    // Use getActiveCount() or subscribe() for real-time tracking.
    return [];
  }

  getActiveCount(): number {
    return this.#activeCount;
  }

  subscribe(callback: (event: CLIProcessEvent) => void): () => void {
    this.#subscribers.add(callback);
    // Fire and forget — listeners are idempotent and subsequent calls
    // wait on the same promise, so spawn await it before invoking.
    void this.#ensureListeners();
    return () => {
      this.#subscribers.delete(callback);
    };
  }

  destroy(): void {
    for (const unlisten of this.#unlisteners) {
      unlisten();
    }
    this.#unlisteners = [];
    this.#subscribers.clear();
    this.#initialized = false;
    this.#activeCount = 0;
  }
}
