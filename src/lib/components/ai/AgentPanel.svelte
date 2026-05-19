<script lang="ts">
  /**
   * AgentPanel - Status indicator and expandable panel for agent loop operations
   *
   * Shows a compact status badge when an agent is running, expandable
   * to show turn progress, active tools, and a cancel button.
   * Integrates into the AISidebar header area.
   */

  import { aiStore, notesStore } from '$lib/stores';

  /** Whether the detail panel is expanded */
  let expanded = $state(false);

  /** Derived agent state from store */
  let agentLoopState = $derived(aiStore.agentState);
  let agentRunState = $derived(aiStore.agentRunState);
  let currentRun = $derived(agentRunState.currentRun);
  let isRunning = $derived(aiStore.isAgentRunning);
  let runningTasks = $derived(currentRun?.tasks.filter((task) => task.status === 'running') ?? []);
  let completedTasks = $derived(currentRun?.tasks.filter((task) => task.status === 'completed') ?? []);
  let activeQueueTasks = $derived(
    currentRun?.tasks.filter((task) => task.status !== 'completed' && task.status !== 'cancelled') ?? []
  );
  let activeTask = $derived(runningTasks[0] ?? currentRun?.tasks.find((task) => task.status === 'pending' || task.status === 'blocked') ?? null);
  let latestEvent = $derived(currentRun?.events.at(-1) ?? null);
  let recentTimeline = $derived(currentRun?.events.slice(-8).reverse() ?? []);
  let plan = $derived(currentRun?.plan ?? null);
  let planNotes = $derived(plan?.suggestedNotes ?? []);
  let planSources = $derived(plan?.citations ?? []);
  let planExistingNotes = $derived(plan?.existingNotes ?? []);
  let noteArtifacts = $derived(currentRun?.artifacts.filter((artifact) => artifact.type === 'note') ?? []);
  let sourceArtifacts = $derived(currentRun?.artifacts.filter((artifact) => artifact.type === 'source') ?? []);
  let mediaArtifacts = $derived(currentRun?.artifacts.filter((artifact) => artifact.type === 'media') ?? []);
  let approvalHasSourceWarning = $derived(
    currentRun?.status === 'waiting_approval' && planSources.length === 0
  );
  let isTerminalRun = $derived(
    currentRun?.status === 'completed' ||
    currentRun?.status === 'failed' ||
    currentRun?.status === 'cancelled'
  );

  /** Status label for display */
  let statusLabel = $derived.by(() => {
    if (currentRun) {
      switch (currentRun.status) {
        case 'planning': return 'Planning';
        case 'searching': return 'Searching notes and sources';
        case 'waiting_approval': return 'Waiting for approval';
        case 'executing': return 'Working through tasks';
        case 'reviewing': return 'Reviewing changes';
        case 'completed': return 'Completed';
        case 'failed': return 'Failed';
        case 'cancelled': return 'Cancelled';
      }
    }

    switch (agentLoopState.status) {
      case 'planning': return 'Planning...';
      case 'executing': return `Turn ${agentLoopState.currentTurn}/${agentLoopState.maxTurns}`;
      case 'waiting_approval': return 'Waiting for approval';
      case 'completed': return 'Completed';
      case 'failed': return 'Failed';
      case 'cancelled': return 'Cancelled';
      default: return '';
    }
  });

  /** Progress percentage */
  let progressPercent = $derived.by(() => {
    if (currentRun && currentRun.tasks.length > 0) {
      const total = currentRun.tasks.reduce((sum, task) => sum + task.progress, 0);
      return Math.round(total / currentRun.tasks.length);
    }
    return agentLoopState.maxTurns > 0 ? Math.round((agentLoopState.currentTurn / agentLoopState.maxTurns) * 100) : 0;
  });

  function handleCancel() {
    if (currentRun) {
      void aiStore.cancelAgentRun(currentRun.id);
    } else {
      aiStore.cancelAgent();
    }
  }

  function handleApprove() {
    if (!currentRun) return;
    void aiStore.approveAgentRun(currentRun.id);
  }

  function handleOpenArtifact(path: string | undefined) {
    if (!path) return;
    notesStore.selectNoteByAnyPath(path);
  }

  function handleOpenWork() {
    aiStore.setSidebarView('actions');
  }

  function sourceHost(url: string | undefined): string {
    if (!url) return '';
    try {
      return new URL(url).host;
    } catch {
      return url;
    }
  }

  function toggleExpanded() {
    expanded = !expanded;
  }
