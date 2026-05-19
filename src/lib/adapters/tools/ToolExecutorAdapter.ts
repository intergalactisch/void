/**
 * ToolExecutorAdapter - Implementation of ToolExecutorPort
 *
 * Manages tool handler registration and execution. Creates execution contexts
 * with AbortController for cancellation support. Emits events for execution
 * lifecycle (start, complete, fail, cancel).
 *
 * Part of the Hexagonal Architecture - implements the ToolExecutorPort interface.
 */

import type { ToolInvocation } from '$lib/domain/entities/ToolInvocation';
import type { ToolId } from '$lib/domain/values/ToolId';
import type { ToolResult } from '$lib/domain/values/ToolResult';
import {
  toolSuccess,
  toolFailure,
  toolCancelled,
} from '$lib/domain/values/ToolResult';
import type {
  ToolExecutorPort,
  ToolHandler,
  ToolExecutionContext,
} from '$lib/ports/outbound/ToolExecutorPort';
import type { ToolServices, ToolServicesProvider } from '$lib/ports/inbound/ToolServices';
import { events } from '$lib/events';
import { resourceLock } from '$lib/events/queue/ResourceLock';
import { getLogger } from '$lib/logging';
import type { OperationRunner } from '$lib/pipeline/OperationRunner';
import { AI_SOURCE } from '$lib/pipeline/types';
import { getToolResourceMeta } from '$lib/tools/registry';

const log = getLogger('ToolExecutor');

/**
 * Execution state tracked for each running invocation.
 */
interface ExecutionState {
  invocation: ToolInvocation;
  abortController: AbortController;
  startedAt: Date;
}

/**
 * Tool executor adapter implementing ToolExecutorPort.
 *
 * @example
 * ```typescript
 * const executor = new ToolExecutorAdapter();
 *
 * // Register a handler
 * executor.registerHandler(TOOL_IDS.NOTE_CREATE, async (args, context) => {
 *   if (context.isCancelled()) throw new Error('Cancelled');
 *   context.reportProgress(50, 'Creating note...');
 *   return { noteId: 'new-note-123' };
 * });
 *
 * // Execute
 * const result = await executor.execute(invocation);
 * ```
 */
export class ToolExecutorAdapter implements ToolExecutorPort {
  private readonly handlers: Map<ToolId, ToolHandler> = new Map();
  private readonly executing: Map<string, ExecutionState> = new Map();
  private readonly operationRunner: OperationRunner | undefined;
  private readonly servicesProvider: ToolServicesProvider | undefined;

  constructor(
    operationRunner?: OperationRunner,
    servicesProvider?: ToolServicesProvider
  ) {
    this.operationRunner = operationRunner;
    this.servicesProvider = servicesProvider;
  }

  registerHandler<TArgs = Record<string, unknown>, TResult = unknown>(
    toolId: ToolId,
    handler: ToolHandler<TArgs, TResult>
  ): void {
    // Store as generic handler (type safety is at registration site)
    this.handlers.set(toolId, handler as ToolHandler);
  }

  unregisterHandler(toolId: ToolId): boolean {
    return this.handlers.delete(toolId);
  }

  hasHandler(toolId: ToolId): boolean {
    return this.handlers.has(toolId);
  }

