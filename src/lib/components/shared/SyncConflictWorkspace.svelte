<script lang="ts">
  import {
    AlertTriangle,
    Check,
    Copy,
    FileText,
    GitMerge,
    RefreshCw,
    RotateCcw,
    X,
  } from '@lucide/svelte';
  import { notesStore, syncStore, toastStore, uiStore } from '$lib/stores';
  import type { SyncConflict, SyncConflictResolution } from '$lib/domain/values';

  let selectedId = $state<string | null>(null);
  let mergedDraft = $state('');
  let busy = $state(false);

  const session = $derived(syncStore.conflictSession);
  const preview = $derived(syncStore.activeConflictPreview);
  const conflicts = $derived(session?.conflicts ?? syncStore.status.conflicts);
  const selectedConflict = $derived(conflicts.find((conflict) => conflict.id === selectedId) ?? conflicts[0] ?? null);

  $effect(() => {
    if (!uiStore.syncConflictWorkspaceOpen) return;
    void loadSession();
  });

  $effect(() => {
    if (!selectedId && selectedConflict) {
      selectedId = selectedConflict.id;
      void loadPreview(selectedConflict.id);
    }
  });

  $effect(() => {
    if (preview) mergedDraft = preview.mergedMarkdown;
  });

  async function loadSession() {
    busy = true;
    try {
      const loaded = await syncStore.refreshConflictSession();
      const first = loaded?.conflicts.find((conflict) => conflict.mergeStatus !== 'resolved') ?? loaded?.conflicts[0] ?? null;
      if (first) {
        selectedId = first.id;
        await loadPreview(first.id);
      }
    } finally {
      busy = false;
    }
  }

  async function loadPreview(conflictId: string) {
    selectedId = conflictId;
    const next = await syncStore.previewConflict(conflictId);
    if (next) mergedDraft = next.mergedMarkdown;
  }

  async function apply(resolution: SyncConflictResolution) {
    if (!selectedId) return;
    busy = true;
    try {
      const ok = await syncStore.applyConflictResolution(
        selectedId,
        resolution,
        resolution === 'use-merged' ? mergedDraft : undefined,
      );
      if (ok) {
        toastStore.success('Conflict resolution applied');
        await loadSession();
      }
    } finally {
      busy = false;
    }
  }

  async function resume() {
    busy = true;
    try {
      const ok = await syncStore.resumeConflictResolution();
      if (ok) {
        toastStore.success('GitHub sync resumed');
        uiStore.closeSyncConflictWorkspace();
      }
    } finally {
      busy = false;
    }
  }

  async function abort() {
    busy = true;
    try {
      const ok = await syncStore.abortConflictResolution();
      if (ok) toastStore.warning('Merge aborted. Recovery branch preserved.');
    } finally {
      busy = false;
    }
  }

  function openNote(conflict: SyncConflict) {
    if (!conflict.path) return;
    notesStore.selectNote(conflict.path);
  }
</script>

