/**
 * ToolInvocationService — owns tool-call execution lifecycle.
 *
 * Extracted from AIAssistantServiceImpl. The AI assistant produces
 * tool calls; this service turns each one into a domain ToolInvocation,
 * decides whether confirmation is required, executes confirmed
 * invocations through ToolExecutorPort, and tracks pending ones until
 * the user confirms or rejects.
 *
 * Side-effects that touch host state (attaching invocations to the
 * conversation message, refreshing the assistant's `executingTools`
 * UI list) flow through three callbacks the host registers at
 * construction time. The service therefore has no direct dependency
 * on Conversation, ConversationStore, or AIInteractionState — it
 * decides what should change; the host applies it.
 *
 * Mirrors the callback-bridge pattern established by ConversationStore
 * (round 1) and the operations toast bridge.
 */

import type { ToolRegistryService } from '$lib/ports/inbound/ToolRegistryService';
import type { ToolExecutorPort } from '$lib/ports/outbound/ToolExecutorPort';
import type { AIResponse } from '$lib/domain/values/AIResponse';
import type { ToolInvocation } from '$lib/domain/entities/ToolInvocation';
import {
  createInvocation,
  startInvocation,
  completeInvocation,
  updateProgress,
  confirmInvocation,
  cancelInvocation,
} from '$lib/domain/entities/ToolInvocation';
import { events } from '$lib/events';
import { getLogger } from '$lib/logging';

const log = getLogger('ToolInvocation');

export interface ToolInvocationServiceDeps {
  toolRegistry: ToolRegistryService;
  toolExecutor: ToolExecutorPort;
  /**
   * Attach a freshly-created invocation onto an assistant message in the
   * host's conversation store. Called once per tool call when there is
   * a target message id.
   */
  attachInvocation: (
    conversationId: string,
    messageId: string,
    invocation: ToolInvocation,
  ) => void;
  /**
   * Replace an in-flight invocation on its assistant message with the
   * completed result. Called immediately after auto-confirmed
   * invocations finish executing.
   */
  updateInvocation: (
    conversationId: string,
    messageId: string,
    invocation: ToolInvocation,
  ) => void;
  /**
   * Push the latest "currently executing" list to the host so the UI
   * can render spinners. Empty array means nothing is executing.
   */
  setExecutingTools: (executing: ToolInvocation[]) => void;
}

export class ToolInvocationService {
  private readonly toolRegistry: ToolRegistryService;
  private readonly toolExecutor: ToolExecutorPort;
  private readonly attachInvocation: ToolInvocationServiceDeps['attachInvocation'];
  private readonly updateInvocation: ToolInvocationServiceDeps['updateInvocation'];
  private readonly setExecutingTools: ToolInvocationServiceDeps['setExecutingTools'];

  /**
   * Invocations that need user confirmation before they run. The host
   * surfaces these via `aiStore.pendingConfirmations`; the service
   * drains them when `confirmToolExecution` / `rejectToolExecution`
   * is called.
   */
  private readonly pendingInvocations: Map<string, ToolInvocation> = new Map();

  /** Mirrors AIInteractionState.executingTools so the service can push deltas. */
  private executing: ToolInvocation[] = [];
  private readonly invocationTargets: Map<string, { conversationId: string; messageId: string }> = new Map();
  private readonly progressHandler: (payload: { invocationId: string; progress: number; message?: string }) => void;

  constructor(deps: ToolInvocationServiceDeps) {
    this.toolRegistry = deps.toolRegistry;
    this.toolExecutor = deps.toolExecutor;
    this.attachInvocation = deps.attachInvocation;
    this.updateInvocation = deps.updateInvocation;
    this.setExecutingTools = deps.setExecutingTools;
    this.progressHandler = (payload) => this.handleProgress(payload);
    events.on('tool:progress', this.progressHandler);
  }

  dispose(): void {
    events.off('tool:progress', this.progressHandler);
    this.pendingInvocations.clear();
    this.invocationTargets.clear();
    this.executing = [];
  }

