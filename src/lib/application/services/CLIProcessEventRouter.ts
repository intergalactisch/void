/**
 * CLIProcessEventRouter — translates CLI process events into operation
 * state transitions.
 *
 * Extracted from OperationServiceImpl. The CLI session manager fires a
 * stream of events (started / progress / completed / failed /
 * cancelled). Each event needs to find the corresponding operation,
 * transition it, persist the new state, write archive sidecars, and
 * — for completed/failed/cancelled — kick the queue so the next
 * pending operation can run.
 *
 * Doing all of that inline made `OperationServiceImpl` 115 lines longer
 * than it needed to be. The router owns the process↔operation mapping
 * and the event switch; it talks back to OperationService through a
 * narrow set of bridge callbacks.
 *
 * Implements `Disposable` so `Container.dispose()` can unsubscribe
 * cleanly during shutdown.
 */

import type { Disposable } from '$lib/core/container';
import type { Result } from '$lib/core/result';
import type { CLISessionManagerPort, CLIProcessEvent } from '$lib/ports/outbound/CLISessionManagerPort';
import type { CLIProviderPort } from '$lib/ports/outbound/CLIProviderPort';
import type { ResultParserPort } from '$lib/ports/outbound/ResultParserPort';
import type { Operation } from '$lib/domain/entities/Operation';
import {
  completeOperation,
  failOperation,
  cancelOperation,
  updateOperationProgress,
} from '$lib/domain/entities/Operation';
import type { OperationId } from '$lib/domain/values/OperationId';
import type { OperationOutput, OperationResult } from '$lib/domain/values/OperationResult';
import { ok } from '$lib/core/result';
import type { OperationArchiver } from './OperationArchiver';
import type { OperationTemplateRegistry } from './OperationTemplateRegistry';

export interface CLIProcessEventRouterDeps {
  cliManager: CLISessionManagerPort;
  provider: CLIProviderPort;
  resultParser: ResultParserPort;
  archiver: OperationArchiver;
  templateRegistry: OperationTemplateRegistry;
  /** Read the current operation for an id; returns null if unknown. */
  getOperation: (id: OperationId) => Operation | null;
  /** Replace the operation in the host's store. */
  updateOperation: (id: OperationId, op: Operation) => void;
  /** Push a state-change notification to host subscribers. */
  notify: () => void;
  /** Wake the queue so the next pending operation can start. */
  resumeQueue: () => void;
  /** Persist the operation to disk (best-effort; failures are logged). */
  persistOperation: (op: Operation) => Promise<void>;
  /** Apply an operation's result through the host's normal apply path. */
  applyResult: (id: OperationId) => Promise<Result<void, Error>>;
}

export class CLIProcessEventRouter implements Disposable {
  private readonly cliManager: CLISessionManagerPort;
  private readonly provider: CLIProviderPort;
  private readonly resultParser: ResultParserPort;
  private readonly archiver: OperationArchiver;
  private readonly templateRegistry: OperationTemplateRegistry;
  private readonly getOperation: CLIProcessEventRouterDeps['getOperation'];
  private readonly updateOperation: CLIProcessEventRouterDeps['updateOperation'];
  private readonly notify: () => void;
  private readonly resumeQueue: () => void;
  private readonly persistOperation: (op: Operation) => Promise<void>;
  private readonly applyResultFn: CLIProcessEventRouterDeps['applyResult'];

  /** Process-id → operation-id binding for active CLI invocations. */
  private readonly processToOperation: Map<string, OperationId> = new Map();
  private cliUnsubscribe: (() => void) | null = null;

  constructor(deps: CLIProcessEventRouterDeps) {
    this.cliManager = deps.cliManager;
    this.provider = deps.provider;
    this.resultParser = deps.resultParser;
    this.archiver = deps.archiver;
    this.templateRegistry = deps.templateRegistry;
    this.getOperation = deps.getOperation;
    this.updateOperation = deps.updateOperation;
    this.notify = deps.notify;
    this.resumeQueue = deps.resumeQueue;
    this.persistOperation = deps.persistOperation;
    this.applyResultFn = deps.applyResult;

    // Subscribe immediately. The host calls dispose() on shutdown.
    this.cliUnsubscribe = this.cliManager.subscribe((event) =>
      this.handleProcessEvent(event),
    );
  }

  /**
   * Bind a freshly-spawned CLI process to its operation. Called by
   * OperationService after `cliManager.spawn` returns a process id.
   */
  bindProcess(processId: string, operationId: OperationId): void {
    this.processToOperation.set(processId, operationId);
  }

