<script lang="ts">
  import { onMount } from 'svelte';
  import { ArrowLeft, Loader2, RefreshCw, RotateCcw, Trash2 } from '@lucide/svelte';
  import { EmptyState } from '$lib/components/shared';
  import { notesStore, toastStore } from '$lib/stores';
  import { formatRelativeDate } from '$lib/utils/relativeDate';

  interface Props {
    onClose?: () => void;
    onRestored?: () => void;
  }

  let { onClose, onRestored }: Props = $props();

  let busyId = $state<string | null>(null);
  let confirmDeleteId = $state<string | null>(null);

  const trashedNotes = $derived(notesStore.trashedNotes);
  const loading = $derived(notesStore.trashLoading);
  const error = $derived(notesStore.trashError);

  export function handleEscape(): boolean {
    if (confirmDeleteId) {
      confirmDeleteId = null;
      return true;
    }
    return false;
  }

  onMount(() => {
    void refreshTrash();
  });

  async function refreshTrash() {
    await notesStore.loadTrashedNotes();
  }

  async function restoreNote(id: string) {
    if (busyId) return;
    busyId = id;
    confirmDeleteId = null;
    try {
      const restored = await notesStore.restoreTrashedNote(id);
      if (!restored) {
        toastStore.error(notesStore.trashError?.message ?? 'Could not restore note');
        return;
      }
      toastStore.success('Note restored');
      onRestored?.();
    } finally {
      busyId = null;
    }
  }

  async function deleteForever(id: string) {
    if (busyId) return;
    if (confirmDeleteId !== id) {
      confirmDeleteId = id;
      return;
    }

    busyId = id;
    try {
      const deleted = await notesStore.deleteTrashedNote(id);
      if (deleted) {
        toastStore.info('Note permanently deleted');
        confirmDeleteId = null;
      } else {
        toastStore.error(notesStore.trashError?.message ?? 'Could not delete note');
      }
    } finally {
      busyId = null;
    }
  }
</script>

