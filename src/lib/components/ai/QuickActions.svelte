<script lang="ts">
  /**
   * QuickActions - Template-based quick actions for the sidebar
   *
   * Displays operation templates as a list with inline variable forms.
   * Replaces the OperationsPanel template selector.
   */

  import { aiStore, notesStore, operationsStore } from '$lib/stores';
  import type { OperationTemplate } from '$lib/domain/values/OperationTemplate';
  import type { Operation } from '$lib/domain/entities/Operation';
  import OperationItem from '$lib/components/operations/OperationItem.svelte';
  import OperationDetail from '$lib/components/operations/OperationDetail.svelte';
  import { isSessionOperation } from '$lib/domain/entities/Operation';
  import type { SessionOperation } from '$lib/domain/entities/Operation';
  import { isActiveAgentRun } from '$lib/domain/entities/AgentRun';
  import type { AgentArtifact, AgentRun, ResearchCitation } from '$lib/domain/entities/AgentRun';
  import { CirclePlay, History, Inbox, ListChecks, Zap } from '@lucide/svelte';

  type WorkMode = 'processes' | 'runs' | 'actions' | 'results';

  let selectedTemplate = $state<OperationTemplate | null>(null);
  let templateVariables = $state<Record<string, string>>({});
  let selectedOperation = $state<Operation | null>(null);
  let selectedRunId = $state<string | null>(null);
  let workMode = $state<WorkMode>('processes');

  const runTimeFormatter = new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  let templates = $derived(aiStore.templates);
  let agentRuns = $derived(aiStore.agentRunState.runs);
  let visibleAgentRuns = $derived(agentRuns.slice(0, 12));
  let activeRunIds = $derived.by(() => {
    const ids = new Set<string>();
    for (const run of agentRuns) {
      if (isActiveAgentRun(run)) ids.add(run.id);
    }
    if (isActiveAgentRun(aiStore.agentRunState.currentRun)) {
      ids.add(aiStore.agentRunState.currentRun.id);
    }
    return ids;
  });
  let activeProcessCount = $derived(activeRunIds.size + operationsStore.activeOperations.length);
  let activeRun = $derived(aiStore.agentRunState.currentRun ?? agentRuns.find((run) => isActiveAgentRun(run)) ?? null);
  let latestRun = $derived(agentRuns[0] ?? null);
  let selectedRun = $derived(
    agentRuns.find((run) => run.id === selectedRunId) ?? (workMode === 'processes' ? activeRun : null)
  );
  let selectedRunActiveTask = $derived(
    selectedRun?.tasks.find((task) => task.status === 'running') ??
      selectedRun?.tasks.find((task) => task.status === 'pending' || task.status === 'blocked') ??
      null
  );
  let selectedRunIsActive = $derived(isActiveAgentRun(selectedRun));
  let selectedRunCompletedCount = $derived(selectedRun?.tasks.filter((task) => task.status === 'completed').length ?? 0);
  let selectedRunOpenTasks = $derived(
    selectedRun?.tasks.filter((task) => task.status !== 'completed' && task.status !== 'cancelled') ?? []
  );
  let selectedRunNotes = $derived(selectedRun?.artifacts.filter((artifact) => artifact.type === 'note') ?? []);
  let selectedRunFolders = $derived(selectedRun?.artifacts.filter((artifact) => artifact.type === 'folder') ?? []);
  let selectedRunSources = $derived(selectedRun ? getRunSources(selectedRun) : []);
  let selectedRunOtherArtifacts = $derived(
    selectedRun?.artifacts.filter((artifact) => artifact.type !== 'note' && artifact.type !== 'folder' && artifact.type !== 'source') ?? []
  );
  let selectedRunTimeline = $derived(selectedRun?.events.slice(-12).reverse() ?? []);

  /** Completed operations with unapplied workspace results */
  let unappliedResults = $derived(operationsStore.unappliedResultOperations);

  /** Terminal operations without unapplied results (history) */
  let historyOps = $derived(
    operationsStore.historyOperations.filter(op => !op.result || op.result.outputs.length === 0)
  );
  let resultsCount = $derived(unappliedResults.length + operationsStore.sessions.length + historyOps.length);

  function handleTemplateSelect(template: OperationTemplate) {
    if (template.variables.length > 0) {
      selectedTemplate = template;
      templateVariables = {};
      for (const v of template.variables) {
        templateVariables[v.name] = v.default?.toString() ?? '';
      }
    } else {
      aiStore.queueFromTemplate(template.id, {});
      aiStore.setSidebarView('chat');
    }
  }

  function handleTemplateSubmit() {
    if (!selectedTemplate) return;
    aiStore.queueFromTemplate(selectedTemplate.id, templateVariables);
    selectedTemplate = null;
    templateVariables = {};
    aiStore.setSidebarView('chat');
  }

  function handleCancel(operationId: string) {
    operationsStore.cancel(operationId as never);
  }

  function handleSelect(operationId: string) {
    operationsStore.selectOperation(operationId as never);
  }

  function handleResume(operation: SessionOperation) {
    operationsStore.selectOperation(operation.id);
  }

  function handleResultSelect(operation: Operation) {
    selectedOperation = selectedOperation?.id === operation.id ? null : operation;
  }

  function handleApply() {
    if (selectedOperation) {
      operationsStore.applyResult(selectedOperation.id);
      selectedOperation = null;
    }
  }

  function handleDiscard() {
    if (selectedOperation) {
      operationsStore.discardResult(selectedOperation.id);
      selectedOperation = null;
    }
  }

  function handleApproveRun(runId: string) {
    void aiStore.approveAgentRun(runId);
  }

  function handleCancelRun(runId: string) {
    void aiStore.cancelAgentRun(runId);
  }

  function handleOpenArtifact(path: string | undefined) {
    if (!path) return;
    notesStore.selectNoteByAnyPath(path);
  }

  function formatStatus(status: string): string {
    return status.replace(/_/g, ' ');
  }

  function formatEventType(type: string): string {
    return type.replace('.', ' ');
  }

  function formatRunTime(iso: string): string {
    return runTimeFormatter.format(new Date(iso));
  }

  function sourceHost(url: string | undefined): string {
    if (!url) return '';
    try {
      return new URL(url).host;
    } catch {
      return url;
    }
  }

  function getRunSources(run: AgentRun): ResearchCitation[] {
    const sources = new Map<string, ResearchCitation>();

    for (const citation of run.plan?.citations ?? []) {
      sources.set(citation.finalUrl ?? citation.url, citation);
    }

    for (const artifact of run.artifacts) {
      if (artifact.citation) {
        sources.set(artifact.citation.finalUrl ?? artifact.citation.url, artifact.citation);
      } else if (artifact.type === 'source' && artifact.url) {
        sources.set(artifact.url, {
          title: artifact.title,
          url: artifact.url,
          fetchedAt: artifact.createdAt,
          status: 'verified',
          sourceType: 'web',
        });
      }
    }

    return [...sources.values()];
  }

  function openArtifact(artifact: AgentArtifact) {
    if (artifact.path) {
      handleOpenArtifact(artifact.path);
      return;
    }
    if (artifact.url) {
      window.open(artifact.url, '_blank', 'noopener,noreferrer');
    }
  }