  /**
   * Look up which CLI process is running an operation, if any. Used
   * by `OperationService.cancel` to kill the running process.
   */
  findProcessForOperation(operationId: OperationId): string | null {
    for (const [processId, opId] of this.processToOperation) {
      if (opId === operationId) return processId;
    }
    return null;
  }

  dispose(): void {
    if (this.cliUnsubscribe) {
      this.cliUnsubscribe();
      this.cliUnsubscribe = null;
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // Event switch — split per branch for readability
  // ─────────────────────────────────────────────────────────────────

  private handleProcessEvent(event: CLIProcessEvent): void {
    switch (event.type) {
      case 'started':
        this.handleStarted(event);
        break;
      case 'progress':
        this.handleProgress(event);
        break;
      case 'completed':
        this.handleCompleted(event);
        break;
      case 'failed':
        this.handleFailed(event);
        break;
      case 'cancelled':
        this.handleCancelled(event);
        break;
    }
  }

  private handleStarted(event: CLIProcessEvent & { type: 'started' }): void {
    const opId = this.processToOperation.get(event.processId);
    if (!opId) return;
    const op = this.getOperation(opId);
    if (!op) return;
    this.updateOperation(opId, updateOperationProgress(op, 10, 'Processing...'));
    this.notify();
  }

  private handleProgress(event: CLIProcessEvent & { type: 'progress' }): void {
    const opId = this.processToOperation.get(event.processId);
    if (!opId) return;
    const op = this.getOperation(opId);
    if (!op) return;
    this.updateOperation(opId, updateOperationProgress(op, 50, event.message));
    this.notify();
  }

  private handleCompleted(event: CLIProcessEvent & { type: 'completed' }): void {
    const opId = this.processToOperation.get(event.processId);
    if (!opId) return;
    const op = this.getOperation(opId);
    if (!op) return;

    // Determine output format — provider knows its own capabilities.
    const outputFormat = this.provider.supportsJsonOutput ? 'json' : 'text';
    const isJson = outputFormat === 'json' && event.stdout.startsWith('{');

    let parseResult: Result<OperationOutput[], Error>;
    if (isJson) {
      const parsed = this.provider.parseOutput(event.stdout, 'json');
      const outputs: OperationOutput[] = [];
      if (parsed.content) {
        outputs.push({ type: 'content', content: parsed.content });
      }
      if (parsed.sessionId) {
        outputs.push({ type: 'metadata', key: 'session_id', value: parsed.sessionId });
      }
      parseResult = ok(outputs);
    } else {
      parseResult = this.resultParser.parse(event.stdout, op.type);
    }

    const operationResult: OperationResult = {
      status: 'completed',
      outputs: parseResult.ok ? parseResult.value : [],
      rawResponse: event.stdout,
      durationMs: op.startedAt ? Date.now() - op.startedAt.getTime() : 0,
      metadata: {
        stderr: event.stderr,
        exitCode: event.exitCode,
        ...(event.sessionId ? { sessionId: event.sessionId } : {}),
      },
    };

    const completed = completeOperation(op, operationResult);
    this.updateOperation(opId, completed);
    this.processToOperation.delete(event.processId);
    this.notify();
    this.resumeQueue();
    this.persistOperation(completed);
    this.archiver.writeDigest(completed);
    this.archiver.pruneUndoFrames();

    // Auto-apply the result if the originating template asked for it.
    if (completed.templateId) {
      const template = this.templateRegistry.get(completed.templateId);
      if (template?.resultHandling.autoApply) {
        this.applyResultFn(opId);
      }
    }
  }

  private handleFailed(event: CLIProcessEvent & { type: 'failed' }): void {
    const opId = this.processToOperation.get(event.processId);
    if (!opId) return;
    const op = this.getOperation(opId);
    if (!op) return;

    const failed = failOperation(op, event.error);
    this.updateOperation(opId, failed);
    this.processToOperation.delete(event.processId);
    this.notify();
    this.resumeQueue();
    this.persistOperation(failed);
    this.archiver.writeDigest(failed);
  }

  private handleCancelled(event: CLIProcessEvent & { type: 'cancelled' }): void {
    const opId = this.processToOperation.get(event.processId);
    if (!opId) return;
    const op = this.getOperation(opId);
    if (!op) return;

    const cancelled = cancelOperation(op);
    this.updateOperation(opId, cancelled);
    this.processToOperation.delete(event.processId);
    this.notify();
    this.resumeQueue();
    this.persistOperation(cancelled);
    this.archiver.writeDigest(cancelled);
  }
}
