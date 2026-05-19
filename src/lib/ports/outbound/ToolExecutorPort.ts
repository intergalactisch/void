/**
 * ToolExecutorPort - Outbound port for tool execution
 *
 * This port defines how tools are executed. The executor receives tool
 * invocations and emits results through the event system.
 *
 * Part of the Hexagonal Architecture outbound ports layer.
 */

import type { ToolInvocation } from '$lib/domain/entities/ToolInvocation';
import type { ToolResult } from '$lib/domain/values/ToolResult';
import type { ToolId } from '$lib/domain/values/ToolId';
import type { OperationContext } from '$lib/pipeline/types';
import type { ToolServices } from '$lib/ports/inbound/ToolServices';

/**
 * Tool execution handler function type.
 * Tools register handlers that perform the actual work.
 */
export type ToolHandler<TArgs = Record<string, unknown>, TResult = unknown> = (
  args: TArgs,
  context: ToolExecutionContext
) => Promise<TResult>;

/**
 * Context provided to tool handlers during execution.
 *
 * `services` is injected by the executor adapter, so handlers receive
 * the application's services explicitly rather than reaching for a
 * global resolver. Handlers can rely on it being present whenever the
 * adapter was constructed with a service provider.
 */
export interface ToolExecutionContext {
  /** The invocation being executed */
  invocation: ToolInvocation;

  /** Report progress (0-100) */
  reportProgress: (progress: number, message?: string) => void;

  /** Check if execution was cancelled */
  isCancelled: () => boolean;

  /** Signal that allows cancellation */
  signal: AbortSignal;

  /** Operation context for multi-step operations (parallel, step, buffer) */
  operationContext?: OperationContext;

  /** Application services available to the tool. Injected by the executor. */
  services: ToolServices;
}

/**
 * Outbound port for tool execution.
 *
 * Implemented by adapters that handle the actual execution of tools,
 * typically by emitting events through the event bus.
 */
export interface ToolExecutorPort {
  /**
   * Register a handler for a tool.
   * @param toolId - ID of the tool this handler executes
   * @param handler - Function that performs the tool's work
   */
  registerHandler<TArgs = Record<string, unknown>, TResult = unknown>(
    toolId: ToolId,
    handler: ToolHandler<TArgs, TResult>
  ): void;

  /**
   * Unregister a handler for a tool.
   * @param toolId - ID of the tool to unregister handler for
   * @returns True if handler was removed
   */
  unregisterHandler(toolId: ToolId): boolean;

  /**
   * Check if a handler is registered for a tool.
   * @param toolId - ID of the tool to check
   * @returns True if a handler exists
   */
  hasHandler(toolId: ToolId): boolean;

  /**
   * Execute a tool invocation.
   * @param invocation - The invocation to execute
   * @returns Result of the execution
   */
  execute(invocation: ToolInvocation): Promise<ToolResult>;

  /**
   * Execute multiple invocations in sequence.
   * Stops on first failure unless continueOnError is true.
   * @param invocations - Invocations to execute
   * @param continueOnError - Whether to continue after failures
   * @returns Array of results
   */
  executeSequence(
    invocations: ToolInvocation[],
    continueOnError?: boolean
  ): Promise<ToolResult[]>;

  /**
   * Execute multiple invocations in parallel.
   * @param invocations - Invocations to execute
   * @returns Array of results in same order as invocations
   */
  executeParallel(invocations: ToolInvocation[]): Promise<ToolResult[]>;

  /**
   * Cancel an executing invocation.
   * @param invocationId - ID of the invocation to cancel
   * @returns True if cancellation was signaled
   */
  cancel(invocationId: string): boolean;

  /**
   * Cancel all executing invocations.
   */
  cancelAll(): void;

  /**
   * Check if an invocation is currently executing.
   * @param invocationId - ID of the invocation to check
   * @returns True if executing
   */
  isExecuting(invocationId: string): boolean;

  /**
   * Get IDs of all currently executing invocations.
   * @returns Array of invocation IDs
   */
  getExecutingIds(): string[];
}
