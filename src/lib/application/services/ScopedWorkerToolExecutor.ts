/**
 * ScopedWorkerToolExecutor - capability and resource gate for swarm workers.
 *
 * Worker agents default to read-only access. Drafter/patch workers can receive
 * explicit write scopes and target resources; every mutation still flows through
 * the normal tool executor, resource metadata, collaboration services, and locks.
 */

import type {
  AgentWorkerSpec,
  AgentWorkerTargetResource,
  AgentWorkerWriteScope,
} from '$lib/domain/entities/AgentRun';
import type { Tool } from '$lib/domain/entities/Tool';
import type { ToolInvocation } from '$lib/domain/entities/ToolInvocation';
import type { ToolId } from '$lib/domain/values/ToolId';
import { toolFailure, type ToolResult } from '$lib/domain/values/ToolResult';
import type {
  ToolExecutorPort,
  ToolHandler,
} from '$lib/ports/outbound/ToolExecutorPort';
import { getToolResourceMeta } from '$lib/tools/registry';

const DEFAULT_ALLOWED_WORKER_TOOLS = new Set<string>([
  'note:read',
  'note:list',
  'search:notes',
  'search:content',
  'fs:read',
  'fs:summarize',
  'content:summarize',
  'content:outline',
  'content:brainstorm',
  'intelligence:find-related',
  'intelligence:summarize-folder',
  'lineage:history',
  'lineage:why',
  'lineage:trace',
  'lineage:context',
  'commitment:source',
  'commitment:stale-check',
]);

const STAGED_DRAFT_TOOLS = new Set<string>([
  'note:create',
]);

const PROPOSED_PATCH_TOOLS = new Set<string>([
  'editor:apply-note-patch',
  'editor:insert-blocks',
  'editor:replace-block',
  'note:update',
]);

const DIRECT_SCOPED_TOOLS = new Set<string>([
  ...STAGED_DRAFT_TOOLS,
  ...PROPOSED_PATCH_TOOLS,
  'todo:create',
  'todo:update',
  'todo:toggle',
]);

const DESTRUCTIVE_OR_NAVIGATION_ACTIONS = /\b(delete|move|merge|duplicate|tag|format|goto|back|forward|home|branch|revert|repair)\b/i;

interface WorkerToolScope {
  writeScope?: AgentWorkerWriteScope;
  targetResources?: AgentWorkerTargetResource[];
}

export class ScopedWorkerToolExecutor implements ToolExecutorPort {
  constructor(private readonly delegate: ToolExecutorPort) {}

  isAllowed(toolId: ToolId | string, requestedAllowedTools?: string[], scope?: WorkerToolScope): boolean {
    const id = String(toolId);
    if (requestedAllowedTools && requestedAllowedTools.length > 0 && !requestedAllowedTools.includes(id)) {
      return false;
    }

    if (DEFAULT_ALLOWED_WORKER_TOOLS.has(id)) return true;

    const meta = getToolResourceMeta(id as ToolId);
    if (meta?.accessMode === 'read' && !DESTRUCTIVE_OR_NAVIGATION_ACTIONS.test(id)) {
      return true;
    }

    return this.isWriteToolAllowedForScope(id, scope?.writeScope ?? 'read_only');
  }

  filterTools(tools: Tool[], requestedAllowedTools?: string[], scope?: WorkerToolScope): Tool[] {
    return tools.filter((tool) => this.isAllowed(tool.id, requestedAllowedTools, scope));
  }

  registerHandler<TArgs = Record<string, unknown>, TResult = unknown>(
    toolId: ToolId,
    handler: ToolHandler<TArgs, TResult>
  ): void {
    this.delegate.registerHandler(toolId, handler);
  }

  unregisterHandler(toolId: ToolId): boolean {
    return this.delegate.unregisterHandler(toolId);
  }

  hasHandler(toolId: ToolId): boolean {
    return this.delegate.hasHandler(toolId);
  }

