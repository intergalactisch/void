/**
 * Command Center Store - Primary adapter view state
 *
 * This store does not execute AI work. It composes the existing AI,
 * operation, and run state into one UI-facing command center model.
 */

import { isActiveAgentRun } from '$lib/domain/entities/AgentRun';
import type { AgentRun, AgentTask, AgentWorker } from '$lib/domain/entities/AgentRun';
import type { Message } from '$lib/domain/entities/Message';
import type { Operation } from '$lib/domain/entities/Operation';
import type { OperationId } from '$lib/domain/values/OperationId';
import { classifyDurableAgentPrompt } from '$lib/domain/values/AgentPromptIntent';
import type { DurableAgentPromptMode } from '$lib/domain/values/AgentPromptIntent';
import { events, resourceLock, type ResourceLockSnapshot } from '$lib/events';
import { aiStore } from './ai.svelte';
import { operationsStore } from './operations.svelte';

const OPEN_TASK_STATUSES: ReadonlySet<AgentTask['status']> = new Set(['pending', 'running', 'blocked']);

function taskOrderKey(task: AgentTask): string {
  return task.startedAt ?? task.createdAt;
}

/** How much of the agent's activity the narrative stream shows. */
export type CommandStreamDensity = 'firehose' | 'milestones';
export type PendingUserTurnStatus = 'routing' | 'submitted' | 'failed';
export type CommandPanelSide = 'history' | 'inspector';

export interface RunHistoryGroup {
  label: string;
  runs: AgentRun[];
}

export interface PendingUserTurn {
  id: string;
  text: string;
  conversationId: string | null;
  createdAt: Date;
  status: PendingUserTurnStatus;
  matchedMessageId: string | null;
  error?: string;
}

export interface RetryableSwarmRun {
  kind: 'chat_retry' | 'placeholder_repair';
  conversationId: string;
  sourceMessageId: string;
  assistantMessageId: string | null;
  runId?: string;
  prompt: string;
  suggestedMode: DurableAgentPromptMode;
  rationale: string;
}

export interface VisibleConversationId {
  id: string;
  source: 'conversation' | 'run';
}

export type CommandAgentTarget =
  | { kind: 'worker'; runId: string; workerId: string }
  | { kind: 'orchestrator'; runId: string };

export interface SelectedWorkerDetail {
  run: AgentRun;
  worker: AgentWorker;
}

export type CollaborationSurfaceKind = 'note' | 'todo' | 'tool' | 'system';
export type CollaborationPressure = 'active' | 'queued' | 'contended';

export interface CollaborationSurface {
  id: string;
  kind: CollaborationSurfaceKind;
  title: string;
  activeLanes: number;
  queuedWrites: number;
  laneCount: number;
  laneKinds: string[];
  holders: string[];
  waiters: string[];
  runIds: string[];
  resourceIds: string[];
  pressure: CollaborationPressure;
}

export interface CollaborationHotspot {
  id: string;
  kind: CollaborationSurfaceKind;
  title: string;
  incidentCount: number;
  maxQueuedWrites: number;
  maxActiveLanes: number;
  laneKinds: string[];
  runIds: string[];
  lastOwners: string[];
  lastPressure: CollaborationPressure;
  lastSeenAt: string;
  currentlyActive: boolean;
}

const FALLBACK_MATCH_WINDOW_MS = 60_000;
const MAX_COLLABORATION_HOTSPOTS = 12;

class CommandCenterStore {
  selectedRunId = $state<string | null>(null);
  selectedAgentTarget = $state<CommandAgentTarget | null>(null);
  selectedResultOperationId = $state<OperationId | null>(null);
  pendingUserTurns = $state<PendingUserTurn[]>([]);
  collapsedRunIds = $state<string[]>([]);
  deletedConversationIds = $state<string[]>([]);
  historyCollapsed = $state(false);
  inspectorCollapsed = $state(false);
  resourceLocks = $state<ResourceLockSnapshot[]>(resourceLock.snapshot());
  collaborationTelemetry = $state<CollaborationHotspot[]>([]);
  /**
   * Whether to show the active conversation's transcript + composer in the
   * conversation pane. Toggled false by the "close conversation detail"
   * affordance, restored true whenever the user picks or starts a thread.
   * Purely a UI-level concern — does not touch the underlying conversation.
   */
  conversationDetailVisible = $state(true);
  /**
   * Narrative-stream verbosity for the center column. `firehose` shows every
   * tool call / progress tick / trace; `milestones` folds low-signal entries
   * into collapsible "N steps" groups. Global default, persisted in-memory.
   */
  streamDensity = $state<CommandStreamDensity>('firehose');
  /** Whether the action-templates popover is open (replaces the old tab). */
  templatesOpen = $state(false);
  /** Last known per-surface pressure, used to count contention episodes. */
  #lastSurfacePressure = new Map<string, CollaborationPressure>();

