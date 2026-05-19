<script lang="ts">
  /**
   * Trash Page
   *
   * Provides the route linked from the sidebar. The current notes service
   * deletes notes permanently, so this page intentionally stays read-only
   * until a soft-delete adapter/service is introduced.
   */

  import { ArrowLeft, Trash2 } from '@lucide/svelte';
  import { EmptyState } from '$lib/components/shared';
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
        <p>Deleted notes will appear here when recoverable deletion is enabled.</p>
      </div>
    </div>
  </header>

  <section class="trash-content" aria-label="Trash contents">
    <div class="empty-panel">
      <EmptyState variant="trash" />
    </div>
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
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 48px 24px;
  }

  .empty-panel {
    width: min(100%, 520px);
  }

  @media (max-width: 640px) {
    .trash-header {
      padding: 14px 16px;
    }

    .header-row {
      gap: 10px;
    }

    .trash-content {
      align-items: flex-start;
      padding: 56px 16px;
    }
  }
</style>