  async execute(invocation: ToolInvocation, scope?: AgentWorkerSpec): Promise<ToolResult> {
    const startedAt = invocation.startedAt ?? new Date();
    const allowed = this.isInvocationAllowed(invocation, scope);
    if (!allowed.ok) {
      return toolFailure(
        invocation.toolId,
        new Error(allowed.reason),
        startedAt
      );
    }

    return this.delegate.execute(invocation);
  }

  executeSequence(invocations: ToolInvocation[], continueOnError?: boolean, scope?: AgentWorkerSpec): Promise<ToolResult[]> {
    const run = async () => {
      const results: ToolResult[] = [];
      for (const invocation of invocations) {
        const result = await this.execute(invocation, scope);
        results.push(result);
        if (!continueOnError && result.status === 'failure') break;
      }
      return results;
    };
    return run();
  }

  executeParallel(invocations: ToolInvocation[], scope?: AgentWorkerSpec): Promise<ToolResult[]> {
    return Promise.all(invocations.map((invocation) => this.execute(invocation, scope)));
  }

  cancel(invocationId: string): boolean {
    return this.delegate.cancel(invocationId);
  }

  cancelAll(): void {
    this.delegate.cancelAll();
  }

  isExecuting(invocationId: string): boolean {
    return this.delegate.isExecuting(invocationId);
  }

  getExecutingIds(): string[] {
    return this.delegate.getExecutingIds();
  }

  private isInvocationAllowed(invocation: ToolInvocation, scope?: AgentWorkerSpec): { ok: true } | { ok: false; reason: string } {
    const id = String(invocation.toolId);
    if (!this.isAllowed(id, scope?.allowedTools, scope)) {
      return { ok: false, reason: `Worker scope ${scope?.writeScope ?? 'read_only'} cannot execute tool ${id}` };
    }

    const meta = getToolResourceMeta(invocation.toolId);
    if (!meta || meta.accessMode === 'read') return { ok: true };

    if (DESTRUCTIVE_OR_NAVIGATION_ACTIONS.test(id)) {
      return { ok: false, reason: `Worker agents cannot execute destructive or navigation tool ${id}` };
    }

    const resourceId = meta.resourceId(invocation.args);
    if (!resourceId) {
      return { ok: false, reason: `Worker write tool ${id} did not declare a target resource` };
    }

    if (!this.isTargetResourceAllowed(resourceId, meta.accessMode, scope?.targetResources ?? [])) {
      return {
        ok: false,
        reason: `Worker tool ${id} cannot access resource ${resourceId} outside its target scope`,
      };
    }

    return { ok: true };
  }

  private isWriteToolAllowedForScope(id: string, writeScope: AgentWorkerWriteScope): boolean {
    if (DESTRUCTIVE_OR_NAVIGATION_ACTIONS.test(id)) return false;

    switch (writeScope) {
      case 'read_only':
        return false;
      case 'staged_draft':
        return STAGED_DRAFT_TOOLS.has(id);
      case 'proposed_patch':
        return PROPOSED_PATCH_TOOLS.has(id);
      case 'direct_scoped':
        return DIRECT_SCOPED_TOOLS.has(id);
    }
  }

  private isTargetResourceAllowed(
    resourceId: string,
    accessMode: NonNullable<ReturnType<typeof getToolResourceMeta>>['accessMode'],
    targets: AgentWorkerTargetResource[]
  ): boolean {
    const normalizedResource = normalizeResourceId(resourceId);
    return targets.some((target) => {
      if (target.accessMode && target.accessMode !== accessMode) return false;
      const normalizedTarget = normalizeResourceId(target.id);
      if (normalizedTarget.endsWith('*')) {
        return normalizedResource.startsWith(normalizedTarget.slice(0, -1));
      }
      if (normalizedTarget.endsWith('/')) {
        return normalizedResource.startsWith(normalizedTarget);
      }
      return normalizedResource === normalizedTarget;
    });
  }
}

function normalizeResourceId(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+/g, '/').trim();
}