  async execute(invocation: ToolInvocation): Promise<ToolResult> {
    const handler = this.handlers.get(invocation.toolId);
    const startedAt = new Date();

    if (!handler) {
      return toolFailure(
        invocation.toolId,
        new Error(`No handler registered for tool: ${invocation.toolId}`),
        startedAt
      );
    }

    // Create abort controller for cancellation
    const abortController = new AbortController();

    // Resolve the application services bundle for this invocation.
    // We resolve lazily because some services are registered after the
    // ToolExecutorAdapter itself. When no provider is configured we fall
    // back to a Proxy that throws on access, so tests with bare handlers
    // continue to work and accidental production use surfaces loudly.
    const services: ToolServices = this.servicesProvider
      ? this.servicesProvider()
      : ToolExecutorAdapter.unconfiguredServices();

    // Create execution context
    const context: ToolExecutionContext = {
      invocation,
      reportProgress: (progress: number, message?: string) => {
        const payload: { invocationId: string; progress: number; message?: string } = {
          invocationId: invocation.id,
          progress,
        };
        if (message !== undefined) {
          payload.message = message;
        }
        events.emit('tool:progress', payload);
      },
      isCancelled: () => abortController.signal.aborted,
      signal: abortController.signal,
      services,
    };

    // Track executing state
    this.executing.set(invocation.id, {
      invocation,
      abortController,
      startedAt,
    });

    log.info('Executing tool', { invocationId: invocation.id, toolId: invocation.toolId, args: invocation.args });

    // Emit executing event
    events.emit('tool:executing', {
      invocationId: invocation.id,
      toolId: invocation.toolId,
    });

    try {
      // Execute handler — wrap in OperationRunner if available, and serialize
      // writes to the same declared resource across concurrent agent runs.
      let data: unknown;
      const executeHandler = async () => {
        if (this.operationRunner) {
          const opResult = await this.operationRunner.run(
            `Tool: ${invocation.toolId}`,
            { ...AI_SOURCE, signal: abortController.signal },
            async (ctx) => {
              context.operationContext = ctx;
              return handler(invocation.args, context);
            }
          );
          if (!opResult.ok) throw opResult.error;
          return opResult.value;
        }

        return handler(invocation.args, context);
      };

      const lockKey = this.lockKeyFor(invocation);
      data = lockKey
        ? await resourceLock.withLock(lockKey, executeHandler, {
            id: invocation.id,
            kind: 'tool',
            label: String(invocation.toolId),
            toolId: invocation.toolId,
            messageId: invocation.messageId,
          })
        : await executeHandler();

      // Check if cancelled during execution
      if (abortController.signal.aborted) {
        const result = toolCancelled(
          invocation.toolId,
          'Execution was cancelled',
          startedAt
        );
        events.emit('tool:cancelled', { invocationId: invocation.id });
        return result;
      }

      // Success
      const durationMs = Date.now() - startedAt.getTime();
      log.info('Tool completed', { invocationId: invocation.id, toolId: invocation.toolId, durationMs, data });
      const result = toolSuccess(invocation.toolId, data, startedAt);
      events.emit('tool:completed', {
        invocationId: invocation.id,
        result,
      });
      return result;
    } catch (error) {
      // Check if this was a cancellation
      if (abortController.signal.aborted) {
        const result = toolCancelled(
          invocation.toolId,
          error instanceof Error ? error.message : 'Execution was cancelled',
          startedAt
        );
        events.emit('tool:cancelled', { invocationId: invocation.id });
        return result;
      }

      // Failure
      const err = error instanceof Error ? error : new Error(String(error));
      log.error('Tool failed', { invocationId: invocation.id, toolId: invocation.toolId, error: err.message });
      const result = toolFailure(invocation.toolId, err, startedAt);
      events.emit('tool:failed', {
        invocationId: invocation.id,
        error: err,
      });
      return result;
    } finally {
      // Clean up execution state
      this.executing.delete(invocation.id);
    }
  }

  private lockKeyFor(invocation: ToolInvocation): string | null {
    const meta = getToolResourceMeta(invocation.toolId);
    if (!meta || meta.accessMode === 'read') return null;

    const resource = meta.resourceId(invocation.args);
    if (!resource) return null;

    return `tool:${resource}`;
  }

  async executeSequence(
    invocations: ToolInvocation[],
    continueOnError = false
  ): Promise<ToolResult[]> {
    const results: ToolResult[] = [];

    for (const invocation of invocations) {
      const result = await this.execute(invocation);
      results.push(result);

      // Stop on failure unless continueOnError is true
      if (!continueOnError && result.status === 'failure') {
        break;
      }
    }

    return results;
  }

  async executeParallel(invocations: ToolInvocation[]): Promise<ToolResult[]> {
    return Promise.all(invocations.map((inv) => this.execute(inv)));
  }

  cancel(invocationId: string): boolean {
    const state = this.executing.get(invocationId);
    if (!state) {
      return false;
    }

    state.abortController.abort();
    return true;
  }

  cancelAll(): void {
    for (const state of this.executing.values()) {
      state.abortController.abort();
    }
  }

  isExecuting(invocationId: string): boolean {
    return this.executing.has(invocationId);
  }

  getExecutingIds(): string[] {
    return Array.from(this.executing.keys());
  }

  /**
   * Build a ToolServices stand-in that throws if any service is read.
   * Used when no servicesProvider was configured — allows tests to drive
   * the adapter with bare handlers while still surfacing accidental
   * misconfiguration in production.
   */
  private static unconfiguredServices(): ToolServices {
    const handler: ProxyHandler<object> = {
      get(_target, prop) {
        throw new Error(
          `ToolExecutorAdapter has no services provider; cannot access services.${String(prop)}. ` +
            'Pass a ToolServicesProvider to the adapter constructor.'
        );
      },
    };
    return new Proxy({}, handler) as ToolServices;
  }

  // --- Testing utilities ---

  /**
   * Get the number of registered handlers (for testing assertions).
   */
  getHandlerCount(): number {
    return this.handlers.size;
  }

  /**
   * Get all registered tool IDs (for testing assertions).
   */
  getRegisteredToolIds(): ToolId[] {
    return Array.from(this.handlers.keys());
  }

  /**
   * Clear all handlers (for testing cleanup).
   */
  clearHandlers(): void {
    this.handlers.clear();
  }
}
