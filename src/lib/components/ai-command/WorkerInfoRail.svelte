<script lang="ts">
  import { Check, Copy } from '@lucide/svelte';
  import type { AgentRun, AgentWorker } from '$lib/domain/entities/AgentRun';
  import { copyTextToClipboard } from '$lib/utils/clipboard';
  import { buildRefId } from '$lib/domain/values';

  interface Props {
    run: AgentRun;
    worker: AgentWorker;
    showPromptTraces: boolean;
    onTogglePromptTraces: (value: boolean) => void;
  }

  let { run, worker, showPromptTraces, onTogglePromptTraces }: Props = $props();

  let result = $derived(worker.result ?? null);
  let copyState = $state<Record<string, 'idle' | 'copied' | 'failed'>>({});
  let resetTimers = new Map<string, ReturnType<typeof setTimeout>>();

  function statusLabel(status: string): string {
    return status.replace(/_/g, ' ');
  }

  async function copy(key: string, value: string) {
    const success = await copyTextToClipboard(value);
    copyState = { ...copyState, [key]: success ? 'copied' : 'failed' };
    const prev = resetTimers.get(key);
    if (prev) clearTimeout(prev);
    resetTimers.set(key, setTimeout(() => {
      copyState = { ...copyState, [key]: 'idle' };
      resetTimers.delete(key);
    }, 1600));
  }
</script>

