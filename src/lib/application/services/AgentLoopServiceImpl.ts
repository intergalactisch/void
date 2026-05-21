/**
 * AgentLoopServiceImpl - Multi-turn agentic AI execution
 *
 * Implements the agentic loop: prompt AI -> execute tools -> feed results back.
 * Continues until the AI stops calling tools or max turns is reached.
 *
 * Uses OperationRunner for tracking, ToolExecutorPort for execution,
 * and resource metadata for smart parallelization.
 *
 * Part of the Hexagonal Architecture application layer.
 */

import type {
  AgentLoopService,
  AgentOptions,
  AgentResult,
  AgentState,
  AgentPlan,
} from '$lib/ports/inbound/AgentLoopService';
import type { AIAssistantService, PromptOptions } from '$lib/ports/inbound/AIAssistantService';
import type { ToolExecutorPort } from '$lib/ports/outbound/ToolExecutorPort';
import type { ToolInvocation } from '$lib/domain/entities/ToolInvocation';
import type { ToolCall, AIResponse } from '$lib/domain/values/AIResponse';
import { createInvocation, startInvocation, completeInvocation } from '$lib/domain/entities/ToolInvocation';
import { toolFailure } from '$lib/domain/values/ToolResult';
import type { ToolId } from '$lib/domain/values/ToolId';
import { OperationRunner } from '$lib/pipeline/OperationRunner';
import { AI_SOURCE } from '$lib/pipeline/types';
import { getToolResourceMeta } from '$lib/tools/registry';
import { getLogger } from '$lib/logging';

const log = getLogger('AgentLoop');

const DEFAULT_MAX_TURNS = 15;
const DEFAULT_MAX_CONCURRENCY = 5;
const AGENT_DENIED_TOOLS = new Set<string>(['note:delete']);

/**
 * Prefix marking an "ambient" resource — a shared, ambient mutable surface
 * such as the active editor, active note selection, or navigation state.
 * The scheduler treats any resource id with this prefix as a sequential
 * barrier: it can't be parallelised against other writes because the
 * concrete target isn't known at scheduling time (e.g. which note the
 * active editor currently displays).
 */
const AMBIENT_RESOURCE_PREFIX = '@ambient:';

function isAmbientResource(resource: string | null | undefined): boolean {
  return !!resource && resource.startsWith(AMBIENT_RESOURCE_PREFIX);
}

/** Initial idle state */
const IDLE_STATE: AgentState = {
  status: 'idle',
  currentTurn: 0,
  maxTurns: DEFAULT_MAX_TURNS,
  activeTools: [],
  completedTools: [],
};

/**
 * Group tool calls by resource for smart parallelization.
 * - Read-only tools: parallel
 * - Scoped creates/writes: parallel when they target different resources
 * - Unscoped creates/writes/navigation: sequential barriers
 */
interface ToolGroup {
  /** Tool calls that can run in parallel */
  parallel: ToolCall[];
  /** Write waves; each wave has at most one call per declared resource. */
  writeWaves: ToolCall[][];
}

function groupToolCalls(toolCalls: ToolCall[]): ToolGroup {
  const parallel: ToolCall[] = [];
  const writeWaves: ToolCall[][] = [];
  let currentWriteWave: ToolCall[] = [];
  let currentWriteResources = new Set<string>();

  const flushWriteWave = () => {
    if (currentWriteWave.length === 0) return;
    writeWaves.push(currentWriteWave);
    currentWriteWave = [];
    currentWriteResources = new Set();
  };

  for (const tc of toolCalls) {
    const meta = getToolResourceMeta(tc.toolId);

    if (!meta) {
      // No resource metadata — default to parallel (safe assumption for reads)
      parallel.push(tc);
      continue;
    }

    if (meta.accessMode === 'read') {
      // Reads are safe to parallelize.
      parallel.push(tc);
    } else {
      const resource = meta.resourceId(tc.args);
      if (!resource || isAmbientResource(resource)) {
        // Unscoped or ambient-scoped mutations are barriers because the loop
        // cannot prove whether they touch the active editor, navigation, or a
        // generated path. Ambient resources (prefixed with '@ambient:') name a
        // shared mutable surface whose concrete target isn't known here.
        flushWriteWave();
        writeWaves.push([tc]);
        continue;
      }

      if (currentWriteResources.has(resource)) {
        flushWriteWave();
      }

      currentWriteWave.push(tc);
      currentWriteResources.add(resource);
    }
  }
  flushWriteWave();

  return { parallel, writeWaves };
}

