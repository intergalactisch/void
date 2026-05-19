<script lang="ts">
  import {
    CheckCircle2,
    Check,
    CircleAlert,
    CircleDashed,
    Clock3,
    GitBranch,
    History,
    Inbox,
    Loader2,
    Plus,
    RotateCcw,
    Route,
    Sparkles,
    Wrench,
    X,
    Zap,
  } from '@lucide/svelte';
  import { isActiveAgentRun } from '$lib/domain/entities/AgentRun';
  import type { AgentRun } from '$lib/domain/entities/AgentRun';
  import type { ResourceLockSnapshot } from '$lib/events';
  import { aiStore, commandCenterStore, lineageStore, operationsStore, uiStore } from '$lib/stores';
  import OperationDetail from '$lib/components/operations/OperationDetail.svelte';
  import OperationItem from '$lib/components/operations/OperationItem.svelte';
  import CommandRunCard from './CommandRunCard.svelte';
  import CommandTemplatePanel from './CommandTemplatePanel.svelte';

  let mode = $derived(commandCenterStore.inspectorMode);
  let selectedRun = $derived(commandCenterStore.selectedRun);
  let activeRun = $derived(commandCenterStore.activeRun);
  let activeRuns = $derived(commandCenterStore.activeRuns);
  let writeLanes = $derived(commandCenterStore.writeLanes);
  let collaborationSurfaces = $derived(commandCenterStore.collaborationSurfaces);
  let collaborationHotspots = $derived(commandCenterStore.collaborationHotspots);
  let liveHotspotCount = $derived(collaborationHotspots.filter((hotspot) => hotspot.currentlyActive).length);
  let lineageVisible = $derived(lineageStore.visible);
  let lineageLineLabel = $derived(lineageStore.lineIndex !== null ? `Line ${lineageStore.lineIndex + 1}` : 'Lineage');
  let lineageCurrent = $derived(lineageStore.explanation?.currentVersion ?? null);
  let lineagePreviousVersions = $derived(lineageStore.history?.versions
    .filter((version) => version.id !== lineageCurrent?.id)
    .slice()
    .reverse() ?? []);
  let lineageWarnings = $derived(lineageStore.warnings.filter((warning) =>
    warning.matches.some((match) => match.newLineIndex === lineageStore.lineIndex)
  ));
  let lineageRepairTarget = $derived.by(() => {
    for (const warning of lineageWarnings) {
      const match = warning.matches.find((candidate) =>
        candidate.newLineIndex === lineageStore.lineIndex && !!candidate.oldUnitId
      );
      if (match?.oldUnitId) return { unitId: match.oldUnitId, warningId: warning.id };
    }
    return null;
  });
  let runs = $derived(commandCenterStore.runs);
  let historyByDay = $derived(commandCenterStore.historyByDay);
  let activeOperations = $derived(operationsStore.activeOperations);
  let unappliedResults = $derived(operationsStore.unappliedResultOperations);
  let selectedResultOperation = $derived(commandCenterStore.selectedResultOperation);

  /** Run shown in the "Now" tab — selected takes priority, then active. */
  let nowRun = $derived(selectedRun ?? activeRun ?? null);
  let nowProgress = $derived(
    nowRun && nowRun.tasks.length > 0
      ? Math.round(nowRun.tasks.reduce((sum, task) => sum + task.progress, 0) / nowRun.tasks.length)
      : 0
  );

  let inboxCount = $derived(unappliedResults.length);
  let historyCount = $derived(runs.length);
  let activeSwarmMetrics = $derived.by(() => {
    const workerTotal = activeRuns.reduce((sum, run) => sum + run.workers.length, 0);
    const workerRunning = activeRuns.reduce((sum, run) =>
      sum + run.workers.filter((worker) => worker.status === 'running').length,
    0);
    const workerCompleted = activeRuns.reduce((sum, run) =>
      sum + run.workers.filter((worker) => worker.status === 'completed').length,
    0);
    const noteCount = activeRuns.reduce((sum, run) =>
      sum + run.artifacts.filter((artifact) => artifact.type === 'note').length,
    0);
    const sourceCount = activeRuns.reduce((sum, run) =>
      sum + run.artifacts.filter((artifact) => artifact.type === 'source').length,
    0);
    const mediaCount = activeRuns.reduce((sum, run) =>
      sum + run.artifacts.filter((artifact) => artifact.type === 'media').length,
    0);
    const outputCount = activeRuns.reduce((sum, run) => sum + run.artifacts.length, 0);
    const queuedWrites = writeLanes.reduce((sum, lane) => sum + lane.queued, 0);
    const activeLanes = writeLanes.filter((lane) => lane.held).length;
    const contendedSurfaces = collaborationSurfaces.filter((surface) => surface.queuedWrites > 0).length;
    const approvals = activeRuns.filter((run) => run.status === 'waiting_approval').length;
    const progress = activeRuns.length > 0
      ? Math.round(activeRuns.reduce((sum, run) => sum + runProgress(run), 0) / activeRuns.length)
      : 0;

    return {
      runs: activeRuns.length,
      swarms: activeRuns.filter((run) => run.orchestrationMode === 'swarm').length,
      workerTotal,
      workerRunning,
      workerCompleted,
      outputCount,
      noteCount,
      sourceCount,
      mediaCount,
      queuedWrites,
      activeLanes,
      contendedSurfaces,
      approvals,
      progress,
    };
  });

  type StatusTone = 'live' | 'warn' | 'ok' | 'idle' | 'error';
  interface StatusPill {
    tone: StatusTone;
    label: string;
    detail: string | null;
    showProgress: boolean;
    progress: number;
  }

  let status = $derived.by<StatusPill>(() => {
    if (activeRuns.length > 1) {
      const progress = Math.round(
        activeRuns.reduce((sum, run) => sum + runProgress(run), 0) / activeRuns.length
      );
      return {
        tone: 'live',
        label: `${activeRuns.length} runs active`,
        detail: commandCenterStore.nextOpenRunTask?.title ?? activeRuns[0]?.prompt ?? null,
        showProgress: progress > 0,
        progress,
      };
    }

    if (activeRun) {
      const detail = activeRun.prompt;
      const showProgress = isActiveAgentRun(activeRun) && activeRun.tasks.length > 0;
      const progress = runProgress(activeRun);
      switch (activeRun.status) {
        case 'planning':
          return { tone: 'live', label: 'Planning', detail, showProgress, progress };
        case 'searching':
          return { tone: 'live', label: 'Researching', detail, showProgress, progress };
        case 'waiting_approval':
          return { tone: 'warn', label: 'Waiting on you', detail, showProgress: false, progress };
        case 'executing':
          return { tone: 'live', label: 'Working', detail, showProgress, progress };
        case 'reviewing':
          return { tone: 'live', label: 'Reviewing', detail, showProgress, progress };
        default:
          return { tone: 'live', label: 'Working', detail, showProgress, progress };
      }
    }

    if (aiStore.isStreaming) {
      return { tone: 'live', label: 'Writing response', detail: null, showProgress: false, progress: 0 };
    }
    if (aiStore.isProcessing) {
      return { tone: 'live', label: 'Thinking', detail: null, showProgress: false, progress: 0 };
    }
    if (aiStore.isRouting) {
      return { tone: 'live', label: 'Routing request', detail: null, showProgress: false, progress: 0 };
    }
    if (activeOperations.length > 0) {
      const detail = activeOperations.length === 1
        ? activeOperations[0]?.label ?? null
        : `${activeOperations.length} operations running`;
      return { tone: 'live', label: 'Running', detail, showProgress: false, progress: 0 };
    }

    if (unappliedResults.length > 0) {
      return {
        tone: 'warn',
        label: `${unappliedResults.length} to review`,
        detail: 'Workspace results awaiting your decision',
        showProgress: false,
        progress: 0,
      };
    }

    if (runs.length > 0) {
      return {
        tone: 'ok',
        label: 'Idle',
        detail: `${runs.length} run${runs.length === 1 ? '' : 's'} in this conversation`,
        showProgress: false,
        progress: 0,
      };
    }

    return { tone: 'idle', label: 'Idle', detail: null, showProgress: false, progress: 0 };
  });

  function formatStatus(value: string): string {
    return value.replace(/_/g, ' ');
  }

  function formatTime(iso: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }

  function handleCancelOperation(operationId: string) {
    operationsStore.cancel(operationId as never);
  }

  async function handleApplyResult() {
    if (!selectedResultOperation) return;
    await operationsStore.applyResult(selectedResultOperation.id);
    commandCenterStore.clearResultOperation();
  }

  function handleDiscardResult() {
    if (!selectedResultOperation) return;
    operationsStore.discardResult(selectedResultOperation.id);
    commandCenterStore.clearResultOperation();
  }

  async function applyResult(operationId: string) {
    await operationsStore.applyResult(operationId as never);
    if (selectedResultOperation?.id === operationId) {
      commandCenterStore.clearResultOperation();
    }
  }

  function discardResult(operationId: string) {
    operationsStore.discardResult(operationId as never);
    if (selectedResultOperation?.id === operationId) {
      commandCenterStore.clearResultOperation();
    }
  }

  function selectResult(operationId: string) {
    if (selectedResultOperation?.id === operationId) {
      commandCenterStore.clearResultOperation();
    } else {
      commandCenterStore.selectResultOperation(operationId as never);
    }
  }

  function selectHistoryRun(run: AgentRun) {
    commandCenterStore.selectRun(run.id);
  }

  function selectActiveRun(run: AgentRun) {
    commandCenterStore.selectRun(run.id);
  }

  function openLineageWorkspace(filter: 'all' | 'focused' | 'deleted' | 'warnings' = 'focused') {
    lineageStore.setTimelineFilter(filter);
    uiStore.openLineageWorkspace();
    void lineageStore.refresh();
  }

  async function restoreLatestLineageVersion() {
    const version = lineagePreviousVersions[0];
    if (!version) return;
    await lineageStore.restoreVersion(version.id);
  }

  async function repairLineageTarget() {
    if (!lineageRepairTarget) return;
    await lineageStore.repairTo(lineageRepairTarget.unitId, lineageRepairTarget.warningId);
  }

  function openBranchPicker() {
    uiStore.openBranchPicker();
  }

  function lineageActorLabel(): string {
    const actor = lineageCurrent?.actor;
    if (!actor) return 'Unknown actor';
    if (actor.kind === 'ai-agent') return actor.model ?? actor.name ?? 'AI agent';
    if (actor.kind === 'external-editor') return 'External editor';
    return actor.name ?? actor.kind;
  }

  function lineageIntentLabel(): string {
    const intent = lineageStore.explanation?.intent;
    return intent?.summary ?? intent?.kind ?? 'No intent recorded';
  }

  function isLiveRun(run: AgentRun): boolean {
    return isActiveAgentRun(run);
  }

  function runProgress(run: AgentRun): number {
    return run.tasks.length > 0
      ? Math.round(run.tasks.reduce((sum, task) => sum + task.progress, 0) / run.tasks.length)
      : 0;
  }

  function runWorkerSummary(run: AgentRun): string {
    if (run.workers.length === 0) return `${run.tasks.filter((task) => task.status === 'completed').length}/${run.tasks.length} tasks`;
    const completed = run.workers.filter((worker) => worker.status === 'completed').length;
    const failed = run.workers.filter((worker) => worker.status === 'failed').length;
    return `${completed}/${run.workers.length} workers${failed > 0 ? `, ${failed} failed` : ''}`;
  }

  function runScopeLabel(run: AgentRun): string {
    const currentConversationId = commandCenterStore.currentConversationId;
    if (!run.conversationId) return 'No thread';
    if (!currentConversationId || run.conversationId === currentConversationId) return 'This thread';
    return `Thread ${shortId(run.conversationId)}`;
  }

  function runOutputSummary(run: AgentRun): string {
    if (run.artifacts.length === 0) return 'No outputs';
    const notes = run.artifacts.filter((artifact) => artifact.type === 'note').length;
    const sources = run.artifacts.filter((artifact) => artifact.type === 'source').length;
    const media = run.artifacts.filter((artifact) => artifact.type === 'media').length;
    const parts: string[] = [];
    if (notes > 0) parts.push(`${notes} note${notes === 1 ? '' : 's'}`);
    if (sources > 0) parts.push(`${sources} source${sources === 1 ? '' : 's'}`);
    if (media > 0) parts.push(`${media} media`);
    const other = run.artifacts.length - notes - sources - media;
    if (other > 0) parts.push(`${other} other`);
    return parts.join(' / ') || `${run.artifacts.length} outputs`;
  }

  function lockKind(resourceId: string): string {
    if (resourceId.startsWith('block:')) return 'block';
    if (resourceId.startsWith('note:save:')) return 'save';
    if (resourceId.startsWith('note:')) return 'note';
    if (resourceId.startsWith('todo:save:')) return 'save';
    if (resourceId.startsWith('todo:item:')) return 'todo';
    if (resourceId.startsWith('todo:create:')) return 'todo';
    if (resourceId.startsWith('todo:file:')) return 'todo';
    if (resourceId.startsWith('tool:')) return 'tool';
    return 'system';
  }

  function lockTitle(resourceId: string): string {
    if (resourceId.startsWith('note:create:')) return 'Creating note';
    if (resourceId.startsWith('note:save:')) return `Saving note / ${shortResource(resourceId.slice('note:save:'.length))}`;
    if (resourceId.startsWith('block:')) return blockLockTitle(resourceId);
    if (resourceId.startsWith('note:')) return `Note / ${shortResource(resourceId.slice('note:'.length))}`;
    if (resourceId.startsWith('todo:item:')) return todoItemLockTitle(resourceId);
    if (resourceId.startsWith('todo:create:')) return `Todo create / ${shortResource(resourceId.slice('todo:create:'.length))}`;
    if (resourceId.startsWith('todo:save:')) return `Todo save / ${shortResource(resourceId.slice('todo:save:'.length))}`;
    if (resourceId.startsWith('todo:file:')) return `Todo snapshot / ${shortResource(resourceId.slice('todo:file:'.length))}`;
    if (resourceId.startsWith('tool:')) return `Tool / ${shortResource(resourceId.slice('tool:'.length))}`;
    return shortResource(resourceId);
  }

  function blockLockTitle(resourceId: string): string {
    const value = resourceId.slice('block:'.length);
    const splitAt = value.lastIndexOf(':');
    if (splitAt === -1) return `Block / ${shortResource(value)}`;
    const path = value.slice(0, splitAt);
    const blockId = value.slice(splitAt + 1);
    return `Block / ${shortResource(path)} / ${blockId}`;
  }

  function todoItemLockTitle(resourceId: string): string {
    const value = resourceId.slice('todo:item:'.length);
    const splitAt = value.lastIndexOf(':');
    if (splitAt === -1) return `Todo item / ${shortResource(value)}`;
    const path = value.slice(0, splitAt);
    const line = value.slice(splitAt + 1);
    return `Todo item / ${shortResource(path)} / line ${line}`;
  }

  function lockMeta(lock: ResourceLockSnapshot): string {
    if (lock.held && lock.queued > 0) return `Writing / ${lock.queued} waiting`;
    if (lock.held) return 'Writing';
    return `${lock.queued} waiting`;
  }

  function surfaceKindLabel(kind: string): string {
    if (kind === 'note') return 'Note';
    if (kind === 'todo') return 'Todo';
    if (kind === 'tool') return 'Tool';
    return 'System';
  }

  function surfaceMeta(surface: {
    laneKinds: string[];
    activeLanes: number;
    queuedWrites: number;
    holders: string[];
    waiters: string[];
  }): string {
    const lanes = surface.laneKinds.slice(0, 3).join(' / ');
    const more = surface.laneKinds.length > 3 ? ` +${surface.laneKinds.length - 3}` : '';
    const holder = surface.holders.length > 0 ? ` / owner ${surface.holders.slice(0, 2).join(', ')}` : '';
    const waiting = surface.waiters.length > 0 ? ` / waiting ${surface.waiters.slice(0, 2).join(', ')}` : '';
    return `${lanes}${more} / ${surface.activeLanes} active / ${surface.queuedWrites} queued${holder}${waiting}`;
  }

  function hotspotMeta(hotspot: {
    incidentCount: number;
    maxQueuedWrites: number;
    maxActiveLanes: number;
    laneKinds: string[];
    runIds: string[];
    lastOwners: string[];
  }): string {
    const incidents = `${hotspot.incidentCount} contention${hotspot.incidentCount === 1 ? '' : 's'}`;
    const lanes = hotspot.laneKinds.slice(0, 3).join(' / ') || 'lane';
    const runs = hotspot.runIds.length > 0 ? ` / ${hotspot.runIds.length} run${hotspot.runIds.length === 1 ? '' : 's'}` : '';
    const owners = hotspot.lastOwners.length > 0 ? ` / ${hotspot.lastOwners.slice(0, 2).join(', ')}` : '';
    return `${incidents} / max ${hotspot.maxQueuedWrites} queued / ${hotspot.maxActiveLanes} active / ${lanes}${runs}${owners}`;
  }

  function hotspotState(hotspot: { currentlyActive: boolean; lastPressure: string }): string {
    if (!hotspot.currentlyActive) return 'Recent';
    if (hotspot.lastPressure === 'contended') return 'Hot';
    return 'Live';
  }

  function shortResource(value: string): string {
    const normalized = value.replace(/\\/g, '/').replace(/^\/+/, '');
    const parts = normalized.split('/').filter(Boolean);
    return parts.slice(-2).join('/') || normalized || 'resource';
  }

  function shortId(value: string): string {
    return value.length > 12 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value;
  }