</script>

{#if currentRun || isRunning || agentLoopState.status === 'waiting_approval'}
  <div class="agent-panel">
    <!-- Compact status bar -->
    <button
      type="button"
      class="agent-status"
      class:agent-status-terminal={isTerminalRun}
      onclick={toggleExpanded}
      aria-expanded={expanded}
      aria-label="Agent loop status: {statusLabel}"
    >
      <span class="agent-indicator" aria-hidden="true"></span>
      <span class="agent-label">{statusLabel}</span>
      <span class="agent-tools-count">
        {currentRun ? `${completedTasks.length}/${currentRun.tasks.length} tasks` : `${agentLoopState.activeTools.length} active`}
      </span>
      <svg
        class="agent-chevron"
        class:agent-chevron-up={expanded}
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </button>

    <!-- Expanded detail view -->
    {#if expanded}
      <div class="agent-detail">
        <!-- Progress bar -->
        <div class="agent-progress-track" role="progressbar" aria-valuenow={progressPercent} aria-valuemin={0} aria-valuemax={100}>
          <div class="agent-progress-fill" style="width: {progressPercent}%"></div>
        </div>

        {#if currentRun}
          <div class="agent-run-head">
            <div class="agent-run-title-row">
              <span class="agent-run-title">{currentRun.prompt}</span>
              <button type="button" class="agent-open-work" onclick={handleOpenWork}>
                Work
              </button>
            </div>
            <span class="agent-run-id">{currentRun.id}</span>
            {#if activeTask}
              <span class="agent-run-current">{activeTask.title}</span>
            {/if}
            {#if latestEvent?.message}
              <span class="agent-run-latest">{latestEvent.message}</span>
            {/if}
          </div>

          {#if currentRun.plan}
            <div class="agent-plan">
              <p class="agent-plan-summary">{currentRun.plan.summary}</p>
              <div class="agent-plan-steps">
                {#each currentRun.plan.steps as step, i}
                  <div class="agent-plan-step">
                    <span class="agent-step-num">{i + 1}.</span>
                    <span class="agent-step-desc">{step}</span>
                  </div>
                {/each}
              </div>
            </div>
          {/if}

          {#if currentRun.status === 'waiting_approval'}
            <div class="agent-approval">
              <div class="agent-approval-main">
                <span class="agent-approval-title">Review write scope</span>
                {#if plan?.suggestedFolder}
                  <span class="agent-approval-line">Folder: {plan.suggestedFolder}</span>
                {/if}
                <span class="agent-approval-line">
                  {planNotes.length} notes · {planSources.length} sources · {planExistingNotes.length} existing matches
                </span>
                {#if approvalHasSourceWarning}
                  <span class="agent-approval-warning">No verified web sources yet.</span>
                {/if}
              </div>
              <div class="agent-approval-actions">
                <button type="button" class="agent-approve" onclick={handleApprove}>
                  Approve writes
                </button>
                <button type="button" class="agent-approval-cancel" onclick={handleCancel}>
                  Cancel
                </button>
              </div>
            </div>
          {/if}

          {#if planSources.length > 0}
            <div class="agent-sources" aria-label="Verified research sources">
              <span class="agent-section-title">Verified sources</span>
              {#each planSources.slice(0, 5) as source (source.url)}
                <a class="agent-source-row" href={source.url} target="_blank" rel="noreferrer">
                  <span class="agent-source-title">{source.title}</span>
                  <span class="agent-source-meta">{source.status ?? 'verified'} / {sourceHost(source.finalUrl ?? source.url)} / {source.fetchedAt.slice(0, 10)}</span>
                </a>
              {/each}
            </div>
          {/if}

          {#if activeQueueTasks.length > 0}
            <div class="agent-task-list" aria-label="Active agent tasks">
              <span class="agent-section-title">Active queue</span>
              {#each activeQueueTasks as task (task.id)}
                <div class="agent-task-item" data-status={task.status}>
                  <span class="agent-task-dot" aria-hidden="true"></span>
                  <div class="agent-task-main">
                    <span class="agent-task-title">{task.title}</span>
                    {#if task.detail || task.result || task.error}
                      <span class="agent-task-detail">{task.error ?? task.result ?? task.detail}</span>
                    {/if}
                  </div>
                  <span class="agent-task-status">{task.status.replace('_', ' ')}</span>
                </div>
              {/each}
            </div>
          {:else if currentRun.tasks.length > 0}
            <div class="agent-empty-line">No open AI tasks</div>
          {/if}

          {#if recentTimeline.length > 0}
            <div class="agent-timeline" aria-label="Agent run timeline">
              <span class="agent-section-title">Timeline</span>
              {#each recentTimeline as event (event.id)}
                <div class="agent-timeline-row">
                  <span class="agent-timeline-type">{event.type.replace('.', ' ')}</span>
                  <span class="agent-timeline-message">{event.message ?? event.type}</span>
                </div>
              {/each}
            </div>
          {/if}

          {#if sourceArtifacts.length > 0 || noteArtifacts.length > 0 || mediaArtifacts.length > 0}
            <div class="agent-work-map" aria-label="Agent work map">
              <span class="agent-section-title">Work map</span>
              <div class="agent-work-map-grid">
                <span>{noteArtifacts.length} notes</span>
                <span>{sourceArtifacts.length} verified sources</span>
                <span>{mediaArtifacts.length} media</span>
                <span>{currentRun.events.length} events</span>
              </div>
            </div>
          {/if}

          {#if currentRun.artifacts.length > 0}
            <div class="agent-artifacts">
              <span class="agent-artifacts-title">Artifacts</span>
              {#each currentRun.artifacts.slice(0, 6) as artifact (artifact.id)}
                <button
                  type="button"
                  class="agent-artifact"
                  disabled={!artifact.path && !artifact.url}
                  onclick={() => artifact.path ? handleOpenArtifact(artifact.path) : artifact.url ? window.open(artifact.url, '_blank', 'noopener,noreferrer') : undefined}
                >
                  <span class="agent-artifact-type">{artifact.type}</span>
                  <span class="agent-artifact-title">{artifact.title}</span>
                </button>
              {/each}
            </div>
          {/if}
        {:else if agentLoopState.activeTools.length > 0}
          <div class="agent-tools">
            {#each agentLoopState.activeTools as tool (tool.id)}
              <div class="agent-tool-item">
                <span class="agent-tool-dot" aria-hidden="true"></span>
                <span class="agent-tool-name">{tool.toolId}</span>
              </div>
            {/each}
          </div>
        {/if}

        <!-- Plan summary (if available) -->
        {#if !currentRun && agentLoopState.plan}
          <div class="agent-plan">
            <p class="agent-plan-summary">{agentLoopState.plan.summary}</p>
            <div class="agent-plan-steps">
              {#each agentLoopState.plan.steps as step, i}
                <div class="agent-plan-step">
                  <span class="agent-step-num">{i + 1}.</span>
                  <span class="agent-step-desc">{step.description}</span>
                </div>
              {/each}
            </div>
          </div>
        {/if}

        <!-- Stats -->
        <div class="agent-stats">
          <span>{currentRun ? `${completedTasks.length} tasks completed` : `${agentLoopState.completedTools.length} tools completed`}</span>
        </div>

        <!-- Cancel button -->
        {#if !isTerminalRun}
          <button
            type="button"
            class="agent-cancel"
            onclick={handleCancel}
            aria-label="Cancel agent loop"
          >
            Cancel
          </button>
        {/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  .agent-panel {
    border-bottom: 1px solid var(--border-light);
    background: var(--bg-sidebar);
    flex-shrink: 0;
  }

  .agent-status {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 6px 12px;
    border: none;
    background: transparent;
    color: var(--text-secondary);
    font-size: 11px;
    cursor: pointer;
    transition: background-color 150ms ease;
  }

  .agent-status:hover {
    background: var(--bg-hover);
  }

  .agent-status-terminal .agent-indicator {
    animation: none;
    background: var(--text-placeholder);
  }

  .agent-indicator {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent-primary);
    animation: agentPulse 1.5s ease-in-out infinite;
    flex-shrink: 0;
  }

  @keyframes agentPulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  .agent-label {
    font-weight: 500;
    color: var(--text-primary);
    white-space: nowrap;
  }

  .agent-tools-count {
    margin-left: auto;
    color: var(--text-muted);
    font-size: 10px;
  }

  .agent-chevron {
    flex-shrink: 0;
    color: var(--text-muted);
    transition: transform 150ms ease;
  }

  .agent-chevron-up {
    transform: rotate(180deg);
  }

  .agent-detail {
    padding: 8px 12px 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-height: min(56vh, 520px);
    overflow-y: auto;
  }

  .agent-run-head {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .agent-run-title-row {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    min-width: 0;
  }

  .agent-run-title {
    flex: 1;
    min-width: 0;
    font-size: 11px;
    font-weight: 600;
    color: var(--text-primary);
    line-height: 1.35;
  }

  .agent-open-work {
    flex-shrink: 0;
    height: 22px;
    padding: 0 8px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-sm);
    background: var(--bg-card);
    color: var(--text-secondary);
    font: inherit;
    font-size: 10.5px;
    font-weight: 600;
    cursor: pointer;
  }

  .agent-open-work:hover {
    border-color: var(--border-medium);
    color: var(--text-primary);
    background: var(--bg-hover);
  }

  .agent-run-id {
    font-family: var(--font-mono);
    font-size: 9.5px;
    color: var(--text-placeholder);
  }

  .agent-run-current,
  .agent-run-latest {
    font-size: 10.5px;
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .agent-run-latest {
    color: var(--text-placeholder);
  }

  .agent-progress-track {
    height: 3px;
    background: var(--bg-hover);
    border-radius: 2px;
    overflow: hidden;
  }

  .agent-progress-fill {
    height: 100%;
    background: var(--accent-primary);
    border-radius: 2px;
    transition: width 300ms ease;
  }

  .agent-tools {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .agent-tool-item {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 11px;
    color: var(--text-muted);
  }

  .agent-tool-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--accent-primary);
    animation: agentPulse 1.2s ease-in-out infinite;
  }

  .agent-tool-name {
    font-family: var(--font-mono, monospace);
    font-size: 10px;
  }

  .agent-plan {
    padding: 6px 8px;
    background: var(--bg-hover);
    border-radius: var(--radius-sm);
  }

  .agent-plan-summary {
    margin: 0;
    font-size: 11px;
    font-weight: 500;
    color: var(--text-primary);
  }

  .agent-plan-steps {
    margin-top: 4px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .agent-plan-step {
    display: flex;
    gap: 4px;
    font-size: 10px;
    color: var(--text-muted);
  }

  .agent-step-num {
    color: var(--text-placeholder);
    flex-shrink: 0;
  }

  .agent-step-desc {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .agent-approval {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 8px;
    padding: 7px 8px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-sm);
    background: var(--ai-tint);
    color: var(--text-secondary);
    font-size: 11px;
  }

  .agent-approval-main,
  .agent-approval-actions {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }

  .agent-approval-title {
    font-weight: 650;
    color: var(--text-primary);
  }

  .agent-approval-line,
  .agent-approval-warning {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .agent-approval-warning {
    color: var(--color-warning, var(--ai-accent));
    font-weight: 550;
  }

  .agent-approval-actions {
    flex-shrink: 0;
  }

  .agent-approve {
    height: 24px;
    padding: 0 9px;
    border: none;
    border-radius: var(--radius-sm);
    background: var(--ai-accent);
    color: var(--text-inverse);
    font: inherit;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
  }

  .agent-approval-cancel {
    height: 22px;
    padding: 0 9px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-sm);
    background: var(--bg-card);
    color: var(--text-secondary);
    font: inherit;
    font-size: 11px;
    cursor: pointer;
  }

  .agent-task-list,
  .agent-artifacts,
  .agent-timeline,
  .agent-work-map,
  .agent-sources {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .agent-section-title {
    font-size: 10px;
    font-weight: 600;
    color: var(--text-muted);
  }

  .agent-empty-line {
    color: var(--text-muted);
    font-size: 10.5px;
  }

  .agent-task-item {
    display: grid;
    grid-template-columns: 7px minmax(0, 1fr) auto;
    align-items: start;
    gap: 6px;
    min-height: 24px;
    font-size: 10.5px;
    color: var(--text-muted);
  }

  .agent-task-dot {
    width: 6px;
    height: 6px;
    margin-top: 5px;
    border-radius: 50%;
    background: var(--text-placeholder);
  }

  .agent-task-item[data-status='running'] .agent-task-dot {
    background: var(--ai-accent);
    animation: agentPulse 1.2s ease-in-out infinite;
  }

  .agent-task-item[data-status='completed'] .agent-task-dot {
    background: var(--color-success);
  }

  .agent-task-item[data-status='failed'] .agent-task-dot {
    background: var(--color-error);
  }

  .agent-task-main {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .agent-task-title {
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .agent-task-detail {
    color: var(--text-placeholder);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .agent-task-status {
    color: var(--text-placeholder);
    white-space: nowrap;
  }

  .agent-artifacts {
    padding-top: 2px;
  }

  .agent-artifacts-title {
    font-size: 10px;
    font-weight: 600;
    color: var(--text-muted);
  }

  .agent-artifact {
    display: grid;
    grid-template-columns: 44px minmax(0, 1fr);
    gap: 5px;
    width: 100%;
    padding: 0;
    border: none;
    background: transparent;
    text-align: left;
    font-size: 10px;
    font-family: inherit;
    cursor: pointer;
  }

  .agent-artifact:disabled {
    cursor: default;
  }

  .agent-artifact:not(:disabled):hover .agent-artifact-title {
    color: var(--text-primary);
    text-decoration: underline;
  }

  .agent-artifact-type {
    color: var(--text-placeholder);
  }

  .agent-artifact-title {
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .agent-timeline {
    padding-top: 2px;
  }

  .agent-timeline-row {
    display: grid;
    grid-template-columns: 82px minmax(0, 1fr);
    gap: 6px;
    min-height: 18px;
    font-size: 10px;
  }

  .agent-timeline-type {
    color: var(--text-placeholder);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .agent-timeline-message {
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .agent-work-map {
    padding: 6px 8px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-sm);
    background: var(--bg-hover);
  }

  .agent-work-map-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 6px;
    font-size: 10px;
    color: var(--text-secondary);
  }

  .agent-work-map-grid span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .agent-source-row {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
    padding: 0;
    color: inherit;
    text-decoration: none;
  }

  .agent-source-row:hover .agent-source-title {
    color: var(--text-primary);
    text-decoration: underline;
  }

  .agent-source-title,
  .agent-source-meta {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .agent-source-title {
    color: var(--text-secondary);
    font-size: 10.5px;
    font-weight: 500;
  }

  .agent-source-meta {
    color: var(--text-placeholder);
    font-size: 10px;
  }

  .agent-stats {
    font-size: 10px;
    color: var(--text-muted);
  }

  .agent-cancel {
    align-self: flex-start;
    padding: 3px 10px;
    font-size: 11px;
    font-weight: 500;
    color: var(--color-error);
    background: transparent;
    border: 1px solid var(--color-error);
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: background-color 150ms ease;
  }

  .agent-cancel:hover {
    background: rgba(239, 68, 68, 0.1);
  }

  .agent-cancel:focus-visible {
    outline: 2px solid var(--accent-primary);
    outline-offset: 2px;
  }
</style>