</script>

<div class="quick-actions">
  <div class="work-nav" role="tablist" aria-label="Work views">
    <button type="button" class="work-nav-btn" class:active={workMode === 'processes'} role="tab" aria-selected={workMode === 'processes'} onclick={() => { workMode = 'processes'; }}>
      <CirclePlay size={14} class="work-nav-icon" aria-hidden="true" />
      <span>Processes</span>
      {#if activeProcessCount > 0}
        <strong>{activeProcessCount}</strong>
      {/if}
    </button>
    <button type="button" class="work-nav-btn" class:active={workMode === 'runs'} role="tab" aria-selected={workMode === 'runs'} onclick={() => { workMode = 'runs'; }}>
      <History size={14} class="work-nav-icon" aria-hidden="true" />
      <span>Runs</span>
      {#if agentRuns.length > 0}
        <strong>{agentRuns.length}</strong>
      {/if}
    </button>
    <button type="button" class="work-nav-btn" class:active={workMode === 'actions'} role="tab" aria-selected={workMode === 'actions'} onclick={() => { workMode = 'actions'; }}>
      <Zap size={14} class="work-nav-icon" aria-hidden="true" />
      <span>Actions</span>
    </button>
    <button type="button" class="work-nav-btn" class:active={workMode === 'results'} role="tab" aria-selected={workMode === 'results'} onclick={() => { workMode = 'results'; }}>
      <Inbox size={14} class="work-nav-icon" aria-hidden="true" />
      <span>Results</span>
      {#if resultsCount > 0}
        <strong>{resultsCount}</strong>
      {/if}
    </button>
  </div>

  {#if (workMode === 'processes' || workMode === 'runs') && selectedRun}
    <div class="section command-center" data-status={selectedRun.status}>
      <div class="section-header">
        <div class="section-title-group">
          <h3 class="section-title">{selectedRunIsActive ? 'Running Process' : 'Run Detail'}</h3>
          <span class="run-status-pill" data-status={selectedRun.status}>{formatStatus(selectedRun.status)}</span>
        </div>
        {#if isActiveAgentRun(selectedRun)}
          <button type="button" class="section-clear" onclick={() => handleCancelRun(selectedRun.id)}>
            Cancel
          </button>
        {/if}
      </div>

      <div class="command-head">
        <span class="command-prompt">{selectedRun.prompt}</span>
        <span class="command-meta">
          {formatRunTime(selectedRun.createdAt)} / {selectedRunCompletedCount}/{selectedRun.tasks.length} done / {selectedRun.artifacts.length} artifacts
        </span>
        {#if selectedRunActiveTask}
          <span class="command-active">{selectedRunActiveTask.title}</span>
        {/if}
      </div>

      {#if selectedRun.status === 'waiting_approval'}
        <div class="command-approval">
          <div class="command-approval-copy">
            <span class="command-approval-title">Write review</span>
            <span class="command-approval-line">
              {selectedRun.plan?.suggestedFolder ?? 'No folder proposed'} / {selectedRun.plan?.suggestedNotes.length ?? 0} notes / {selectedRunSources.length} sources
            </span>
          </div>
          <div class="run-actions">
            <button type="button" class="run-action run-approve" onclick={() => handleApproveRun(selectedRun.id)}>
              Approve
            </button>
            <button type="button" class="run-action run-cancel" onclick={() => handleCancelRun(selectedRun.id)}>
              Cancel
            </button>
          </div>
        </div>
      {/if}

      {#if selectedRun.error}
        <div class="command-error">{selectedRun.error}</div>
      {/if}

      {#if selectedRunIsActive && selectedRunOpenTasks.length > 0}
        <div class="command-subtitle">Active Queue</div>
        <div class="command-task-rail" aria-label="Active AI tasks">
          {#each selectedRunOpenTasks as task (task.id)}
            <div class="command-task" data-status={task.status}>
              <span class="command-task-dot" aria-hidden="true"></span>
              <span class="command-task-title">{task.title}</span>
              <span class="command-task-status">{formatStatus(task.status)}</span>
            </div>
          {/each}
        </div>
      {:else if selectedRunIsActive && selectedRun.tasks.length > 0}
        <div class="command-empty-line">No open AI tasks</div>
      {/if}

      {#if selectedRun.finalSummary}
        <details class="command-disclosure" open={selectedRunIsActive}>
          <summary>Summary</summary>
          <div class="command-summary">{selectedRun.finalSummary}</div>
        </details>
      {/if}

      {#if selectedRunNotes.length > 0 || selectedRunFolders.length > 0 || selectedRunOtherArtifacts.length > 0}
        <details class="command-disclosure" open={selectedRunIsActive}>
          <summary>Outputs</summary>
          <div class="command-output-groups">
            {#if selectedRunFolders.length > 0}
              <div class="command-output-group">
                <span class="command-output-label">Folders</span>
                {#each selectedRunFolders.slice(0, 4) as artifact (artifact.id)}
                  <button type="button" class="command-artifact" disabled={!artifact.path && !artifact.url} onclick={() => openArtifact(artifact)}>
                    <strong>{artifact.title}</strong>
                    <span>{artifact.path ?? artifact.url ?? artifact.type}</span>
                  </button>
                {/each}
              </div>
            {/if}

            {#if selectedRunNotes.length > 0}
              <div class="command-output-group">
                <span class="command-output-label">Notes</span>
                {#each selectedRunNotes.slice(0, 8) as artifact (artifact.id)}
                  <button type="button" class="command-artifact" disabled={!artifact.path && !artifact.url} onclick={() => openArtifact(artifact)}>
                    <strong>{artifact.title}</strong>
                    <span>{artifact.path ?? artifact.url ?? artifact.type}</span>
                  </button>
                {/each}
              </div>
            {/if}

            {#if selectedRunOtherArtifacts.length > 0}
              <div class="command-output-group">
                <span class="command-output-label">Other</span>
                {#each selectedRunOtherArtifacts.slice(0, 4) as artifact (artifact.id)}
                  <button type="button" class="command-artifact" disabled={!artifact.path && !artifact.url} onclick={() => openArtifact(artifact)}>
                    <strong>{artifact.title}</strong>
                    <span>{artifact.type}</span>
                  </button>
                {/each}
              </div>
            {/if}
          </div>
        </details>
      {/if}

      {#if selectedRunSources.length > 0}
        <details class="command-disclosure">
          <summary>Sources</summary>
          <div class="command-sources" aria-label="Verified sources">
            {#each selectedRunSources.slice(0, 6) as source (source.finalUrl ?? source.url)}
              <a class="command-source" href={source.finalUrl ?? source.url} target="_blank" rel="noreferrer" data-status={source.status ?? 'verified'}>
                <span class="command-source-title">{source.title}</span>
                <span class="command-source-meta">{source.status ?? 'verified'} / {sourceHost(source.finalUrl ?? source.url)}</span>
              </a>
            {/each}
          </div>
        </details>
      {/if}

      {#if selectedRunTimeline.length > 0}
        <details class="command-disclosure">
          <summary>Timeline</summary>
          <div class="command-timeline" aria-label="Run timeline">
            {#each selectedRunTimeline as event (event.id)}
              <div class="command-event">
                <span class="command-event-type">{formatEventType(event.type)}</span>
                <span class="command-event-message">{event.message ?? event.type}</span>
              </div>
            {/each}
          </div>
        </details>
      {/if}
    </div>
  {/if}

  {#if workMode === 'processes'}
    {#if operationsStore.activeOperations.length > 0}
      <div class="section">
        <h3 class="section-title">Operations</h3>
        {#each operationsStore.activeOperations as operation (operation.id)}
          <OperationItem
            {operation}
            onCancel={() => handleCancel(operation.id)}
            onSelect={() => handleSelect(operation.id)}
          />
        {/each}
      </div>
    {/if}

    {#if !selectedRun && operationsStore.activeOperations.length === 0}
      <div class="section process-empty">
        <div class="process-empty-head">
          <span class="process-empty-icon" aria-hidden="true">
            <ListChecks size={16} />
          </span>
          <div class="process-empty-copy">
            <strong>No active work</strong>
            <span>Ready for the next run</span>
          </div>
        </div>
        <div class="process-empty-actions">
          <button type="button" class="process-empty-action primary" onclick={() => { workMode = 'actions'; }}>
            <Zap size={14} aria-hidden="true" />
            <span>Actions</span>
          </button>
          <button type="button" class="process-empty-action" onclick={() => { workMode = 'runs'; }}>
            <History size={14} aria-hidden="true" />
            <span>Run history</span>
          </button>
        </div>
        {#if latestRun}
          <button
            type="button"
            class="process-latest"
            onclick={() => { selectedRunId = latestRun.id; workMode = 'runs'; }}
          >
            <span>Latest: {latestRun.prompt}</span>
            <strong>{formatStatus(latestRun.status)}</strong>
          </button>
        {/if}
      </div>
    {/if}
  {:else if workMode === 'runs'}
    <div class="section">
      <h3 class="section-title">Run History</h3>
      {#if visibleAgentRuns.length > 0}
        <div class="agent-runs">
          {#each visibleAgentRuns as run (run.id)}
            <div class="agent-run-row" data-status={run.status} data-active={isActiveAgentRun(run)} data-selected={selectedRun?.id === run.id}>
              <div class="agent-run-main">
                <button type="button" class="agent-run-prompt" onclick={() => { selectedRunId = run.id; }}>{run.prompt}</button>
                <span class="agent-run-meta">{formatStatus(run.status)} / {run.tasks.filter((task) => task.status === 'completed').length}/{run.tasks.length} done</span>
              </div>
              {#if run.status === 'waiting_approval'}
                <div class="run-actions">
                  <button type="button" class="run-action run-approve" onclick={() => handleApproveRun(run.id)}>
                    Approve
                  </button>
                  <button type="button" class="run-action run-cancel" onclick={() => handleCancelRun(run.id)}>
                    Cancel
                  </button>
                </div>
              {:else if isActiveAgentRun(run)}
                <button type="button" class="run-action run-cancel" onclick={() => handleCancelRun(run.id)}>
                  Cancel
                </button>
              {/if}
            </div>
          {/each}
        </div>
      {:else}
        <div class="empty-state">
          <p class="empty-text">No runs yet</p>
        </div>
      {/if}
    </div>
  {:else if workMode === 'actions'}
    {#if selectedTemplate}
      <div class="template-form-container">
        <form class="template-form" onsubmit={(e) => { e.preventDefault(); handleTemplateSubmit(); }}>
          <h4 class="form-title">{selectedTemplate.name}</h4>
          <p class="form-desc">{selectedTemplate.description}</p>
          {#each selectedTemplate.variables as variable}
            <div class="form-field">
              <label class="form-label" for="var-{variable.name}">{variable.name}</label>
              <input
                id="var-{variable.name}"
                type="text"
                class="form-input"
                placeholder={variable.description}
                bind:value={templateVariables[variable.name]}
                required={variable.required}
              />
            </div>
          {/each}
          <div class="form-actions">
            <button type="button" class="btn-cancel" onclick={() => { selectedTemplate = null; }}>Cancel</button>
            <button type="submit" class="btn-run">Run</button>
          </div>
        </form>
      </div>
    {:else}
      <div class="templates-list scrollbar-thin">
        {#if templates.length === 0}
          <div class="empty-state">
            <p class="empty-text">No templates available</p>
          </div>
        {:else}
          {#each templates as template (template.id)}
            <button
              type="button"
              class="template-card"
              onclick={() => handleTemplateSelect(template)}
            >
              <div class="template-icon">
                <Zap size={16} strokeWidth={1.6} aria-hidden="true" />
              </div>
              <div class="template-info">
                <span class="template-name">{template.name}</span>
                <span class="template-desc">{template.description}</span>
              </div>
            </button>
          {/each}
        {/if}
      </div>
    {/if}
  {:else if workMode === 'results'}
    {#if unappliedResults.length > 0}
      <div class="section">
        <h3 class="section-title">Unapplied Results</h3>
        {#if selectedOperation}
          <div class="detail-container">
            <OperationDetail
              operation={selectedOperation}
              onApply={handleApply}
              onDiscard={handleDiscard}
              onClose={() => { selectedOperation = null; }}
            />
          </div>
        {/if}
        {#each unappliedResults as operation (operation.id)}
          <OperationItem
            {operation}
            onSelect={() => handleResultSelect(operation)}
          />
        {/each}
      </div>
    {/if}

    {#if operationsStore.sessions.length > 0}
      <div class="section">
        <h3 class="section-title">Sessions</h3>
        {#each operationsStore.sessions as operation (operation.id)}
          <OperationItem
            {operation}
            onSelect={() => handleSelect(operation.id)}
            onResume={() => {
              if (isSessionOperation(operation)) handleResume(operation);
            }}
          />
        {/each}
      </div>
    {/if}

    {#if historyOps.length > 0}
      <div class="section">
        <div class="section-header">
          <h3 class="section-title">History</h3>
          <button
            type="button"
            class="section-clear"
            onclick={() => operationsStore.clearHistory()}
          >
            Clear
          </button>
        </div>
        {#each historyOps as operation (operation.id)}
          <OperationItem
            {operation}
            onSelect={() => handleSelect(operation.id)}
            onResume={() => {
              if (isSessionOperation(operation)) handleResume(operation);
            }}
          />
        {/each}
      </div>
    {/if}

    {#if resultsCount === 0}
      <div class="section process-empty">
        <div class="process-empty-head">
          <span class="process-empty-icon" aria-hidden="true">
            <Inbox size={16} />
          </span>
          <div class="process-empty-copy">
            <strong>No unapplied results</strong>
            <span>Completed work will collect here</span>
          </div>
        </div>
      </div>
    {/if}
  {/if}
</div>

<style>
  .quick-actions {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    container-type: inline-size;
  }

  .work-nav {
    position: sticky;
    top: 0;
    z-index: 2;
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 2px;
    overflow: hidden;
    padding: 10px 16px;
    border-bottom: 1px solid var(--border-light);
    background: var(--bg-app);
  }

  .work-nav-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    min-width: 0;
    height: 30px;
    padding: 0 8px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-muted);
    font: inherit;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
  }

  .work-nav-btn:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }

  .work-nav-btn.active {
    color: var(--text-primary);
    background: var(--bg-card);
    box-shadow: 0 0 0 1px var(--border-light);
  }

  .work-nav-btn span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .work-nav-btn :global(.work-nav-icon) {
    flex-shrink: 0;
  }

  .work-nav-btn strong {
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    border-radius: 999px;
    background: var(--ai-tint);
    color: var(--ai-accent);
    font-size: 10px;
    font-weight: 700;
    line-height: 16px;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }

  .section {
    padding: 12px 16px;
    border-bottom: 1px solid var(--border-light);
  }

  .section-title {
    margin: 0 0 6px;
    padding: 0 4px;
    font-size: 0.6875rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted);
  }

  .section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .section-header .section-title {
    margin-bottom: 0;
  }

  .section-title-group {
    display: flex;
    align-items: center;
    min-width: 0;
    gap: 6px;
  }

  .section-clear {
    font-size: 0.6875rem;
    font-weight: 500;
    color: var(--text-muted);
    background: none;
    border: none;
    cursor: pointer;
    padding: 2px 6px;
    border-radius: var(--radius-sm);
    transition: all 150ms ease;
  }

  .section-clear:hover {
    color: var(--text-secondary);
    background: var(--bg-hover);
  }

  .agent-runs {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .agent-run-row {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 38px;
    padding: 6px 8px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-sm);
    background: var(--bg-card);
  }

  .agent-run-row[data-active='true'] {
    border-color: color-mix(in srgb, var(--ai-accent) 45%, var(--border-light));
  }

  .agent-run-row[data-selected='true'] {
    border-color: var(--ai-accent);
    background: var(--ai-tint);
  }

  .agent-run-main {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1;
  }

  .agent-run-prompt {
    width: 100%;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--text-primary);
    font-size: 12px;
    font-weight: 500;
    font-family: inherit;
    text-align: left;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: pointer;
  }

  .agent-run-prompt:hover {
    text-decoration: underline;
  }

  .agent-run-meta {
    color: var(--text-muted);
    font-size: 10.5px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .command-center {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .run-status-pill {
    display: inline-flex;
    align-items: center;
    max-width: 120px;
    height: 18px;
    padding: 0 6px;
    border-radius: 999px;
    background: var(--bg-hover);
    color: var(--text-muted);
    font-size: 10px;
    font-weight: 600;
    text-transform: capitalize;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .run-status-pill[data-status='planning'],
  .run-status-pill[data-status='searching'],
  .run-status-pill[data-status='executing'],
  .run-status-pill[data-status='reviewing'] {
    background: var(--ai-tint);
    color: var(--ai-accent);
  }

  .run-status-pill[data-status='waiting_approval'] {
    background: var(--ai-tint);
    color: var(--ai-accent);
  }

  .run-status-pill[data-status='failed'] {
    background: color-mix(in srgb, var(--color-error) 12%, transparent);
    color: var(--color-error);
  }

  .command-head {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .command-prompt {
    color: var(--text-primary);
    font-size: 12px;
    font-weight: 650;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .command-meta,
  .command-active {
    color: var(--text-muted);
    font-size: 10.5px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .command-subtitle {
    color: var(--text-muted);
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .run-actions {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
  }

  .command-active {
    color: var(--text-secondary);
  }

  .command-task-rail,
  .command-output-groups,
  .command-sources,
  .command-timeline {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .command-task {
    display: grid;
    grid-template-columns: 8px minmax(0, 1fr) auto;
    gap: 6px;
    align-items: center;
    min-height: 18px;
  }

  .command-task-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--text-placeholder);
  }

  .command-task[data-status='running'] .command-task-dot {
    background: var(--ai-accent);
    animation: quickAgentPulse 1.2s ease-in-out infinite;
  }

  .command-task[data-status='completed'] .command-task-dot {
    background: var(--color-success);
  }

  .command-task[data-status='failed'] .command-task-dot {
    background: var(--color-error);
  }

  .command-task-title {
    color: var(--text-secondary);
    font-size: 10.5px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .command-task-status {
    color: var(--text-placeholder);
    font-size: 10px;
    text-transform: capitalize;
    white-space: nowrap;
  }

  .command-approval {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 7px 8px;
    border: 1px solid color-mix(in srgb, var(--ai-accent) 35%, var(--border-light));
    border-radius: var(--radius-sm);
    background: var(--ai-tint);
  }

  .command-approval-copy {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .command-approval-title {
    color: var(--text-primary);
    font-size: 11px;
    font-weight: 650;
  }

  .command-approval-line,
  .command-empty-line {
    color: var(--text-muted);
    font-size: 10.5px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .process-empty {
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-height: 118px;
  }

  .process-empty-head {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  .process-empty-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-sm);
    background: var(--bg-card);
    color: var(--ai-accent);
    flex-shrink: 0;
  }

  .process-empty-copy {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }

  .process-empty-copy strong,
  .process-empty-copy span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .process-empty-copy strong {
    color: var(--text-primary);
    font-size: 13px;
    font-weight: 650;
  }

  .process-empty-copy span {
    color: var(--text-muted);
    font-size: 12px;
  }

  .process-empty-actions {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }

  .process-empty-action {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 30px;
    padding: 0 10px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-sm);
    background: var(--bg-card);
    color: var(--text-secondary);
    font: inherit;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }

  .process-empty-action:hover {
    border-color: var(--border-medium);
    color: var(--text-primary);
    background: var(--bg-hover);
  }

  .process-empty-action.primary {
    border-color: color-mix(in srgb, var(--ai-accent) 35%, var(--border-light));
    color: var(--ai-accent);
    background: var(--ai-tint);
  }

  .process-latest {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 8px;
    align-items: center;
    min-height: 36px;
    padding: 6px 8px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-sm);
    background: var(--bg-card);
    color: var(--text-secondary);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .process-latest:hover {
    border-color: var(--border-medium);
    color: var(--text-primary);
    background: var(--bg-hover);
  }

  .process-latest span,
  .process-latest strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .process-latest span {
    font-size: 11.5px;
    font-weight: 550;
  }

  .process-latest strong {
    color: var(--text-muted);
    font-size: 10.5px;
    font-weight: 600;
    text-transform: capitalize;
  }

  .command-disclosure {
    border-top: 1px solid var(--border-faint);
    padding-top: 6px;
  }

  .command-disclosure summary {
    cursor: pointer;
    color: var(--text-muted);
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    list-style: none;
  }

  .command-disclosure summary::-webkit-details-marker {
    display: none;
  }

  .command-disclosure summary::before {
    content: '›';
    display: inline-block;
    margin-right: 5px;
    color: var(--text-placeholder);
  }

  .command-disclosure[open] summary::before {
    transform: rotate(90deg);
  }

  .command-disclosure[open] > :not(summary) {
    margin-top: 6px;
  }

  .command-summary,
  .command-error {
    padding: 9px 10px;
    border-radius: var(--radius-sm);
    background: var(--bg-hover);
    color: var(--text-secondary);
    font-size: 11px;
    line-height: 1.35;
    max-height: 180px;
    overflow: auto;
  }

  .command-error {
    background: color-mix(in srgb, var(--color-error) 9%, transparent);
    color: var(--color-error);
  }

  .command-output-group {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .command-output-label {
    color: var(--text-placeholder);
    font-size: 10px;
    font-weight: 600;
  }

  .command-artifact {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(72px, 38%);
    gap: 8px;
    align-items: center;
    width: 100%;
    min-height: 20px;
    padding: 0 2px;
    border: none;
    background: transparent;
    font-family: inherit;
    font-size: 10.5px;
    text-align: left;
    cursor: pointer;
  }

  .command-artifact:disabled {
    cursor: default;
  }

  .command-artifact span {
    color: var(--text-placeholder);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .command-artifact strong {
    color: var(--text-secondary);
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .command-artifact:not(:disabled):hover strong {
    color: var(--text-primary);
    text-decoration: underline;
  }

  .command-source {
    display: flex;
    flex-direction: column;
    gap: 1px;
    color: inherit;
    text-decoration: none;
    min-width: 0;
  }

  .command-source:hover .command-source-title {
    color: var(--text-primary);
    text-decoration: underline;
  }

  .command-source-title,
  .command-source-meta {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .command-source-title {
    color: var(--text-secondary);
    font-size: 10.5px;
    font-weight: 500;
  }

  .command-source-meta {
    color: var(--text-placeholder);
    font-size: 10px;
  }

  .command-source[data-status='failed'] .command-source-meta {
    color: var(--color-error);
  }

  .command-event {
    display: grid;
    grid-template-columns: 82px minmax(0, 1fr);
    gap: 6px;
    min-height: 18px;
    font-size: 10px;
  }

  .command-event-type,
  .command-event-message {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .command-event-type {
    color: var(--text-placeholder);
  }

  .command-event-message {
    color: var(--text-secondary);
  }

  @keyframes quickAgentPulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  .run-action {
    height: 24px;
    padding: 0 8px;
    border-radius: var(--radius-sm);
    font: inherit;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    flex-shrink: 0;
  }

  .run-approve {
    border: none;
    background: var(--ai-accent);
    color: var(--text-inverse);
  }

  .run-cancel {
    border: 1px solid var(--color-error);
    background: transparent;
    color: var(--color-error);
  }

  .detail-container {
    margin-bottom: 8px;
  }

  .templates-list {
    flex: 1;
    overflow-y: auto;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 8px;
    align-content: start;
    padding: 12px 16px;
  }

  .template-card {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    width: 100%;
    padding: 10px 12px;
    border: 1px solid var(--border-light);
    background: var(--bg-card);
    border-radius: var(--radius-md);
    cursor: pointer;
    text-align: left;
    transition: border-color 150ms ease, background-color 150ms ease;
  }

  .template-card:hover {
    border-color: var(--accent-primary);
    background-color: var(--bg-hover);
  }

  .template-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    background-color: var(--bg-hover);
    border-radius: var(--radius-sm);
    color: var(--accent-primary);
    flex-shrink: 0;
  }

  .template-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .template-name {
    font-size: 13px;
    font-weight: 500;
    color: var(--text-primary);
  }

  .template-desc {
    font-size: 12px;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    line-clamp: 2;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }

  /* Template form */
  .template-form-container {
    padding: 12px;
  }

  .template-form {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .form-title {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .form-desc {
    margin: 0;
    font-size: 12px;
    color: var(--text-secondary);
  }

  .form-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .form-label {
    font-size: 11px;
    font-weight: 600;
    color: var(--text-secondary);
    text-transform: capitalize;
  }

  .form-input {
    padding: 6px 10px;
    font-size: 13px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-md);
    background-color: var(--bg-sidebar);
    color: var(--text-primary);
    transition: border-color 150ms ease;
  }

  .form-input:focus {
    outline: none;
    border-color: var(--accent-primary);
  }

  .form-input::placeholder {
    color: var(--text-muted);
  }

  .form-actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
  }

  .btn-cancel {
    padding: 5px 12px;
    font-size: 13px;
    font-weight: 500;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
  }

  .btn-cancel:hover {
    border-color: var(--text-secondary);
  }

  .btn-run {
    padding: 5px 12px;
    font-size: 13px;
    font-weight: 500;
    border: none;
    border-radius: var(--radius-md);
    background-color: var(--accent-primary);
    color: white;
    cursor: pointer;
  }

  .btn-run:hover {
    background-color: var(--accent-hover);
  }

  .empty-state {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 48px 16px;
  }

  .empty-text {
    font-size: 13px;
    color: var(--text-muted);
    margin: 0;
  }

  @container (min-width: 580px) {
    .templates-list {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .agent-runs {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (max-width: 420px) {
    .work-nav {
      padding-inline: 8px;
    }

    .work-nav-btn {
      gap: 3px;
      padding-inline: 5px;
      font-size: 10.5px;
    }
  }
</style>
