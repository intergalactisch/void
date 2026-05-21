<script lang="ts">
  /**
   * WorkspaceCard — one workspace, two density modes.
   *
   *   Active: inline-edit name + folder, last-opened timestamp, and embedded
   *           GitHub sync controls.
   *   Inactive: name, truncated path, sync pill, Switch, and workspace actions.
   *
   * State lives in workspaceStore; this component only translates user intent.
   */

  import { workspaceStore, toastStore } from '$lib/stores';
  import type { Workspace } from '$lib/domain';
  import { open } from '@tauri-apps/plugin-dialog';
  import { Check, FolderInput, FolderOpen, MoreHorizontal, Pencil, Trash2, X } from '@lucide/svelte';
  import GitHubSyncSection from './GitHubSyncSection.svelte';

  interface Props {
    workspace: Workspace;
    isActive: boolean;
    canRemove: boolean;
    switchBlocker?: string | null;
  }

  let { workspace, isActive, canRemove, switchBlocker = null }: Props = $props();

  // Local edit buffers. Initialised empty and kept in sync with the workspace
  // prop via the effect below — using $effect rather than capturing the prop
  // value directly avoids the "state captures initial value" Svelte warning
  // while still letting the user edit before commit.
  let nameInput = $state('');
  let pathInput = $state('');
  let moveInput = $state('');
  let trashConfirmInput = $state('');
  let savingName = $state(false);
  let savingPath = $state(false);
  let manageOpen = $state(false);
  let dialog = $state<'rename' | 'move' | 'forget' | 'trash' | null>(null);
  let actionBusy = $state(false);

  $effect(() => {
    nameInput = workspace.name;
    pathInput = workspace.notesPath;
    moveInput = siblingDestination(workspace.notesPath);
    trashConfirmInput = '';
  });

  async function commitName(): Promise<void> {
    const next = nameInput.trim();
    if (!next || next === workspace.name) {
      nameInput = workspace.name;
      return;
    }
    savingName = true;
    try {
      const updated = await workspaceStore.rename(workspace.id, next);
      if (!updated) nameInput = workspace.name;
    } finally {
      savingName = false;
    }
  }

  async function commitPath(): Promise<void> {
    const next = pathInput.trim();
    if (!next || next === workspace.notesPath) {
      pathInput = workspace.notesPath;
      return;
    }
    savingPath = true;
    try {
      const updated = await workspaceStore.updateNotesPath(workspace.id, next);
      if (updated) {
        toastStore.info('Folder updated. Switch away and back to reload notes from the new path.');
      } else {
        pathInput = workspace.notesPath;
      }
    } finally {
      savingPath = false;
    }
  }

  async function browseFolder(): Promise<void> {
    try {
      const selected = await open({ directory: true, multiple: false, title: 'Select notes folder' });
      if (selected && typeof selected === 'string') {
        pathInput = selected;
        await commitPath();
      }
    } catch (e) {
      console.error('Failed to open folder dialog:', e);
    }
  }

  async function browseMoveParentFolder(): Promise<void> {
    try {
      const selected = await open({ directory: true, multiple: false, title: 'Choose destination parent folder' });
      if (selected && typeof selected === 'string') {
        moveInput = `${selected.replace(/\/+$/, '')}/${folderName(workspace.notesPath)}`;
      }
    } catch (e) {
      console.error('Failed to open folder dialog:', e);
    }
  }

  function onInputKeydown(event: KeyboardEvent, reset: () => void): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      (event.target as HTMLInputElement).blur();
    } else if (event.key === 'Escape') {
      reset();
      (event.target as HTMLInputElement).blur();
    }
  }

  async function handleSwitch(): Promise<void> {
    await workspaceStore.switchTo(workspace.id);
  }

  function openDialog(kind: 'rename' | 'move' | 'forget' | 'trash'): void {
    if (kind !== 'rename' && !canRemove) return;
    nameInput = workspace.name;
    moveInput = siblingDestination(workspace.notesPath);
    trashConfirmInput = '';
    dialog = kind;
    manageOpen = false;
  }

  function closeDialog(): void {
    if (actionBusy) return;
    dialog = null;
    trashConfirmInput = '';
  }

  function dialogBackdropClick(event: MouseEvent): void {
    if (event.currentTarget === event.target) closeDialog();
  }

  function dialogKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeDialog();
    }
  }

  async function submitRename(): Promise<void> {
    const next = nameInput.trim();
    if (!next) return;
    if (next === workspace.name) {
      closeDialog();
      return;
    }
    actionBusy = true;
    try {
      const updated = await workspaceStore.rename(workspace.id, next);
      if (updated) {
        toastStore.success(`Renamed workspace to ${updated.name}`);
        dialog = null;
      }
    } finally {
      actionBusy = false;
    }
  }

  async function submitMove(): Promise<void> {
    const destination = moveInput.trim();
    if (!destination) return;
    actionBusy = true;
    try {
      const updated = await workspaceStore.moveFolder(workspace.id, destination);
      if (updated) {
        toastStore.success(`Moved ${updated.name}`);
        dialog = null;
      }
    } finally {
      actionBusy = false;
    }
  }

  async function submitForget(): Promise<void> {
    actionBusy = true;
    try {
      const removed = await workspaceStore.remove(workspace.id);
      if (removed) {
        toastStore.success(`Forgot ${workspace.name}`);
        dialog = null;
      }
    } finally {
      actionBusy = false;
    }
  }

  async function submitTrash(): Promise<void> {
    if (trashConfirmInput !== workspace.name) return;
    actionBusy = true;
    try {
      const trashed = await workspaceStore.trash(workspace.id);
      if (trashed) {
        toastStore.success(`Removed ${workspace.name} from Void`);
        dialog = null;
      }
    } finally {
      actionBusy = false;
    }
  }

  function folderName(path: string): string {
    const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '');
    const parts = normalized.split('/').filter(Boolean);
    return parts.at(-1) ?? workspace.name;
  }

  function siblingDestination(path: string): string {
    const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '');
    const slash = normalized.lastIndexOf('/');
    if (slash < 0) return path;
    const parent = normalized.slice(0, slash);
    const leaf = normalized.slice(slash + 1);
    return `${parent || '/'}/${leaf}`;
  }

  function formatRelative(iso: string): string {
    if (!iso) return '';
    const past = new Date(iso).getTime();
    if (Number.isNaN(past)) return '';
    const secs = Math.max(1, Math.floor((Date.now() - past) / 1000));
    if (secs < 60) return 'just now';
    if (secs < 3_600) return `${Math.floor(secs / 60)}m ago`;
    if (secs < 86_400) return `${Math.floor(secs / 3_600)}h ago`;
    if (secs < 86_400 * 7) return `${Math.floor(secs / 86_400)}d ago`;
    return new Date(iso).toLocaleDateString();
  }

  type PillKind = 'synced' | 'paused' | 'idle';
  const syncStatus = $derived<{ kind: PillKind; label: string }>(
    workspace.sync.repository
      ? workspace.sync.paused
        ? { kind: 'paused', label: 'Paused' }
        : { kind: 'synced', label: 'Synced' }
      : { kind: 'idle', label: 'Not synced' },
  );