  /**
   * Turn a list of AI tool calls into invocations. Auto-confirmed ones
   * execute immediately; the rest land in `pendingInvocations` until
   * the user calls `confirmToolExecution` or `rejectToolExecution`.
   *
   * @param toolCalls          AI response tool calls
   * @param conversationId     Target conversation id (used by the
   *                           attach/update callbacks)
   * @param lastAssistantMessageId  The id of the assistant message to
   *                           pin invocations onto, or `null` if no
   *                           assistant message exists yet
   */
  async executeToolCalls(
    toolCalls: AIResponse['toolCalls'],
    conversationId: string,
    lastAssistantMessageId: string | null,
  ): Promise<ToolInvocation[]> {
    const invocations: ToolInvocation[] = [];

    for (const toolCall of toolCalls) {
      const tool = await this.toolRegistry.get(toolCall.toolId);
      const needsConfirmation = tool?.requiresConfirmation ?? false;

      let invocation = createInvocation({
        toolId: toolCall.toolId,
        args: toolCall.args,
        messageId: toolCall.id,
        confirmed: !needsConfirmation,
      });

      invocations.push(invocation);

      if (lastAssistantMessageId) {
        this.invocationTargets.set(invocation.id, {
          conversationId,
          messageId: lastAssistantMessageId,
        });
        this.attachInvocation(conversationId, lastAssistantMessageId, invocation);
      }

      if (needsConfirmation) {
        this.pendingInvocations.set(invocation.id, invocation);
        events.emit('tool:pending_confirmation', {
          invocationId: invocation.id,
          toolId: toolCall.toolId,
        });
        continue;
      }

      invocation = await this.executeInvocation(invocation);
      invocations[invocations.length - 1] = invocation;

      if (lastAssistantMessageId) {
        this.updateInvocation(conversationId, lastAssistantMessageId, invocation);
      }
    }

    // Refresh the host's executing list so spinners clear once
    // auto-confirmed invocations have all completed.
    this.executing = invocations.filter((inv) => inv.status === 'executing');
    this.setExecutingTools(this.executing);

    return invocations;
  }

  /**
   * The user approved a previously-pending invocation. Promote it from
   * pending to executing. Throws if the id isn't pending — that means
   * the UI got out of sync with the service, which is a bug.
   */
  async confirmToolExecution(invocationId: string): Promise<void> {
    const invocation = this.pendingInvocations.get(invocationId);
    if (!invocation) {
      throw new Error(`Invocation ${invocationId} not found or not pending`);
    }

    const confirmed = confirmInvocation(invocation);
    this.pendingInvocations.delete(invocationId);

    await this.executeInvocation(confirmed);
  }

  /**
   * The user rejected a previously-pending invocation. Mark it
   * cancelled and emit a tool:rejected event so listeners (chat UI,
   * provenance) can render the rejection reason.
   */
  async rejectToolExecution(invocationId: string, reason: string): Promise<void> {
    const invocation = this.pendingInvocations.get(invocationId);
    if (!invocation) {
      throw new Error(`Invocation ${invocationId} not found or not pending`);
    }

    const cancelled = cancelInvocation(invocation, reason);
    this.pendingInvocations.delete(invocationId);
    this.updateAttachedInvocation(cancelled);

    events.emit('tool:rejected', {
      invocationId,
      reason,
    });
  }

  // ─────────────────────────────────────────────────────────────────
  // Internal — single-invocation runner
  // ─────────────────────────────────────────────────────────────────

  /**
   * Execute one invocation through the executor port. Updates the
   * host's executing list at start (push) and end (filter out by id).
   */
  private async executeInvocation(invocation: ToolInvocation): Promise<ToolInvocation> {
    log.info('Tool execution started', {
      invocationId: invocation.id,
      toolId: invocation.toolId,
      args: invocation.args,
    });

    const startedAt = Date.now();
    const started = startInvocation(invocation);

    this.executing = [...this.executing, started];
    this.setExecutingTools(this.executing);
    this.updateAttachedInvocation(started);

    const result = await this.toolExecutor.execute(started);

    const completed = completeInvocation(started, result);

    this.executing = this.executing.filter((inv) => inv.id !== completed.id);
    this.setExecutingTools(this.executing);
    this.updateAttachedInvocation(completed);

    log.info('Tool execution completed', {
      invocationId: completed.id,
      toolId: completed.toolId,
      status: result.status,
      data: 'data' in result ? result.data : undefined,
      durationMs: Date.now() - startedAt,
    });

    events.emit('tool:executed', {
      invocationId: completed.id,
      result,
    });

    return completed;
  }

  private handleProgress(payload: {
    invocationId: string;
    progress: number;
    message?: string;
  }): void {
    const current = this.executing.find((inv) => inv.id === payload.invocationId);
    if (!current || current.status !== 'executing') return;

    const updated = updateProgress(current, payload.progress, payload.message);
    this.executing = this.executing.map((inv) =>
      inv.id === updated.id ? updated : inv
    );
    this.setExecutingTools(this.executing);
    this.updateAttachedInvocation(updated);
  }

  private updateAttachedInvocation(invocation: ToolInvocation): void {
    const target = this.invocationTargets.get(invocation.id);
    if (!target) return;

    this.updateInvocation(target.conversationId, target.messageId, invocation);

    if (
      invocation.status === 'completed' ||
      invocation.status === 'failed' ||
      invocation.status === 'cancelled'
    ) {
      this.invocationTargets.delete(invocation.id);
    }
  }
}
