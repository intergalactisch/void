<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { ArrowLeft, Loader2, RefreshCw, RotateCcw, Trash2 } from '@lucide/svelte';
  import { EmptyState } from '$lib/components/shared';
  import { notesStore, toastStore } from '$lib/stores';
  import { formatRelativeDate } from '$lib/utils/relativeDate';

  let busyId = $state<string | null>(null);
  let confirmDeleteId = $state<string | null>(null);

  const trashedNotes = $derived(notesStore.trashedNotes);
  const loading = $derived(notesStore.trashLoading);
  const error = $derived(notesStore.trashError);

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
      await goto('/');
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

<svelte:head>
  <title>Trash | Void</title>
</svelte:head>

<main class="trash-page">
  <header class="trash-header">
    <div class="header-row">
      <a href="/" class="back-link" title="Back to notes" aria-label="Back to notes">
        <ArrowLeft size={16} strokeWidth={1.8} />
      </a>
      <div class="title-group">
        <div class="title-kicker">
          <Trash2 size={14} strokeWidth={1.8} />
          <span>Workspace</span>
        </div>
        <h1>Trash</h1>
        <p>{trashedNotes.length} recoverable note{trashedNotes.length === 1 ? '' : 's'}.</p>
      </div>
      <button
        type="button"
        class="refresh-button"
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
      </button>
    </div>
  </header>

  <section class="trash-content" aria-label="Trash contents" aria-busy={loading}>
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

<style>
  .trash-page {
    height: 100%;
    overflow: hidden;
    background: var(--bg-editor);
    color: var(--text-primary);
    display: flex;
    flex-direction: column;
  }

  .trash-header {
    flex-shrink: 0;
    border-bottom: 1px solid var(--border-faint);
    background: var(--bg-editor);
    padding: 18px 24px;
  }

  .header-row {
    display: grid;
    grid-template-columns: 30px minmax(0, 1fr) 32px;
    align-items: flex-start;
    gap: 12px;
    max-width: 920px;
    margin: 0 auto;
  }

  .back-link,
  .refresh-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    flex-shrink: 0;
    color: var(--text-secondary);
    border: 1px solid var(--border-light);
    border-radius: var(--radius-md);
    background: var(--bg-card);
    text-decoration: none;
    transition: background var(--transition-fast), border-color var(--transition-fast),
                color var(--transition-fast), box-shadow var(--transition-fast);
  }

  .refresh-button {
    width: 32px;
    height: 32px;
    cursor: pointer;
  }

  .back-link:hover,
  .refresh-button:hover:not(:disabled) {
    color: var(--text-primary);
    background: var(--bg-subtle);
    border-color: var(--border-medium);
    box-shadow: var(--shadow-xs);
  }

  .back-link:focus-visible,
  .refresh-button:focus-visible,
  .row-button:focus-visible {
    outline: 2px solid var(--accent-primary);
    outline-offset: 2px;
  }

  .refresh-button:disabled,
  .row-button:disabled {
    opacity: 0.58;
    cursor: not-allowed;
  }

  .title-group {
    min-width: 0;
  }

  .title-kicker {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--text-tertiary);
    font-size: var(--text-label);
    font-weight: var(--text-label-weight);
    letter-spacing: 0;
    text-transform: uppercase;
    margin-bottom: 5px;
  }

  .title-group h1 {
    margin: 0;
    font-size: var(--text-h1);
    line-height: var(--text-h1-line-height);
    font-weight: var(--text-h1-weight);
    letter-spacing: 0;
  }

  .title-group p {
    margin: 4px 0 0;
    max-width: 480px;
    color: var(--text-tertiary);
    font-size: var(--text-small);
    line-height: var(--text-small-line-height);
  }

  .trash-content {
    flex: 1;
    overflow: auto;
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
    .trash-header {
      padding: 14px 16px;
    }

    .header-row {
      gap: 10px;
    }

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
