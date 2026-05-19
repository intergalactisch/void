<script lang="ts">
  /**
   * RelationsPanel — note details rail for explicit note references.
   */

  import { relationsStore, notesStore, uiStore } from '$lib/stores';
  import { events } from '$lib/events';
  import { ArrowDownLeft, FileText, Link2, Paperclip, X } from '@lucide/svelte';

  $effect(() => {
    void relationsStore.fetchFor(notesStore.selectedPath);
  });

  const hasAttached = $derived(relationsStore.outgoing.length > 0);
  const hasReferencedBy = $derived(relationsStore.backlinks.length > 0);

  function navigate(path: string) {
    notesStore.selectNote(path);
    events.emit('app:navigate', { view: 'note', path });
  }

  function close() {
    uiStore.closeRelationsPanel();
  }
</script>

{#if uiStore.relationsPanelVisible}
  <aside class="relations-panel" aria-label="Note details">
    <div class="relations-card">
      <header class="relations-header">
        <span class="relations-title">
          <Link2 size={14} strokeWidth={1.8} aria-hidden="true" />
          References
        </span>
        <button type="button" class="relations-close" onclick={close} aria-label="Close references panel">
          <X size={14} strokeWidth={1.8} />
        </button>
      </header>

      <div class="relations-body">
        {#if relationsStore.loading}
          <div class="relations-empty">Scanning links...</div>
        {:else if !relationsStore.activePath}
          <div class="relations-empty">No note open</div>
        {:else if !hasAttached && !hasReferencedBy}
          <div class="relations-empty">
            Add a note reference to attach notes here.
          </div>
        {:else}
          {#if hasAttached}
            <section class="relations-section">
              <h3 class="section-label">
                <Paperclip size={13} strokeWidth={1.8} aria-hidden="true" />
                Attached notes
                <span class="section-count">{relationsStore.outgoing.length}</span>
              </h3>
              <ul class="relations-list" role="list">
                {#each relationsStore.outgoing as link (link.path + ':' + link.line)}
                  <li>
                    <button
                      type="button"
                      class="relation-row"
                      onclick={() => navigate(link.path)}
                      title={link.context}
                    >
                      <FileText size={14} strokeWidth={1.8} aria-hidden="true" />
                      <span class="relation-copy">
                        <span class="relation-title">{link.title}</span>
                        <span class="relation-context">{link.linkText || link.context}</span>
                      </span>
                    </button>
                  </li>
                {/each}
              </ul>
            </section>
          {/if}

          {#if hasReferencedBy}
            <section class="relations-section">
              <h3 class="section-label">
                <ArrowDownLeft size={13} strokeWidth={1.8} aria-hidden="true" />
                Referenced by
                <span class="section-count">{relationsStore.backlinks.length}</span>
              </h3>
              <ul class="relations-list" role="list">
                {#each relationsStore.backlinks as link (link.path + ':' + link.line)}
                  <li>
                    <button
                      type="button"
                      class="relation-row"
                      onclick={() => navigate(link.path)}
                      title={link.context}
                    >
                      <FileText size={14} strokeWidth={1.8} aria-hidden="true" />
                      <span class="relation-copy">
                        <span class="relation-title">{link.title}</span>
                        <span class="relation-context">{link.context}</span>
                      </span>
                    </button>
                  </li>
                {/each}
              </ul>
            </section>
          {/if}
        {/if}
      </div>
    </div>
  </aside>
{/if}

<style>
  .relations-panel {
    width: 300px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    background: var(--bg-editor);
    border-left: 1px solid var(--border-faint);
    padding: 14px;
    overflow: hidden;
  }

  .relations-card {
    display: flex;
    min-height: 0;
    max-height: 100%;
    flex-direction: column;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-lg);
    background: var(--bg-card);
    box-shadow: var(--shadow-md);
    overflow: hidden;
  }

  .relations-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 42px;
    padding: 0 10px 0 13px;
    border-bottom: 1px solid var(--border-faint);
  }

  .relations-title {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    font-size: 13px;
    font-weight: 650;
    color: var(--text-secondary);
  }

  .relations-close {
    border: none;
    background: transparent;
    color: var(--text-muted);
    width: 26px;
    height: 26px;
    border-radius: var(--radius-sm);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .relations-close:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .relations-body {
    flex: 1;
    overflow-y: auto;
    padding: 9px 7px 14px;
  }

  .relations-empty {
    color: var(--text-tertiary);
    font-size: 13px;
    padding: 20px 12px;
    text-align: center;
  }

  .relations-section + .relations-section {
    margin-top: 12px;
    padding-top: 10px;
    border-top: 1px solid var(--border-faint);
  }

  .section-label {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--text-tertiary);
    font-weight: 650;
    padding: 4px 6px 7px;
    margin: 0;
  }

  .section-count {
    margin-left: auto;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }

  .relations-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .relation-row {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    width: 100%;
    text-align: left;
    padding: 8px 7px;
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
    color: var(--text-secondary);
    font-family: inherit;
  }

  .relation-row:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .relation-copy {
    display: flex;
    min-width: 0;
    flex: 1;
    flex-direction: column;
    gap: 2px;
  }

  .relation-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .relation-context {
    font-size: 11px;
    color: var(--text-tertiary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  @media (max-width: 860px) {
    .relations-panel {
      position: fixed;
      top: 52px;
      right: 10px;
      bottom: 10px;
      z-index: 35;
      width: min(320px, calc(100vw - 20px));
      border-left: none;
      padding: 0;
      background: transparent;
    }
  }
</style>
