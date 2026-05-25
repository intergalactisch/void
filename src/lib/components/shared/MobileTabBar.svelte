<script lang="ts">
  import { Bot, CheckSquare, FileText, Search } from '@lucide/svelte';
  import { uiStore } from '$lib/stores';
  import { goto } from '$app/navigation';

  function openNotes() {
    void goto('/');
  }

  function openTasks() {
    uiStore.openTasksWorkspace(null, uiStore.aiSidebarVisible);
  }

  function openAI() {
    uiStore.openAISidebar();
  }

  function openSearch() {
    uiStore.openSearchPanel();
  }
</script>

<nav class="mobile-tab-bar" aria-label="Primary">
  <button type="button" onclick={openNotes} aria-label="Notes">
    <FileText size={20} strokeWidth={1.8} />
    <span>Notes</span>
  </button>
  <button type="button" onclick={openTasks} aria-label="Tasks">
    <CheckSquare size={20} strokeWidth={1.8} />
    <span>Tasks</span>
  </button>
  <button type="button" onclick={openAI} aria-label="AI">
    <Bot size={20} strokeWidth={1.8} />
    <span>AI</span>
  </button>
  <button type="button" onclick={openSearch} aria-label="Search">
    <Search size={20} strokeWidth={1.8} />
    <span>Search</span>
  </button>
</nav>

<style>
  .mobile-tab-bar {
    position: fixed;
    right: 0;
    bottom: 0;
    left: 0;
    z-index: var(--z-sticky);
    display: none;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 0;
    padding: 6px max(10px, env(safe-area-inset-left)) max(8px, env(safe-area-inset-bottom)) max(10px, env(safe-area-inset-right));
    border-top: 1px solid var(--border-light);
    background: color-mix(in srgb, var(--bg-toolbar) 94%, transparent);
    backdrop-filter: blur(18px);
    box-shadow: 0 -10px 28px rgba(20, 19, 16, 0.08);
  }

  .mobile-tab-bar button {
    display: inline-flex;
    min-width: 0;
    min-height: 48px;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 3px;
    border: 0;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--text-secondary);
    font: 600 11px/1.2 var(--font-sans);
    cursor: pointer;
  }

  .mobile-tab-bar button:active {
    background: var(--bg-active);
    color: var(--text-primary);
  }

  .mobile-tab-bar span {
    overflow: hidden;
    max-width: 100%;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  @media (max-width: 639px) {
    .mobile-tab-bar {
      display: grid;
    }
  }
</style>
