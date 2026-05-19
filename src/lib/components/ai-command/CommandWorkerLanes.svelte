<script lang="ts">
  import {
    CircleAlert,
    CircleCheck,
    CircleDashed,
    CircleStop,
    FileText,
    Image,
    Link2,
    ListChecks,
    MessagesSquare,
    Search,
    ShieldAlert,
  } from '@lucide/svelte';
  import type { AgentArtifactDraft, AgentWorker, AgentWorkerMessage } from '$lib/domain/entities/AgentRun';
  import { commandCenterStore } from '$lib/stores';

  interface Props {
    workers: AgentWorker[];
    messages?: AgentWorkerMessage[];
    compact?: boolean;
  }

  let { workers, messages = [], compact = false }: Props = $props();

  function formatStatus(status: string): string {
    return status.replace(/_/g, ' ');
  }

  function latestMessage(workerId: string): AgentWorkerMessage | null {
    return messages
      .filter((message) => message.workerId === workerId)
      .slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
  }

  function workerMessages(workerId: string): AgentWorkerMessage[] {
    return messages.filter((message) => message.workerId === workerId);
  }

  function workerDrafts(worker: AgentWorker): AgentArtifactDraft[] {
    const byKey = new Map<string, AgentArtifactDraft>();
    for (const draft of worker.result?.artifactDrafts ?? []) {
      byKey.set(draftKey(draft), draft);
    }
    for (const message of workerMessages(worker.id)) {
      if (message.artifactDraft) {
        byKey.set(draftKey(message.artifactDraft), message.artifactDraft);
      }
      for (const draft of message.result?.artifactDrafts ?? []) {
        byKey.set(draftKey(draft), draft);
      }
    }
    return [...byKey.values()];
  }

  function draftKey(draft: AgentArtifactDraft): string {
    return `${draft.type}:${draft.url ?? draft.path ?? draft.title.toLowerCase()}`;
  }

  function draftTypeCount(drafts: AgentArtifactDraft[], type: AgentArtifactDraft['type']): number {
    return drafts.filter((draft) => draft.type === type).length;
  }

  function toolLabel(toolId: string): string {
    return toolId.replace(':', ' / ');
  }

  function visibleTools(worker: AgentWorker): string[] {
    const preferred = worker.spec.allowedTools.filter((tool) =>
      tool === 'search:media' ||
      tool === 'search:content' ||
      tool === 'note:read' ||
      tool === 'lineage:context'
    );
    return (preferred.length > 0 ? preferred : worker.spec.allowedTools).slice(0, 3);
  }

  function riskCount(worker: AgentWorker): number {
    return worker.result?.risks.length ?? 0;
  }

  function findingCount(worker: AgentWorker): number {
    return worker.result?.findings.length ?? 0;
  }

  function citationCount(worker: AgentWorker): number {
    return worker.result?.citations.length ?? 0;
  }

  function qualityLabel(worker: AgentWorker): string | null {
    if (worker.result?.quality) return worker.result.quality;
    if (worker.result?.evidenceLevel) return worker.result.evidenceLevel.replace(/_/g, ' ');
    if (worker.spec.allowedTools.includes('search:media')) return 'media lane';
    return null;
  }

  function selectWorker(worker: AgentWorker): void {
    commandCenterStore.selectWorker(worker.runId, worker.id);
  }
</script>