  constructor() {
    events.on('resource-lock:changed', ({ resources }) => {
      this.resourceLocks = resources;
      this.recordCollaborationTelemetry(resources);
    });
  }

  get currentConversationId(): string | null {
    return aiStore.currentConversation?.id ?? null;
  }

  get runs(): AgentRun[] {
    const conversationId = this.currentConversationId;
    if (!conversationId) {
      return [];
    }
    return aiStore.agentRunState.runs.filter((run) => {
      if (this.isDeletedConversation(run.conversationId)) return false;
      return run.conversationId === conversationId;
    });
  }

  get activeRun(): AgentRun | null {
    const conversationId = this.currentConversationId;
    const current = aiStore.agentRunState.currentRun;
    if (!conversationId) {
      if (current && isActiveAgentRun(current) && !this.isDeletedConversation(current.conversationId)) {
        return current;
      }
      return aiStore.agentRunState.runs.find((run) =>
        isActiveAgentRun(run) && !this.isDeletedConversation(run.conversationId)
      ) ?? null;
    }
    if (
      current &&
      isActiveAgentRun(current) &&
      !this.isDeletedConversation(current.conversationId) &&
      current.conversationId === conversationId
    ) {
      return current;
    }
    return this.runs.find((run) => isActiveAgentRun(run)) ?? this.globalActiveRuns[0] ?? null;
  }

  get activeRuns(): AgentRun[] {
    return this.globalActiveRuns;
  }

