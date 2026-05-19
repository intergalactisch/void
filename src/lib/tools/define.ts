/**
 * defineTool() - Self-contained tool definition helper
 *
 * Each tool file uses defineTool() to export a single, complete tool definition
 * including its metadata, parameters, and execute function. No other files to touch.
 *
 * @example
 * ```typescript
 * // note/create.tool.ts
 * import { defineTool } from '../define';
 *
 * export default defineTool({
 *   id: 'note:create',
 *   name: 'Create Note',
 *   description: 'Create a new note',
 *   category: 'note',
 *   args: { title: { type: 'string', description: 'Note title' } },
 *   async execute(args, { services }) {
 *     return await services.notes.create(args);
 *   },
 * });
 * ```
 */

import { createTool, type Tool, type ParameterSchema, type ToolCategory } from '$lib/domain/entities/Tool';
import type { ToolId } from '$lib/domain/values/ToolId';
import type { ToolHandler, ToolExecutionContext } from '$lib/ports/outbound/ToolExecutorPort';
import type { ToolServices } from './context';
import type { OperationContext } from '$lib/pipeline/types';
import type { ToolInvocation } from '$lib/domain/entities/ToolInvocation';

/**
 * Context provided to tool execute functions.
 */
export interface ToolContext {
  /** Current durable tool invocation. Useful for lineage receipt IDs. */
  invocation: ToolInvocation;
  /** All app services */
  services: ToolServices;
  /** Report progress 0-100 with optional message */
  progress: (pct: number, msg?: string) => void;
  /** Check if execution was cancelled */
  isCancelled: () => boolean;
  /** AbortSignal for async cancellation */
  signal: AbortSignal;
  /** Operation context for multi-step operations (parallel, step, buffer) */
  ctx?: OperationContext | undefined;
}

/** Access mode for resource-aware parallelization */
export type AccessMode = 'read' | 'write' | 'create';

/**
 * What a tool author provides to defineTool().
 */
export interface ToolDefinition<TArgs = Record<string, unknown>, TResult = unknown> {
  /** Tool ID in 'namespace:action' format */
  id: string;
  /** Human-readable name */
  name: string;
  /** Description (shown to AI) */
  description: string;
  /** Category for organization */
  category: ToolCategory;
  /** Parameter definitions (optional - some tools have no args) */
  args?: Record<string, ParameterSchema>;
  /** Keywords for search/matching */
  keywords?: string[];
  /** Example usage phrases */
  examples?: string[];
  /** Whether tool requires user confirmation before executing */
  requiresConfirmation?: boolean;
  /** Estimated execution time in ms */
  estimatedDuration?: number;
  /**
   * Extract the resource identifier this tool operates on.
   * Returns null if the tool doesn't target a specific resource.
   * Used for automatic parallelization: different resources run in parallel,
   * same resource + write = sequential.
   */
  resourceId?: (args: TArgs) => string | null;
  /**
   * How this tool accesses its resource.
   * 'read' = safe to run in parallel with other reads
   * 'write' = must serialize with other writes to same resource
   * 'create' = creates a new resource (safe to parallelize)
   */
  accessMode?: AccessMode;
  /** The tool's execute function */
  execute: (args: TArgs, context: ToolContext) => Promise<TResult>;
  /** Human-readable summary of what happened, shown in chat after execution */
  summary?: (args: TArgs, result: TResult) => string;
}

/**
 * What defineTool() returns - ready for registration.
 */
/** Summary function type - takes raw args and result, returns readable string */
export type ToolSummaryFn = (args: Record<string, unknown>, result: unknown) => string;

/** Resource metadata for a tool, used for parallelization decisions */
export interface ToolResourceMeta {
  resourceId: (args: Record<string, unknown>) => string | null;
  accessMode: AccessMode;
}

export interface RegisteredTool {
  /** Tool ID */
  id: ToolId;
  /** Tool definition for the registry */
  tool: Tool;
  /** Tool handler for the executor */
  handler: ToolHandler;
  /** Human-readable summary function (optional) */
  summary?: ToolSummaryFn;
  /** Resource metadata for parallelization (optional) */
  resource?: ToolResourceMeta;
}

/**
 * Define a self-contained tool. One file per tool, everything included.
 *
 * Services come from `ToolExecutionContext.services`, injected by the
 * `ToolExecutorAdapter`. We do not maintain a global resolver — the
 * dependency is explicit at construction time.
 */
export function defineTool<TArgs = Record<string, unknown>, TResult = unknown>(
  def: ToolDefinition<TArgs, TResult>
): RegisteredTool {
  const id = def.id as ToolId;

  // Build params object conditionally to satisfy exactOptionalPropertyTypes
  const params: Parameters<typeof createTool>[0] = {
    id,
    name: def.name,
    description: def.description,
    category: def.category,
  };
  if (def.args !== undefined) params.parameters = def.args;
  if (def.requiresConfirmation !== undefined) params.requiresConfirmation = def.requiresConfirmation;
  if (def.keywords !== undefined) params.keywords = def.keywords;
  if (def.examples !== undefined) params.examples = def.examples;
  if (def.estimatedDuration !== undefined) params.estimatedDuration = def.estimatedDuration;

  const tool = createTool(params);

  const handler: ToolHandler = async (
    args: Record<string, unknown>,
    executionContext: ToolExecutionContext
  ) => {
    const context: ToolContext = {
      invocation: executionContext.invocation,
      services: executionContext.services,
      progress: executionContext.reportProgress,
      isCancelled: executionContext.isCancelled,
      signal: executionContext.signal,
      ctx: executionContext.operationContext,
    };
    return def.execute(args as TArgs, context);
  };

  const registered: RegisteredTool = { id, tool, handler };

  if (def.summary) {
    const summaryFn = def.summary;
    registered.summary = (args, result) => summaryFn(args as TArgs, result as TResult);
  }

  // Store resource metadata for parallelization
  if (def.resourceId || def.accessMode) {
    const resourceIdFn = def.resourceId;
    registered.resource = {
      resourceId: resourceIdFn
        ? (args) => resourceIdFn(args as TArgs)
        : () => null,
      accessMode: def.accessMode ?? 'read',
    };
  }

  return registered;
}
