<script lang="ts">
  /**
   * Workspaces Page
   *
   * Dedicated section for managing notes-folder workspaces and their
   * GitHub sync. Promotes what used to live inside the Settings slide-over
   * into a first-class route so the GitHub-sync UI has room to breathe.
   *
   * Per-workspace interactions are unchanged: each workspace renders the
   * same WorkspaceCard (which embeds GitHubSyncSection) used everywhere
   * else. Only the wrapper and entry-points changed.
   */

  import { ArrowLeft, FolderOpen, Layers, Plus } from '@lucide/svelte';
  import WorkspaceCard from '$lib/components/shared/WorkspaceCard.svelte';
  import { InfoPopover } from '$lib/components/shared';
  import { settingsStore, workspaceStore } from '$lib/stores';
  import {
    MANAGED_DEFAULT_WORKSPACE_PATH,
    generateManagedWorkspacePath,
    needsManagedDefaultWorkspaceMigration,
  } from '$lib/domain';
  import { open } from '@tauri-apps/plugin-dialog';
  import { goto } from '$app/navigation';

  // ─── Add-workspace inline form (moved verbatim from SettingsPanel) ──
  let addOpen = $state(false);
  let newWorkspaceName = $state('');
  let newWorkspacePath = $state('');
  let showCustomWorkspaceFolder = $state(false);
  let creatingWorkspace = $state(false);

  function openAddWorkspace() {
    addOpen = true;
    newWorkspaceName = '';
    newWorkspacePath = '';
    showCustomWorkspaceFolder = false;
  }

  function cancelAddWorkspace() {
    addOpen = false;
    newWorkspaceName = '';
    newWorkspacePath = '';
    showCustomWorkspaceFolder = false;
  }

  async function createWorkspaceFromPage() {
    const name = newWorkspaceName.trim();
    if (!name) return;
    const notesPath = showCustomWorkspaceFolder ? newWorkspacePath.trim() || null : null;
    creatingWorkspace = true;
    try {
      const created = await workspaceStore.createAndSwitch(name, notesPath, legacyMigrationNeeded);
      if (created) {
        cancelAddWorkspace();
      }
    } finally {
      creatingWorkspace = false;
    }
  }

  async function browseNewWorkspaceFolder() {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Select notes folder for new workspace',
      });
      if (selected && typeof selected === 'string') {
        newWorkspacePath = selected;
      }
    } catch (e) {
      console.error('Failed to open folder dialog:', e);
    }
  }

  const managedWorkspacePreview = $derived(
    generateManagedWorkspacePath(
      newWorkspaceName.trim() || 'New Workflow',
      workspaceStore.workspaces.map((workspace) => workspace.notesPath),
    )
  );

  const legacyMigrationNeeded = $derived(
    settingsStore.settings
      ? needsManagedDefaultWorkspaceMigration(
          settingsStore.settings.workspaces,
          settingsStore.settings.activeWorkspaceId,
        )
      : false
  );

  // ─── Derived views over the workspace list ─────────────────────────
  const activeWorkspace = $derived(workspaceStore.activeWorkspace);
  const otherWorkspaces = $derived(
    workspaceStore.workspaces.filter((workspace) => workspace.id !== activeWorkspace?.id)
  );

  // ─── ESC closes the page ──────────────────────────────────────────
  // Layered precedence so we don't fight nested ESC handlers:
  //   1. A WorkspaceCard modal already handled ESC → it called
  //      preventDefault(), so event.defaultPrevented is true; skip.
  //   2. The user is typing in a field → let the field handle ESC
  //      (lucide inputs reset on ESC, etc.).
  //   3. The inline "Add workspace" form is open → close that first.
  //   4. Otherwise → leave the page (back to /).
  function handleKeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape') return;
    if (event.defaultPrevented) return;

    const target = event.target as HTMLElement | null;
    const isEditable = !!target && (
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT' ||
      target.isContentEditable
    );
    if (isEditable) return;

    if (addOpen) {
      event.preventDefault();
      cancelAddWorkspace();
      return;
    }

    event.preventDefault();
    void goto('/');
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<svelte:head>
  <title>Workspaces | Void</title>
</svelte:head>

