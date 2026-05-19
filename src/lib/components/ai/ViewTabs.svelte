<script lang="ts">
  /**
   * ViewTabs - Segmented control for sidebar views
   *
   * Three icon tabs: Chat, History, Actions.
   * Compact enough for the sidebar header.
   */

  import type { SidebarView } from '$lib/stores/ai.svelte';

  interface Props {
    /** Currently active view */
    active: SidebarView;
    /** Callback when a view is selected */
    onChange: (view: SidebarView) => void;
    /** Number of work items that need attention */
    pendingCount?: number;
  }

  let { active, onChange, pendingCount = 0 }: Props = $props();

  const tabs: { view: SidebarView; label: string; title: string }[] = [
    { view: 'chat', label: 'Chat', title: 'Chat' },
    { view: 'history', label: 'History', title: 'History' },
    { view: 'actions', label: 'Work', title: 'Work' },
  ];
</script>

<div class="view-tabs" role="tablist" aria-label="Sidebar view">
  {#each tabs as tab (tab.view)}
    <button
      type="button"
      class="tab"
      class:active={active === tab.view}
      role="tab"
      aria-selected={active === tab.view}
      title={tab.title}
      onclick={() => onChange(tab.view)}
    >
      {#if tab.view === 'chat'}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      {:else if tab.view === 'history'}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
      {:else}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
        </svg>
        {#if tab.view === 'actions' && pendingCount > 0}
          <span class="pending-dot" aria-label="{pendingCount} work items need attention"></span>
        {/if}
      {/if}
    </button>
  {/each}
</div>

<style>
  /* ─── Segmented control ─── */
  .view-tabs {
    display: inline-flex;
    background-color: var(--bg-subtle);
    border: 1px solid var(--border-light);
    border-radius: var(--radius-md);
    padding: 2px;
    gap: 1px;
  }

  .tab {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 22px;
    border: none;
    background: transparent;
    color: var(--text-tertiary);
    border-radius: 4px;
    cursor: pointer;
    font-family: inherit;
    transition: color var(--transition-fast), background var(--transition-fast),
                box-shadow var(--transition-fast);
  }

  .tab:hover:not(.active) {
    color: var(--text-primary);
  }

  .tab.active {
    background-color: var(--bg-card);
    color: var(--text-primary);
    box-shadow: 0 1px 2px rgba(20, 19, 16, 0.06), 0 0 0 1px var(--border-light);
  }

  .tab:focus-visible {
    outline: 2px solid var(--accent-primary);
    outline-offset: 1px;
  }

  .pending-dot {
    position: absolute;
    top: 2px;
    right: 3px;
    width: 5px;
    height: 5px;
    background-color: var(--ai-accent);
    border-radius: 50%;
    box-shadow: 0 0 0 1.5px var(--bg-card);
  }
</style>