export class AgentLoopServiceImpl implements AgentLoopService {
  private readonly aiService: AIAssistantService;
  private readonly toolExecutor: ToolExecutorPort;
  private readonly operationRunner: OperationRunner;

  private state: AgentState = { ...IDLE_STATE };
  private subscribers = new Set<(state: AgentState) => void>();
  private readonly activeAbortControllers = new Set<AbortController>();

  constructor(
    aiService: AIAssistantService,
    toolExecutor: ToolExecutorPort,
    operationRunner: OperationRunner
  ) {
    this.aiService = aiService;
    this.toolExecutor = toolExecutor;
    this.operationRunner = operationRunner;
  }

  async run(prompt: string, options?: AgentOptions): Promise<AgentResult> {
    const maxTurns = options?.maxTurns ?? DEFAULT_MAX_TURNS;
    const maxConcurrency = options?.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY;

    const abortController = new AbortController();
    this.activeAbortControllers.add(abortController);
    const abortFromCaller = () => abortController.abort();
    options?.signal?.addEventListener('abort', abortFromCaller, { once: true });
    if (options?.signal?.aborted) abortController.abort();
    const allToolInvocations: ToolInvocation[] = [];
    let conversationId = options?.conversationId;
    let finalResponse = '';
    let cancelled = false;
    let loopError: Error | undefined;

    this.updateState({
      status: 'executing',
      currentTurn: 0,
      maxTurns,
      activeTools: [],
      completedTools: [],
    });

    log.info('Agent loop started', { maxTurns, maxConcurrency, hasConversation: !!conversationId });

    // Wrap entire loop in OperationRunner for tracking
    const opResult = await this.operationRunner.run(
      'Agent Loop',
      { ...AI_SOURCE, signal: abortController.signal },
      async (ctx) => {
        let turn = 0;
        let currentPrompt = prompt;

        while (turn < maxTurns) {
          // Check cancellation
          if (ctx.isCancelled) {
            cancelled = true;
            break;
          }

          turn++;
          this.updateState({ currentTurn: turn });

          ctx.progress(`Turn ${turn}/${maxTurns}`);
          log.info('Agent turn', { turn, promptLength: currentPrompt.length });

          // Call AI
          const promptOptions: PromptOptions = {
            autoExecuteTools: false, // We handle tool execution ourselves
          };
          if (conversationId) promptOptions.conversationId = conversationId;
          if (options?.webAccess !== undefined) promptOptions.webAccess = options.webAccess;
          if (options?.hideInternalMessages) {
            promptOptions.persistAssistantMessage = false;
            promptOptions.displayMessage =
              turn === 1
                ? options.displayMessage === undefined
                  ? prompt
                  : options.displayMessage
                : null;
          }

          const result = await ctx.step(`AI Turn ${turn}`, async () => {
            return this.aiService.prompt(currentPrompt, promptOptions);
          });

          if (!result.ok) {
            log.error('AI prompt failed', { turn, error: result.error.message });
            throw result.error;
          }

          const response = result.value;
          conversationId = conversationId ?? this.aiService.getCurrentConversation()?.id ?? undefined;
          finalResponse = response.chat;

          // If no tool calls, we're done
          if (response.toolCalls.length === 0 || response.stopReason !== 'tool_use') {
            log.info('Agent loop complete — no more tool calls', { turn, stopReason: response.stopReason });
            break;
          }

          // Check if plan approval is needed (3+ write targets)
          if (options?.onPlanReady) {
            const writeTargets = this.countWriteTargets(response.toolCalls);
            if (writeTargets >= 3) {
              const plan = this.extractPlanFromResponse(response);
              this.updateState({ status: 'waiting_approval', plan });

              const approved = await options.onPlanReady(plan);
              if (!approved) {
                log.info('Plan rejected by user');
                cancelled = true;
                break;
              }
            }
          }

          this.updateState({ status: 'executing' });

          // Execute tools with smart parallelization
          const invocations = await this.executeToolCalls(
            response.toolCalls,
            maxConcurrency,
            ctx,
            options
          );

          allToolInvocations.push(...invocations);
          this.updateState({
            completedTools: [...allToolInvocations],
            activeTools: [],
          });

          // Build tool results message for next turn
          currentPrompt = this.buildToolResultsMessage(invocations, prompt);

          log.info('Tools executed', {
            turn,
            toolCount: invocations.length,
            succeeded: invocations.filter(i => i.status === 'completed').length,
            failed: invocations.filter(i => i.status === 'failed').length,
          });
        }

        if (turn >= maxTurns) {
          log.warn('Agent loop reached max turns', { maxTurns });
        }

        return { turn };
      }
    );

    if (!opResult.ok) {
      loopError = opResult.error;
    }

    const turns = opResult.ok ? opResult.value.turn : 0;

    const finalStatus = cancelled ? 'cancelled' : (opResult.ok ? 'completed' : 'failed');
    this.activeAbortControllers.delete(abortController);
    options?.signal?.removeEventListener('abort', abortFromCaller);
    this.updateState({
      status: this.activeAbortControllers.size > 0 ? 'executing' : finalStatus,
      activeTools: [],
    });

    const agentResult: AgentResult = {
      turns,
      finalResponse,
      toolInvocations: allToolInvocations,
      conversationId: conversationId ?? '',
      cancelled,
      ...(loopError ? { error: loopError } : {}),
    };

    log.info('Agent loop finished', {
      turns,
      totalTools: allToolInvocations.length,
      cancelled,
      status: opResult.ok ? 'ok' : 'error',
    });

    return agentResult;
  }