{#if uiStore.syncConflictWorkspaceOpen}
  <div class="sync-conflict-backdrop" role="presentation" onclick={() => uiStore.closeSyncConflictWorkspace()}></div>
  <div class="sync-conflict-workspace" role="dialog" aria-modal="true" aria-label="GitHub sync conflicts">
    <header class="sync-conflict-header">
      <div>
        <div class="sync-conflict-kicker">
          <GitMerge size={14} />
          GitHub Sync
        </div>
        <h2>Resolve Conflicts</h2>
      </div>
      <button type="button" class="icon-btn" title="Close" aria-label="Close" onclick={() => uiStore.closeSyncConflictWorkspace()}>
        <X size={18} />
      </button>
    </header>

    {#if session}
      <div class="sync-conflict-meta">
        <span>{session.branch}</span>
        <span>{session.remoteBranch}</span>
        <span>{session.recoveryBranch}</span>
      </div>
    {/if}

    <div class="sync-conflict-body">
      <aside class="sync-conflict-list" aria-label="Conflict files">
        <div class="sync-conflict-list-header">
          <span>{conflicts.length} file{conflicts.length === 1 ? '' : 's'}</span>
          <button type="button" class="icon-btn small" title="Refresh" aria-label="Refresh" disabled={busy} onclick={loadSession}>
            <span class:spin={busy}><RefreshCw size={14} /></span>
          </button>
        </div>
        {#each conflicts as conflict (conflict.id)}
          <button
            type="button"
            class="sync-conflict-file"
            class:active={selectedId === conflict.id}
            onclick={() => loadPreview(conflict.id)}
          >
            <FileText size={14} />
            <span>{conflict.path ?? conflict.kind}</span>
            <em>{conflict.mergeStatus ?? 'pending'}</em>
          </button>
        {/each}
      </aside>

      <main class="sync-conflict-detail">
        {#if selectedConflict}
          <div class="sync-conflict-detail-head">
            <div>
              <h3>{selectedConflict.path ?? 'Repository conflict'}</h3>
              <p>{selectedConflict.message}</p>
            </div>
            {#if selectedConflict.path}
              <button type="button" class="text-btn" onclick={() => openNote(selectedConflict)}>
                Open Note
              </button>
            {/if}
          </div>

          {#if selectedConflict.supported === false}
            <div class="sync-conflict-warning">
              <AlertTriangle size={16} />
              <span>This conflict needs manual Git resolution. The recovery branch above preserves the local state.</span>
            </div>
          {/if}

          {#if preview}
            <div class="sync-conflict-previews">
              <section>
                <h4>Local</h4>
                <pre>{preview.localMarkdown ?? ''}</pre>
              </section>
              <section>
                <h4>Remote</h4>
                <pre>{preview.remoteMarkdown ?? ''}</pre>
              </section>
              <section>
                <h4>Base</h4>
                <pre>{preview.baseMarkdown ?? ''}</pre>
              </section>
            </div>

            <label class="sync-conflict-merged">
              <span>Merged</span>
              <textarea bind:value={mergedDraft} spellcheck="true"></textarea>
            </label>
          {:else}
            <div class="sync-conflict-empty">
              {busy ? 'Loading conflict preview...' : 'Select a conflict to preview it.'}
            </div>
          {/if}
        {:else}
          <div class="sync-conflict-empty">No active sync conflicts.</div>
        {/if}
      </main>
    </div>

    <footer class="sync-conflict-actions">
      <button type="button" class="danger-btn" disabled={busy} onclick={abort}>
        <RotateCcw size={15} />
        Abort Merge
      </button>
      <div class="sync-conflict-resolution-actions">
        <button type="button" disabled={busy || !selectedId} onclick={() => apply('keep-local')}>
          Keep Local
        </button>
        <button type="button" disabled={busy || !selectedId} onclick={() => apply('take-remote')}>
          Take Remote
        </button>
        <button type="button" disabled={busy || !selectedId} onclick={() => apply('duplicate-local')}>
          <Copy size={14} />
          Duplicate Local
        </button>
        <button type="button" disabled={busy || !selectedId || !preview?.supported} onclick={() => apply('use-merged')}>
          Use Merged
        </button>
        <button type="button" class="primary-btn" disabled={busy} onclick={resume}>
          <Check size={15} />
          Resume Sync
        </button>
      </div>
    </footer>
  </div>
{/if}

<style>
  .sync-conflict-backdrop {
    position: fixed;
    inset: 0;
    z-index: 70;
    background: color-mix(in srgb, var(--bg-app) 65%, transparent);
    backdrop-filter: blur(3px);
  }

  .sync-conflict-workspace {
    position: fixed;
    inset: 32px;
    z-index: 71;
    display: flex;
    flex-direction: column;
    min-width: 0;
    overflow: hidden;
    border: 1px solid var(--border-medium);
    border-radius: 8px;
    background: var(--bg-card);
    box-shadow: 0 24px 80px rgb(0 0 0 / 0.28);
  }

  .sync-conflict-header,
  .sync-conflict-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 16px 18px;
    border-bottom: 1px solid var(--border-light);
  }

  .sync-conflict-actions {
    border-top: 1px solid var(--border-light);
    border-bottom: 0;
  }

  .sync-conflict-kicker,
  .sync-conflict-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--text-muted);
    font-size: 12px;
  }

  h2,
  h3,
  h4,
  p {
    margin: 0;
  }

  h2 {
    margin-top: 3px;
    font-size: 20px;
  }

  .sync-conflict-meta {
    padding: 8px 18px;
    border-bottom: 1px solid var(--border-light);
    font-family: var(--font-mono);
  }

  .sync-conflict-body {
    display: grid;
    grid-template-columns: minmax(220px, 280px) minmax(0, 1fr);
    min-height: 0;
    flex: 1;
  }

  .sync-conflict-list {
    min-width: 0;
    overflow: auto;
    border-right: 1px solid var(--border-light);
    background: var(--bg-sidebar);
  }

  .sync-conflict-list-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px;
    color: var(--text-muted);
    font-size: 12px;
  }

  .sync-conflict-file {
    display: grid;
    grid-template-columns: 16px minmax(0, 1fr);
    gap: 8px;
    width: calc(100% - 12px);
    margin: 0 6px 6px;
    padding: 10px;
    border: 1px solid transparent;
    border-radius: 6px;
    background: transparent;
    color: var(--text-primary);
    text-align: left;
    cursor: pointer;
  }

  .sync-conflict-file.active {
    border-color: var(--accent-primary);
    background: var(--bg-card);
  }

  .sync-conflict-file span,
  .sync-conflict-file em {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sync-conflict-file em {
    grid-column: 2;
    color: var(--text-muted);
    font-size: 11px;
    font-style: normal;
  }

  .sync-conflict-detail {
    min-width: 0;
    overflow: auto;
    padding: 16px;
  }

  .sync-conflict-detail-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 14px;
  }

  .sync-conflict-detail-head h3 {
    font-size: 16px;
  }

  .sync-conflict-detail-head p {
    margin-top: 4px;
    color: var(--text-muted);
    font-size: 13px;
  }

  .sync-conflict-warning {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 12px;
    padding: 10px 12px;
    border: 1px solid color-mix(in srgb, var(--color-warning) 45%, var(--border-medium));
    border-radius: 6px;
    color: var(--color-warning);
    font-size: 13px;
  }

  .sync-conflict-previews {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 12px;
  }

  .sync-conflict-previews section {
    min-width: 0;
  }

  h4,
  .sync-conflict-merged span {
    display: block;
    margin-bottom: 6px;
    color: var(--text-muted);
    font-size: 12px;
    font-weight: 600;
  }

  pre,
  textarea {
    width: 100%;
    min-height: 180px;
    margin: 0;
    padding: 10px;
    overflow: auto;
    border: 1px solid var(--border-light);
    border-radius: 6px;
    background: var(--bg-subtle);
    color: var(--text-primary);
    font: 12px/1.5 var(--font-mono);
    white-space: pre-wrap;
  }

  .sync-conflict-merged {
    display: block;
    margin-top: 14px;
  }

  textarea {
    min-height: 260px;
    resize: vertical;
  }

  .sync-conflict-resolution-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 8px;
  }

  button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-height: 30px;
    padding: 0 10px;
    border: 1px solid var(--border-medium);
    border-radius: 6px;
    background: var(--bg-subtle);
    color: var(--text-primary);
    font-size: 12px;
    cursor: pointer;
  }

  button:disabled {
    cursor: default;
    opacity: 0.55;
  }

  .icon-btn {
    width: 32px;
    padding: 0;
  }

  .icon-btn.small {
    width: 26px;
    min-height: 26px;
  }

  .text-btn {
    flex: 0 0 auto;
  }

  .primary-btn {
    border-color: var(--accent-primary);
    background: var(--accent-primary);
    color: var(--text-inverse);
  }

  .danger-btn {
    color: var(--color-error);
  }

  .sync-conflict-empty {
    display: grid;
    min-height: 240px;
    place-items: center;
    color: var(--text-muted);
  }

  .spin {
    animation: sync-spin 0.9s linear infinite;
  }

  @keyframes sync-spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (max-width: 820px) {
    .sync-conflict-workspace {
      inset: 0;
      border-radius: 0;
    }

    .sync-conflict-body {
      grid-template-columns: 1fr;
    }

    .sync-conflict-list {
      max-height: 190px;
      border-right: 0;
      border-bottom: 1px solid var(--border-light);
    }

    .sync-conflict-previews {
      grid-template-columns: 1fr;
    }

    .sync-conflict-actions {
      align-items: stretch;
      flex-direction: column;
    }

    .sync-conflict-resolution-actions {
      justify-content: stretch;
    }
  }
</style>
