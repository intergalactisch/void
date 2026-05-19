<script lang="ts">
  import {
    CheckCircle2,
    ChevronDown,
    ChevronRight,
    CircleAlert,
    CircleDashed,
    CircleStop,
    Clock3,
  } from '@lucide/svelte';
  import { isActiveAgentRun } from '$lib/domain/entities/AgentRun';
  import type { AgentRun } from '$lib/domain/entities/AgentRun';
  import { aiStore, commandCenterStore } from '$lib/stores';
  import CommandArtifacts from './CommandArtifacts.svelte';
  import CommandEventTimeline from './CommandEventTimeline.svelte';
  import CommandTaskGraph from './CommandTaskGraph.svelte';
  import CommandWorkerLanes from './CommandWorkerLanes.svelte';

  interface Props {
    run: AgentRun;
    compact?: boolean;
  }

  let { run, compact = false }: Props = $props();

  let completedTasks = $derived(run.tasks.filter((task) => task.status === 'completed').length);
  let failedTasks = $derived(run.tasks.filter((task) => task.status === 'failed').length);
  let noteArtifacts = $derived(run.artifacts.filter((artifact) => artifact.type === 'note'));
  let sourceArtifacts = $derived(run.artifacts.filter((artifact) => artifact.type === 'source'));
  let mediaArtifacts = $derived(run.artifacts.filter((artifact) => artifact.type === 'media'));
  let completedWorkers = $derived(run.workers.filter((worker) => worker.status === 'completed').length);
  let failedWorkers = $derived(run.workers.filter((worker) => worker.status === 'failed').length);
  let latestArtifacts = $derived(run.artifacts.slice().reverse());
  let activeTask = $derived(
    run.tasks.find((task) => task.status === 'running') ??
      run.tasks.find((task) => task.status === 'pending' || task.status === 'blocked') ??
      null
  );
  let upcomingTask = $derived(
    activeTask?.status === 'running'
      ? run.tasks.find((task) => task.status === 'pending' || task.status === 'blocked') ?? null
      : null
  );
  let progress = $derived(
    run.tasks.length > 0
      ? Math.round(run.tasks.reduce((sum, task) => sum + task.progress, 0) / run.tasks.length)
      : 0
  );
  let active = $derived(isActiveAgentRun(run));
  let collapsed = $derived(compact && commandCenterStore.isRunCollapsed(run.id));
  let selectedWorker = $derived(commandCenterStore.selectedWorker);
  let selectedWorkerForRun = $derived(selectedWorker?.run.id === run.id ? selectedWorker.worker : null);
  let compactDetailsVisible = $derived(
    compact && !collapsed && (run.artifacts.length > 0 || run.events.length > 0 || !!run.finalSummary || !!upcomingTask)
  );

  function formatStatus(status: string): string {
    return status.replace(/_/g, ' ');
  }

  function handleApprove() {
    void aiStore.approveAgentRun(run.id);
  }

  function handleCancel() {
    void aiStore.cancelAgentRun(run.id);
  }

  function handleSelect() {
    commandCenterStore.selectRun(run.id);
  }

  function handleToggleCollapse() {
    commandCenterStore.toggleRunCollapsed(run.id);
  }

  function outputLabel(): string {
    if (run.artifacts.length === 0) return 'No outputs yet';
    const parts = [];
    if (noteArtifacts.length > 0) parts.push(`${noteArtifacts.length} note${noteArtifacts.length === 1 ? '' : 's'}`);
    if (sourceArtifacts.length > 0) parts.push(`${sourceArtifacts.length} source${sourceArtifacts.length === 1 ? '' : 's'}`);
    if (mediaArtifacts.length > 0) parts.push(`${mediaArtifacts.length} media`);
    const otherCount = run.artifacts.length - noteArtifacts.length - sourceArtifacts.length - mediaArtifacts.length;
    if (otherCount > 0) parts.push(`${otherCount} output${otherCount === 1 ? '' : 's'}`);
    return parts.join(' / ');
  }

  function workerLabel(): string {
    if (run.workers.length === 0) return '';
    const failed = failedWorkers > 0 ? ` / ${failedWorkers} failed` : '';
    return `${completedWorkers}/${run.workers.length} workers${failed}`;
  }
</script>