<section class="foreground-workspace trash-workspace" aria-label="Trash workspace">
  <nav class="foreground-workspace-nav" aria-label="Trash navigation">
    <div class="foreground-nav-title">
      <div class="foreground-nav-brand">
        <Trash2 size={16} strokeWidth={2} aria-hidden="true" />
        <span>Trash</span>
      </div>
      <button type="button" class="foreground-nav-return" onclick={() => onClose?.()} title="Back to notes (Esc)" aria-label="Back to notes">
        <ArrowLeft size={14} strokeWidth={2} aria-hidden="true" />
        <span>Notes</span>
      </button>
    </div>

    <div class="foreground-nav-body scrollbar-thin">
      <section class="foreground-nav-section" aria-label="Trash views">
        <div class="foreground-nav-section-label">Recover</div>
        <button type="button" class="foreground-nav-item active" aria-current="page">
          <span class="foreground-nav-icon" aria-hidden="true"><Trash2 size={14} strokeWidth={2} /></span>
          <span class="foreground-nav-label">Deleted notes</span>
          {#if trashedNotes.length > 0}
            <span class="foreground-nav-count tabular-nums">{trashedNotes.length}</span>
          {/if}
        </button>
      </section>
    </div>
  </nav>

  <main class="foreground-workspace-main">
    <header class="foreground-command-bar">
      <div class="foreground-title-block">
        <h1 class="foreground-title">Trash</h1>
        <p class="foreground-context">{trashedNotes.length} recoverable note{trashedNotes.length === 1 ? '' : 's'}.</p>
      </div>

      <button
        type="button"
        class="foreground-action-button"
        onclick={refreshTrash}
        disabled={loading || busyId !== null}
        title="Refresh Trash"
        aria-label="Refresh Trash"
      >
        {#if loading}
          <span class="spin" aria-hidden="true">
            <Loader2 size={15} strokeWidth={1.8} />
          </span>
        {:else}
          <RefreshCw size={15} strokeWidth={1.8} />
        {/if}
        <span>Refresh</span>
      </button>
    </header>

    <section class="foreground-content trash-content" aria-label="Trash contents" aria-busy={loading}>
      {#if error}
        <div class="error-panel" role="alert">
          <strong>Could not load Trash.</strong>
          <span>{error.message}</span>
        </div>
      {:else if loading && trashedNotes.length === 0}
        <div class="loading-panel">
          <span class="spin" aria-hidden="true">
            <Loader2 size={18} strokeWidth={1.8} />
          </span>
          <span>Loading Trash.</span>
        </div>
      {:else if trashedNotes.length === 0}
        <div class="empty-panel">
          <EmptyState variant="trash" />
        </div>
      {:else}
        <ol class="trash-list" role="list">
          {#each trashedNotes as note (note.id)}
            <li class="trash-row">
              <div class="note-main">
                <span class="note-title">{note.title}</span>
                <span class="note-path">{note.originalPath}</span>
              </div>
              <time class="deleted-at" datetime={note.deletedAt.toISOString()}>
                {formatRelativeDate(note.deletedAt)}
              </time>
              <div class="row-actions">
                <button
                  type="button"
                  class="row-button row-button-restore"
                  onclick={() => restoreNote(note.id)}
                  disabled={busyId !== null}
                >
                  <RotateCcw size={13} strokeWidth={1.9} aria-hidden="true" />
                  <span>{busyId === note.id ? 'Restoring' : 'Restore'}</span>
                </button>
                <button
                  type="button"
                  class:confirming={confirmDeleteId === note.id}
                  class="row-button row-button-danger"
                  onclick={() => deleteForever(note.id)}
                  disabled={busyId !== null}
                >
                  <Trash2 size={13} strokeWidth={1.9} aria-hidden="true" />
                  <span>{confirmDeleteId === note.id ? 'Confirm delete' : 'Delete forever'}</span>
                </button>
              </div>
            </li>
          {/each}
        </ol>
      {/if}
    </section>
  </main>
</section>

<style>
  .trash-content {
    padding: 24px;
  }

  .empty-panel,
  .loading-panel,
  .error-panel,
  .trash-list {
    width: min(100%, 920px);
    margin: 0 auto;
  }

  .empty-panel,
  .loading-panel {
    min-height: min(460px, 100%);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .loading-panel {
    gap: 8px;
    color: var(--text-tertiary);
    font-size: var(--text-small);
  }

  .error-panel {
    display: flex;
    flex-direction: column;
    gap: 4px;
    border: 1px solid var(--color-error);
    border-radius: var(--radius-md);
    background: var(--color-error-bg);
    color: var(--color-error);
    padding: 12px 14px;
    font-size: var(--text-small);
  }

  .trash-list {
    list-style: none;
    padding: 0;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-lg);
    background: var(--bg-card);
    overflow: hidden;
  }

  .trash-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(112px, auto) auto;
    align-items: center;
    gap: 16px;
    padding: 12px 14px;
    border-top: 1px solid var(--border-faint);
  }

  .trash-row:first-child {
    border-top: 0;
  }

  .note-main {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .note-title {
    color: var(--text-primary);
    font-size: 13px;
    font-weight: 650;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .note-path {
    color: var(--text-tertiary);
    font-family: var(--font-mono);
    font-size: 11px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .deleted-at {
    color: var(--text-tertiary);
    font-size: 12px;
    white-space: nowrap;
  }

  .row-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }

  .row-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-width: 104px;
    height: 30px;
    padding: 0 10px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-md);
    background: var(--bg-card);
    color: var(--text-secondary);
    font: inherit;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }

  .row-button:hover:not(:disabled) {
    background: var(--bg-subtle);
    color: var(--text-primary);
    border-color: var(--border-medium);
  }

  .row-button:focus-visible {
    outline: 2px solid var(--accent-primary);
    outline-offset: 2px;
  }

  .row-button:disabled {
    opacity: 0.58;
    cursor: not-allowed;
  }

  .row-button-restore {
    color: var(--accent-primary);
  }

  .row-button-danger {
    color: var(--color-error);
  }

  .row-button-danger.confirming {
    background: var(--color-error-bg);
    border-color: var(--color-error);
  }

  .spin {
    display: inline-flex;
    animation: spin 900ms linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (max-width: 760px) {
    .trash-content {
      padding: 16px;
    }

    .trash-row {
      grid-template-columns: minmax(0, 1fr);
      align-items: stretch;
      gap: 10px;
    }

    .deleted-at {
      white-space: normal;
    }

    .row-actions {
      justify-content: stretch;
    }

    .row-button {
      flex: 1;
      min-width: 0;
    }
  }
</style>