</script>

{#if isActive}
  <article class="ws-card ws-card-active" aria-label="Active workspace">
    <header class="ws-head">
      <input
        type="text"
        class="ws-name-input"
        bind:value={nameInput}
        onblur={commitName}
        onkeydown={(e) => onInputKeydown(e, () => (nameInput = workspace.name))}
        aria-label="Workspace name"
        disabled={savingName}
        spellcheck="false"
        autocomplete="off"
      />
      <span class="ws-active-pill">
        <Check size={10} aria-hidden="true" />
        Active
      </span>
    </header>

    <label class="ws-field-label" for={`ws-path-${workspace.id}`}>Folder</label>
    <div class="ws-input-row">
      <input
        id={`ws-path-${workspace.id}`}
        type="text"
        class="ws-input ws-input-path"
        bind:value={pathInput}
        onblur={commitPath}
        onkeydown={(e) => onInputKeydown(e, () => (pathInput = workspace.notesPath))}
        disabled={savingPath}
        spellcheck="false"
        autocomplete="off"
      />
      <button
        type="button"
        class="ws-icon-btn"
        onclick={browseFolder}
        disabled={savingPath}
        aria-label="Browse for folder"
        title="Browse for folder"
      >
        <FolderOpen size={14} />
      </button>
    </div>

    <p class="ws-meta">Last opened {formatRelative(workspace.lastOpenedAt)}</p>

    <div class="ws-divider" role="presentation"></div>

    <GitHubSyncSection workspaceId={workspace.id} />

    <div class="ws-divider" role="presentation"></div>

    <footer class="ws-footer">
      <p class="ws-active-note">
        {canRemove
          ? 'Switch to another workspace to move, forget, or trash this one.'
          : 'Add another workspace before moving, forgetting, or trashing this one.'}
      </p>
    </footer>
  </article>
{:else}
  <article class="ws-card ws-card-inactive" aria-label={`Inactive workspace: ${workspace.name}`}>
    <div class="ws-inactive-main">
      <span class="ws-name">{workspace.name}</span>
      <span class="ws-path" dir="ltr" title={workspace.notesPath}>{workspace.notesPath}</span>
    </div>
    <div class="ws-inactive-side">
      <span class={`ws-sync-pill ws-sync-${syncStatus.kind}`}>{syncStatus.label}</span>
      <button type="button" class="ws-btn ws-btn-secondary" onclick={handleSwitch}>
        Switch
      </button>
      <button
        type="button"
        class="ws-icon-btn"
        onclick={() => (manageOpen = !manageOpen)}
        aria-label={`Manage ${workspace.name}`}
        title="Manage workspace"
        aria-expanded={manageOpen}
      >
        <MoreHorizontal size={14} aria-hidden="true" />
      </button>
    </div>
    {#if manageOpen}
      <div class="ws-manage-actions" aria-label={`Actions for ${workspace.name}`}>
        <button type="button" class="ws-action-btn" onclick={() => openDialog('rename')}>
          <Pencil size={13} aria-hidden="true" />
          Rename workspace
        </button>
        <button
          type="button"
          class="ws-action-btn"
          onclick={() => openDialog('move')}
          disabled={!canRemove}
          title={canRemove ? 'Move the folder on disk' : 'Void needs at least one workspace'}
        >
          <FolderInput size={13} aria-hidden="true" />
          Move folder
        </button>
        <button
          type="button"
          class="ws-action-btn"
          onclick={() => openDialog('forget')}
          disabled={!canRemove}
          title={canRemove ? 'Remove from Void without deleting files' : 'Void needs at least one workspace'}
        >
          <X size={13} aria-hidden="true" />
          Forget from Void
        </button>
        <button
          type="button"
          class="ws-action-btn ws-action-danger"
          onclick={() => openDialog('trash')}
          disabled={!canRemove}
          title={canRemove ? 'Move the local folder to Trash' : 'Void needs at least one workspace'}
        >
          <Trash2 size={13} aria-hidden="true" />
          Move to Trash
        </button>
      </div>
    {/if}
    {#if switchBlocker}
      <p class="ws-blocker">{switchBlocker}</p>
    {/if}
  </article>
{/if}

{#if dialog}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="ws-modal-backdrop" onclick={dialogBackdropClick} onkeydown={dialogKeydown} role="presentation">
    <div
      class="ws-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby={`ws-dialog-title-${workspace.id}`}
      tabindex="-1"
    >
      <header class="ws-modal-head">
        <h3 id={`ws-dialog-title-${workspace.id}`} class="ws-modal-title">
          {#if dialog === 'rename'}
            Rename workspace
          {:else if dialog === 'move'}
            Move folder
          {:else if dialog === 'forget'}
            Forget from Void
          {:else}
            Move to Trash
          {/if}
        </h3>
        <button type="button" class="ws-icon-btn" onclick={closeDialog} aria-label="Close dialog" disabled={actionBusy}>
          <X size={14} aria-hidden="true" />
        </button>
      </header>

      {#if dialog === 'rename'}
        <p class="ws-dialog-copy">Only the name shown in Void changes. The folder stays where it is.</p>
        <label class="ws-dialog-label" for={`ws-rename-${workspace.id}`}>Workspace name</label>
        <input
          id={`ws-rename-${workspace.id}`}
          class="ws-input"
          bind:value={nameInput}
          disabled={actionBusy}
          autocomplete="off"
          spellcheck="false"
          onkeydown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void submitRename();
            }
          }}
        />
      {:else if dialog === 'move'}
        <p class="ws-dialog-copy">Void will move the whole folder, including notes, .void data, Git history, and sync settings.</p>
        <div class="ws-path-box" title={workspace.notesPath}>{workspace.notesPath}</div>
        <label class="ws-dialog-label" for={`ws-move-${workspace.id}`}>New folder path</label>
        <div class="ws-input-row">
          <input
            id={`ws-move-${workspace.id}`}
            class="ws-input ws-input-path"
            bind:value={moveInput}
            disabled={actionBusy}
            autocomplete="off"
            spellcheck="false"
          />
          <button
            type="button"
            class="ws-icon-btn"
            onclick={browseMoveParentFolder}
            disabled={actionBusy}
            aria-label="Choose destination parent folder"
            title="Choose destination parent folder"
          >
            <FolderOpen size={14} aria-hidden="true" />
          </button>
        </div>
      {:else if dialog === 'forget'}
        <p class="ws-dialog-copy">Void will remove this workspace from the app. The folder and any GitHub repository stay untouched.</p>
        <div class="ws-path-box" title={workspace.notesPath}>{workspace.notesPath}</div>
      {:else}
        <p class="ws-dialog-copy">Void will remove this workspace from the app and move its local folder to the operating system Trash.</p>
        <div class="ws-path-box" title={workspace.notesPath}>{workspace.notesPath}</div>
        {#if workspace.sync.repository}
          <p class="ws-sync-note">The GitHub repository {workspace.sync.repository.fullName} will not be deleted.</p>
        {/if}
        <label class="ws-dialog-label" for={`ws-trash-${workspace.id}`}>Type {workspace.name} to confirm</label>
        <input
          id={`ws-trash-${workspace.id}`}
          class="ws-input"
          bind:value={trashConfirmInput}
          disabled={actionBusy}
          autocomplete="off"
          spellcheck="false"
        />
      {/if}

      <footer class="ws-modal-actions">
        <button type="button" class="ws-btn ws-btn-secondary" onclick={closeDialog} disabled={actionBusy}>Cancel</button>
        {#if dialog === 'rename'}
          <button type="button" class="ws-btn ws-btn-primary" onclick={submitRename} disabled={actionBusy || !nameInput.trim()}>
            Save name
          </button>
        {:else if dialog === 'move'}
          <button type="button" class="ws-btn ws-btn-primary" onclick={submitMove} disabled={actionBusy || !moveInput.trim()}>
            Move folder
          </button>
        {:else if dialog === 'forget'}
          <button type="button" class="ws-btn ws-btn-danger-fill" onclick={submitForget} disabled={actionBusy}>
            Forget from Void
          </button>
        {:else}
          <button type="button" class="ws-btn ws-btn-danger-fill" onclick={submitTrash} disabled={actionBusy || trashConfirmInput !== workspace.name}>
            Move to Trash
          </button>
        {/if}
      </footer>
    </div>
  </div>
{/if}

<style>
  /* ─── Base card ───────────────────────────────────────────────────── */
  .ws-card {
    background: var(--bg-card);
    border: 1px solid var(--border-light);
    border-radius: var(--radius-lg);
    transition: border-color var(--transition-fast);
  }

  .ws-card-active {
    border-color: var(--border-medium);
    box-shadow: var(--shadow-xs);
    padding: 14px 14px 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .ws-card-inactive {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    column-gap: 12px;
    padding: 10px 12px;
  }

  .ws-card-inactive:hover {
    border-color: var(--border-medium);
    background: var(--bg-subtle);
  }

  /* ─── Active head ─────────────────────────────────────────────────── */
  .ws-head {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .ws-name-input {
    flex: 1;
    min-width: 0;
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    padding: 4px 6px;
    margin-left: -6px;
    font-size: var(--text-h3);
    font-weight: 600;
    color: var(--text-primary);
    font-family: inherit;
    letter-spacing: var(--text-h3-tracking);
    transition: background var(--transition-fast), border-color var(--transition-fast);
  }

  .ws-name-input:hover:not(:focus):not(:disabled) {
    background: var(--bg-hover);
  }

  .ws-name-input:focus {
    outline: none;
    background: var(--bg-card);
    border-color: var(--accent-primary);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }

  .ws-active-pill {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 2px 8px;
    background: var(--accent-soft);
    color: var(--accent-primary);
    border-radius: var(--radius-full);
    font-size: var(--text-micro);
    font-weight: 600;
    letter-spacing: 0.02em;
    flex-shrink: 0;
  }

  /* ─── Field label + input row ─────────────────────────────────────── */
  .ws-field-label {
    font-size: var(--text-label);
    font-weight: var(--text-label-weight);
    letter-spacing: var(--text-label-tracking);
    text-transform: uppercase;
    color: var(--text-tertiary);
    margin-top: 2px;
  }

  .ws-input-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .ws-input {
    flex: 1;
    min-width: 0;
    padding: 6px 10px;
    border-radius: var(--radius-md);
    background: var(--bg-card);
    border: 1px solid var(--border-medium);
    color: var(--text-primary);
    font-size: var(--text-small);
    font-family: inherit;
    transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
  }

  .ws-input-path {
    font-family: var(--font-mono);
    letter-spacing: -0.003em;
  }

  .ws-input:hover:not(:focus):not(:disabled) {
    border-color: var(--border-dark);
  }

  .ws-input:focus {
    outline: none;
    border-color: var(--accent-primary);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }

  .ws-icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    flex-shrink: 0;
    background: var(--bg-card);
    border: 1px solid var(--border-medium);
    border-radius: var(--radius-md);
    color: var(--text-secondary);
    cursor: pointer;
    transition: background var(--transition-fast), border-color var(--transition-fast),
                color var(--transition-fast);
  }

  .ws-icon-btn:hover:not(:disabled) {
    background: var(--bg-subtle);
    border-color: var(--border-dark);
    color: var(--text-primary);
  }

  .ws-icon-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .ws-meta {
    margin: 0;
    font-size: var(--text-caption);
    color: var(--text-tertiary);
  }

  /* ─── Card interior divider ───────────────────────────────────────── */
  .ws-divider {
    height: 1px;
    background: var(--border-faint);
    margin: 6px -14px;
  }

  /* ─── Footer ──────────────────────────────────────────────────────── */
  .ws-footer {
    display: flex;
    justify-content: flex-end;
    padding-top: 2px;
  }

  .ws-active-note {
    margin: 0;
    color: var(--text-tertiary);
    font-size: var(--text-caption);
    line-height: 1.4;
  }

  /* ─── Buttons (scoped) ────────────────────────────────────────────── */
  .ws-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 10px;
    border-radius: var(--radius-md);
    font-size: var(--text-caption);
    font-weight: 500;
    border: 1px solid transparent;
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    transition: background var(--transition-fast), color var(--transition-fast),
                border-color var(--transition-fast);
  }

  .ws-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .ws-btn-secondary {
    background: var(--bg-card);
    border-color: var(--border-medium);
    color: var(--text-primary);
  }

  .ws-btn-secondary:hover:not(:disabled) {
    background: var(--bg-subtle);
    border-color: var(--border-dark);
  }

  .ws-btn-primary {
    background: var(--accent-primary);
    border-color: var(--accent-primary);
    color: var(--text-on-accent, white);
  }

  .ws-btn-primary:hover:not(:disabled) {
    background: var(--accent-primary-hover, var(--accent-primary));
    border-color: var(--accent-primary-hover, var(--accent-primary));
  }

  .ws-btn-danger {
    color: var(--color-error);
  }

  .ws-btn-danger:hover:not(:disabled) {
    background: var(--color-error-bg);
  }

  .ws-btn-danger-fill {
    background: var(--color-error);
    border-color: var(--color-error);
    color: var(--text-on-accent, white);
  }

  .ws-btn-danger-fill:hover:not(:disabled) {
    filter: brightness(0.96);
  }

  /* ─── Inactive card body ──────────────────────────────────────────── */
  .ws-inactive-main {
    display: flex;
    flex-direction: column;
    min-width: 0;
    gap: 1px;
  }

  .ws-name {
    font-size: var(--text-small);
    font-weight: 600;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ws-path {
    font-size: var(--text-micro);
    color: var(--text-tertiary);
    font-family: var(--font-mono);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    /* Truncate from the start so the meaningful tail of the path stays visible. */
    direction: rtl;
    text-align: left;
    unicode-bidi: plaintext;
  }

  .ws-inactive-side {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }

  .ws-manage-actions {
    grid-column: 1 / -1;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 6px;
    margin-top: 10px;
    padding-top: 10px;
    border-top: 1px solid var(--border-faint);
  }

  .ws-action-btn {
    display: inline-flex;
    align-items: center;
    justify-content: flex-start;
    gap: 6px;
    min-width: 0;
    padding: 7px 8px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-md);
    background: var(--bg-card);
    color: var(--text-secondary);
    font-size: var(--text-caption);
    font-weight: 500;
    text-align: left;
    cursor: pointer;
    transition: background var(--transition-fast), border-color var(--transition-fast),
                color var(--transition-fast);
  }

  .ws-action-btn:hover:not(:disabled) {
    background: var(--bg-subtle);
    border-color: var(--border-medium);
    color: var(--text-primary);
  }

  .ws-action-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .ws-action-danger {
    color: var(--color-error);
  }

  /* ─── Sync status pill ────────────────────────────────────────────── */
  .ws-sync-pill {
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    border-radius: var(--radius-full);
    font-size: var(--text-micro);
    font-weight: 500;
    letter-spacing: 0.02em;
  }

  .ws-sync-synced {
    background: var(--color-success-bg);
    color: var(--color-success);
  }

  .ws-sync-paused {
    background: var(--bg-subtle);
    color: var(--text-secondary);
  }

  .ws-sync-idle {
    color: var(--text-muted);
  }

  /* ─── Switch blocker ──────────────────────────────────────────────── */
  .ws-blocker {
    grid-column: 1 / -1;
    margin: 8px 0 0;
    padding: 8px 10px;
    background: var(--color-warning-bg);
    border: 1px solid var(--color-warning);
    border-radius: var(--radius-md);
    color: var(--color-warning);
    font-size: var(--text-caption);
    line-height: 1.4;
  }

  /* ─── Workspace action dialogs ───────────────────────────────────── */
  .ws-modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: calc(var(--z-overlay) + 1);
    display: grid;
    place-items: center;
    padding: 20px;
    background: var(--bg-overlay);
    backdrop-filter: blur(6px) saturate(130%);
    -webkit-backdrop-filter: blur(6px) saturate(130%);
  }

  .ws-modal {
    width: min(420px, 100%);
    border: 1px solid var(--border-light);
    border-radius: var(--radius-lg);
    background: var(--bg-app);
    box-shadow: var(--shadow-dialog);
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .ws-modal-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .ws-modal-title {
    margin: 0;
    color: var(--text-primary);
    font-size: var(--text-h3);
    font-weight: 600;
    letter-spacing: var(--text-h3-tracking);
  }

  .ws-dialog-copy,
  .ws-sync-note {
    margin: 0;
    color: var(--text-secondary);
    font-size: var(--text-caption);
    line-height: 1.45;
  }

  .ws-sync-note {
    padding: 8px 10px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-md);
    background: var(--bg-subtle);
  }

  .ws-dialog-label {
    color: var(--text-tertiary);
    font-size: var(--text-label);
    font-weight: var(--text-label-weight);
    letter-spacing: var(--text-label-tracking);
    text-transform: uppercase;
  }

  .ws-path-box {
    min-width: 0;
    padding: 8px 10px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-md);
    background: var(--bg-card);
    color: var(--text-tertiary);
    font-family: var(--font-mono);
    font-size: var(--text-micro);
    line-height: 1.45;
    overflow-wrap: anywhere;
  }

  .ws-modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding-top: 4px;
  }

  @media (max-width: 520px) {
    .ws-card-inactive {
      grid-template-columns: 1fr;
      row-gap: 8px;
    }

    .ws-inactive-side {
      justify-content: flex-start;
      flex-wrap: wrap;
    }

    .ws-manage-actions {
      grid-template-columns: 1fr;
    }
  }
</style>