<main class="workspaces-page">
  <header class="workspaces-header">
    <div class="header-row">
      <a href="/" class="back-link" title="Back to notes" aria-label="Back to notes">
        <ArrowLeft size={16} strokeWidth={1.8} />
      </a>
      <div class="title-group">
        <div class="title-kicker">
          <Layers size={14} strokeWidth={1.8} />
          <span>Void</span>
        </div>
        <h1>
          Workspaces
          <InfoPopover
            title="Workspace folders"
            body="A workspace is one notes folder, plus the local Void data that belongs to it."
            items={[
              'Switching changes which folder Void opens.',
              'GitHub sync is configured per workspace.',
              'Forgetting a workspace does not delete the folder.',
            ]}
            align="start"
          />
        </h1>
        <p>Each workspace is a notes folder you can sync to its own private GitHub repo.</p>
      </div>
      <div class="header-actions">
        {#if addOpen}
          <button
            type="button"
            class="btn btn-secondary"
            onclick={cancelAddWorkspace}
            disabled={creatingWorkspace}
          >
            Cancel
          </button>
        {:else}
          <button
            type="button"
            class="btn btn-primary header-cta"
            onclick={openAddWorkspace}
            disabled={workspaceStore.loading}
          >
            <Plus size={14} aria-hidden="true" />
            New workspace
          </button>
        {/if}
      </div>
    </div>
  </header>

  <section class="workspaces-content" aria-label="Workspaces">
    <div class="workspaces-inner">
      {#if workspaceStore.loading && workspaceStore.workspaces.length === 0}
        <div class="loading-state" role="status" aria-live="polite">
          <div class="spinner"></div>
          <p>Loading workspaces…</p>
        </div>
      {:else}
        {#if activeWorkspace}
          <div class="ws-group" aria-labelledby="ws-active-label">
            <span id="ws-active-label" class="group-label">Active</span>
            <div class="ws-list">
              <WorkspaceCard
                workspace={activeWorkspace}
                isActive={true}
                canRemove={workspaceStore.workspaces.length > 1}
                switchBlocker={null}
              />
            </div>
          </div>
        {/if}

        {#if otherWorkspaces.length > 0}
          <div class="ws-group" aria-labelledby="ws-other-label">
            <span id="ws-other-label" class="group-label">Other workspaces</span>
            <div class="ws-list">
              {#each otherWorkspaces as workspace (workspace.id)}
                <WorkspaceCard
                  {workspace}
                  isActive={false}
                  canRemove={workspaceStore.workspaces.length > 1}
                  switchBlocker={workspaceStore.switchBlockers.length > 0
                    ? workspaceStore.switchBlockers[0]?.message ?? null
                    : null}
                />
              {/each}
            </div>
          </div>
        {/if}

        {#if addOpen}
          <div class="ws-group">
            <span class="group-label">New workspace</span>
            <div class="ws-add-form">
              <label class="ws-add-label" for="ws-new-name">Workflow name</label>
              <input
                id="ws-new-name"
                type="text"
                class="input"
                placeholder="Test"
                bind:value={newWorkspaceName}
                disabled={creatingWorkspace}
                autocomplete="off"
                spellcheck="false"
              />
              <p class="ws-path-preview" title={managedWorkspacePreview}>{managedWorkspacePreview}</p>

              {#if legacyMigrationNeeded}
                <p class="ws-migration-note">
                  Void will first move the default workflow to {MANAGED_DEFAULT_WORKSPACE_PATH}.
                </p>
              {/if}

              <button
                type="button"
                class="ws-advanced-toggle"
                onclick={() => (showCustomWorkspaceFolder = !showCustomWorkspaceFolder)}
                disabled={creatingWorkspace}
                aria-expanded={showCustomWorkspaceFolder}
              >
                {showCustomWorkspaceFolder ? 'Use managed folder' : 'Choose a different folder'}
              </button>

              {#if showCustomWorkspaceFolder}
                <label class="ws-add-label" for="ws-new-path">Custom folder</label>
                <div class="input-row">
                  <input
                    id="ws-new-path"
                    type="text"
                    class="input flex-1"
                    placeholder="/path/to/folder"
                    bind:value={newWorkspacePath}
                    disabled={creatingWorkspace}
                    autocomplete="off"
                    spellcheck="false"
                  />
                  <button
                    type="button"
                    onclick={browseNewWorkspaceFolder}
                    class="btn btn-secondary"
                    title="Browse for folder"
                    aria-label="Browse for folder"
                  >
                    <FolderOpen size={14} />
                  </button>
                </div>
              {/if}

              <div class="ws-add-actions">
                <button
                  type="button"
                  class="btn btn-secondary"
                  onclick={cancelAddWorkspace}
                  disabled={creatingWorkspace}
                >Cancel</button>
                <button
                  type="button"
                  class="btn btn-primary"
                  onclick={createWorkspaceFromPage}
                  disabled={creatingWorkspace || !newWorkspaceName.trim()}
                >Create and switch</button>
              </div>
            </div>
          </div>
        {/if}
      {/if}
    </div>
  </section>
</main>

<style>
  .workspaces-page {
    height: 100%;
    overflow: hidden;
    background: var(--bg-editor);
    color: var(--text-primary);
    display: flex;
    flex-direction: column;
  }

  /* ─── Header (mirrors /trash) ─────────────────────────────────────── */
  .workspaces-header {
    flex-shrink: 0;
    border-bottom: 1px solid var(--border-faint);
    background: var(--bg-editor);
    padding: 18px 24px;
  }

  .header-row {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    max-width: 840px;
    margin: 0 auto;
  }

  .back-link {
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

  .back-link:hover {
    color: var(--text-primary);
    background: var(--bg-subtle);
    border-color: var(--border-medium);
    box-shadow: var(--shadow-xs);
  }

  .back-link:focus-visible {
    outline: 2px solid var(--accent-primary);
    outline-offset: 2px;
  }

  .title-group {
    min-width: 0;
    flex: 1;
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
    display: inline-flex;
    align-items: center;
    gap: 5px;
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

  .header-actions {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
    margin-top: 2px;
  }

  .header-cta {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  /* ─── Content area ────────────────────────────────────────────────── */
  .workspaces-content {
    flex: 1;
    overflow-y: auto;
    padding: 28px 24px 56px;
  }

  .workspaces-inner {
    max-width: 840px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 28px;
  }

  .ws-group {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .group-label {
    display: block;
    font-size: var(--text-label);
    font-weight: var(--text-label-weight);
    text-transform: uppercase;
    letter-spacing: var(--text-label-tracking);
    color: var(--text-tertiary);
  }

  .ws-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  /* ─── Loading state ───────────────────────────────────────────────── */
  .loading-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 64px 0;
    color: var(--text-secondary);
    font-size: 13px;
    gap: 12px;
  }

  .spinner {
    width: 20px;
    height: 20px;
    border: 2px solid var(--border-light);
    border-top-color: var(--accent-primary);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  /* ─── Add-workspace inline form (lifted from SettingsPanel) ───────── */
  .ws-add-form {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 14px;
    background: var(--bg-subtle);
    border: 1px solid var(--border-light);
    border-radius: var(--radius-md);
  }

  .ws-add-label {
    font-size: var(--text-label);
    font-weight: var(--text-label-weight);
    letter-spacing: var(--text-label-tracking);
    text-transform: uppercase;
    color: var(--text-tertiary);
  }

  .ws-path-preview {
    margin: -2px 0 2px;
    padding: 7px 9px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    border-radius: var(--radius-sm);
    background: var(--bg-card);
    border: 1px solid var(--border-faint);
    color: var(--text-tertiary);
    font-family: var(--font-mono);
    font-size: 11px;
  }

  .ws-migration-note {
    margin: 0;
    padding: 8px 9px;
    border-radius: var(--radius-sm);
    background: var(--color-warning-bg, rgba(255, 200, 0, 0.12));
    color: var(--text-secondary);
    font-size: var(--text-caption);
    line-height: 1.4;
  }

  .ws-advanced-toggle {
    align-self: flex-start;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--accent-primary);
    font-family: inherit;
    font-size: var(--text-caption);
    font-weight: 500;
    cursor: pointer;
  }

  .ws-advanced-toggle:hover:not(:disabled) {
    color: var(--accent-hover);
  }

  .ws-advanced-toggle:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .ws-add-actions {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
    margin-top: 4px;
  }

  .input-row {
    display: flex;
    gap: 6px;
  }

  .input-row .flex-1 {
    flex: 1;
  }

  /* ─── Responsive ──────────────────────────────────────────────────── */
  @media (max-width: 640px) {
    .workspaces-header {
      padding: 14px 16px;
    }

    .header-row {
      flex-wrap: wrap;
      gap: 10px;
    }

    .header-actions {
      width: 100%;
      justify-content: flex-end;
    }

    .workspaces-content {
      padding: 20px 16px 40px;
    }
  }
</style>
