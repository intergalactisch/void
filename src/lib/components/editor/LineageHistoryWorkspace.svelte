<script lang="ts">
  import { onMount } from 'svelte';
  import {
    aiStore,
    commandCenterStore,
    editorStore,
    inlineAIStore,
    lineageStore,
    noteAIActivityStore,
    toastStore,
    uiStore,
    type LineageTimelineFilter,
  } from '$lib/stores';
  import {
    AlertTriangle,
    ArchiveRestore,
    CheckCircle2,
    Clock3,
    Copy,
    ExternalLink,
    GitBranch,
    History,
    LocateFixed,
    ListFilter,
    Loader2,
    MessageSquare,
    RotateCcw,
    Route,
    Save,
    Sparkles,
    Trash2,
    X,
  } from '@lucide/svelte';
  import { formatRelativeDate } from '$lib/utils/relativeDate';
  import type {
    LineageDiffHunk,
    LineagePendingTimelineEntry,
    LineageTimelineEntry,
  } from '$lib/ports/inbound/LineageService';
  import type { NoteAIActivityItem } from '$lib/ports/inbound';
  import type { IntentFrame, LineActor } from '$lib/domain/entities/Lineage';
  import type { InlineAIProposedChange, InlineAIThreadStatus } from '$lib/domain/entities/InlineAIThread';
  import { copyTextToClipboard } from '$lib/utils/clipboard';

  type WorkspaceView = 'timeline' | 'ai';

  let workspaceView = $state<WorkspaceView>('timeline');
  const timeline = $derived(lineageStore.timeline);
  const entries = $derived(lineageStore.visibleTimelineEntries);
  const selectedEntry = $derived(lineageStore.selectedEntry);
  const aiItems = $derived(noteAIActivityStore.items);
  const selectedAIItem = $derived(noteAIActivityStore.selectedItem);
  const selectedHunks = $derived(selectedEntry?.diffHunks ?? []);
  const selectedDeletedLines = $derived(selectedEntry?.deletedLines ?? []);
  const hasWorkspace = $derived(lineageStore.visible || uiStore.lineageWorkspaceOpen);
  const focusedLine = $derived(lineageStore.lineIndex !== null ? lineageStore.lineIndex + 1 : null);
  const deletedLines = $derived(lineageStore.deletedLines);
  const restorePreview = $derived(lineageStore.restorePreview);
  const previousVersions = $derived(lineageStore.history?.versions
    .filter((version) => version.id !== lineageStore.explanation?.currentVersion.id)
    .slice()
    .reverse() ?? []);

  function close() {
    lineageStore.close();
    uiStore.closeLineageWorkspace();
  }

  function refresh() {
    void lineageStore.refresh();
    if (lineageStore.notePath) void noteAIActivityStore.loadForDocument(lineageStore.notePath);
  }

  $effect(() => {
    if (!hasWorkspace) return;
    const notePath = timeline?.notePath ?? lineageStore.notePath;
    if (notePath) void noteAIActivityStore.loadForDocument(notePath);
  });

  function setWorkspaceView(view: WorkspaceView) {
    workspaceView = view;
    if (view === 'ai' && lineageStore.notePath) {
      void noteAIActivityStore.loadForDocument(lineageStore.notePath);
    }
  }

  onMount(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ view?: WorkspaceView; threadId?: string }>).detail;
      if (detail?.view === 'ai') setWorkspaceView('ai');
      if (detail?.threadId) noteAIActivityStore.selectItem(detail.threadId);
    };
    window.addEventListener('void:lineage-workspace-view', handler);
    return () => window.removeEventListener('void:lineage-workspace-view', handler);
  });

  function select(entry: LineageTimelineEntry) {
    lineageStore.selectEntry(entry.id);
  }

  function selectAIActivity(item: NoteAIActivityItem) {
    noteAIActivityStore.selectItem(item.id);
  }

  function setFilter(filter: LineageTimelineFilter) {
    lineageStore.setTimelineFilter(filter);
  }

  function isPending(entry: LineageTimelineEntry | null): entry is LineagePendingTimelineEntry {
    return Boolean(entry && 'isPending' in entry && entry.isPending);
  }

  function actorLabel(actor: LineActor | null | undefined): string {
    if (!actor) return 'Unknown';
    if (actor.kind === 'ai-agent') return actor.model ?? actor.name ?? 'AI agent';
    if (actor.kind === 'external-editor') return 'External editor';
    if (actor.kind === 'importer') return actor.name ?? 'Import';
    return actor.name ?? 'You';
  }

  function intentLabel(intent: IntentFrame | null | undefined): string {
    return intent?.summary ?? intent?.kind?.replace(/-/g, ' ') ?? 'Lineage change';
  }

  function entryActor(entry: LineageTimelineEntry): string {
    if (isPending(entry)) return 'Pending';
    return actorLabel(entry.intent?.actor ?? entry.versions[0]?.actor);
  }

  function lineRange(entry: Pick<LineageTimelineEntry, 'lineRange'>): string {
    const { start, end } = entry.lineRange;
    if (start === null) return 'archived lines';
    if (start === end) return `line ${start}`;
    return `lines ${start}-${end}`;
  }

  function changeLabel(changeType: string): string {
    return changeType
      .replace(/^unit\./, '')
      .replace(/^pending\./, '')
      .replace(/-/g, ' ');
  }

  function isDeletedEntry(entry: LineageTimelineEntry): boolean {
    return (entry.changeTypes as string[]).includes('unit.deleted') ||
      (entry.changeTypes as string[]).includes('pending.delete') ||
      entry.diffHunks.some((hunk) => hunk.changeType === 'unit.deleted' || hunk.changeType === 'pending.delete');
  }

  function hunkTitle(hunk: LineageDiffHunk): string {
    const line = hunk.line !== null ? `Line ${hunk.line}` : 'Archived line';
    return `${line} · ${changeLabel(hunk.changeType)}`;
  }

  function statusLabel(status: InlineAIThreadStatus): string {
    switch (status) {
      case 'generating': return 'Working';
      case 'answer': return 'Answer';
      case 'proposed': return 'Proposed';
      case 'applied': return 'Applied';
      case 'canceled': return 'Canceled';
      case 'stale': return 'Stale';
      case 'error': return 'Error';
    }
  }

  function latestResponse(item: NoteAIActivityItem): string {
    return item.thread.turns.at(-1)?.response || item.responsePreview || 'No response yet.';
  }

  function compactText(value: string | null | undefined, fallback = 'No text captured'): string {
    const text = (value ?? '').replace(/\s+/g, ' ').trim();
    if (!text) return fallback;
    return text.length > 90 ? `${text.slice(0, 87)}...` : text;
  }

  function contextText(value: string | null | undefined, fallback: string): string {
    const text = (value ?? '').trim();
    return text || fallback;
  }

  function blockLabel(item: NoteAIActivityItem): string {
    const blockIds = item.thread.invocation.blockIds;
    if (blockIds.length === 0) return 'No block captured';
    if (blockIds.length === 1) return blockIds[0] ?? 'One block';
    return `${blockIds.length} blocks`;
  }

  function visibleMessages(item: NoteAIActivityItem) {
    return item.conversation?.messages.filter((message) => message.visibility !== 'internal') ?? [];
  }

  function proposalBefore(change: InlineAIProposedChange): string {
    switch (change.kind) {
      case 'replace-range':
      case 'replace-block':
        return change.originalText ?? '(unknown)';
      case 'insert-blocks':
        return '(insertion)';
      case 'apply-note-patch':
        return '(full note)';
    }
  }

  function proposalAfter(change: InlineAIProposedChange): string {
    switch (change.kind) {
      case 'replace-range':
      case 'replace-block':
      case 'insert-blocks':
        return change.markdown;
      case 'apply-note-patch':
        return change.content;
    }
  }

  function jumpToAIThread(item: NoteAIActivityItem) {
    editorStore.scrollInlineAIThreadIntoView(item.id);
    close();
  }

  async function openAIConversation(item: NoteAIActivityItem) {
    if (!item.conversationId) {
      toastStore.info('No chat is linked to this response');
      return;
    }
    await aiStore.switchConversation(item.conversationId);
    commandCenterStore.showConversationDetail();
    uiStore.openAISidebar();
  }

  async function copyAIResponse(item: NoteAIActivityItem) {
    const copied = await copyTextToClipboard(latestResponse(item));
    if (copied) toastStore.info('AI response copied');
    else toastStore.error('Failed to copy AI response');
  }

  async function retryAIThread(item: NoteAIActivityItem) {
    if (!(await inlineAIStore.retry(item.id))) {
      toastStore.error(inlineAIStore.error?.message ?? 'Retry failed');
      return;
    }
    await noteAIActivityStore.refresh();
  }

  function viewChangedLines(item: NoteAIActivityItem) {
    const entry = item.lineageEntries[0];
    if (!entry) return;
    workspaceView = 'timeline';
    lineageStore.selectEntry(entry.id);
  }

  function handleKeydown(event: KeyboardEvent) {
    if (!hasWorkspace) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  }

  async function restore(versionId: string) {
    await lineageStore.restoreVersion(versionId);
  }

  async function previewDeletedRestore(unitId: string, versionId?: string) {
    await lineageStore.previewDeletedRestore(unitId, versionId);
  }

  async function applyDeletedRestore() {
    await lineageStore.applyDeletedRestore();
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if hasWorkspace}
  <div class="lineage-workspace" role="dialog" aria-modal="true" aria-label="Lineage history workspace">
    <header class="lineage-header">
      <div class="lineage-title">
        <span class="lineage-title-icon">
          <History size={16} strokeWidth={1.9} aria-hidden="true" />
        </span>
        <div>
          <h2>History</h2>
          <p>{timeline?.notePath ?? lineageStore.notePath ?? 'No note selected'}</p>
        </div>
      </div>
      <div class="lineage-header-actions">
        {#if timeline?.pendingEntry}
          <span class="lineage-status lineage-status-pending">
            <Loader2 size={12} strokeWidth={1.8} aria-hidden="true" />
            Pending changes
          </span>
        {:else if timeline}
          <span class="lineage-status">
            <CheckCircle2 size={12} strokeWidth={1.8} aria-hidden="true" />
            Durable
          </span>
        {/if}
        <button type="button" class="icon-button" onclick={refresh} title="Refresh history" aria-label="Refresh history">
          <RotateCcw size={14} strokeWidth={1.8} aria-hidden="true" />
        </button>
        <button type="button" class="icon-button" onclick={close} title="Close history" aria-label="Close history">
          <X size={15} strokeWidth={1.8} aria-hidden="true" />
        </button>
      </div>
    </header>

    <div class="lineage-body">
      <aside class="lineage-timeline" aria-label="Edit timeline">
        <div class="workspace-view-tabs" role="tablist" aria-label="History views">
          <button
            type="button"
            class:active={workspaceView === 'timeline'}
            onclick={() => setWorkspaceView('timeline')}
          >
            <History size={12} strokeWidth={1.8} aria-hidden="true" />
            Edits
          </button>
          <button
            type="button"
            class:active={workspaceView === 'ai'}
            onclick={() => setWorkspaceView('ai')}
          >
            <MessageSquare size={12} strokeWidth={1.8} aria-hidden="true" />
            AI conversations
          </button>
        </div>

        {#if workspaceView === 'timeline'}
        <div class="lineage-timeline-head">
          <span>
            <ListFilter size={12} strokeWidth={1.8} aria-hidden="true" />
            Timeline
          </span>
          {#if focusedLine}
            <span>Focus line {focusedLine}</span>
          {/if}
        </div>

        <div class="timeline-filter" role="tablist" aria-label="History filters">
          <button
            type="button"
            class:active={lineageStore.timelineFilter === 'all'}
            onclick={() => setFilter('all')}
          >All</button>
          <button
            type="button"
            class:active={lineageStore.timelineFilter === 'focused'}
            disabled={focusedLine === null}
            onclick={() => setFilter('focused')}
          >Focused line</button>
          <button
            type="button"
            class:active={lineageStore.timelineFilter === 'deleted'}
            onclick={() => setFilter('deleted')}
          >Deleted</button>
          <button
            type="button"
            class:active={lineageStore.timelineFilter === 'warnings'}
            onclick={() => setFilter('warnings')}
          >Warnings</button>
        </div>

        {#if lineageStore.timelineFilter === 'deleted'}
          <section class="deleted-archive" aria-label="Deleted line archive">
            <header>
              <span>Deleted archive</span>
              <span>{deletedLines.length}</span>
            </header>
            {#if deletedLines.length === 0}
              <p>No deleted lines are archived for this note.</p>
            {:else}
              <ol role="list">
                {#each deletedLines as line (`${line.unitId}:${line.versionId}`)}
                  <li>
                    <button
                      type="button"
                      class="deleted-archive-row"
                      onclick={() => void previewDeletedRestore(line.unitId, line.versionId)}
                    >
                      <span class="deleted-archive-meta">
                        <span>{line.lastKnownLine !== null ? `Line ${line.lastKnownLine}` : 'Archived line'}</span>
                        <time datetime={line.deletedAt}>{formatRelativeDate(new Date(line.deletedAt))}</time>
                      </span>
                      <span class="deleted-archive-content">{line.content}</span>
                      <span class="deleted-archive-action">
                        <ArchiveRestore size={12} strokeWidth={1.8} aria-hidden="true" />
                        Restore preview
                      </span>
                    </button>
                  </li>
                {/each}
              </ol>
            {/if}
          </section>
        {/if}

        {#if lineageStore.loading && entries.length === 0}
          <div class="lineage-empty">Loading history...</div>
        {:else if lineageStore.error}
          <div class="lineage-empty lineage-error">{lineageStore.error.message}</div>
        {:else if entries.length === 0}
          <div class="lineage-empty">
            <Clock3 size={18} strokeWidth={1.5} aria-hidden="true" />
            <span>No lineage history yet</span>
          </div>
        {:else}
          <ol class="timeline-list" role="list">
            {#each entries as entry (entry.id)}
              <li>
                <button
                  type="button"
                  class:active={entry.id === lineageStore.selectedEntryId}
                  class:pending={isPending(entry)}
                  class:deleted={isDeletedEntry(entry)}
                  class="timeline-row"
                  onclick={() => select(entry)}
                >
                  <span class="timeline-row-top">
                    <span class="timeline-actor">{entryActor(entry)}</span>
                    <time datetime={entry.createdAt}>{formatRelativeDate(new Date(entry.createdAt))}</time>
                  </span>
                  <span class="timeline-summary">{entry.summary}</span>
                  <span class="timeline-meta">
                    <span>{lineRange(entry)}</span>
                    <span>{entry.diffHunks.length} diff{entry.diffHunks.length === 1 ? '' : 's'}</span>
                  </span>
                </button>
              </li>
            {/each}
          </ol>
        {/if}
        {:else}
          <div class="lineage-timeline-head">
            <span>
              <MessageSquare size={12} strokeWidth={1.8} aria-hidden="true" />
              AI Conversations
            </span>
            <span>{aiItems.length}</span>
          </div>

          {#if noteAIActivityStore.loading && aiItems.length === 0}
            <div class="lineage-empty">Loading AI conversations...</div>
          {:else if noteAIActivityStore.error}
            <div class="lineage-empty lineage-error">{noteAIActivityStore.error.message}</div>
          {:else if aiItems.length === 0}
            <div class="lineage-empty">
              <Sparkles size={18} strokeWidth={1.5} aria-hidden="true" />
              <span>No inline AI conversations yet</span>
            </div>
          {:else}
            <ol class="timeline-list ai-thread-list" role="list">
              {#each aiItems as item (item.id)}
                <li>
                  <button
                    type="button"
                    class:active={item.id === noteAIActivityStore.selectedItemId}
                    class="timeline-row ai-thread-row"
                    onclick={() => selectAIActivity(item)}
                  >
                    <span class="timeline-row-top">
                      <span class={`ai-status-badge status-${item.status}`}>{statusLabel(item.status)}</span>
                      <time datetime={item.updatedAt}>{formatRelativeDate(new Date(item.updatedAt))}</time>
                    </span>
                    <span class="timeline-summary">{item.prompt}</span>
                    <span class="ai-thread-selection">{compactText(item.selectedText, 'No selection captured')}</span>
                    <span class="timeline-meta">
                      <span>{item.invokedLocation}</span>
                      <span>{item.changeCount} change{item.changeCount === 1 ? '' : 's'}</span>
                    </span>
                  </button>
                </li>
              {/each}
            </ol>
          {/if}
        {/if}
      </aside>

      <main class="lineage-detail" aria-live="polite">
        {#if workspaceView === 'ai'}
          {#if noteAIActivityStore.loading && !selectedAIItem}
            <div class="detail-empty">Preparing AI conversation history...</div>
          {:else if !selectedAIItem}
            <div class="detail-empty">Select an AI conversation to inspect its trace.</div>
          {:else}
            <section class="detail-hero">
              <div>
                <span class="detail-kind">{statusLabel(selectedAIItem.status)}</span>
                <h3>{selectedAIItem.prompt}</h3>
                <p>
                  {selectedAIItem.invokedLocation}
                  · {selectedAIItem.thread.turns.length} turn{selectedAIItem.thread.turns.length === 1 ? '' : 's'}
                  · {selectedAIItem.changeCount} change{selectedAIItem.changeCount === 1 ? '' : 's'}
                </p>
              </div>
              <div class="detail-badges">
                <span class={`badge ai-status-badge status-${selectedAIItem.status}`}>
                  {statusLabel(selectedAIItem.status)}
                </span>
                {#if selectedAIItem.accepted}
                  <span class="badge">
                    <CheckCircle2 size={12} strokeWidth={1.8} aria-hidden="true" />
                    Accepted
                  </span>
                {/if}
              </div>
            </section>

            <section class="detail-section ai-actions">
              <button type="button" onclick={() => jumpToAIThread(selectedAIItem)}>
                <LocateFixed size={13} strokeWidth={1.8} aria-hidden="true" />
                Jump
              </button>
              <button type="button" onclick={() => void openAIConversation(selectedAIItem)}>
                <ExternalLink size={13} strokeWidth={1.8} aria-hidden="true" />
                Open chat
              </button>
              <button type="button" onclick={() => void copyAIResponse(selectedAIItem)}>
                <Copy size={13} strokeWidth={1.8} aria-hidden="true" />
                Copy
              </button>
              {#if selectedAIItem.status === 'stale' || selectedAIItem.status === 'error'}
                <button type="button" onclick={() => void retryAIThread(selectedAIItem)}>
                  <RotateCcw size={13} strokeWidth={1.8} aria-hidden="true" />
                  Retry
                </button>
              {/if}
              {#if selectedAIItem.lineageEntries.length > 0}
                <button type="button" onclick={() => viewChangedLines(selectedAIItem)}>
                  <GitBranch size={13} strokeWidth={1.8} aria-hidden="true" />
                  Changed lines
                </button>
              {/if}
            </section>

            <section class="detail-section">
              <header class="section-head">
                <span>
                  <LocateFixed size={13} strokeWidth={1.8} aria-hidden="true" />
                  Invocation
                </span>
              </header>
              <div class="detail-grid ai-invocation-meta">
                <div>
                  <span class="field-label">Selected text</span>
                  <span class="field-value">{compactText(selectedAIItem.selectedText)}</span>
                </div>
                <div>
                  <span class="field-label">Range</span>
                  <span class="field-value">{selectedAIItem.invokedLocation}</span>
                </div>
                <div>
                  <span class="field-label">Blocks</span>
                  <span class="field-value mono">{blockLabel(selectedAIItem)}</span>
                </div>
                {#if selectedAIItem.conversationId}
                  <div>
                    <span class="field-label">Conversation</span>
                    <span class="field-value mono">{selectedAIItem.conversationId}</span>
                  </div>
                {/if}
              </div>
              <div class="ai-context-strip" aria-label="Inline AI invocation context">
                <div>
                  <span>Before</span>
                  <pre>{contextText(selectedAIItem.contextBefore, 'Start of note or unavailable')}</pre>
                </div>
                <div>
                  <span>Selected</span>
                  <pre>{contextText(selectedAIItem.selectedText, 'No selected text captured')}</pre>
                </div>
                <div>
                  <span>After</span>
                  <pre>{contextText(selectedAIItem.contextAfter, 'End of note or unavailable')}</pre>
                </div>
              </div>
            </section>

            <section class="detail-section">
              <header class="section-head">
                <span>
                  <Sparkles size={13} strokeWidth={1.8} aria-hidden="true" />
                  Latest Response
                </span>
              </header>
              <p class="ai-response-text">{latestResponse(selectedAIItem)}</p>
            </section>

            {#if selectedAIItem.thread.proposal}
              <section class="detail-section">
                <header class="section-head">
                  <span>
                    <GitBranch size={13} strokeWidth={1.8} aria-hidden="true" />
                    Proposed Edit
                  </span>
                  <span class="confidence">{selectedAIItem.thread.proposal.status}</span>
                </header>
                <div class="diff-list">
                  {#each selectedAIItem.thread.proposal.changes as change, index (`${selectedAIItem.id}-proposal-${index}`)}
                    <article class="diff-hunk">
                      <header>
                        <span>{change.kind.replace(/-/g, ' ')}</span>
                      </header>
                      <div class="diff-before-after">
                        <div>
                          <span>Before</span>
                          <p>{proposalBefore(change)}</p>
                        </div>
                        <div>
                          <span>After</span>
                          <p>{proposalAfter(change)}</p>
                        </div>
                      </div>
                    </article>
                  {/each}
                </div>
              </section>
            {/if}

            <section class="detail-section">
              <header class="section-head">
                <span>
                  <Route size={13} strokeWidth={1.8} aria-hidden="true" />
                  Lifecycle
                </span>
              </header>
              <ol class="ai-event-list" role="list">
                {#each selectedAIItem.events as event (event.id)}
                  <li>
                    <span>{event.type.replace(/_/g, ' ')}</span>
                    <time datetime={event.createdAt}>{formatRelativeDate(new Date(event.createdAt))}</time>
                    {#if event.message}
                      <p>{event.message}</p>
                    {/if}
                  </li>
                {/each}
              </ol>
            </section>

            <section class="detail-section">
              <header class="section-head">
                <span>
                  <MessageSquare size={13} strokeWidth={1.8} aria-hidden="true" />
                  Transcript
                </span>
              </header>
              {#if visibleMessages(selectedAIItem).length === 0}
                <p class="muted">No visible chat messages are stored for this request yet.</p>
              {:else}
                <ol class="ai-transcript" role="list">
                  {#each visibleMessages(selectedAIItem) as message (message.id)}
                    <li class={`role-${message.role}`}>
                      <span>{message.role}</span>
                      <p>{message.text}</p>
                    </li>
                  {/each}
                </ol>
              {/if}
            </section>
          {/if}
        {:else}
        {#if lineageStore.loading && !selectedEntry}
          <div class="detail-empty">Preparing lineage...</div>
        {:else if !selectedEntry}
          <div class="detail-empty">Select an edit to inspect its trace.</div>
        {:else}
          <section class="detail-hero">
            <div>
              <span class:pending-label={isPending(selectedEntry)} class="detail-kind">
                {isPending(selectedEntry) ? 'Pending editor diff' : changeLabel(selectedEntry.kind)}
              </span>
              <h3>{selectedEntry.summary}</h3>
              <p>
                {lineRange(selectedEntry)}
                {#if selectedEntry.diffHunks.length > 0}
                  · {selectedEntry.diffHunks.length} content diff{selectedEntry.diffHunks.length === 1 ? '' : 's'}
                {/if}
              </p>
            </div>
            <div class="detail-badges">
              {#if isPending(selectedEntry)}
                <span class="badge badge-pending">
                  <Loader2 size={12} strokeWidth={1.8} aria-hidden="true" />
                  Unsaved
                </span>
              {:else}
                <span class="badge">
                  <Save size={12} strokeWidth={1.8} aria-hidden="true" />
                  Saved
                </span>
              {/if}
              {#if !isPending(selectedEntry) && selectedEntry.captureReason}
                <span class="badge">{selectedEntry.captureReason}</span>
              {/if}
              {#if !isPending(selectedEntry) && selectedEntry.warningIds.length > 0}
                <span class="badge badge-warning">
                  <AlertTriangle size={12} strokeWidth={1.8} aria-hidden="true" />
                  Repair
                </span>
              {/if}
            </div>
          </section>

          {#if !isPending(selectedEntry)}
            <section class="detail-section detail-grid">
              <div>
                <span class="field-label">Actor</span>
                <span class="field-value">{actorLabel(selectedEntry.intent?.actor ?? selectedEntry.versions[0]?.actor)}</span>
              </div>
              <div>
                <span class="field-label">Intent</span>
                <span class="field-value">{intentLabel(selectedEntry.intent)}</span>
              </div>
              <div>
                <span class="field-label">When</span>
                <span class="field-value">{formatRelativeDate(new Date(selectedEntry.createdAt))}</span>
              </div>
              <div>
                <span class="field-label">Patch</span>
                <span class="field-value mono">{selectedEntry.patchId}</span>
              </div>
              {#if selectedEntry.intent?.receiptId}
                <div>
                  <span class="field-label">Receipt</span>
                  <span class="field-value mono">{selectedEntry.intent.receiptId}</span>
                </div>
              {/if}
              {#if selectedEntry.intent?.branchId}
                <div>
                  <span class="field-label">Branch</span>
                  <span class="field-value mono">{selectedEntry.intent.branchId}</span>
                </div>
              {/if}
            </section>
          {/if}

          {#if selectedDeletedLines.length > 0}
            <section class="detail-section">
              <header class="section-head">
                <span>
                  <Trash2 size={13} strokeWidth={1.8} aria-hidden="true" />
                  Deleted Lines
                </span>
              </header>
              <ol class="deleted-line-list" role="list">
                {#each selectedDeletedLines as line (`selected-${line.unitId}:${line.versionId}`)}
                  <li>
                    <div>
                      <span class="field-label">
                        {line.lastKnownLine !== null ? `Last seen on line ${line.lastKnownLine}` : 'Archived line'}
                      </span>
                      <pre>{line.content}</pre>
                      {#if line.context}
                        <p class="muted">
                          Context: {line.context.before[line.context.before.length - 1]?.content ?? 'start of note'} / {line.context.after[0]?.content ?? 'end of note'}
                        </p>
                      {/if}
                    </div>
                    <button
                      type="button"
                      disabled={lineageStore.restoring || !line.restoreEligible}
                      onclick={() => void previewDeletedRestore(line.unitId, line.versionId)}
                    >
                      <ArchiveRestore size={12} strokeWidth={1.8} aria-hidden="true" />
                      Restore in place
                    </button>
                  </li>
                {/each}
              </ol>
            </section>
          {/if}

          {#if restorePreview}
            <section class="detail-section restore-preview">
              <header class="section-head">
                <span>
                  <ArchiveRestore size={13} strokeWidth={1.8} aria-hidden="true" />
                  Restore Preview
                </span>
                <span class="confidence">{Math.round(restorePreview.confidence * 100)}% match</span>
              </header>
              <div class="restore-preview-grid">
                <div>
                  <span class="field-label">Placement</span>
                  <span class="field-value">Line {restorePreview.insertLine} · {restorePreview.strategy.replace(/-/g, ' ')}</span>
                  <p class="muted">{restorePreview.reason}</p>
                </div>
                <div>
                  <span class="field-label">Restored content</span>
                  <pre>{restorePreview.content}</pre>
                </div>
              </div>
              <button
                type="button"
                class="restore-apply"
                disabled={lineageStore.restoring}
                onclick={() => void applyDeletedRestore()}
              >
                <ArchiveRestore size={13} strokeWidth={1.8} aria-hidden="true" />
                Apply restore
              </button>
            </section>
          {/if}

          <section class="detail-section">
            <header class="section-head">
              <span>
                <GitBranch size={13} strokeWidth={1.8} aria-hidden="true" />
                Sentence Diff
              </span>
            </header>
            {#if selectedHunks.length === 0}
              <p class="muted">This cluster only moved or re-linked existing lines.</p>
            {:else}
              <div class="diff-list">
                {#each selectedHunks as hunk (hunk.id)}
                  <article class="diff-hunk">
                    <header>
                      <span>{hunkTitle(hunk)}</span>
                      {#if hunk.unitId}
                        <span class="mono">{hunk.unitId}</span>
                      {/if}
                    </header>
                    <div class="diff-before-after">
                      <div>
                        <span>Before</span>
                        <p>{hunk.before ?? '(empty)'}</p>
                      </div>
                      <div>
                        <span>After</span>
                        <p>{hunk.after ?? '(empty)'}</p>
                      </div>
                    </div>
                    <p class="inline-diff">
                      {#each hunk.tokens as token, index (`${hunk.id}-${index}`)}
                        <span class:added={token.type === 'added'} class:removed={token.type === 'removed'}>{token.text}</span>
                      {/each}
                    </p>
                  </article>
                {/each}
              </div>
            {/if}
          </section>

          {#if lineageStore.explanation}
            <section class="detail-section">
              <header class="section-head">
                <span>
                  <Route size={13} strokeWidth={1.8} aria-hidden="true" />
                  Selected Line Trace
                </span>
              </header>
              <pre class="current-line">{lineageStore.explanation.currentVersion.content}</pre>
              {#if lineageStore.traceNodes.length <= 1}
                <p class="muted">No upstream or downstream versions are linked to this line.</p>
              {:else}
                <ol class="trace-list">
                  {#each lineageStore.traceNodes as node (node.version.id)}
                    <li class:root={node.direction === 'root'}>
                      <span>{node.direction}</span>
                      <p>{node.version.content}</p>
                    </li>
                  {/each}
                </ol>
              {/if}
            </section>
          {/if}

          {#if lineageStore.commitmentSource}
            <section class="detail-section">
              <header class="section-head">
                <span>
                  {#if lineageStore.commitmentSource.status === 'current'}
                    <CheckCircle2 size={13} strokeWidth={1.8} aria-hidden="true" />
                  {:else}
                    <AlertTriangle size={13} strokeWidth={1.8} aria-hidden="true" />
                  {/if}
                  Commitment
                </span>
              </header>
              <p class="commitment">{lineageStore.commitmentSource.todo.content}</p>
              <p class:warning={lineageStore.commitmentSource.status !== 'current'} class="muted">
                {lineageStore.commitmentSource.status}
              </p>
              {#each lineageStore.commitmentSource.reasons as reason}
                <p class="muted">{reason}</p>
              {/each}
            </section>
          {/if}

          {#if lineageStore.warnings.length > 0}
            <section class="detail-section">
              <header class="section-head">
                <span>
                  <AlertTriangle size={13} strokeWidth={1.8} aria-hidden="true" />
                  Repair Warnings
                </span>
              </header>
              <div class="warning-list">
                {#each lineageStore.warnings as warning (warning.id)}
                  <div class="warning-row">
                    <p>{warning.message}</p>
                    {#each warning.matches as match}
                      {#if match.oldUnitId && focusedLine !== null && match.newLineIndex === focusedLine - 1}
                        <button type="button" onclick={() => void lineageStore.repairTo(match.oldUnitId!, warning.id)}>
                          Assign to unit
                        </button>
                      {/if}
                    {/each}
                  </div>
                {/each}
              </div>
            </section>
          {/if}

          {#if previousVersions.length > 0}
            <section class="detail-section">
              <header class="section-head">
                <span>
                  <Clock3 size={13} strokeWidth={1.8} aria-hidden="true" />
                  Restore Preview
                </span>
              </header>
              <ol class="version-list">
                {#each previousVersions as version (version.id)}
                  <li>
                    <div>
                      <time datetime={version.createdAt}>{formatRelativeDate(new Date(version.createdAt))}</time>
                      <p>{version.content}</p>
                    </div>
                    <button
                      type="button"
                      disabled={lineageStore.restoring}
                      onclick={() => void restore(version.id)}
                    >
                      Restore
                    </button>
                  </li>
                {/each}
              </ol>
            </section>
          {/if}

          {#if !isPending(selectedEntry) && selectedEntry.intent?.actor.kind === 'ai-agent'}
            <section class="detail-section">
              <header class="section-head">
                <span>
                  <Sparkles size={13} strokeWidth={1.8} aria-hidden="true" />
                  AI Trace
                </span>
              </header>
              <div class="detail-grid">
                {#if selectedEntry.intent.prompt}
                  <div>
                    <span class="field-label">Prompt</span>
                    <span class="field-value">{selectedEntry.intent.prompt}</span>
                  </div>
                {/if}
                {#if selectedEntry.intent.agentRunId}
                  <div>
                    <span class="field-label">Run</span>
                    <span class="field-value mono">{selectedEntry.intent.agentRunId}</span>
                  </div>
                {/if}
                {#if selectedEntry.intent.commandId}
                  <div>
                    <span class="field-label">Command</span>
                    <span class="field-value mono">{selectedEntry.intent.commandId}</span>
                  </div>
                {/if}
              </div>
            </section>
          {/if}
        {/if}
        {/if}
      </main>
    </div>
  </div>
{/if}

<style>
  .lineage-workspace {
    position: fixed;
    inset: 0;
    z-index: 120;
    display: flex;
    flex-direction: column;
    background: var(--bg-app);
    color: var(--text-primary);
  }

  .lineage-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    height: 52px;
    padding: 0 16px;
    border-bottom: 1px solid var(--border-light);
    background: var(--bg-app);
    flex-shrink: 0;
  }

  .lineage-title {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  .lineage-title-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-md);
    color: var(--text-secondary);
  }

  .lineage-title h2 {
    margin: 0;
    font-size: 14px;
    line-height: 1.2;
    font-weight: 700;
    letter-spacing: 0;
  }

  .lineage-title p {
    margin: 2px 0 0;
    color: var(--text-muted);
    font-size: var(--text-caption);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: min(48vw, 620px);
  }

  .lineage-header-actions {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }

  .icon-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
  }

  .icon-button:hover,
  .icon-button:focus-visible {
    background: var(--bg-hover);
    color: var(--text-primary);
    outline: none;
  }

  .lineage-status,
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    min-height: 22px;
    padding: 0 7px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-sm);
    color: var(--text-secondary);
    font-size: var(--text-caption);
    font-weight: 600;
  }

  .lineage-status-pending,
  .badge-pending {
    color: var(--accent-primary);
    border-color: color-mix(in srgb, var(--accent-primary) 28%, var(--border-light));
  }

  .badge-warning {
    color: var(--color-warning, #a46400);
    border-color: color-mix(in srgb, var(--color-warning, #a46400) 30%, var(--border-light));
  }

  .lineage-body {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(260px, 32vw) minmax(0, 1fr);
  }

  .lineage-timeline {
    min-width: 0;
    border-right: 1px solid var(--border-light);
    background: var(--bg-subtle, var(--bg-app));
    overflow-y: auto;
  }

  .workspace-view-tabs {
    position: sticky;
    top: 0;
    z-index: 2;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 4px;
    padding: 8px;
    border-bottom: 1px solid var(--border-faint);
    background: var(--bg-subtle, var(--bg-app));
  }

  .workspace-view-tabs button {
    min-width: 0;
    min-height: 30px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    padding: 0 7px;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-muted);
    font: inherit;
    font-size: var(--text-caption);
    font-weight: 700;
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .workspace-view-tabs button:hover,
  .workspace-view-tabs button:focus-visible {
    background: var(--bg-hover);
    color: var(--text-primary);
    outline: none;
  }

  .workspace-view-tabs button.active {
    border-color: var(--border-light);
    background: var(--bg-card);
    color: var(--text-primary);
  }

  .lineage-timeline-head {
    position: sticky;
    top: 47px;
    z-index: 1;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 12px;
    border-bottom: 1px solid var(--border-faint);
    background: var(--bg-subtle, var(--bg-app));
    color: var(--text-muted);
    font-size: var(--text-caption);
    font-weight: 700;
  }

  .lineage-timeline-head span {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }

  .timeline-filter {
    position: sticky;
    top: 83px;
    z-index: 1;
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 4px;
    padding: 8px;
    border-bottom: 1px solid var(--border-faint);
    background: var(--bg-subtle, var(--bg-app));
  }

  .timeline-filter button {
    min-width: 0;
    min-height: 28px;
    padding: 0 6px;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-muted);
    font: inherit;
    font-size: var(--text-caption);
    font-weight: 700;
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .timeline-filter button:hover,
  .timeline-filter button:focus-visible {
    background: var(--bg-hover);
    color: var(--text-primary);
    outline: none;
  }

  .timeline-filter button.active {
    border-color: var(--border-light);
    background: var(--bg-card);
    color: var(--text-primary);
  }

  .timeline-filter button:disabled {
    opacity: 0.42;
    cursor: default;
  }

  .deleted-archive {
    border-bottom: 1px solid var(--border-light);
    background: var(--bg-app);
  }

  .deleted-archive header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 9px 12px 4px;
    color: var(--text-muted);
    font-size: var(--text-caption);
    font-weight: 700;
  }

  .deleted-archive p {
    margin: 0;
    padding: 4px 12px 12px;
    color: var(--text-muted);
    font-size: var(--text-caption);
    line-height: 1.4;
  }

  .deleted-archive ol {
    list-style: none;
    margin: 0;
    padding: 0 0 6px;
  }

  .deleted-archive-row {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 5px;
    padding: 8px 12px;
    border: 0;
    border-top: 1px solid var(--border-faint);
    background: transparent;
    color: var(--text-secondary);
    text-align: left;
    font: inherit;
    cursor: pointer;
  }

  .deleted-archive-row:hover,
  .deleted-archive-row:focus-visible {
    background: var(--bg-hover);
    outline: none;
  }

  .deleted-archive-meta,
  .deleted-archive-action {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    color: var(--text-muted);
    font-size: var(--text-caption);
    font-weight: 700;
  }

  .deleted-archive-action {
    justify-content: flex-start;
    color: var(--color-success, #167348);
  }

  .deleted-archive-content {
    color: var(--text-secondary);
    font-size: var(--text-body-sm);
    line-height: 1.35;
    overflow-wrap: anywhere;
  }

  .timeline-list {
    list-style: none;
    margin: 0;
    padding: 4px 0 16px;
  }

  .timeline-row {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 5px;
    padding: 10px 12px;
    border: 0;
    border-left: 3px solid transparent;
    border-bottom: 1px solid var(--border-faint);
    background: transparent;
    color: var(--text-secondary);
    text-align: left;
    cursor: pointer;
    font: inherit;
  }

  .timeline-row:hover,
  .timeline-row:focus-visible {
    background: var(--bg-hover);
    outline: none;
  }

  .timeline-row.active {
    background: var(--bg-selected, var(--bg-hover));
    border-left-color: var(--accent-primary);
    color: var(--text-primary);
  }

  .timeline-row.pending {
    border-left-color: color-mix(in srgb, var(--accent-primary) 64%, transparent);
  }

  .timeline-row.deleted {
    border-left-color: color-mix(in srgb, var(--color-error, #b3261e) 62%, transparent);
  }

  .timeline-row.deleted.active {
    border-left-color: var(--color-error, #b3261e);
  }

  .ai-thread-row {
    border-left-color: color-mix(in srgb, var(--accent-primary) 42%, transparent);
  }

  .ai-thread-row.active {
    border-left-color: var(--accent-primary);
  }

  .ai-status-badge {
    display: inline-flex;
    align-items: center;
    min-width: 0;
    min-height: 22px;
    padding: 0 7px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-sm);
    color: var(--text-secondary);
    font-size: var(--text-caption);
    font-weight: 700;
    line-height: 1;
  }

  .ai-status-badge.status-generating {
    color: var(--accent-primary);
    border-color: color-mix(in srgb, var(--accent-primary) 28%, var(--border-light));
  }

  .ai-status-badge.status-proposed {
    color: var(--color-warning, #a46400);
    border-color: color-mix(in srgb, var(--color-warning, #a46400) 30%, var(--border-light));
  }

  .ai-status-badge.status-applied,
  .ai-status-badge.status-answer {
    color: var(--color-success, #167348);
    border-color: color-mix(in srgb, var(--color-success, #167348) 28%, var(--border-light));
  }

  .ai-status-badge.status-canceled,
  .ai-status-badge.status-stale,
  .ai-status-badge.status-error {
    color: var(--color-error, #b3261e);
    border-color: color-mix(in srgb, var(--color-error, #b3261e) 28%, var(--border-light));
  }

  .timeline-row-top,
  .timeline-meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-width: 0;
  }

  .timeline-actor {
    font-size: var(--text-caption);
    font-weight: 700;
    color: var(--text-primary);
  }

  .timeline-row time,
  .timeline-meta {
    font-size: var(--text-caption);
    color: var(--text-muted);
  }

  .timeline-summary {
    color: var(--text-secondary);
    font-size: var(--text-body-sm);
    line-height: 1.35;
    overflow-wrap: anywhere;
  }

  .ai-thread-selection {
    color: var(--text-muted);
    font-size: var(--text-caption);
    line-height: 1.35;
    overflow-wrap: anywhere;
  }

  .lineage-detail {
    min-width: 0;
    overflow-y: auto;
    padding: 18px clamp(16px, 3vw, 36px) 42px;
  }

  .ai-actions {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
  }

  .ai-actions button {
    min-height: 30px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 0 9px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-sm);
    background: var(--bg-card);
    color: var(--text-secondary);
    font: inherit;
    font-size: var(--text-caption);
    font-weight: 700;
    cursor: pointer;
  }

  .ai-actions button:hover,
  .ai-actions button:focus-visible {
    background: var(--bg-hover);
    color: var(--text-primary);
    outline: none;
  }

  .ai-response-text {
    margin: 0;
    color: var(--text-secondary);
    font-size: var(--text-body-sm);
    line-height: 1.55;
    white-space: pre-wrap;
  }

  .ai-invocation-meta {
    margin-bottom: 12px;
  }

  .ai-context-strip {
    display: grid;
    grid-template-columns: minmax(0, 0.9fr) minmax(0, 1fr) minmax(0, 0.9fr);
    gap: 10px;
  }

  .ai-context-strip > div {
    min-width: 0;
    border-top: 1px solid var(--border-faint);
    padding-top: 8px;
  }

  .ai-context-strip span {
    display: block;
    margin-bottom: 5px;
    color: var(--text-muted);
    font-size: var(--text-caption);
    font-weight: 700;
  }

  .ai-context-strip pre {
    max-height: 148px;
    margin: 0;
    padding: 9px;
    overflow: auto;
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-sm);
    background: var(--bg-card);
    color: var(--text-secondary);
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: 1.5;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .detail-empty,
  .lineage-empty {
    min-height: 160px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    color: var(--text-muted);
    font-size: var(--text-body-sm);
    text-align: center;
  }

  .lineage-error {
    color: var(--color-error);
  }

  .detail-hero {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    padding-bottom: 16px;
    border-bottom: 1px solid var(--border-light);
  }

  .detail-kind {
    display: block;
    margin-bottom: 5px;
    color: var(--text-muted);
    font-size: var(--text-caption);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0;
  }

  .pending-label {
    color: var(--accent-primary);
  }

  .detail-hero h3 {
    margin: 0;
    font-size: 20px;
    line-height: 1.2;
    letter-spacing: 0;
  }

  .detail-hero p {
    margin: 6px 0 0;
    color: var(--text-secondary);
    font-size: var(--text-body-sm);
  }

  .detail-badges {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 6px;
  }

  .detail-section {
    padding: 16px 0;
    border-bottom: 1px solid var(--border-faint);
  }

  .detail-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 12px 16px;
  }

  .field-label {
    display: block;
    color: var(--text-muted);
    font-size: var(--text-caption);
    font-weight: 700;
    margin-bottom: 4px;
  }

  .field-value {
    display: block;
    color: var(--text-secondary);
    font-size: var(--text-body-sm);
    line-height: 1.35;
    overflow-wrap: anywhere;
  }

  .mono {
    font-family: var(--font-mono);
    font-size: var(--text-caption);
  }

  .section-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 10px;
    color: var(--text-secondary);
    font-size: var(--text-body-sm);
    font-weight: 700;
  }

  .section-head span {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .diff-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .diff-hunk {
    border-top: 1px solid var(--border-faint);
    padding-top: 10px;
  }

  .diff-hunk:first-child {
    border-top: 0;
    padding-top: 0;
  }

  .diff-hunk header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 8px;
    color: var(--text-muted);
    font-size: var(--text-caption);
    font-weight: 700;
  }

  .diff-before-after {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
    margin-bottom: 8px;
  }

  .diff-before-after div {
    min-width: 0;
    padding: 9px;
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-sm);
    background: var(--bg-card);
  }

  .diff-before-after span {
    display: block;
    margin-bottom: 4px;
    color: var(--text-muted);
    font-size: var(--text-caption);
    font-weight: 700;
  }

  .diff-before-after p,
  .inline-diff,
  .current-line {
    margin: 0;
    color: var(--text-secondary);
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: 1.55;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .inline-diff {
    padding: 10px;
    border-radius: var(--radius-sm);
    background: var(--bg-card);
    border: 1px solid var(--border-faint);
  }

  .inline-diff .added {
    color: var(--color-success, #167348);
    background: color-mix(in srgb, var(--color-success, #167348) 14%, transparent);
  }

  .inline-diff .removed {
    color: var(--color-error, #b3261e);
    background: color-mix(in srgb, var(--color-error, #b3261e) 12%, transparent);
    text-decoration: line-through;
  }

  .current-line {
    padding: 10px;
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-sm);
    background: var(--bg-card);
  }

  .trace-list,
  .version-list,
  .deleted-line-list {
    list-style: none;
    margin: 10px 0 0;
    padding: 0;
  }

  .trace-list li,
  .version-list li,
  .deleted-line-list li {
    display: grid;
    grid-template-columns: 88px minmax(0, 1fr) auto;
    gap: 10px;
    align-items: start;
    padding: 9px 0;
    border-top: 1px solid var(--border-faint);
  }

  .trace-list li:first-child,
  .version-list li:first-child,
  .deleted-line-list li:first-child {
    border-top: 0;
  }

  .trace-list span,
  .version-list time {
    color: var(--text-muted);
    font-size: var(--text-caption);
    font-weight: 700;
  }

  .trace-list p,
  .version-list p,
  .commitment,
  .muted {
    margin: 0;
    color: var(--text-secondary);
    font-size: var(--text-body-sm);
    line-height: 1.45;
    overflow-wrap: anywhere;
  }

  .trace-list li.root p {
    color: var(--text-primary);
    font-weight: 600;
  }

  .ai-event-list,
  .ai-transcript {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .ai-event-list li,
  .ai-transcript li {
    padding: 9px 0;
    border-top: 1px solid var(--border-faint);
  }

  .ai-event-list li:first-child,
  .ai-transcript li:first-child {
    border-top: 0;
    padding-top: 0;
  }

  .ai-event-list span,
  .ai-transcript span {
    display: inline-flex;
    color: var(--text-muted);
    font-size: var(--text-caption);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0;
  }

  .ai-event-list time {
    margin-left: 8px;
    color: var(--text-muted);
    font-size: var(--text-caption);
  }

  .ai-event-list p,
  .ai-transcript p {
    margin: 4px 0 0;
    color: var(--text-secondary);
    font-size: var(--text-body-sm);
    line-height: 1.45;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .ai-transcript .role-user p {
    color: var(--text-primary);
  }

  .version-list li {
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .deleted-line-list li {
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .deleted-line-list pre,
  .restore-preview pre {
    margin: 0;
    padding: 10px;
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-sm);
    background: var(--bg-card);
    color: var(--text-secondary);
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: 1.55;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .version-list button,
  .warning-row button,
  .deleted-line-list button,
  .restore-apply {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    min-height: 26px;
    padding: 0 9px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-sm);
    background: var(--bg-card);
    color: var(--text-secondary);
    font: inherit;
    font-size: var(--text-caption);
    font-weight: 700;
    cursor: pointer;
  }

  .version-list button:hover,
  .warning-row button:hover,
  .deleted-line-list button:hover,
  .restore-apply:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .version-list button:disabled,
  .deleted-line-list button:disabled,
  .restore-apply:disabled {
    opacity: 0.55;
    cursor: default;
  }

  .restore-preview-grid {
    display: grid;
    grid-template-columns: minmax(180px, 1fr) minmax(0, 2fr);
    gap: 14px;
    align-items: start;
  }

  .restore-apply {
    margin-top: 12px;
    min-height: 30px;
    color: var(--color-success, #167348);
  }

  .confidence {
    color: var(--text-muted);
    font-size: var(--text-caption);
    font-weight: 700;
  }

  .warning {
    color: var(--color-warning, #a46400);
  }

  .warning-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .warning-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 9px 0;
    border-top: 1px solid var(--border-faint);
  }

  .warning-row:first-child {
    border-top: 0;
  }

  .warning-row p {
    margin: 0;
    color: var(--text-secondary);
    font-size: var(--text-body-sm);
  }

  @media (max-width: 760px) {
    .lineage-header {
      height: auto;
      min-height: 52px;
      align-items: flex-start;
      padding: 10px 12px;
    }

    .lineage-status {
      display: none;
    }

    .lineage-body {
      grid-template-columns: 1fr;
      grid-template-rows: minmax(170px, 34vh) minmax(0, 1fr);
    }

    .lineage-timeline {
      border-right: 0;
      border-bottom: 1px solid var(--border-light);
    }

    .detail-hero,
    .diff-before-after,
    .ai-context-strip,
    .restore-preview-grid,
    .deleted-line-list li {
      grid-template-columns: 1fr;
      display: grid;
    }

    .detail-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