  cancel(): void {
    if (this.activeAbortControllers.size > 0) {
      for (const abortController of this.activeAbortControllers) {
        abortController.abort();
      }
      this.updateState({ status: 'cancelled' });
    }
  }

  getState(): AgentState {
    return { ...this.state };
  }

  subscribe(callback: (state: AgentState) => void): () => void {
    this.subscribers.add(callback);
    callback(this.getState());
    return () => this.subscribers.delete(callback);
  }

  // =========================================================================
  // Private methods
  // =========================================================================

  /**
   * Execute tool calls with resource-aware parallelization.
   */
  private async executeToolCalls(
    toolCalls: ToolCall[],
    maxConcurrency: number,
    ctx: { isCancelled: boolean },
    options?: AgentOptions
  ): Promise<ToolInvocation[]> {
    const { parallel, writeWaves } = groupToolCalls(toolCalls);
    const allInvocations: ToolInvocation[] = [];

    // Execute parallel tools first (respecting concurrency limit)
    if (parallel.length > 0) {
      const invocations = parallel.map(tc =>
        createInvocation({ toolId: tc.toolId, args: tc.args, messageId: tc.id, confirmed: true })
      );
      allInvocations.push(...await this.executeInvocationBatch(invocations, maxConcurrency, ctx, options));
    }

    // Execute write waves. Within a wave, resources are distinct; same-resource
    // writes and unscoped mutations are separated by groupToolCalls().
    for (const wave of writeWaves) {
      if (ctx.isCancelled) break;
      const invocations = wave.map(tc =>
        createInvocation({ toolId: tc.toolId, args: tc.args, messageId: tc.id, confirmed: true })
      );
      allInvocations.push(...await this.executeInvocationBatch(invocations, maxConcurrency, ctx, options));
    }

    return allInvocations;
  }