<div class="worker-lanes" class:compact role="list" aria-label="Worker agents">
  {#each workers as worker (worker.id)}
    {@const latest = latestMessage(worker.id)}
    {@const drafts = workerDrafts(worker)}
    {@const tools = visibleTools(worker)}
    {@const noteDrafts = draftTypeCount(drafts, 'note') + draftTypeCount(drafts, 'summary') + draftTypeCount(drafts, 'diff')}
    {@const sourceDrafts = draftTypeCount(drafts, 'source') + citationCount(worker)}
    {@const mediaDrafts = draftTypeCount(drafts, 'media')}
    {@const todoDrafts = draftTypeCount(drafts, 'todo')}
    {@const quality = qualityLabel(worker)}
    <article
      class="worker-lane"
      class:selected={commandCenterStore.isWorkerSelected(worker.runId, worker.id)}
      data-status={worker.status}
      role="listitem"
    >
      <button
        type="button"
        class="worker-lane-button"
        title={`Inspect ${worker.spec.title}`}
        aria-pressed={commandCenterStore.isWorkerSelected(worker.runId, worker.id)}
        onclick={() => selectWorker(worker)}
      >
        <div class="worker-head">
          <span class="worker-icon" aria-hidden="true">
            {#if worker.status === 'completed'}
              <CircleCheck size={14} strokeWidth={1.9} />
            {:else if worker.status === 'failed'}
              <CircleAlert size={14} strokeWidth={1.9} />
            {:else if worker.status === 'cancelled'}
              <CircleStop size={14} strokeWidth={1.9} />
            {:else}
              <CircleDashed size={14} strokeWidth={1.9} />
            {/if}
          </span>
          <div class="worker-title-block">
            <span class="worker-title">{worker.spec.title}</span>
            <span class="worker-role">{worker.spec.role} / {formatStatus(worker.status)}</span>
          </div>
          <span class="worker-progress">{worker.progress}%</span>
        </div>

      <div class="worker-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={worker.progress}>
        <span style:width={`${worker.progress}%`}></span>
      </div>

      {#if !compact}
        <p class="worker-objective">{worker.spec.objective}</p>
      {/if}

      {#if tools.length > 0 || quality}
        <div class="worker-tool-row" aria-label="Worker lane tools">
          {#if quality}
            <span class="worker-chip" data-tone={worker.result?.quality === 'insufficient' ? 'warn' : 'default'}>{quality}</span>
          {/if}
          {#each tools as tool}
            <span class="worker-chip">
              <Search size={12} strokeWidth={1.8} aria-hidden="true" />
              {toolLabel(tool)}
            </span>
          {/each}
        </div>
      {/if}

      {#if worker.error}
        <p class="worker-error">{worker.error}</p>
      {:else if worker.result?.summary}
        <p class="worker-summary">{worker.result.summary}</p>
      {:else if latest}
        <p class="worker-summary">{latest.message}</p>
      {/if}

      {#if findingCount(worker) > 0 || drafts.length > 0 || sourceDrafts > 0 || mediaDrafts > 0 || todoDrafts > 0 || riskCount(worker) > 0}
        <div class="worker-evidence" aria-label="Worker evidence">
          {#if findingCount(worker) > 0}
            <span>
              <ListChecks size={12} strokeWidth={1.8} aria-hidden="true" />
              {findingCount(worker)} finding{findingCount(worker) === 1 ? '' : 's'}
            </span>
          {/if}
          {#if noteDrafts > 0}
            <span>
              <FileText size={12} strokeWidth={1.8} aria-hidden="true" />
              {noteDrafts} note draft{noteDrafts === 1 ? '' : 's'}
            </span>
          {/if}
          {#if sourceDrafts > 0}
            <span>
              <Link2 size={12} strokeWidth={1.8} aria-hidden="true" />
              {sourceDrafts} source{sourceDrafts === 1 ? '' : 's'}
            </span>
          {/if}
          {#if mediaDrafts > 0}
            <span data-tone="media">
              <Image size={12} strokeWidth={1.8} aria-hidden="true" />
              {mediaDrafts} media
            </span>
          {/if}
          {#if todoDrafts > 0}
            <span>
              <ListChecks size={12} strokeWidth={1.8} aria-hidden="true" />
              {todoDrafts} todo{todoDrafts === 1 ? '' : 's'}
            </span>
          {/if}
          {#if riskCount(worker) > 0}
            <span data-tone="warn">
              <ShieldAlert size={12} strokeWidth={1.8} aria-hidden="true" />
              {riskCount(worker)} risk{riskCount(worker) === 1 ? '' : 's'}
            </span>
          {/if}
        </div>
      {/if}

      {#if !compact && drafts.length > 0}
        <div class="worker-drafts" aria-label="Worker draft artifacts">
          {#each drafts.slice(0, 3) as draft (draftKey(draft))}
            <span class="worker-draft" data-type={draft.type}>
              {#if draft.type === 'media'}
                <Image size={12} strokeWidth={1.8} aria-hidden="true" />
              {:else if draft.type === 'source'}
                <Link2 size={12} strokeWidth={1.8} aria-hidden="true" />
              {:else}
                <FileText size={12} strokeWidth={1.8} aria-hidden="true" />
              {/if}
              <span>{draft.title}</span>
            </span>
          {/each}
          {#if drafts.length > 3}
            <span class="worker-draft-more">+{drafts.length - 3}</span>
          {/if}
        </div>
      {/if}

      {#if drafts.length > 0 || latest}
        <div class="worker-meta">
          {#if drafts.length > 0}
            <span>{drafts.length} draft{drafts.length === 1 ? '' : 's'}</span>
          {/if}
          {#if latest}
            <span class="worker-message">
              <MessagesSquare size={12} strokeWidth={1.8} aria-hidden="true" />
              {latest.toolId ? toolLabel(latest.toolId) : latest.type.replace('worker.', '').replace('orchestrator.', '')}
            </span>
          {/if}
        </div>
      {/if}
      </button>
    </article>
  {/each}
</div>

<style>
  .worker-lanes {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
    gap: 8px;
    container-type: inline-size;
    min-width: 0;
  }

  .worker-lanes.compact {
    grid-template-columns: 1fr;
  }

  .worker-lane {
    min-width: 0;
    overflow: hidden;
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--bg-card) 88%, var(--ai-tint));
  }

  .worker-lane-button {
    display: flex;
    flex-direction: column;
    gap: 7px;
    width: 100%;
    min-width: 0;
    padding: 9px;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .worker-lane:hover {
    border-color: color-mix(in srgb, var(--ai-accent) 35%, var(--border-light));
    background: color-mix(in srgb, var(--bg-card) 72%, var(--ai-tint));
  }

  .worker-lane:focus-within {
    outline: 2px solid color-mix(in srgb, var(--ai-accent) 70%, transparent);
    outline-offset: 2px;
  }

  .worker-lane.selected {
    border-color: color-mix(in srgb, var(--ai-accent) 62%, var(--border-light));
    background: color-mix(in srgb, var(--ai-tint) 72%, var(--bg-card));
  }

  .worker-lane[data-status='running'] {
    border-color: color-mix(in srgb, var(--ai-accent) 32%, var(--border-faint));
  }

  .worker-head {
    display: grid;
    grid-template-columns: 16px minmax(0, 1fr) 34px;
    align-items: start;
    gap: 7px;
    min-width: 0;
  }

  .worker-icon {
    display: inline-flex;
    color: var(--text-placeholder);
  }

  .worker-lane[data-status='running'] .worker-icon {
    color: var(--ai-accent);
  }

  .worker-lane[data-status='completed'] .worker-icon {
    color: var(--color-success);
  }

  .worker-lane[data-status='failed'] .worker-icon {
    color: var(--color-error);
  }

  .worker-title-block {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }

  .worker-title,
  .worker-role,
  .worker-progress {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .worker-title {
    color: var(--text-primary);
    font-size: 12px;
    font-weight: 600;
    line-height: 1.3;
  }

  .worker-role,
  .worker-progress {
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: 10.5px;
    line-height: 1.35;
    text-transform: capitalize;
  }

  .worker-progress {
    text-align: right;
  }

  .worker-bar {
    position: relative;
    overflow: hidden;
    height: 3px;
    border-radius: var(--radius-full);
    background: var(--bg-hover);
  }

  .worker-bar span {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: var(--ai-accent);
  }

  .worker-lane[data-status='completed'] .worker-bar span {
    background: var(--color-success);
  }

  .worker-lane[data-status='failed'] .worker-bar span {
    background: var(--color-error);
  }

  .worker-objective,
  .worker-summary,
  .worker-error {
    display: -webkit-box;
    overflow: hidden;
    margin: 0;
    -webkit-box-orient: vertical;
    color: var(--text-secondary);
    font-size: 11px;
    line-height: 1.35;
    line-clamp: 3;
    -webkit-line-clamp: 3;
  }

  .worker-summary {
    color: var(--text-muted);
  }

  .worker-error {
    color: var(--color-error);
  }

  .worker-tool-row,
  .worker-evidence,
  .worker-drafts {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    min-width: 0;
  }

  .worker-chip,
  .worker-evidence span,
  .worker-draft,
  .worker-draft-more {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    max-width: 100%;
    min-width: 0;
    height: 20px;
    padding: 0 6px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-sm);
    background: var(--bg-editor);
    color: var(--text-muted);
    font-size: 10.5px;
    line-height: 1;
  }

  .worker-chip[data-tone='warn'],
  .worker-evidence span[data-tone='warn'] {
    border-color: color-mix(in srgb, var(--color-warning) 35%, var(--border-light));
    background: var(--color-warning-bg);
    color: var(--color-warning);
  }

  .worker-evidence span[data-tone='media'],
  .worker-draft[data-type='media'] {
    border-color: color-mix(in srgb, var(--ai-accent) 35%, var(--border-light));
    background: var(--ai-tint);
    color: var(--ai-accent);
  }

  .worker-draft {
    flex: 1 1 128px;
    justify-content: flex-start;
  }

  .worker-draft span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .worker-draft-more {
    flex: 0 0 auto;
    font-family: var(--font-mono);
  }

  .worker-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    color: var(--text-placeholder);
    font-size: 10.5px;
    line-height: 1.35;
  }

  .worker-message {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    min-width: 0;
  }

  @container (max-width: 460px) {
    .worker-lanes:not(.compact) {
      grid-template-columns: 1fr;
    }

    .worker-draft {
      flex-basis: 100%;
    }
  }
</style>
