<script lang="ts">
  import { lineageStore } from '$lib/stores';
  import { InfoPopover } from '$lib/components/shared';
  import { Clock3, GitBranch, RotateCcw, Route, X, AlertTriangle, CheckCircle2 } from '@lucide/svelte';
  import { formatRelativeDate } from '$lib/utils/relativeDate';
  import type { LineVersion } from '$lib/domain/entities/Lineage';

  const explanation = $derived(lineageStore.explanation);
  const current = $derived(explanation?.currentVersion ?? null);
  const intent = $derived(explanation?.intent ?? null);
  const activeCluster = $derived(lineageStore.activeCluster);
  const previousVersions = $derived(lineageStore.history?.versions
    .filter((version) => version.id !== current?.id)
    .slice()
    .reverse() ?? []);
  const openWarnings = $derived(lineageStore.warnings.filter((warning) =>
    warning.matches.some((match) => match.newLineIndex === lineageStore.lineIndex)
  ));

  function actor(version: LineVersion | null): string {
    if (!version) return 'Unknown';
    if (version.actor.kind === 'ai-agent') return version.actor.model ?? version.actor.name ?? 'AI agent';
    if (version.actor.kind === 'external-editor') return 'External editor';
    return version.actor.name ?? version.actor.kind;
  }

  function close() {
    lineageStore.close();
  }

  async function restore(versionId: string) {
    await lineageStore.restoreVersion(versionId);
  }

  async function repair(unitId: string, warningId?: string) {
    await lineageStore.repairTo(unitId, warningId);
  }

  function lineRange(cluster: NonNullable<typeof activeCluster>): string {
    const { start, end } = cluster.lineRange;
    if (start === null) return 'archived lines';
    if (start === end) return `line ${start}`;
    return `lines ${start}-${end}`;
  }
</script>