<aside class="worker-rail" aria-label="Worker info">
  <section class="rail-section">
    <header class="rail-section-head">Worker</header>
    <div class="rail-row">
      <span>Role</span>
      <strong>{worker.spec.role}</strong>
    </div>
    <div class="rail-row">
      <span>Status</span>
      <strong data-status={worker.status}>{statusLabel(worker.status)}</strong>
    </div>
    <div class="rail-row">
      <span>Progress</span>
      <strong>{worker.progress}%</strong>
    </div>
    <div class="rail-progress">
      <div class="rail-progress-bar" style:width={`${Math.max(0, Math.min(100, worker.progress))}%`}></div>
    </div>
  </section>

  <section class="rail-section">
    <header class="rail-section-head">Objective</header>
    <p>{worker.spec.objective}</p>
  </section>

  {#if worker.spec.deliverables.length > 0}
    <section class="rail-section">
      <header class="rail-section-head">Deliverables</header>
      <ul>
        {#each worker.spec.deliverables as item}
          <li>{item}</li>
        {/each}
      </ul>
    </section>
  {/if}

  {#if result}
    <section class="rail-section">
      <header class="rail-section-head">Evidence</header>
      <div class="rail-grid">
        <div>
          <span>Findings</span>
          <strong>{result.findings.length}</strong>
        </div>
        <div>
          <span>Citations</span>
          <strong>{result.citations.length}</strong>
        </div>
        <div>
          <span>Drafts</span>
          <strong>{result.artifactDrafts.length}</strong>
        </div>
        <div>
          <span>Confidence</span>
          <strong>{Math.round(result.confidence * 100)}%</strong>
        </div>
        {#if result.risks.length > 0}
          <div data-tone="warn">
            <span>Risks</span>
            <strong>{result.risks.length}</strong>
          </div>
        {/if}
      </div>
    </section>
  {/if}

  <section class="rail-section">
    <header class="rail-section-head">Run linkage</header>
    <button
      type="button"
      class="rail-copy-row"
      class:copied={copyState.worker === 'copied'}
      onclick={() => copy('worker', buildRefId({ kind: 'worker', runId: run.id, workerId: worker.id }))}
      title={`Copy worker ref ${worker.id}`}
    >
      <span>Worker Ref</span>
      <strong class="mono">{worker.id}</strong>
      {#if copyState.worker === 'copied'}
        <Check size={11} strokeWidth={2} aria-hidden="true" />
      {:else}
        <Copy size={11} strokeWidth={1.8} aria-hidden="true" />
      {/if}
    </button>
    <button
      type="button"
      class="rail-copy-row"
      class:copied={copyState.run === 'copied'}
      onclick={() => copy('run', buildRefId({ kind: 'run', runId: run.id }))}
      title={`Copy run ref ${run.id}`}
    >
      <span>Run Ref</span>
      <strong class="mono">{run.id}</strong>
      {#if copyState.run === 'copied'}
        <Check size={11} strokeWidth={2} aria-hidden="true" />
      {:else}
        <Copy size={11} strokeWidth={1.8} aria-hidden="true" />
      {/if}
    </button>
    <div class="rail-row">
      <span>Mode</span>
      <strong>{run.orchestrationMode}</strong>
    </div>
    <div class="rail-row">
      <span>Web</span>
      <strong>{run.webAccess ?? 'off'}</strong>
    </div>
    <button
      type="button"
      class="rail-copy-row"
      class:copied={copyState.log === 'copied'}
      onclick={() => copy('log', `.void/agents/${run.id}/${worker.id}.jsonl`)}
      title="Copy log file path"
    >
      <span>Log path</span>
      <strong class="mono">.void/agents/{run.id.slice(0, 10)}…/{worker.id.slice(0, 10)}…jsonl</strong>
      {#if copyState.log === 'copied'}
        <Check size={11} strokeWidth={2} aria-hidden="true" />
      {:else}
        <Copy size={11} strokeWidth={1.8} aria-hidden="true" />
      {/if}
    </button>
  </section>

  {#if worker.spec.allowedTools.length > 0}
    <section class="rail-section">
      <header class="rail-section-head">Tools</header>
      <div class="rail-chips">
        {#each worker.spec.allowedTools as tool}
          <span>{tool}</span>
        {/each}
      </div>
    </section>
  {/if}

  <section class="rail-section">
    <label class="rail-toggle">
      <input
        type="checkbox"
        checked={showPromptTraces}
        onchange={(e) => onTogglePromptTraces((e.currentTarget as HTMLInputElement).checked)}
      />
      <span>Show prompt traces</span>
    </label>
  </section>
</aside>

<style>
  .worker-rail {
    display: flex;
    flex-direction: column;
    gap: 14px;
    width: 100%;
    height: 100%;
    overflow-y: auto;
    padding: 16px;
    border-left: 1px solid var(--border-light);
    background: var(--bg-app);
  }

  .rail-section {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .rail-section-head {
    color: var(--text-muted);
    font-size: 10.5px;
    font-weight: 650;
    letter-spacing: var(--text-label-tracking);
    text-transform: uppercase;
  }

  .rail-section p {
    margin: 0;
    color: var(--text-secondary);
    font-size: 12px;
    line-height: 1.5;
  }

  .rail-section ul {
    margin: 0;
    padding-left: 18px;
  }

  .rail-section li {
    color: var(--text-secondary);
    font-size: 12px;
    line-height: 1.5;
  }

  .rail-row {
    display: grid;
    grid-template-columns: 84px minmax(0, 1fr);
    align-items: center;
    gap: 8px;
  }

  .rail-row span {
    color: var(--text-muted);
    font-size: 11px;
  }

  .rail-row strong {
    overflow: hidden;
    color: var(--text-primary);
    font-size: 11.5px;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .rail-row strong[data-status='running'] {
    color: var(--ai-accent);
  }

  .rail-row strong[data-status='completed'] {
    color: var(--color-success);
  }

  .rail-row strong[data-status='failed'] {
    color: var(--color-error);
  }

  .rail-copy-row {
    display: grid;
    grid-template-columns: 84px minmax(0, 1fr) 14px;
    align-items: center;
    gap: 8px;
    padding: 4px 6px;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-secondary);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .rail-copy-row:hover {
    border-color: var(--border-light);
    background: var(--bg-hover);
  }

  .rail-copy-row.copied {
    border-color: color-mix(in srgb, var(--color-success) 42%, var(--border-light));
    color: var(--color-success);
  }

  .rail-copy-row span {
    color: var(--text-muted);
    font-size: 11px;
  }

  .rail-copy-row strong {
    overflow: hidden;
    color: inherit;
    font-family: var(--font-mono);
    font-size: 10.5px;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .rail-copy-row :global(svg) {
    color: var(--text-muted);
  }

  .rail-copy-row.copied :global(svg) {
    color: currentColor;
  }

  .rail-progress {
    overflow: hidden;
    height: 4px;
    border-radius: var(--radius-full);
    background: var(--border-light);
  }

  .rail-progress-bar {
    height: 100%;
    background: var(--ai-accent);
    transition: width var(--transition-base);
  }

  .rail-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 6px;
  }

  .rail-grid > div {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 7px 9px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-sm);
    background: var(--bg-card);
  }

  .rail-grid > div[data-tone='warn'] {
    border-color: color-mix(in srgb, var(--color-warning) 38%, var(--border-light));
    background: var(--color-warning-bg);
  }

  .rail-grid > div[data-tone='warn'] strong {
    color: var(--color-warning);
  }

  .rail-grid span {
    color: var(--text-muted);
    font-size: 10.5px;
  }

  .rail-grid strong {
    color: var(--text-primary);
    font-family: var(--font-mono);
    font-size: 13px;
    font-weight: 700;
  }

  .rail-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .rail-chips span {
    display: inline-flex;
    align-items: center;
    padding: 3px 7px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-sm);
    background: var(--bg-card);
    color: var(--text-secondary);
    font-family: var(--font-mono);
    font-size: 10.5px;
  }

  .rail-toggle {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--text-secondary);
    font-size: 11.5px;
    cursor: pointer;
  }

  .rail-toggle input {
    margin: 0;
  }
</style>