  /**
   * Count how many distinct resources the tool calls would write to.
   */
  private countWriteTargets(toolCalls: ToolCall[]): number {
    const writeTargets = new Set<string>();

    for (const tc of toolCalls) {
      const meta = getToolResourceMeta(tc.toolId);
      if (meta && meta.accessMode === 'write') {
        const resource = meta.resourceId(tc.args);
        if (resource) writeTargets.add(resource);
      }
    }

    return writeTargets.size;
  }

  /**
   * Extract a plan from the AI response for user approval.
   */
  private extractPlanFromResponse(response: AIResponse): AgentPlan {
    const steps = response.toolCalls.map(tc => ({
      description: `${tc.toolId} with ${JSON.stringify(tc.args).slice(0, 100)}`,
      tools: [tc.toolId],
    }));

    return {
      summary: response.chat.slice(0, 200),
      steps,
    };
  }

  /**
   * Build a message containing tool results to feed back to the AI.
   * Follows Claude's tool_result format for conversation continuity.
   */
  private async executeInvocationBatch(
    invocations: ToolInvocation[],
    maxConcurrency: number,
    ctx: { isCancelled: boolean },
    options?: AgentOptions,
  ): Promise<ToolInvocation[]> {
    const completedInvocations: ToolInvocation[] = [];

    this.updateState({ activeTools: invocations });

    for (let i = 0; i < invocations.length; i += maxConcurrency) {
      if (ctx.isCancelled) break;
      const chunk = invocations.slice(i, i + maxConcurrency);
      const started = chunk.map(inv => startInvocation(inv));
      const results = await this.executeParallelWithPolicy(started);

      for (let j = 0; j < started.length; j++) {
        const completed = completeInvocation(started[j]!, results[j]!);
        completedInvocations.push(completed);
        await options?.onToolCompleted?.(completed);
      }
    }

    return completedInvocations;
  }

  private async executeParallelWithPolicy(invocations: ToolInvocation[]) {
    const results = await Promise.all(invocations.map((invocation) => {
      if (this.isToolDeniedForAgent(invocation.toolId)) {
        return Promise.resolve(toolFailure(
          invocation.toolId,
          new Error(`Tool ${invocation.toolId} is not allowed inside autonomous agent runs`),
          invocation.startedAt ?? new Date()
        ));
      }
      return this.toolExecutor.execute(invocation);
    }));
    return results;
  }

  private isToolDeniedForAgent(toolId: ToolId): boolean {
    return AGENT_DENIED_TOOLS.has(toolId);
  }

  private buildToolResultsMessage(invocations: ToolInvocation[], originalPrompt: string): string {
    const parts: string[] = [];

    for (const inv of invocations) {
      const toolResult = inv.result;
      let status: string;
      let data: string;

      if (!toolResult) {
        status = 'error';
        data = 'No result';
      } else if (toolResult.status === 'success' || toolResult.status === 'partial') {
        status = 'success';
        data = JSON.stringify(toolResult.data);
      } else if (toolResult.status === 'failure') {
        status = 'error';
        data = toolResult.error.message;
      } else {
        status = 'cancelled';
        data = toolResult.reason;
      }

      parts.push(`[Tool: ${inv.toolId}] (${status})\n${data}`);
    }

    return [
      'Continue the same approved agent run.',
      `Original task: ${originalPrompt}`,
      '',
      'Use the tool results below to decide the next step. Do not restart the task, and do not ask the user for next steps unless a blocking approval or error is present.',
      '',
      'Tool execution results:',
      '',
      parts.join('\n\n'),
    ].join('\n');
  }

  private updateState(partial: Partial<AgentState>): void {
    this.state = { ...this.state, ...partial };
    const snapshot = this.getState();
    for (const cb of this.subscribers) {
      try {
        cb(snapshot);
      } catch {
        // Ignore subscriber errors
      }
    }
  }
}