{#if lineageStore.visible}
  <aside class="line-inspector" aria-label="Line inspector">
    <header class="line-inspector-header">
      <span class="line-inspector-title">
        <Clock3 size={13} strokeWidth={1.8} aria-hidden="true" />
        Line
        <InfoPopover
          title="Line details"
          body="The line inspector explains where this line came from and why it changed."
          items={[
            'Actor is who or what wrote the current version.',
            'Intent is the reason Void recorded for that edit.',
            'Command, receipt, and run IDs are reference links for deeper debugging.',
          ]}
          align="start"
        />
      </span>
      <span class="line-inspector-line">{lineageStore.lineIndex !== null ? `#${lineageStore.lineIndex + 1}` : ''}</span>
      <button type="button" class="line-inspector-close" onclick={close} aria-label="Close line inspector">
        <X size={13} strokeWidth={1.8} aria-hidden="true" />
      </button>
    </header>

    <div class="line-inspector-body">
      {#if lineageStore.loading}
        <p class="line-empty">Loading line history...</p>
      {:else if lineageStore.error}
        <p class="line-empty line-error">{lineageStore.error.message}</p>
      {:else if !current}
        <p class="line-empty">No lineage recorded for this line</p>
      {:else}
        <section class="line-section">
          <pre class="line-current">{current.content}</pre>
          <dl class="line-fields">
            <div>
              <dt>Actor</dt>
              <dd>{actor(current)}</dd>
            </div>
            <div>
              <dt>Intent</dt>
              <dd>{intent?.summary ?? intent?.kind ?? 'Unknown'}</dd>
            </div>
            <div>
              <dt>When</dt>
              <dd>{formatRelativeDate(new Date(current.createdAt))}</dd>
            </div>
            {#if intent?.commandId}
              <div>
                <dt>Command</dt>
                <dd class="mono">{intent.commandId}</dd>
              </div>
            {/if}
            {#if intent?.receiptId}
              <div>
                <dt>Receipt</dt>
                <dd class="mono">{intent.receiptId}</dd>
              </div>
            {/if}
            {#if intent?.agentRunId}
              <div>
                <dt>Run</dt>
                <dd class="mono">{intent.agentRunId}</dd>
              </div>
            {/if}
          </dl>
        </section>

        {#if activeCluster}
          <section class="line-section">
            <h3>
              <GitBranch size={12} strokeWidth={1.8} aria-hidden="true" />
              Edit Cluster
              <InfoPopover
                title="Edit cluster"
                body="A cluster groups nearby line changes that were saved together."
                items={[
                  'Range is where the cluster currently appears.',
                  'Units are the stable history records touched by the edit.',
                ]}
                align="start"
              />
            </h3>
            <p class="line-copy">{activeCluster.summary}</p>
            <dl class="line-fields">
              <div>
                <dt>Range</dt>
                <dd>{lineRange(activeCluster)}</dd>
              </div>
              <div>
                <dt>Changes</dt>
                <dd>{activeCluster.changeTypes.map((type) => type.replace('unit.', '')).join(', ')}</dd>
              </div>
              <div>
                <dt>Units</dt>
                <dd>{activeCluster.changedUnitIds.length}</dd>
              </div>
            </dl>
          </section>
        {/if}

        {#if current.context}
          <section class="line-section">
            <h3>
              <Route size={12} strokeWidth={1.8} aria-hidden="true" />
              Context
              <InfoPopover
                title="Line context"
                body="Context shows the neighboring lines captured with this version."
                items={[
                  'The highlighted row is the selected line.',
                  'Neighbors help explain restore placement and repair matches.',
                ]}
                align="start"
              />
            </h3>
            <ol class="context-list">
              {#each current.context.before as line (`before-${line.lineIndex}`)}
                <li>
                  <span>{line.lineIndex + 1}</span>
                  <p>{line.content || ' '}</p>
                </li>
              {/each}
              <li class="context-current">
                <span>{current.context.lineIndex + 1}</span>
                <p>{current.content || ' '}</p>
              </li>
              {#each current.context.after as line (`after-${line.lineIndex}`)}
                <li>
                  <span>{line.lineIndex + 1}</span>
                  <p>{line.content || ' '}</p>
                </li>
              {/each}
            </ol>
          </section>
        {/if}

        {#if lineageStore.commitmentSource}
          <section class="line-section">
            <h3>
              {#if lineageStore.commitmentSource.status === 'current'}
                <CheckCircle2 size={12} strokeWidth={1.8} aria-hidden="true" />
              {:else}
                <AlertTriangle size={12} strokeWidth={1.8} aria-hidden="true" />
              {/if}
              Commitment
              <InfoPopover
                title="Commitment"
                body="Commitment links a task-like line back to the source text it came from."
                items={[
                  'Current means the task still matches its source.',
                  'A warning means the task may be stale after edits.',
                ]}
                align="start"
              />
            </h3>
            <p class="line-copy">{lineageStore.commitmentSource.todo.content}</p>
            <p class:line-warning={lineageStore.commitmentSource.status !== 'current'} class="line-status">
              {lineageStore.commitmentSource.status}
            </p>
            {#each lineageStore.commitmentSource.reasons as reason}
              <p class="line-reason">{reason}</p>
            {/each}
          </section>
        {/if}

        {#if openWarnings.length > 0}
          <section class="line-section">
            <h3>
              <AlertTriangle size={12} strokeWidth={1.8} aria-hidden="true" />
              Repair
              <InfoPopover
                title="Repair"
                body="Repair reconnects a line to older saved history when Void found a likely match."
                items={[
                  'Use it only when the suggested unit clearly matches this text.',
                  'Repair records a new history event.',
                ]}
                align="start"
              />
            </h3>
            {#each openWarnings as warning (warning.id)}
              <div class="line-warning-box">
                <p>{warning.message}</p>
                {#each warning.matches as match}
                  {#if match.oldUnitId}
                    <button type="button" class="line-small-button" onclick={() => repair(match.oldUnitId!, warning.id)}>
                      Assign to {match.oldUnitId}
                    </button>
                  {/if}
                {/each}
              </div>
            {/each}
          </section>
        {/if}

        <section class="line-section">
          <h3>
            <Route size={12} strokeWidth={1.8} aria-hidden="true" />
            Trace
            <InfoPopover
              title="Trace"
              body="Trace shows whether this line was derived from earlier text or reused later."
              items={[
                'Source points backward to text that fed this version.',
                'Downstream points forward to text that reused it.',
              ]}
              align="start"
            />
          </h3>
          {#if lineageStore.traceNodes.length <= 1}
            <p class="line-muted">No source or downstream versions</p>
          {:else}
            <ol class="trace-list">
              {#each lineageStore.traceNodes as node (node.version.id)}
                <li class:trace-root={node.direction === 'root'}>
                  <span>{node.direction}</span>
                  <p>{node.version.content}</p>
                </li>
              {/each}
            </ol>
          {/if}
        </section>

        <section class="line-section">
          <h3>
            <GitBranch size={12} strokeWidth={1.8} aria-hidden="true" />
            Versions
            <InfoPopover
              title="Versions"
              body="Versions are older saved forms of this same line."
              items={[
                'Restore writes that text back into the note.',
                'Old versions remain available after restore.',
              ]}
              align="start"
            />
          </h3>
          {#if previousVersions.length === 0}
            <p class="line-muted">No previous versions</p>
          {:else}
            <ol class="version-list">
              {#each previousVersions as version (version.id)}
                <li>
                  <div class="version-meta">
                    <span>{actor(version)}</span>
                    <time datetime={version.createdAt}>{formatRelativeDate(new Date(version.createdAt))}</time>
                  </div>
                  <pre>{version.content}</pre>
                  <button
                    type="button"
                    class="line-small-button"
                    disabled={lineageStore.restoring}
                    onclick={() => restore(version.id)}
                  >
                    <RotateCcw size={11} strokeWidth={1.8} aria-hidden="true" />
                    Restore
                  </button>
                </li>
              {/each}
            </ol>
          {/if}
        </section>
      {/if}
    </div>
  </aside>
{/if}

<style>
  .line-inspector {
    width: 320px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    background: var(--bg-app);
    border-left: 1px solid var(--border-light);
    overflow: hidden;
  }

  .line-inspector-header {
    height: 36px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 10px 0 14px;
    border-bottom: 1px solid var(--border-faint);
  }

  .line-inspector-title {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-secondary);
  }

  .line-inspector-line {
    flex: 1;
    color: var(--text-muted);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }

  .line-inspector-close,
  .line-small-button {
    border: 1px solid var(--border-light);
    background: var(--bg-card);
    color: var(--text-secondary);
    border-radius: var(--radius-sm);
    font: inherit;
    cursor: pointer;
  }

  .line-inspector-close {
    width: 22px;
    height: 22px;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-color: transparent;
    background: transparent;
  }

  .line-inspector-close:hover,
  .line-small-button:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .line-inspector-body {
    flex: 1;
    overflow-y: auto;
    padding: 10px 0 18px;
  }

  .line-section {
    padding: 10px 14px;
    border-bottom: 1px solid var(--border-faint);
  }

  .line-section h3 {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0 0 8px;
    color: var(--text-secondary);
    font-size: 12px;
    font-weight: 600;
  }

  .line-current,
  .version-list pre {
    margin: 0;
    padding: 8px 9px;
    background: var(--bg-card);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 11.5px;
    line-height: 1.45;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .line-fields {
    display: grid;
    gap: 6px;
    margin: 10px 0 0;
    font-size: 12px;
  }

  .line-fields div {
    display: grid;
    grid-template-columns: 68px 1fr;
    gap: 8px;
  }

  .line-fields dt {
    color: var(--text-muted);
  }

  .line-fields dd {
    min-width: 0;
    margin: 0;
    color: var(--text-secondary);
    overflow-wrap: anywhere;
  }

  .mono {
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 11px;
  }

  .line-empty,
  .line-muted,
  .line-copy,
  .line-status,
  .line-reason,
  .line-warning-box p {
    margin: 0;
    color: var(--text-tertiary);
    font-size: 12px;
    line-height: 1.45;
  }

  .line-empty {
    padding: 34px 16px;
    text-align: center;
  }

  .line-error,
  .line-warning {
    color: var(--color-error);
  }

  .line-status {
    margin-top: 6px;
    text-transform: capitalize;
    font-weight: 600;
  }

  .line-reason {
    margin-top: 4px;
  }

  .line-warning-box {
    display: grid;
    gap: 7px;
    padding: 8px;
    border: 1px solid var(--color-warning-border, var(--border-light));
    border-radius: var(--radius-sm);
    background: var(--color-warning-bg, var(--bg-card));
  }

  .line-small-button {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    width: fit-content;
    min-height: 24px;
    padding: 3px 8px;
    font-size: 11.5px;
  }

  .line-small-button:disabled {
    opacity: 0.55;
    cursor: default;
  }

  .context-list,
  .trace-list,
  .version-list {
    display: grid;
    gap: 8px;
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .context-list {
    gap: 4px;
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 11px;
  }

  .context-list li {
    display: grid;
    grid-template-columns: 28px 1fr;
    gap: 8px;
    min-width: 0;
    color: var(--text-muted);
  }

  .context-list li.context-current {
    color: var(--text-primary);
  }

  .context-list span {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .context-list p {
    min-width: 0;
    margin: 0;
    color: inherit;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }

  .trace-list li {
    border-left: 2px solid var(--border-medium);
    padding-left: 8px;
  }

  .trace-list li.trace-root {
    border-left-color: var(--accent-primary);
  }

  .trace-list span,
  .version-meta {
    color: var(--text-muted);
    font-size: 11px;
    text-transform: capitalize;
  }

  .trace-list p {
    margin: 2px 0 0;
    color: var(--text-secondary);
    font-size: 12px;
    line-height: 1.4;
  }

  .version-list li {
    display: grid;
    gap: 6px;
  }

  .version-meta {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    text-transform: none;
  }
</style>