</script>

<aside class="inspector" aria-label="Agent status">
  <header class="status-header" data-tone={status.tone}>
    <div class="status-line">
      <span class="status-pill" data-tone={status.tone}>
        <span class="status-dot" aria-hidden="true"></span>
        <span>{status.label}</span>
      </span>
      {#if status.detail}
        <span class="status-detail" title={status.detail}>{status.detail}</span>
      {/if}
    </div>
    {#if status.showProgress}
      <div class="status-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={status.progress}>
        <span style:width={`${status.progress}%`}></span>
      </div>
    {/if}
  </header>

  <div class="inspector-tabs" role="tablist" aria-label="Inspector views">
    <div class="tab-row">
      <button
        type="button"
        class="tab"
        class:active={mode === 'now'}
        role="tab"
        aria-selected={mode === 'now'}
        onclick={() => commandCenterStore.showNow()}
      >
        <Zap size={13} strokeWidth={1.9} aria-hidden="true" />
        <span>Now</span>
      </button>
      <button
        type="button"
        class="tab"
        class:active={mode === 'inbox'}
        class:tab-attention={inboxCount > 0 && mode !== 'inbox'}
        role="tab"
        aria-selected={mode === 'inbox'}
        onclick={() => commandCenterStore.showInbox()}
      >
        <Inbox size={13} strokeWidth={1.9} aria-hidden="true" />
        <span>Inbox</span>
        {#if inboxCount > 0}
          <strong class="tab-badge" data-tone="warn">{inboxCount}</strong>
        {/if}
      </button>
      <button
        type="button"
        class="tab"
        class:active={mode === 'history'}
        role="tab"
        aria-selected={mode === 'history'}
        onclick={() => commandCenterStore.showHistory()}
      >
        <History size={13} strokeWidth={1.9} aria-hidden="true" />
        <span>History</span>
        {#if historyCount > 0}
          <strong class="tab-badge">{historyCount}</strong>
        {/if}
      </button>
    </div>
    <button
      type="button"
      class="tab-trailing"
      class:active={mode === 'templates'}
      title="Action templates"
      aria-label="Action templates"
      aria-pressed={mode === 'templates'}
      onclick={() => commandCenterStore.showTemplates()}
    >
      {#if mode === 'templates'}
        <X size={13} strokeWidth={1.9} aria-hidden="true" />
      {:else}
        <Sparkles size={13} strokeWidth={1.9} aria-hidden="true" />
      {/if}
    </button>
  </div>

  <div class="inspector-body scrollbar-thin">
    {#if mode === 'templates'}
      <CommandTemplatePanel />
    {:else if mode === 'inbox'}
      {#if unappliedResults.length === 0}
        <div class="empty-panel" role="status">
          <Inbox size={20} strokeWidth={1.6} aria-hidden="true" />
          <strong>Inbox is clear</strong>
          <span>Workspace changes from the agent will land here for you to apply.</span>
        </div>
      {:else}
        <div class="result-stack" role="list" aria-label="Workspace results awaiting review">
          {#each unappliedResults as operation (operation.id)}
            {@const expanded = selectedResultOperation?.id === operation.id}
            <article class="result-card" class:expanded role="listitem">
              <button
                type="button"
                class="result-card-summary"
                aria-expanded={expanded}
                onclick={() => selectResult(operation.id)}
              >
                <span class="result-icon" aria-hidden="true">
                  <CheckCircle2 size={15} strokeWidth={1.8} />
                </span>
                <span class="result-main">
                  <strong>{operation.label}</strong>
                  <span>
                    {operation.result?.outputs.length ?? 0} change{(operation.result?.outputs.length ?? 0) === 1 ? '' : 's'} ready
                    {#if operation.completedAt}
                      / {formatTime(operation.completedAt.toISOString())}
                    {/if}
                  </span>
                </span>
              </button>
              <div class="result-actions">
                <button
                  type="button"
                  class="result-btn primary"
                  onclick={(event) => { event.stopPropagation(); void applyResult(operation.id); }}
                >
                  <Check size={13} strokeWidth={2} aria-hidden="true" />
                  <span>Apply</span>
                </button>
                <button
                  type="button"
                  class="result-btn ghost"
                  onclick={(event) => { event.stopPropagation(); discardResult(operation.id); }}
                >
                  Discard
                </button>
              </div>
              {#if expanded}
                <div class="result-detail">
                  <OperationDetail
                    {operation}
                    onApply={handleApplyResult}
                    onDiscard={handleDiscardResult}
                    onClose={() => commandCenterStore.clearResultOperation()}
                  />
                </div>
              {/if}
            </article>
          {/each}
        </div>
      {/if}
    {:else if mode === 'history'}
      {#if runs.length === 0}
        <div class="empty-panel" role="status">
          <History size={20} strokeWidth={1.6} aria-hidden="true" />
          <strong>No past work yet</strong>
          <span>Once the agent completes a run, it will be filed here for reference.</span>
        </div>
      {:else}
        <div class="history-stack">
          {#each historyByDay as group (group.label)}
            <section class="history-group" aria-label={`Runs / ${group.label}`}>
              <div class="history-group-label">{group.label}</div>
              <div class="history-list">
                {#each group.runs as run (run.id)}
                  {@const completed = run.tasks.filter((task) => task.status === 'completed').length}
                  {@const live = isLiveRun(run)}
                  <button
                    type="button"
                    class="history-row"
                    class:active={selectedRun?.id === run.id}
                    data-status={run.status}
                    onclick={() => selectHistoryRun(run)}
                  >
                    <span class="history-icon" aria-hidden="true">
                      {#if run.status === 'completed'}
                        <CheckCircle2 size={14} strokeWidth={1.9} />
                      {:else if run.status === 'failed'}
                        <CircleAlert size={14} strokeWidth={1.9} />
                      {:else if run.status === 'waiting_approval'}
                        <Clock3 size={14} strokeWidth={1.9} />
                      {:else if live}
                        <Loader2 size={14} strokeWidth={1.9} class="spin" />
                      {:else}
                        <CircleDashed size={14} strokeWidth={1.9} />
                      {/if}
                    </span>
                    <span class="history-main">
                      <strong>{run.prompt}</strong>
                      <span>
                        {formatStatus(run.status)}
                        / {completed}/{run.tasks.length} tasks
                        / {runOutputSummary(run)}
                      </span>
                    </span>
                    {#if live}
                      <span class="history-live">Live</span>
                    {:else}
                      <span class="history-time">{formatTime(run.createdAt)}</span>
                    {/if}
                  </button>
                {/each}
              </div>
            </section>
          {/each}
        </div>
      {/if}
    {:else}
      <!-- mode === 'now' -->
      {#if activeRuns.length > 0}
        <section class="swarm-ops-board" aria-label="Swarm operations overview">
          <div class="swarm-ops-head">
            <strong>Swarm operations</strong>
            <span>{activeSwarmMetrics.swarms}/{activeSwarmMetrics.runs} swarm mode</span>
          </div>

          <div class="swarm-metric-grid" aria-label="Active swarm metrics">
            <div>
              <span>Runs</span>
              <strong>{activeSwarmMetrics.runs}</strong>
            </div>
            <div>
              <span>Workers</span>
              <strong>{activeSwarmMetrics.workerRunning}/{activeSwarmMetrics.workerTotal}</strong>
            </div>
            <div>
              <span>Outputs</span>
              <strong>{activeSwarmMetrics.outputCount}</strong>
            </div>
            <div>
              <span>Notes</span>
              <strong>{activeSwarmMetrics.noteCount}</strong>
            </div>
            <div>
              <span>Sources</span>
              <strong>{activeSwarmMetrics.sourceCount}</strong>
            </div>
            <div>
              <span>Media</span>
              <strong>{activeSwarmMetrics.mediaCount}</strong>
            </div>
          </div>

          <div class="swarm-pressure-row" aria-label="Swarm queue pressure">
            <div class="swarm-pressure-main">
              <span>Progress</span>
              <strong>{activeSwarmMetrics.progress}% average</strong>
            </div>
            <div class="swarm-pressure-bar" aria-hidden="true">
              <span style:width={`${activeSwarmMetrics.progress}%`}></span>
            </div>
            <div class="swarm-pressure-facts">
              <span>{activeSwarmMetrics.activeLanes} write lane{activeSwarmMetrics.activeLanes === 1 ? '' : 's'}</span>
              <span class:queued={activeSwarmMetrics.queuedWrites > 0}>{activeSwarmMetrics.queuedWrites} queued</span>
              {#if activeSwarmMetrics.contendedSurfaces > 0}
                <span data-tone="warn">{activeSwarmMetrics.contendedSurfaces} hotspot{activeSwarmMetrics.contendedSurfaces === 1 ? '' : 's'}</span>
              {/if}
              {#if activeSwarmMetrics.approvals > 0}
                <span data-tone="warn">{activeSwarmMetrics.approvals} approval{activeSwarmMetrics.approvals === 1 ? '' : 's'}</span>
              {/if}
            </div>
          </div>
        </section>
      {/if}

      {#if collaborationSurfaces.length > 0}
        <section class="collaboration-board" aria-label="Realtime collaboration map">
          <div class="collaboration-board-head">
            <strong>Collaboration map</strong>
            <span>{collaborationSurfaces.length} surface{collaborationSurfaces.length === 1 ? '' : 's'}</span>
          </div>
          <div class="collaboration-list" role="list">
            {#each collaborationSurfaces.slice(0, 4) as surface (surface.id)}
              <article
                class="collaboration-row"
                data-kind={surface.kind}
                data-pressure={surface.pressure}
                role="listitem"
                title={surface.resourceIds.join('\n')}
              >
                <span class="collaboration-kind">{surfaceKindLabel(surface.kind)}</span>
                <span class="collaboration-main">
                  <span class="collaboration-title">{surface.title}</span>
                  <span class="collaboration-meta">{surfaceMeta(surface)}</span>
                </span>
                <span class="collaboration-state" class:queued={surface.queuedWrites > 0}>
                  {#if surface.queuedWrites > 0}
                    {surface.queuedWrites} waiting
                  {:else}
                    Live
                  {/if}
                </span>
              </article>
            {/each}
            {#if collaborationSurfaces.length > 4}
              <div class="collaboration-more">+{collaborationSurfaces.length - 4} more</div>
            {/if}
          </div>
        </section>
      {/if}

      {#if collaborationHotspots.length > 0}
        <section class="hotspot-board" aria-label="Collaboration hotspots">
          <div class="hotspot-board-head">
            <strong>Collaboration hotspots</strong>
            <span>{liveHotspotCount} live / {collaborationHotspots.length} tracked</span>
          </div>
          <div class="hotspot-list" role="list">
            {#each collaborationHotspots.slice(0, 4) as hotspot (hotspot.id)}
              <article
                class="hotspot-row"
                data-kind={hotspot.kind}
                data-active={hotspot.currentlyActive}
                role="listitem"
              >
                <span class="hotspot-main">
                  <span class="hotspot-title">{hotspot.title}</span>
                  <span class="hotspot-meta">{hotspotMeta(hotspot)}</span>
                </span>
                <span class="hotspot-state" class:live={hotspot.currentlyActive}>
                  {hotspotState(hotspot)}
                </span>
              </article>
            {/each}
            {#if collaborationHotspots.length > 4}
              <div class="hotspot-more">+{collaborationHotspots.length - 4} more</div>
            {/if}
          </div>
        </section>
      {/if}

      {#if activeRuns.length > 1}
        <section class="active-run-board" aria-label="Active agent runs">
          <div class="active-run-board-head">
            <strong>Active fleet</strong>
            <span>{activeRuns.length} live</span>
          </div>
          <div class="active-run-list" role="list">
            {#each activeRuns as run (run.id)}
              <button
                type="button"
                class="active-run-row"
                class:active={selectedRun?.id === run.id || (!selectedRun && activeRun?.id === run.id)}
                data-status={run.status}
                onclick={() => selectActiveRun(run)}
              >
                <span class="active-run-main">
                  <span class="active-run-title">{run.prompt}</span>
                  <span class="active-run-meta">
                    {runScopeLabel(run)} / {formatStatus(run.status)} / {runWorkerSummary(run)} / {runOutputSummary(run)}
                  </span>
                </span>
                <span class="active-run-progress" aria-label={`${runProgress(run)} percent complete`}>
                  <span style:width={`${runProgress(run)}%`}></span>
                </span>
              </button>
            {/each}
          </div>
        </section>
      {/if}

      {#if lineageVisible}
        <section class="lineage-action-board" aria-label="Lineage actions">
          <div class="lineage-action-head">
            <strong>{lineageLineLabel}</strong>
            <span>{lineageStore.notePath ?? 'No note selected'}</span>
          </div>

          {#if lineageStore.loading}
            <div class="lineage-action-empty">Loading lineage.</div>
          {:else if lineageStore.error}
            <div class="lineage-action-empty lineage-action-error">{lineageStore.error.message}</div>
          {:else if !lineageCurrent}
            <div class="lineage-action-empty">No lineage recorded for this line.</div>
          {:else}
            <pre class="lineage-action-current">{lineageCurrent.content}</pre>
            <div class="lineage-action-facts" aria-label="Lineage target details">
              <span>{lineageActorLabel()}</span>
              <span>{lineageIntentLabel()}</span>
              <span>{lineagePreviousVersions.length} previous</span>
              {#if lineageWarnings.length > 0}
                <span data-tone="warn">{lineageWarnings.length} warning{lineageWarnings.length === 1 ? '' : 's'}</span>
              {/if}
            </div>
            <div class="lineage-action-grid" role="group" aria-label="Lineage action shortcuts">
              <button type="button" onclick={() => openLineageWorkspace('focused')}>
                <History size={12} strokeWidth={1.9} aria-hidden="true" />
                <span>History</span>
              </button>
              <button type="button" onclick={() => openLineageWorkspace('focused')}>
                <Route size={12} strokeWidth={1.9} aria-hidden="true" />
                <span>Trace</span>
              </button>
              <button
                type="button"
                disabled={lineagePreviousVersions.length === 0 || lineageStore.restoring}
                onclick={restoreLatestLineageVersion}
              >
                <RotateCcw size={12} strokeWidth={1.9} aria-hidden="true" />
                <span>Restore</span>
              </button>
              <button
                type="button"
                disabled={!lineageRepairTarget || lineageStore.repairing}
                onclick={repairLineageTarget}
              >
                <Wrench size={12} strokeWidth={1.9} aria-hidden="true" />
                <span>Repair</span>
              </button>
              <button type="button" onclick={openBranchPicker}>
                <GitBranch size={12} strokeWidth={1.9} aria-hidden="true" />
                <span>Branches</span>
              </button>
            </div>
          {/if}
        </section>
      {/if}

      {#if writeLanes.length > 0}
        <section class="write-lane-board" aria-label="Write lanes">
          <div class="write-lane-board-head">
            <strong>Write lanes</strong>
            <span>{writeLanes.filter((lane) => lane.queued > 0).length} queued</span>
          </div>
          <div class="write-lane-list" role="list">
            {#each writeLanes.slice(0, 5) as lane (lane.resourceId)}
              <div class="write-lane-row" data-kind={lockKind(lane.resourceId)} role="listitem">
                <span class="write-lane-mark" aria-hidden="true"></span>
                <span class="write-lane-main">
                  <span class="write-lane-title">{lockTitle(lane.resourceId)}</span>
                  <span class="write-lane-meta">{lane.resourceId}</span>
                </span>
                <span class="write-lane-state" class:queued={lane.queued > 0}>
                  {lockMeta(lane)}
                </span>
              </div>
            {/each}
            {#if writeLanes.length > 5}
              <div class="write-lane-more">+{writeLanes.length - 5} more</div>
            {/if}
          </div>
        </section>
      {/if}

      {#if nowRun}
        <CommandRunCard run={nowRun} />
        {#if nowProgress > 0 && nowProgress < 100 && !isActiveAgentRun(nowRun)}
          <div class="now-progress-detail">{nowProgress}% complete</div>
        {/if}
      {:else if activeOperations.length > 0}
        <div class="now-operations" role="list">
          {#each activeOperations as operation (operation.id)}
            <OperationItem
              {operation}
              onCancel={() => handleCancelOperation(operation.id)}
              onSelect={() => operationsStore.selectOperation(operation.id)}
            />
          {/each}
        </div>
      {:else if writeLanes.length === 0 && !lineageVisible && collaborationHotspots.length === 0}
        <div class="empty-panel" role="status">
          <Zap size={20} strokeWidth={1.6} aria-hidden="true" />
          <strong>Nothing in flight</strong>
          <span>Send a prompt or run a template — live progress will appear here.</span>
          <button
            type="button"
            class="empty-action"
            onclick={() => commandCenterStore.showTemplates()}
          >
            <Sparkles size={13} strokeWidth={1.9} aria-hidden="true" />
            <span>Browse templates</span>
          </button>
        </div>
      {/if}
    {/if}
  </div>
</aside>

<style>
  .inspector {
    display: flex;
    flex-direction: column;
    container-type: inline-size;
    min-width: 0;
    min-height: 0;
    border-left: 1px solid var(--border-light);
    background: var(--bg-app);
  }

  /* ─── Status header ─── */
  .status-header {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px;
    border-bottom: 1px solid var(--border-light);
    background: var(--bg-app);
  }

  .status-header[data-tone='warn'] {
    background: color-mix(in srgb, var(--color-warning-bg) 50%, var(--bg-app));
  }

  .status-line {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  .status-pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
    height: 22px;
    padding: 0 9px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-full);
    background: var(--bg-card);
    color: var(--text-secondary);
    font-size: 11px;
    font-weight: 650;
    line-height: 1;
    letter-spacing: -0.005em;
  }

  .status-pill[data-tone='live'] {
    border-color: color-mix(in srgb, var(--ai-accent) 35%, var(--border-light));
    background: var(--ai-tint);
    color: var(--ai-accent);
  }

  .status-pill[data-tone='warn'] {
    border-color: color-mix(in srgb, var(--color-warning) 40%, var(--border-light));
    background: var(--color-warning-bg);
    color: var(--color-warning);
  }

  .status-pill[data-tone='ok'] {
    border-color: color-mix(in srgb, var(--color-success) 35%, var(--border-light));
    color: var(--color-success);
  }

  .status-pill[data-tone='error'] {
    border-color: color-mix(in srgb, var(--color-error) 40%, var(--border-light));
    background: var(--color-error-bg);
    color: var(--color-error);
  }

  .status-dot {
    width: 6px;
    height: 6px;
    border-radius: var(--radius-full);
    background: currentColor;
  }

  .status-pill[data-tone='live'] .status-dot {
    animation: statusPulse 1.4s ease-in-out infinite;
  }

  @keyframes statusPulse {
    0%, 100% { opacity: 0.45; transform: scale(0.85); }
    50% { opacity: 1; transform: scale(1); }
  }

  .status-detail {
    overflow: hidden;
    color: var(--text-secondary);
    font-size: 12px;
    line-height: 1.35;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .status-progress {
    width: 100%;
    height: 3px;
    overflow: hidden;
    border-radius: var(--radius-full);
    background: var(--bg-hover);
  }

  .status-progress span {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: var(--ai-accent);
    transition: width var(--transition-normal);
  }

  /* ─── Tab row ─── */
  .inspector-tabs {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 10px;
    border-bottom: 1px solid var(--border-light);
  }

  .tab-row {
    display: inline-flex;
    flex: 1;
    gap: 2px;
    min-width: 0;
    padding: 2px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-md);
    background: var(--bg-editor);
  }

  .tab {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    flex: 1;
    min-width: 0;
    height: 24px;
    padding: 0 8px;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-muted);
    font: inherit;
    font-size: 11px;
    font-weight: 650;
    letter-spacing: -0.005em;
    cursor: pointer;
    transition: color var(--transition-fast), background var(--transition-fast);
  }

  .tab:hover {
    color: var(--text-primary);
  }

  .tab.active {
    background: var(--bg-card);
    color: var(--text-primary);
    box-shadow: var(--shadow-xs);
  }

  .tab-attention {
    color: var(--color-warning);
    animation: tabAttentionPulse 2.4s ease-in-out infinite;
  }

  @keyframes tabAttentionPulse {
    0%, 100% { opacity: 0.85; }
    50% { opacity: 1; }
  }

  .tab-badge {
    min-width: 16px;
    padding: 1px 5px;
    border-radius: var(--radius-full);
    background: var(--ai-tint);
    color: var(--ai-accent);
    font-size: 9.5px;
    font-weight: 700;
    line-height: 1.3;
    text-align: center;
  }

  .tab-badge[data-tone='warn'] {
    background: var(--color-warning-bg);
    color: var(--color-warning);
  }

  .tab-trailing {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 28px;
    height: 28px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-md);
    background: var(--bg-card);
    color: var(--text-secondary);
    cursor: pointer;
    transition: color var(--transition-fast), border-color var(--transition-fast), background var(--transition-fast);
  }

  .tab-trailing:hover {
    border-color: var(--border-medium);
    color: var(--text-primary);
  }

  .tab-trailing.active {
    border-color: color-mix(in srgb, var(--ai-accent) 40%, var(--border-light));
    background: var(--ai-tint);
    color: var(--ai-accent);
  }

  /* ─── Body ─── */
  .inspector-body {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 10px;
    min-height: 0;
    overflow-y: auto;
    padding: 12px;
  }

  /* ─── Empty states ─── */
  .empty-panel {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    margin: auto 0;
    padding: 24px 18px;
    color: var(--text-muted);
    text-align: center;
  }

  .empty-panel :global(svg) {
    color: var(--text-muted);
    opacity: 0.6;
  }

  .empty-panel strong {
    color: var(--text-primary);
    font-size: 13px;
    font-weight: 650;
  }

  .empty-panel span {
    max-width: 240px;
    font-size: 11.5px;
    line-height: 1.45;
  }

  .empty-action {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    margin-top: 6px;
    padding: 0 12px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-md);
    background: var(--bg-card);
    color: var(--text-secondary);
    font: inherit;
    font-size: 11.5px;
    font-weight: 650;
    cursor: pointer;
  }

  .empty-action:hover {
    border-color: var(--ai-accent);
    color: var(--ai-accent);
    background: var(--ai-tint);
  }

  /* ─── Now panel ─── */
  .swarm-ops-board {
    display: flex;
    flex-direction: column;
    gap: 9px;
    padding-bottom: 10px;
    border-bottom: 1px solid var(--border-light);
  }

  .swarm-ops-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-width: 0;
  }

  .swarm-ops-head strong {
    overflow: hidden;
    color: var(--text-primary);
    font-size: 12px;
    font-weight: 650;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .swarm-ops-head span {
    flex-shrink: 0;
    color: var(--text-muted);
    font-size: 10.5px;
    font-variant-numeric: tabular-nums;
  }

  .swarm-metric-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    overflow: hidden;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-md);
    background: var(--bg-card);
  }

  .swarm-metric-grid div {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    padding: 7px 8px;
    border-top: 1px solid var(--border-light);
    border-left: 1px solid var(--border-light);
  }

  .swarm-metric-grid div:nth-child(-n + 3) {
    border-top: 0;
  }

  .swarm-metric-grid div:nth-child(3n + 1) {
    border-left: 0;
  }

  .swarm-metric-grid span {
    overflow: hidden;
    color: var(--text-muted);
    font-size: 9.5px;
    font-weight: 650;
    letter-spacing: var(--text-label-tracking);
    line-height: 1.2;
    text-overflow: ellipsis;
    text-transform: uppercase;
    white-space: nowrap;
  }

  .swarm-metric-grid strong {
    overflow: hidden;
    color: var(--text-primary);
    font-family: var(--font-mono);
    font-size: 12px;
    font-weight: 650;
    line-height: 1.25;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .swarm-pressure-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 6px;
    min-width: 0;
  }

  .swarm-pressure-main {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    min-width: 0;
  }

  .swarm-pressure-main span {
    overflow: hidden;
    color: var(--text-muted);
    font-size: 10px;
    font-weight: 650;
    letter-spacing: var(--text-label-tracking);
    text-overflow: ellipsis;
    text-transform: uppercase;
    white-space: nowrap;
  }

  .swarm-pressure-main strong {
    color: var(--text-secondary);
    font-family: var(--font-mono);
    font-size: 10.5px;
    font-weight: 650;
    white-space: nowrap;
  }

  .swarm-pressure-bar {
    height: 3px;
    overflow: hidden;
    border-radius: var(--radius-full);
    background: var(--bg-hover);
  }

  .swarm-pressure-bar span {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: var(--ai-accent);
  }

  .swarm-pressure-facts {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }

  .swarm-pressure-facts span {
    max-width: 100%;
    overflow: hidden;
    padding: 2px 6px;
    border-radius: var(--radius-full);
    background: var(--bg-hover);
    color: var(--text-muted);
    font-size: 10px;
    font-weight: 650;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .swarm-pressure-facts span.queued,
  .swarm-pressure-facts span[data-tone='warn'] {
    background: var(--color-warning-bg);
    color: var(--color-warning);
  }

  .collaboration-board {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding-bottom: 10px;
    border-bottom: 1px solid var(--border-light);
  }

  .collaboration-board-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-width: 0;
  }

  .collaboration-board-head strong {
    overflow: hidden;
    color: var(--text-primary);
    font-size: 12px;
    font-weight: 650;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .collaboration-board-head span {
    flex-shrink: 0;
    color: var(--text-muted);
    font-size: 10.5px;
    font-variant-numeric: tabular-nums;
  }

  .collaboration-list {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .collaboration-row {
    display: grid;
    grid-template-columns: 46px minmax(0, 1fr) auto;
    align-items: center;
    gap: 8px;
    min-height: 40px;
    padding: 7px 8px;
    border: 1px solid var(--border-light);
    border-left-width: 3px;
    border-radius: var(--radius-md);
    background: var(--bg-card);
  }

  .collaboration-row[data-kind='note'] {
    border-left-color: var(--ai-accent);
  }

  .collaboration-row[data-kind='todo'] {
    border-left-color: var(--color-success);
  }

  .collaboration-row[data-kind='tool'] {
    border-left-color: var(--color-warning);
  }

  .collaboration-row[data-kind='system'] {
    border-left-color: var(--text-muted);
  }

  .collaboration-row[data-pressure='contended'] {
    border-color: color-mix(in srgb, var(--color-warning) 34%, var(--border-light));
    border-left-color: var(--color-warning);
  }

  .collaboration-kind {
    overflow: hidden;
    padding: 2px 5px;
    border-radius: var(--radius-sm);
    background: var(--bg-hover);
    color: var(--text-muted);
    font-size: 9.5px;
    font-weight: 700;
    line-height: 1.25;
    text-align: center;
    text-overflow: ellipsis;
    text-transform: uppercase;
    white-space: nowrap;
  }

  .collaboration-main {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .collaboration-title,
  .collaboration-meta {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .collaboration-title {
    color: var(--text-primary);
    font-size: 11.5px;
    font-weight: 650;
  }

  .collaboration-meta {
    color: var(--text-muted);
    font-size: 10px;
  }

  .collaboration-state {
    padding: 2px 6px;
    border-radius: var(--radius-full);
    background: var(--ai-tint);
    color: var(--ai-accent);
    font-size: 10px;
    font-variant-numeric: tabular-nums;
    font-weight: 650;
    white-space: nowrap;
  }

  .collaboration-state.queued {
    background: var(--color-warning-bg);
    color: var(--color-warning);
  }

  .collaboration-more {
    color: var(--text-muted);
    font-size: 10.5px;
    text-align: right;
  }

  .hotspot-board {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding-bottom: 10px;
    border-bottom: 1px solid var(--border-light);
  }

  .hotspot-board-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-width: 0;
  }

  .hotspot-board-head strong {
    overflow: hidden;
    color: var(--text-primary);
    font-size: 12px;
    font-weight: 650;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .hotspot-board-head span {
    flex-shrink: 0;
    color: var(--text-muted);
    font-size: 10.5px;
    font-variant-numeric: tabular-nums;
  }

  .hotspot-list {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .hotspot-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 8px;
    min-height: 38px;
    padding: 7px 8px;
    border: 1px solid var(--border-light);
    border-left: 3px solid var(--text-muted);
    border-radius: var(--radius-md);
    background: var(--bg-editor);
  }

  .hotspot-row[data-kind='note'] {
    border-left-color: var(--ai-accent);
  }

  .hotspot-row[data-kind='todo'] {
    border-left-color: var(--color-success);
  }

  .hotspot-row[data-kind='tool'] {
    border-left-color: var(--color-warning);
  }

  .hotspot-row[data-active='true'] {
    background: var(--bg-card);
  }

  .hotspot-main {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .hotspot-title,
  .hotspot-meta {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .hotspot-title {
    color: var(--text-primary);
    font-size: 11.5px;
    font-weight: 650;
  }

  .hotspot-meta {
    color: var(--text-muted);
    font-size: 10px;
  }

  .hotspot-state {
    padding: 2px 6px;
    border-radius: var(--radius-full);
    background: var(--bg-hover);
    color: var(--text-secondary);
    font-size: 10px;
    font-variant-numeric: tabular-nums;
    font-weight: 650;
    white-space: nowrap;
  }

  .hotspot-state.live {
    background: var(--color-warning-bg);
    color: var(--color-warning);
  }

  .hotspot-more {
    color: var(--text-muted);
    font-size: 10.5px;
    text-align: right;
  }

  .active-run-board {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding-bottom: 10px;
    border-bottom: 1px solid var(--border-light);
  }

  .active-run-board-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-width: 0;
  }

  .active-run-board-head strong {
    color: var(--text-primary);
    font-size: 12px;
    font-weight: 650;
  }

  .active-run-board-head span {
    color: var(--text-muted);
    font-size: 10.5px;
  }

  .active-run-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .active-run-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 48px;
    align-items: center;
    gap: 8px;
    width: 100%;
    min-height: 46px;
    padding: 8px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-md);
    background: var(--bg-card);
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .active-run-row:hover,
  .active-run-row.active {
    border-color: color-mix(in srgb, var(--ai-accent) 42%, var(--border-light));
    background: var(--ai-tint);
  }

  .active-run-row[data-status='waiting_approval'] {
    border-color: color-mix(in srgb, var(--color-warning) 32%, var(--border-light));
  }

  .active-run-main {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .active-run-title,
  .active-run-meta {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .active-run-title {
    color: var(--text-primary);
    font-size: 11.5px;
    font-weight: 650;
  }

  .active-run-meta {
    color: var(--text-muted);
    font-size: 10.5px;
  }

  .active-run-progress {
    display: block;
    width: 48px;
    height: 4px;
    overflow: hidden;
    border-radius: var(--radius-full);
    background: var(--bg-hover);
  }

  .active-run-progress span {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: var(--ai-accent);
    transition: width var(--transition-normal);
  }

  .lineage-action-board {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding-bottom: 10px;
    border-bottom: 1px solid var(--border-light);
  }

  .lineage-action-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    min-width: 0;
  }

  .lineage-action-head strong {
    color: var(--text-primary);
    font-size: 12px;
    font-weight: 650;
    white-space: nowrap;
  }

  .lineage-action-head span {
    overflow: hidden;
    color: var(--text-muted);
    font-size: 10.5px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .lineage-action-current {
    max-height: 58px;
    overflow: hidden;
    margin: 0;
    padding: 7px 8px;
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-md);
    background: var(--bg-editor);
    color: var(--text-secondary);
    font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace);
    font-size: 10.5px;
    line-height: 1.45;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .lineage-action-facts {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }

  .lineage-action-facts span {
    max-width: 100%;
    overflow: hidden;
    padding: 2px 6px;
    border-radius: var(--radius-full);
    background: var(--bg-hover);
    color: var(--text-muted);
    font-size: 10px;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .lineage-action-facts span[data-tone='warn'] {
    background: var(--color-warning-bg);
    color: var(--color-warning);
  }

  .lineage-action-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 5px;
  }

  .lineage-action-grid button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    min-width: 0;
    height: 28px;
    padding: 0 8px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-md);
    background: var(--bg-card);
    color: var(--text-secondary);
    font: inherit;
    font-size: 10.5px;
    font-weight: 650;
    cursor: pointer;
  }

  .lineage-action-grid button:hover:not(:disabled) {
    border-color: var(--border-medium);
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .lineage-action-grid button:disabled {
    cursor: not-allowed;
    opacity: 0.48;
  }

  .lineage-action-grid button:last-child:nth-child(odd) {
    grid-column: 1 / -1;
  }

  .lineage-action-empty {
    padding: 9px 8px;
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-md);
    background: var(--bg-editor);
    color: var(--text-muted);
    font-size: 11px;
    line-height: 1.4;
  }

  .lineage-action-error {
    color: var(--color-danger);
  }

  .write-lane-board {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding-bottom: 10px;
    border-bottom: 1px solid var(--border-light);
  }

  .write-lane-board-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-width: 0;
  }

  .write-lane-board-head strong {
    color: var(--text-primary);
    font-size: 12px;
    font-weight: 650;
  }

  .write-lane-board-head span {
    color: var(--text-muted);
    font-size: 10.5px;
    font-variant-numeric: tabular-nums;
  }

  .write-lane-list {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .write-lane-row {
    display: grid;
    grid-template-columns: 8px minmax(0, 1fr) auto;
    align-items: center;
    gap: 8px;
    min-height: 38px;
    padding: 7px 8px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-md);
    background: var(--bg-editor);
  }

  .write-lane-mark {
    width: 8px;
    height: 8px;
    border-radius: var(--radius-full);
    background: var(--text-muted);
  }

  .write-lane-row[data-kind='note'] .write-lane-mark {
    background: var(--ai-accent);
  }

  .write-lane-row[data-kind='block'] .write-lane-mark {
    background: var(--accent-secondary);
  }

  .write-lane-row[data-kind='save'] .write-lane-mark {
    background: var(--accent-hover);
  }

  .write-lane-row[data-kind='todo'] .write-lane-mark {
    background: var(--color-success);
  }

  .write-lane-row[data-kind='tool'] .write-lane-mark {
    background: var(--color-warning);
  }

  .write-lane-main {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .write-lane-title,
  .write-lane-meta {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .write-lane-title {
    color: var(--text-primary);
    font-size: 11.5px;
    font-weight: 650;
  }

  .write-lane-meta {
    color: var(--text-muted);
    font-size: 10px;
  }

  .write-lane-state {
    padding: 2px 6px;
    border-radius: var(--radius-full);
    background: var(--bg-hover);
    color: var(--text-secondary);
    font-size: 10px;
    font-variant-numeric: tabular-nums;
    font-weight: 650;
    white-space: nowrap;
  }

  .write-lane-state.queued {
    background: var(--color-warning-bg);
    color: var(--color-warning);
  }

  .write-lane-more {
    color: var(--text-muted);
    font-size: 10.5px;
    text-align: right;
  }

  .now-operations {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .now-progress-detail {
    color: var(--text-muted);
    font-size: 11px;
    text-align: right;
  }

  /* ─── Inbox panel ─── */
  .result-stack {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .result-card {
    display: flex;
    flex-direction: column;
    gap: 9px;
    padding: 11px;
    border: 1px solid color-mix(in srgb, var(--color-warning) 25%, var(--border-light));
    border-left: 3px solid var(--color-warning);
    border-radius: var(--radius-md);
    background: var(--bg-card);
    box-shadow: var(--shadow-xs);
  }

  .result-card.expanded {
    border-color: var(--color-warning);
  }

  .result-card-summary {
    display: grid;
    grid-template-columns: 18px minmax(0, 1fr);
    align-items: center;
    gap: 9px;
    width: 100%;
    padding: 0;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .result-icon {
    display: inline-flex;
    color: var(--color-warning);
  }

  .result-main {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .result-main strong,
  .result-main span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .result-main strong {
    color: var(--text-primary);
    font-size: 12.5px;
    font-weight: 650;
  }

  .result-main span {
    color: var(--text-muted);
    font-size: 11px;
  }

  .result-actions {
    display: flex;
    gap: 6px;
  }

  .result-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    height: 28px;
    padding: 0 12px;
    border-radius: var(--radius-sm);
    font: inherit;
    font-size: 11.5px;
    font-weight: 650;
    cursor: pointer;
  }

  .result-btn.primary {
    flex: 1;
    border: 0;
    background: var(--ai-accent);
    color: var(--text-inverse);
    box-shadow: 0 1px 2px rgba(99, 102, 241, 0.25);
  }

  .result-btn.primary:hover {
    background: var(--ai-accent-strong);
  }

  .result-btn.ghost {
    border: 1px solid var(--border-light);
    background: transparent;
    color: var(--text-secondary);
  }

  .result-btn.ghost:hover {
    border-color: var(--color-error);
    color: var(--color-error);
  }

  .result-detail {
    border-top: 1px solid var(--border-light);
    padding-top: 9px;
  }

  /* ─── History panel ─── */
  .history-stack {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .history-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .history-group-label {
    color: var(--text-muted);
    font-size: 10px;
    font-weight: 650;
    letter-spacing: var(--text-label-tracking);
    text-transform: uppercase;
  }

  .history-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .history-row {
    display: grid;
    grid-template-columns: 18px minmax(0, 1fr) auto;
    align-items: center;
    gap: 9px;
    width: 100%;
    padding: 9px 10px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-md);
    background: var(--bg-card);
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition: border-color var(--transition-fast), background var(--transition-fast);
  }

  .history-row:hover {
    border-color: var(--border-medium);
    background: var(--bg-hover);
  }

  .history-row.active {
    border-color: var(--ai-border);
    background: var(--ai-tint);
  }

  .history-icon {
    display: inline-flex;
    color: var(--text-muted);
  }

  .history-row[data-status='completed'] .history-icon { color: var(--color-success); }
  .history-row[data-status='failed'] .history-icon { color: var(--color-error); }
  .history-row[data-status='waiting_approval'] .history-icon { color: var(--color-warning); }

  .history-main {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .history-main strong,
  .history-main span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .history-main strong {
    color: var(--text-primary);
    font-size: 12px;
    font-weight: 600;
  }

  .history-main span {
    color: var(--text-muted);
    font-size: 10.5px;
    text-transform: capitalize;
  }

  .history-time {
    color: var(--text-muted);
    font-size: 10.5px;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .history-live {
    padding: 2px 7px;
    border-radius: var(--radius-full);
    background: var(--ai-tint);
    color: var(--ai-accent);
    font-size: 9.5px;
    font-weight: 700;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    white-space: nowrap;
  }

  :global(.history-icon .spin) {
    animation: historySpin 1s linear infinite;
  }

  @keyframes historySpin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  @container (max-width: 360px) {
    .swarm-metric-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .swarm-metric-grid div:nth-child(-n + 3),
    .swarm-metric-grid div:nth-child(3n + 1) {
      border-top: 1px solid var(--border-light);
      border-left: 1px solid var(--border-light);
    }

    .swarm-metric-grid div:nth-child(-n + 2) {
      border-top: 0;
    }

    .swarm-metric-grid div:nth-child(2n + 1) {
      border-left: 0;
    }

    .inspector-tabs {
      flex-wrap: wrap;
    }

    .collaboration-row {
      grid-template-columns: minmax(0, 1fr) auto;
    }

    .collaboration-kind {
      display: none;
    }

    .tab-trailing {
      order: 2;
    }
  }

  @media (max-width: 900px) {
    .inspector {
      border-top: 1px solid var(--border-light);
      border-left: 0;
    }
  }
</style>
