/**
 * CLISessionManagerPort - Outbound port for managing CLI AI processes
 *
 * Abstracts the spawning, tracking, and cancellation of CLI processes.
 * CLI-agnostic: receives pre-built binary + args from the CLIProvider.
 *
 * Part of the Hexagonal Architecture outbound ports layer.
 */

import type { Result } from '$lib/core/result';
import type { OperationId } from '$lib/domain/values/OperationId';

/**
 * Request to spawn a new CLI process.
 * CLI-agnostic: binary + pre-built args replace individual CLI flags.
 */
export interface CLISpawnRequest {
  operationId: OperationId;
  binary: string;
  args: string[];
  workingDirectory?: string;
  timeoutMs?: number;
}

/**
 * Handle to a running CLI process.
 */
export interface CLIProcessHandle {
  processId: string;
  operationId: OperationId;
}

/**
 * Information about a running process.
 */
export interface CLIProcessInfo {
  processId: string;
  operationId: OperationId;
  startedAt: number;
}

/**
 * Events emitted by CLI processes.
 */
export type CLIProcessEvent =
  | { type: 'started'; processId: string; operationId: OperationId }
  | { type: 'progress'; processId: string; message: string }
  | { type: 'completed'; processId: string; operationId: OperationId; stdout: string; stderr: string; exitCode: number; sessionId?: string }
  | { type: 'failed'; processId: string; operationId: OperationId; error: string }
  | { type: 'cancelled'; processId: string; operationId: OperationId };

/**
 * CLISessionManager outbound port.
 */
export interface CLISessionManagerPort {
  spawn(request: CLISpawnRequest): Promise<Result<CLIProcessHandle, Error>>;
  cancel(processId: string): Promise<Result<void, Error>>;
  getActiveProcesses(): CLIProcessInfo[];
  getActiveCount(): number;
  subscribe(callback: (event: CLIProcessEvent) => void): () => void;
}