<section class="run-card" class:compact class:collapsed data-status={run.status} aria-label="Agent run">
  <div class="run-head">
    <button type="button" class="run-open" onclick={handleSelect}>
      <span class="run-status-icon" aria-hidden="true">
        {#if run.status === 'completed'}
          <CheckCircle2 size={16} strokeWidth={1.8} />
        {:else if run.status === 'failed'}
          <CircleAlert size={16} strokeWidth={1.8} />
        {:else if run.status === 'cancelled'}
          <CircleStop size={16} strokeWidth={1.8} />
        {:else if run.status === 'waiting_approval'}
          <Clock3 size={16} strokeWidth={1.8} />
        {:else}
          <CircleDashed size={16} strokeWidth={1.8} />
        {/if}
      </span>
      <span class="run-head-main">
        <span class="run-label">{run.orchestrationMode === 'swarm' ? (active ? 'Swarm working' : 'Swarm run') : (active ? 'Agent working' : 'Agent run')}</span>
        <span class="run-title">{run.prompt}</span>
      </span>
      <span class="run-metrics">
        <span>{formatStatus(run.status)}</span>
        <strong>{completedTasks}/{run.tasks.length}</strong>
      </span>
    </button>

    {#if compact}
      <button
        type="button"
        class="run-collapse"
        aria-label={collapsed ? 'Expand agent run' : 'Minimize agent run'}
        title={collapsed ? 'Expand agent run' : 'Minimize agent run'}
        aria-expanded={!collapsed}
        onclick={handleToggleCollapse}
      >
        {#if collapsed}
          <ChevronRight size={15} strokeWidth={1.9} aria-hidden="true" />
        {:else}
          <ChevronDown size={15} strokeWidth={1.9} aria-hidden="true" />
        {/if}
      </button>
    {/if}
  </div>

  {#if !collapsed}
    <div class="run-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={progress}>
      <span style:width={`${progress}%`}></span>
    </div>
  {/if}

  {#if activeTask && !collapsed}
    <div class="run-current">
      <span>Current</span>
      <strong>{activeTask.title}</strong>
    </div>
  {/if}

  {#if !compact}
    <div class="run-snapshot" aria-label="Run snapshot">
      <div>
        <span>Tasks</span>
        <strong>{completedTasks}/{run.tasks.length}</strong>
      </div>
      {#if run.workers.length > 0}
        <div>
          <span>Workers</span>
          <strong>{completedWorkers}/{run.workers.length}</strong>
        </div>
      {/if}
      <div>
        <span>Outputs</span>
        <strong>{run.artifacts.length}</strong>
      </div>
      <div>
        <span>Notes</span>
        <strong>{noteArtifacts.length}</strong>
      </div>
      <div>
        <span>Sources</span>
        <strong>{sourceArtifacts.length}</strong>
      </div>
      {#if failedTasks > 0}
        <div data-tone="error">
          <span>Failed</span>
          <strong>{failedTasks}</strong>
        </div>
      {/if}
    </div>
  {/if}

  {#if run.status === 'waiting_approval' && !collapsed}
    <div class="run-approval">
      <div class="run-approval-copy">
        <strong>Review write scope</strong>
        <span>
          {run.plan?.suggestedFolder ?? 'No folder proposed'} / {run.plan?.suggestedNotes.length ?? 0} notes / {run.plan?.citations.length ?? 0} sources
        </span>
      </div>
      <div class="run-actions">
        <button type="button" class="run-action approve" onclick={handleApprove}>Approve</button>
        <button type="button" class="run-action cancel" onclick={handleCancel}>Cancel</button>
      </div>
    </div>
  {/if}

  {#if run.error && !collapsed}
    <div class="run-error">{run.error}</div>
  {/if}

  {#if compactDetailsVisible}
    <div class="run-compact-detail" aria-label="Run process and outputs">
      <div class="run-compact-summary">
        <span>{outputLabel()}</span>
        {#if run.workers.length > 0}
          <span>{workerLabel()}</span>
        {/if}
        {#if upcomingTask}
          <span>Next: {upcomingTask.title}</span>
        {:else if run.events.length > 0}
          <span>{run.events.length} process events</span>
        {/if}
      </div>

      {#if run.artifacts.length > 0}
        <section class="run-compact-section" aria-label="Recent outputs">
          <div class="run-section-label">
            <span>Outputs</span>
            <strong>{run.artifacts.length}</strong>
          </div>
          <CommandArtifacts artifacts={latestArtifacts} limit={3} compact />
        </section>
      {/if}

      {#if run.workers.length > 0}
        <section class="run-compact-section" aria-label="Worker agents">
          <div class="run-section-label">
            <span>Workers</span>
            <strong>{completedWorkers}/{run.workers.length}</strong>
          </div>
          <CommandWorkerLanes workers={run.workers} messages={run.workerMessages} compact />
        </section>
      {/if}

      {#if run.events.length > 0}
        <section class="run-compact-section" aria-label="Recent process">
          <div class="run-section-label">
            <span>Process</span>
            <strong>Latest</strong>
          </div>
          <CommandEventTimeline events={run.events} limit={4} compact />
        </section>
      {/if}

      {#if run.finalSummary}
        <section class="run-compact-section" aria-label="Run outcome">
          <div class="run-section-label">
            <span>Outcome</span>
          </div>
          <div class="run-compact-outcome">{run.finalSummary}</div>
        </section>
      {/if}
    </div>
  {/if}

  {#if !compact && run.plan}
    <details class="run-section" open={active}>
      <summary>Plan</summary>
      <p class="run-plan-summary">{run.plan.summary}</p>
      <ol class="run-plan-list">
        {#each run.plan.steps as step}
          <li>{step}</li>
        {/each}
      </ol>
    </details>
  {/if}

  {#if !compact && run.tasks.length > 0}
    <details class="run-section" open={active}>
      <summary>Tasks</summary>
      <CommandTaskGraph tasks={run.tasks} />
    </details>
  {/if}

  {#if !compact && run.workers.length > 0}
    <details class="run-section" open={active || run.status === 'completed' || !!selectedWorkerForRun}>
      <summary>Workers</summary>
      <CommandWorkerLanes workers={run.workers} messages={run.workerMessages} />
    </details>
  {/if}

  {#if !compact && run.merge?.summary}
    <details class="run-section" open={active || run.status === 'completed'}>
      <summary>Merge</summary>
      <div class="run-summary">{run.merge.summary}</div>
    </details>
  {/if}

  {#if !compact && run.artifacts.length > 0}
    <details class="run-section" open={active || run.status === 'completed'}>
      <summary>Outputs</summary>
      <CommandArtifacts artifacts={run.artifacts} limit={10} />
    </details>
  {/if}

  {#if !compact && run.finalSummary}
    <details class="run-section" open>
      <summary>Final response</summary>
      <div class="run-summary">{run.finalSummary}</div>
    </details>
  {/if}

  {#if !compact && run.events.length > 0}
    <details class="run-section">
      <summary>Timeline</summary>
      <CommandEventTimeline events={run.events} />
    </details>
  {/if}

  {#if !compact && active && run.status !== 'waiting_approval'}
    <div class="run-footer">
      <button type="button" class="run-cancel-inline" onclick={handleCancel}>Cancel run</button>
    </div>
  {/if}
</section>

<style>
  .run-card {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px;
    border: 1px solid var(--ai-border);
    border-radius: var(--radius-lg);
    background: color-mix(in srgb, var(--ai-tint) 55%, var(--bg-card));
    box-shadow: var(--shadow-xs);
  }

  .run-card.compact {
    padding: 10px;
  }

  .run-head {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: start;
    gap: 8px;
    width: 100%;
  }

  .run-open {
    display: grid;
    grid-template-columns: 20px minmax(0, 1fr) auto;
    align-items: start;
    gap: 8px;
    min-width: 0;
    padding: 0;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .run-collapse {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
  }

  .run-collapse:hover {
    border-color: var(--border-light);
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .run-status-icon {
    display: inline-flex;
    color: var(--ai-accent);
  }

  .run-card[data-status='completed'] .run-status-icon {
    color: var(--color-success);
  }

  .run-card[data-status='failed'] .run-status-icon {
    color: var(--color-error);
  }

  .run-card[data-status='cancelled'] .run-status-icon {
    color: var(--text-muted);
  }

  .run-head-main {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .run-label {
    color: var(--text-muted);
    font-size: 10.5px;
    font-weight: 650;
    letter-spacing: var(--text-label-tracking);
    text-transform: uppercase;
  }

  .run-title {
    overflow: hidden;
    color: var(--text-primary);
    font-size: 13px;
    font-weight: 650;
    line-height: 1.35;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .run-metrics {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--text-muted);
    font-size: 11px;
    line-height: 1.35;
    text-transform: capitalize;
    white-space: nowrap;
  }

  .run-metrics strong {
    color: var(--text-secondary);
    font-family: var(--font-mono);
    font-size: 10.5px;
  }

  .run-progress {
    height: 3px;
    overflow: hidden;
    border-radius: var(--radius-full);
    background: var(--bg-hover);
  }

  .run-progress span {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: var(--ai-accent);
    transition: width var(--transition-normal);
  }

  .run-current {
    display: grid;
    grid-template-columns: 62px minmax(0, 1fr);
    gap: 8px;
    color: var(--text-muted);
    font-size: 11px;
  }

  .run-current strong {
    overflow: hidden;
    color: var(--text-secondary);
    font-weight: 550;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .run-snapshot {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    overflow: hidden;
    border-top: 1px solid var(--border-light);
    border-bottom: 1px solid var(--border-light);
  }

  .run-snapshot div {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    padding: 7px 9px;
    border-left: 1px solid var(--border-light);
  }

  .run-snapshot div:first-child {
    border-left: 0;
  }

  .run-snapshot span {
    overflow: hidden;
    color: var(--text-muted);
    font-size: 10px;
    font-weight: 650;
    letter-spacing: var(--text-label-tracking);
    text-overflow: ellipsis;
    text-transform: uppercase;
    white-space: nowrap;
  }

  .run-snapshot strong {
    overflow: hidden;
    color: var(--text-primary);
    font-family: var(--font-mono);
    font-size: 12px;
    font-weight: 650;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .run-snapshot div[data-tone='error'] strong {
    color: var(--color-error);
  }

  .run-compact-detail {
    display: flex;
    flex-direction: column;
    gap: 9px;
    padding-top: 2px;
  }

  .run-compact-summary {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 12px;
    color: var(--text-muted);
    font-size: 11px;
    line-height: 1.35;
  }

  .run-compact-summary span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .run-compact-section {
    display: flex;
    flex-direction: column;
    gap: 5px;
    min-width: 0;
    padding-top: 8px;
    border-top: 1px solid var(--border-light);
  }

  .run-section-label {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    color: var(--text-muted);
    font-size: 10px;
    font-weight: 650;
    letter-spacing: var(--text-label-tracking);
    line-height: 1.2;
    text-transform: uppercase;
  }

  .run-section-label strong {
    color: var(--text-placeholder);
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 650;
    letter-spacing: 0;
    text-transform: none;
  }

  .run-compact-outcome {
    display: -webkit-box;
    overflow: hidden;
    color: var(--text-secondary);
    font-size: 11.5px;
    line-height: 1.45;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;
    line-clamp: 3;
  }

  .run-approval {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 9px;
    border: 1px solid color-mix(in srgb, var(--ai-accent) 35%, var(--border-light));
    border-radius: var(--radius-md);
    background: var(--bg-card);
  }

  .run-approval-copy {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    font-size: 11.5px;
  }

  .run-approval-copy strong {
    color: var(--text-primary);
    font-size: 12px;
  }

  .run-approval-copy span {
    overflow: hidden;
    color: var(--text-muted);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .run-actions {
    display: flex;
    align-items: center;
    gap: 5px;
    flex-shrink: 0;
  }

  .run-action,
  .run-cancel-inline {
    height: 26px;
    padding: 0 10px;
    border-radius: var(--radius-sm);
    font: inherit;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
  }

  .run-action.approve {
    border: 0;
    background: var(--ai-accent);
    color: var(--text-inverse);
  }

  .run-action.cancel,
  .run-cancel-inline {
    border: 1px solid var(--border-light);
    background: var(--bg-card);
    color: var(--text-secondary);
  }

  .run-cancel-inline:hover,
  .run-action.cancel:hover {
    border-color: var(--border-medium);
    color: var(--text-primary);
  }

  .run-error {
    padding: 8px 9px;
    border: 1px solid var(--color-error);
    border-radius: var(--radius-md);
    background: var(--color-error-bg);
    color: var(--color-error);
    font-size: 12px;
  }

  .run-section {
    min-width: 0;
  }

  .run-section summary {
    color: var(--text-secondary);
    font-size: 11px;
    font-weight: 650;
    cursor: pointer;
  }

  .run-section[open] summary {
    margin-bottom: 8px;
  }

  .run-plan-summary,
  .run-summary {
    margin: 0;
    color: var(--text-secondary);
    font-size: 12px;
    line-height: 1.5;
    white-space: pre-wrap;
  }

  .run-plan-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 8px 0 0;
    padding-left: 18px;
    color: var(--text-secondary);
    font-size: 11.5px;
    line-height: 1.45;
  }

  .run-footer {
    display: flex;
    justify-content: flex-end;
  }

  @container (max-width: 520px) {
    .run-approval {
      align-items: stretch;
      flex-direction: column;
    }

    .run-actions {
      justify-content: flex-end;
    }
  }
</style>