  get globalActiveRuns(): AgentRun[] {
    const byId = new Map<string, AgentRun>();
    const consider = (run: AgentRun | null | undefined) => {
      if (!run || !isActiveAgentRun(run) || this.isDeletedConversation(run.conversationId)) return;
      byId.set(run.id, run);
    };

    consider(aiStore.agentRunState.currentRun);
    for (const run of aiStore.agentRunState.runs) consider(run);

    return [...byId.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  get latestRun(): AgentRun | null {
    if (this.runs.length === 0) return null;
    return [...this.runs].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
  }

  get selectedRun(): AgentRun | null {
    if (this.selectedRunId) {
      const found = this.findRunById(this.selectedRunId);
      if (found) return found;
    }
    return this.activeRun ?? this.currentTurnRun;
  }

  /** Conversation ids that currently have an active run — used by the
   *  conversations list to show a live indicator per row. */
  get activeRunConversationIds(): Set<string> {
    return new Set(
      this.globalActiveRuns
        .map((run) => run.conversationId)
        .filter((id): id is string => !!id)
    );
  }

  get selectedWorker(): SelectedWorkerDetail | null {
    const target = this.selectedAgentTarget;
    if (!target || target.kind !== 'worker') return null;

    const run = this.findRunById(target.runId);
    const worker = run?.workers.find((candidate) => candidate.id === target.workerId) ?? null;
    if (!run || !worker) return null;
    return { run, worker };
  }

  get workerConversationVisible(): boolean {
    return this.selectedWorker !== null;
  }

  closeWorkerConversation(): void {
    this.clearAgentTarget();
  }

  get visibleConversationId(): VisibleConversationId | null {
    const conversationId = this.currentConversationId;
    if (conversationId) {
      return { id: conversationId, source: 'conversation' };
    }

    const candidates = [
      this.selectedRunId ? this.findRunById(this.selectedRunId) : null,
      this.activeRun,
      this.latestRun,
    ];
    const run = candidates.find((candidate) =>
      candidate?.conversationId && !this.isDeletedConversation(candidate.conversationId)
    );
    return run?.conversationId ? { id: run.conversationId, source: 'run' } : null;
  }

  get runTasks(): AgentTask[] {
    return this.runs.flatMap((run) => run.tasks);
  }

  get openRunTasks(): AgentTask[] {
    return this.runTasks.filter((task) => OPEN_TASK_STATUSES.has(task.status));
  }

  get nextOpenRunTask(): AgentTask | null {
    const tasks = this.openRunTasks;
    if (tasks.length === 0) return null;
    const running = tasks.filter((task) => task.status === 'running');
    const pool = running.length > 0 ? running : tasks;
    return [...pool].sort((a, b) => taskOrderKey(a).localeCompare(taskOrderKey(b)))[0] ?? null;
  }

  get hasInspectorContent(): boolean {
    // The inspector is the operational surface — runs, pending decisions,
    // and active work. It should NOT appear just because a conversation has
    // messages: a regular chat exchange doesn't need an inspector pane.
    const conversationId = this.currentConversationId;
    if (this.runs.length > 0) return true;
    if (this.globalActiveRuns.length > 0) return true;
    if (operationsStore.activeOperations.length > 0) return true;
    if (operationsStore.unappliedResultOperations.length > 0) return true;
    if (aiStore.isRouting || aiStore.isProcessing || aiStore.isStreaming) return true;
    if (this.pendingUserTurns.some((turn) => !conversationId || !turn.conversationId || turn.conversationId === conversationId)) {
      return true;
    }
    return false;
  }

  /**
   * Past + present runs in this conversation grouped by day. Most recent
   * group first; runs within a group sorted newest first.
   */
  get historyByDay(): RunHistoryGroup[] {
    const sorted = [...this.runs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const groups = new Map<string, AgentRun[]>();
    for (const run of sorted) {
      const key = startOfDayIso(run.createdAt);
      const list = groups.get(key) ?? [];
      list.push(run);
      groups.set(key, list);
    }
    return [...groups.entries()].map(([key, runs]) => ({
      label: relativeDayLabel(key),
      runs,
    }));
  }

  get activeWorkCount(): number {
    return this.globalActiveRuns.length + operationsStore.activeOperations.length;
  }

  get writeLanes(): ResourceLockSnapshot[] {
    return this.resourceLocks
      .filter((lock) => lock.held || lock.queued > 0)
      .sort((a, b) => {
        if (b.queued !== a.queued) return b.queued - a.queued;
        if (Number(b.held) !== Number(a.held)) return Number(b.held) - Number(a.held);
        return a.resourceId.localeCompare(b.resourceId);
      });
  }

  get collaborationSurfaces(): CollaborationSurface[] {
    return buildCollaborationSurfaces(this.writeLanes);
  }

  get collaborationHotspots(): CollaborationHotspot[] {
    return this.collaborationTelemetry;
  }

  get hasRoutingPendingTurn(): boolean {
    return this.pendingUserTurns.some((turn) => turn.status === 'routing' && !turn.matchedMessageId);
  }

  get selectedResultOperation(): Operation | null {
    const unappliedResults = operationsStore.unappliedResultOperations;
    if (this.selectedResultOperationId) {
      return unappliedResults.find((operation) => operation.id === this.selectedResultOperationId)
        ?? unappliedResults[0]
        ?? null;
    }
    return unappliedResults[0] ?? null;
  }

  get retryableSwarmRun(): RetryableSwarmRun | null {
    const conversation = aiStore.currentConversation;
    if (!conversation || this.isDeletedConversation(conversation.id)) return null;

    const visibleMessages = conversation.messages.filter((message) => message.visibility !== 'internal');
    const conversationRuns = aiStore.agentRunState.runs.filter((run) =>
      run.conversationId === conversation.id && !this.isDeletedConversation(run.conversationId)
    );

    for (let index = visibleMessages.length - 1; index >= 0; index--) {
      const message = visibleMessages[index];
      if (!message || message.role !== 'user') continue;

      const intent = classifyDurableAgentPrompt(message.text);
      if (!intent) continue;

      const linkedRuns = conversationRuns.filter((run) =>
        run.sourceMessageId === message.id ||
        samePrompt(run.prompt, message.text)
      );
      const placeholderRun = linkedRuns.find((run) => isRepairableResearchRun(run));
      if (placeholderRun) {
        return {
          kind: 'placeholder_repair',
          conversationId: conversation.id,
          sourceMessageId: message.id,
          assistantMessageId: null,
          runId: placeholderRun.id,
          prompt: message.text,
          suggestedMode: intent.mode,
          rationale: 'The linked swarm run only produced a worker placeholder note, so it should be repaired into real research notes.',
        };
      }
      if (linkedRuns.length > 0) continue;

      const following = visibleMessages.slice(index + 1);
      const nextUserIndex = following.findIndex((candidate) => candidate.role === 'user');
      const responseWindow = nextUserIndex >= 0 ? following.slice(0, nextUserIndex) : following;
      const assistantAnswer = responseWindow.find((candidate) =>
        candidate.role === 'assistant' && candidate.text.trim().length > 0
      );
      if (!assistantAnswer) continue;

      return {
        kind: 'chat_retry',
        conversationId: conversation.id,
        sourceMessageId: message.id,
        assistantMessageId: assistantAnswer.id,
        prompt: message.text,
        suggestedMode: intent.mode,
        rationale: intent.rationale,
      };
    }

    return null;
  }

  createPendingUserTurn(text: string, conversationId: string | null): PendingUserTurn {
    this.selectedRunId = null;
    const turn: PendingUserTurn = {
      id: `turn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      text,
      conversationId,
      createdAt: new Date(),
      status: 'routing',
      matchedMessageId: null,
    };
    this.pendingUserTurns = [...this.pendingUserTurns, turn];
    return turn;
  }

  retryPendingUserTurn(turnId: string): PendingUserTurn | null {
    const turn = this.pendingUserTurns.find((pending) => pending.id === turnId);
    if (!turn) return null;

    this.pendingUserTurns = this.pendingUserTurns.map((pending) =>
      pending.id === turnId ? resetPendingTurn(pending) : pending
    );
    return this.pendingUserTurns.find((pending) => pending.id === turnId) ?? null;
  }

  markPendingUserTurnSubmitted(turnId: string): void {
    this.pendingUserTurns = this.pendingUserTurns.map((turn) =>
      turn.id === turnId && turn.status === 'routing'
        ? { ...turn, status: 'submitted' }
        : turn
    );
  }

  failPendingUserTurn(turnId: string, error: string): void {
    this.pendingUserTurns = this.pendingUserTurns.map((turn) =>
      turn.id === turnId
        ? { ...turn, status: 'failed', error }
        : turn
    );
  }

  isPendingUserTurnMatched(turnId: string): boolean {
    return this.pendingUserTurns.some((turn) => turn.id === turnId && !!turn.matchedMessageId);
  }

  reconcilePendingUserTurns(messages: Message[], conversationId: string | null): void {
    let changed = false;
    const next = this.pendingUserTurns.map((turn) => {
      if (turn.matchedMessageId || !this.turnBelongsToConversation(turn, conversationId)) {
        return turn;
      }

      const match = this.findMatchingMessage(turn, messages);
      if (!match) return turn;

      changed = true;
      const matchedTurn: PendingUserTurn = {
        ...turn,
        conversationId: turn.conversationId ?? conversationId,
        status: 'submitted' as const,
        matchedMessageId: match.id,
      };
      delete matchedTurn.error;
      return matchedTurn;
    });

    if (changed) {
      this.pendingUserTurns = next;
    }
  }

  getVisiblePendingUserTurns(messages: Message[], conversationId: string | null): PendingUserTurn[] {
    const messageIds = new Set(messages.map((message) => message.id));
    return this.pendingUserTurns.filter((turn) =>
      this.turnBelongsToConversation(turn, conversationId) &&
      (!turn.matchedMessageId || !messageIds.has(turn.matchedMessageId))
    );
  }

  selectRun(runId: string): void {
    this.selectedRunId = runId;
    this.selectedAgentTarget = null;
  }

  selectWorker(runId: string, workerId: string): void {
    const run = this.findRunById(runId);
    if (!run?.workers.some((worker) => worker.id === workerId)) return;

    this.selectedRunId = runId;
    this.selectedAgentTarget = { kind: 'worker', runId, workerId };
  }

  selectOrchestrator(runId: string): void {
    if (!this.findRunById(runId)) return;

    this.selectedRunId = runId;
    this.selectedAgentTarget = { kind: 'orchestrator', runId };
  }

  isWorkerSelected(runId: string, workerId: string): boolean {
    const target = this.selectedAgentTarget;
    return target?.kind === 'worker' && target.runId === runId && target.workerId === workerId;
  }

  clearAgentTarget(): void {
    this.selectedAgentTarget = null;
  }

  isRunCollapsed(runId: string): boolean {
    return this.collapsedRunIds.includes(runId);
  }

  toggleRunCollapsed(runId: string): void {
    this.collapsedRunIds = this.isRunCollapsed(runId)
      ? this.collapsedRunIds.filter((id) => id !== runId)
      : [...this.collapsedRunIds, runId];
  }

  /**
   * Compatibility alias: bring the live conversation detail into focus.
   * The four inspector tabs were replaced by one always-on detail panel, so
   * "show now" now just ensures the detail is visible and closes templates.
   */
  showNow(): void {
    this.templatesOpen = false;
    this.conversationDetailVisible = true;
  }

  /** Re-show the conversation transcript + composer in the conversation pane. */
  showConversationDetail(): void {
    this.conversationDetailVisible = true;
  }

  setStreamDensity(density: CommandStreamDensity): void {
    this.streamDensity = density;
  }

  toggleStreamDensity(): void {
    this.streamDensity = this.streamDensity === 'firehose' ? 'milestones' : 'firehose';
  }

  openTemplates(): void {
    this.templatesOpen = true;
  }

  closeTemplates(): void {
    this.templatesOpen = false;
  }

  toggleTemplates(): void {
    this.templatesOpen = !this.templatesOpen;
  }

  /** Clear the pinned run so the detail panel re-resolves the conversation's
   *  active/latest run (called when switching conversations). */
  clearSelectedRun(): void {
    this.selectedRunId = null;
    this.selectedAgentTarget = null;
  }

  /** Hide the active conversation's detail, returning the pane to a neutral
   *  state where the user can pick another thread or start fresh. */
  hideConversationDetail(): void {
    this.conversationDetailVisible = false;
  }

  togglePanel(side: CommandPanelSide): void {
    if (side === 'history') {
      this.historyCollapsed = !this.historyCollapsed;
      return;
    }
    this.inspectorCollapsed = !this.inspectorCollapsed;
  }

  selectResultOperation(operationId: OperationId): void {
    this.selectedRunId = null;
    this.selectedAgentTarget = null;
    this.selectedResultOperationId = operationId;
  }

  clearResultOperation(): void {
    this.selectedResultOperationId = null;
  }

  handleConversationDeleted(conversationId: string): void {
    const deletedRunIds = new Set(
      aiStore.agentRunState.runs
        .filter((run) => run.conversationId === conversationId)
        .map((run) => run.id)
    );

    if (!this.deletedConversationIds.includes(conversationId)) {
      this.deletedConversationIds = [...this.deletedConversationIds, conversationId];
    }

    if (this.selectedRunId && deletedRunIds.has(this.selectedRunId)) {
      this.selectedRunId = null;
    }
    if (this.selectedAgentTarget && deletedRunIds.has(this.selectedAgentTarget.runId)) {
      this.selectedAgentTarget = null;
    }

    this.pendingUserTurns = this.pendingUserTurns.filter((turn) => turn.conversationId !== conversationId);
    this.collapsedRunIds = this.collapsedRunIds.filter((runId) => !deletedRunIds.has(runId));
  }

  reset(): void {
    this.selectedRunId = null;
    this.selectedAgentTarget = null;
    this.selectedResultOperationId = null;
    this.pendingUserTurns = [];
    this.collapsedRunIds = [];
    this.deletedConversationIds = [];
    this.historyCollapsed = false;
    this.inspectorCollapsed = false;
    this.resourceLocks = resourceLock.snapshot();
    this.collaborationTelemetry = [];
    this.conversationDetailVisible = true;
    this.templatesOpen = false;
    this.#lastSurfacePressure.clear();
  }

  private isDeletedConversation(conversationId: string | null): boolean {
    return !!conversationId && this.deletedConversationIds.includes(conversationId);
  }

  private findRunById(runId: string): AgentRun | null {
    return aiStore.agentRunState.runs.find((run) =>
      run.id === runId && !this.isDeletedConversation(run.conversationId)
    ) ?? null;
  }

  private turnBelongsToConversation(turn: PendingUserTurn, conversationId: string | null): boolean {
    return !turn.conversationId || !conversationId || turn.conversationId === conversationId;
  }

  private findMatchingMessage(turn: PendingUserTurn, messages: Message[]): Message | null {
    const byClientTurn = messages.find(
      (message) => message.role === 'user' && message.clientTurnId === turn.id
    );
    if (byClientTurn) return byClientTurn;

    return messages.find((message) => {
      if (message.role !== 'user') return false;
      if (message.text.trim() !== turn.text.trim()) return false;
      const delta = Math.abs(message.createdAt.getTime() - turn.createdAt.getTime());
      return delta <= FALLBACK_MATCH_WINDOW_MS;
    }) ?? null;
  }

  private get currentTurnRun(): AgentRun | null {
    const turns = [...this.pendingUserTurns].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    for (const turn of turns) {
      const run = this.runs.find((candidate) => {
        if (candidate.prompt.trim() !== turn.text.trim()) return false;
        if (turn.conversationId && candidate.conversationId && turn.conversationId !== candidate.conversationId) {
          return false;
        }
        return true;
      });
      if (run) return run;
    }
    return null;
  }

  private recordCollaborationTelemetry(resources: ResourceLockSnapshot[]): void {
    const surfaces = buildCollaborationSurfaces(resources.filter((lock) => lock.held || lock.queued > 0));
    const activeIds = new Set(surfaces.map((surface) => surface.id));

    if (surfaces.length === 0) {
      this.collaborationTelemetry = this.collaborationTelemetry.map((hotspot) => ({
        ...hotspot,
        currentlyActive: false,
      }));
      this.#lastSurfacePressure.clear();
      return;
    }

    const byId = new Map(this.collaborationTelemetry.map((hotspot) => [hotspot.id, hotspot]));
    const now = new Date().toISOString();

    for (const surface of surfaces) {
      const previous = byId.get(surface.id);
      const previousPressure = this.#lastSurfacePressure.get(surface.id);
      const becameContended = surface.queuedWrites > 0 && previousPressure !== 'contended';
      const owners = uniqueStrings([...surface.holders, ...surface.waiters]).slice(0, 4);

      byId.set(surface.id, {
        id: surface.id,
        kind: surface.kind,
        title: surface.title,
        incidentCount: (previous?.incidentCount ?? 0) + (becameContended ? 1 : 0),
        maxQueuedWrites: Math.max(previous?.maxQueuedWrites ?? 0, surface.queuedWrites),
        maxActiveLanes: Math.max(previous?.maxActiveLanes ?? 0, surface.activeLanes),
        laneKinds: uniqueStrings([...(previous?.laneKinds ?? []), ...surface.laneKinds]),
        runIds: uniqueStrings([...(previous?.runIds ?? []), ...surface.runIds]).slice(0, 8),
        lastOwners: owners.length > 0 ? owners : previous?.lastOwners ?? [],
        lastPressure: surface.pressure,
        lastSeenAt: now,
        currentlyActive: true,
      });

      this.#lastSurfacePressure.set(surface.id, surface.pressure);
    }

    for (const [id, hotspot] of byId) {
      if (!activeIds.has(id)) {
        byId.set(id, {
          ...hotspot,
          currentlyActive: false,
        });
        this.#lastSurfacePressure.delete(id);
      }
    }

    this.collaborationTelemetry = [...byId.values()]
      .sort((a, b) => {
        if (Number(b.currentlyActive) !== Number(a.currentlyActive)) {
          return Number(b.currentlyActive) - Number(a.currentlyActive);
        }
        if (b.maxQueuedWrites !== a.maxQueuedWrites) return b.maxQueuedWrites - a.maxQueuedWrites;
        if (b.incidentCount !== a.incidentCount) return b.incidentCount - a.incidentCount;
        return b.lastSeenAt.localeCompare(a.lastSeenAt);
      })
      .slice(0, MAX_COLLABORATION_HOTSPOTS);
  }
}

export const commandCenterStore = new CommandCenterStore();

function resetPendingTurn(turn: PendingUserTurn): PendingUserTurn {
  const next: PendingUserTurn = {
    ...turn,
    status: 'routing',
    matchedMessageId: null,
    createdAt: new Date(),
  };
  delete next.error;
  return next;
}

function samePrompt(a: string, b: string): boolean {
  return a.trim().replace(/\s+/g, ' ') === b.trim().replace(/\s+/g, ' ');
}

function isRepairableResearchRun(run: AgentRun): boolean {
  if (run.status !== 'completed') return false;
  if (run.orchestrationMode !== 'swarm') return false;
  if (classifyDurableAgentPrompt(run.prompt)?.mode !== 'research') return false;
  const noteArtifacts = run.artifacts.filter((artifact) => artifact.type === 'note');
  if (noteArtifacts.length === 0) return false;
  const placeholderOnly = noteArtifacts.every((artifact) => {
    const title = artifact.title.trim().toLowerCase();
    const path = artifact.path?.trim().toLowerCase() ?? '';
    return title === 'worker summary' ||
      title === 'summary' ||
      path.endsWith('/worker-summary.md') ||
      path === 'worker-summary.md';
  });
  if (placeholderOnly) return true;
  if (run.merge?.evidenceLevel && run.merge.evidenceLevel !== 'scaffold_only') return false;

  const hasSources = run.artifacts.some((artifact) =>
    artifact.type === 'source' && artifact.citation?.status === 'verified'
  ) ||
    (run.plan?.citations.some((citation) => citation.status === 'verified') ?? false) ||
    run.workers.some((worker) => worker.result?.citations.some((citation) => citation.status === 'verified'));
  const hasFindings = run.workers.some((worker) =>
    worker.result?.findings.some((finding) => hasText(finding) && !looksLikeGenericCompletion(finding))
  );
  if (hasSources || hasFindings) return false;

  const text = [
    run.finalSummary,
    run.merge?.summary,
    ...(run.merge?.risks ?? []),
    ...(run.merge?.artifactDrafts ?? []).flatMap((draft) => [draft.title, draft.summary, draft.content]),
  ].filter(hasText).join('\n');
  const allWorkersInsufficient = run.workers.length > 0 && run.workers.every((worker) =>
    !worker.result ||
    worker.result.quality === 'insufficient' ||
    looksLikeGenericCompletion(worker.result.summary)
  );

  return allWorkersInsufficient &&
    /workers did not return substantive|did not produce substantive|needs-verification|research scaffold|no verified external citations/i.test(text);
}

function hasText(value: string | undefined | null): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function looksLikeGenericCompletion(text: string): boolean {
  const normalized = text.trim().replace(/\s+/g, ' ');
  if (!normalized) return false;
  if (/^completed\s+[\w\s-]+\.?$/i.test(normalized)) return true;
  const lines = normalized.split(/(?:\n|;|\.)/).map((line) => line.trim()).filter(Boolean);
  return lines.length > 0 && lines.every((line) => /^-?\s*completed\s+/i.test(line));
}

interface CollaborationResourceDescriptor {
  id: string;
  kind: CollaborationSurfaceKind;
  title: string;
  laneKind: string;
}

function buildCollaborationSurfaces(locks: ResourceLockSnapshot[]): CollaborationSurface[] {
  const surfaces = new Map<string, CollaborationSurface>();

  for (const lock of locks) {
    const descriptor = describeCollaborationResource(lock.resourceId);
    const existing = surfaces.get(descriptor.id);
    const surface = existing ?? {
      id: descriptor.id,
      kind: descriptor.kind,
      title: descriptor.title,
      activeLanes: 0,
      queuedWrites: 0,
      laneCount: 0,
      laneKinds: [],
      holders: [],
      waiters: [],
      runIds: [],
      resourceIds: [],
      pressure: 'active' as const,
    };

    surface.activeLanes += lock.held ? 1 : 0;
    surface.queuedWrites += lock.queued;
    surface.laneCount += 1;
    if (!surface.laneKinds.includes(descriptor.laneKind)) {
      surface.laneKinds = [...surface.laneKinds, descriptor.laneKind];
    }
    if (!surface.resourceIds.includes(lock.resourceId)) {
      surface.resourceIds = [...surface.resourceIds, lock.resourceId];
    }
    if (lock.holder) {
      surface.holders = appendUnique(surface.holders, ownerLabel(lock.holder));
      if (lock.holder.runId) surface.runIds = appendUnique(surface.runIds, lock.holder.runId);
    }
    for (const waiter of lock.waiters ?? []) {
      surface.waiters = appendUnique(surface.waiters, ownerLabel(waiter));
      if (waiter.runId) surface.runIds = appendUnique(surface.runIds, waiter.runId);
    }
    surface.pressure = surface.queuedWrites > 0
      ? 'contended'
      : surface.activeLanes > 0
        ? 'active'
        : 'queued';

    surfaces.set(surface.id, surface);
  }

  return [...surfaces.values()].sort((a, b) => {
    if (b.queuedWrites !== a.queuedWrites) return b.queuedWrites - a.queuedWrites;
    if (b.activeLanes !== a.activeLanes) return b.activeLanes - a.activeLanes;
    if (b.laneCount !== a.laneCount) return b.laneCount - a.laneCount;
    return a.title.localeCompare(b.title);
  });
}

function describeCollaborationResource(resourceId: string): CollaborationResourceDescriptor {
  if (resourceId.startsWith('tool:')) {
    const nested = describeCollaborationResource(resourceId.slice('tool:'.length));
    return {
      ...nested,
      laneKind: nested.laneKind === 'tool' ? 'tool' : `tool ${nested.laneKind}`,
    };
  }

  if (resourceId.startsWith('block:')) {
    const { path } = splitPathAndSuffix(resourceId.slice('block:'.length));
    return noteSurface(path || 'active note', 'block');
  }

  if (resourceId.startsWith('note:save:')) {
    return noteSurface(resourceId.slice('note:save:'.length), 'save');
  }

  if (resourceId.startsWith('note:create:')) {
    return noteSurface(resourceId.slice('note:create:'.length), 'create');
  }

  if (resourceId.startsWith('note:')) {
    return noteSurface(resourceId.slice('note:'.length), 'note');
  }

  if (resourceId.startsWith('todo:item:')) {
    const value = resourceId.slice('todo:item:'.length);
    const { path } = splitPathAndSuffix(value);
    return todoSurface(path || value || 'default', 'item');
  }

  if (resourceId.startsWith('todo:save:')) {
    return todoSurface(resourceId.slice('todo:save:'.length), 'save');
  }

  if (resourceId.startsWith('todo:file:')) {
    return todoSurface(resourceId.slice('todo:file:'.length), 'file');
  }

  if (resourceId.startsWith('todo:create:')) {
    return todoSurface(resourceId.slice('todo:create:'.length), 'create');
  }

  if (resourceId.startsWith('todo:')) {
    return todoSurface(resourceId.slice('todo:'.length), 'todo');
  }

  if (resourceId) {
    return {
      id: `system:${normalizeResource(resourceId)}`,
      kind: 'system',
      title: shortResourceLabel(resourceId),
      laneKind: 'system',
    };
  }

  return {
    id: 'system:unknown',
    kind: 'system',
    title: 'Unknown resource',
    laneKind: 'system',
  };
}

function noteSurface(path: string, laneKind: string): CollaborationResourceDescriptor {
  const normalized = normalizeResource(path);
  return {
    id: `note:${normalized}`,
    kind: 'note',
    title: shortResourceLabel(normalized),
    laneKind,
  };
}

function todoSurface(path: string, laneKind: string): CollaborationResourceDescriptor {
  const normalized = normalizeResource(path);
  return {
    id: `todo:${normalized}`,
    kind: 'todo',
    title: normalized === 'default' ? 'Default todos' : shortResourceLabel(normalized),
    laneKind,
  };
}

function splitPathAndSuffix(value: string): { path: string; suffix: string | null } {
  const splitAt = value.lastIndexOf(':');
  if (splitAt === -1) return { path: value, suffix: null };
  return {
    path: value.slice(0, splitAt),
    suffix: value.slice(splitAt + 1),
  };
}

function normalizeResource(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/').trim() || 'default';
}

function shortResourceLabel(value: string): string {
  const normalized = normalizeResource(value);
  const parts = normalized.split('/').filter(Boolean);
  return parts.slice(-2).join('/') || normalized || 'resource';
}

function ownerLabel(owner: { label?: string; toolId?: string; id: string }): string {
  return owner.label ?? owner.toolId ?? owner.id;
}

function appendUnique(items: string[], item: string): string[] {
  return items.includes(item) ? items : [...items, item];
}

function uniqueStrings(items: string[]): string[] {
  return [...new Set(items.filter((item) => item.trim().length > 0))];
}

function startOfDayIso(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).toISOString();
}

function relativeDayLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Earlier';
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const dayMs = 24 * 60 * 60 * 1000;
  const diff = Math.round((startOfToday.getTime() - date.getTime()) / dayMs);
  if (diff <= 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return `${diff} days ago`;
  if (diff < 14) return 'Last week';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
