<script lang="ts">
  /**
   * EmptyState Component
   *
   * Displays helpful empty states throughout the app with variant-specific
   * icons, titles, subtitles, and optional action buttons.
   */

  type Variant = 'folder' | 'search' | 'trash' | 'welcome';

  interface Props {
    /** The type of empty state to display */
    variant: Variant;
    /** Search query for the search variant */
    query?: string;
    /** Callback for primary action button */
    onAction?: () => void;
  }

  let { variant, query = '', onAction }: Props = $props();

  /** Configuration for each variant */
  const variants: Record<
    Variant,
    {
      title: string;
      subtitle: string | ((q: string) => string);
      hasAction: boolean;
      actionLabel?: string;
    }
  > = {
    folder: {
      title: 'No notes here yet',
      subtitle: 'Create a note to get started',
      hasAction: true,
      actionLabel: '+ New Note',
    },
    search: {
      title: 'No results found',
      subtitle: (q: string) => `No notes matching '${q}'`,
      hasAction: false,
    },
    trash: {
      title: 'Trash is empty',
      subtitle: 'Deleted notes will appear here',
      hasAction: false,
    },
    welcome: {
      title: 'Welcome to Void',
      subtitle: 'Your AI-powered note-taking companion',
      hasAction: true,
      actionLabel: 'Create your first note',
    },
  };

  const config = $derived(variants[variant]);
  const subtitleText = $derived(
    typeof config.subtitle === 'function' ? config.subtitle(query) : config.subtitle
  );
</script>

<div class="empty-state">
  <div class="empty-state-icon">
    {#if variant === 'folder'}
      <!-- Folder outline icon -->
      <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        stroke-width="1.5"
        stroke="currentColor"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z"
        />
      </svg>
    {:else if variant === 'search'}
      <!-- Search outline icon -->
      <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        stroke-width="1.5"
        stroke="currentColor"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
        />
      </svg>
    {:else if variant === 'trash'}
      <!-- Trash outline icon -->
      <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        stroke-width="1.5"
        stroke="currentColor"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
        />
      </svg>
    {:else if variant === 'welcome'}
      <!-- Sparkle/magic wand icon -->
      <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        stroke-width="1.5"
        stroke="currentColor"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z"
        />
      </svg>
    {/if}
  </div>

  <h3 class="empty-state-title">{config.title}</h3>
  <p class="empty-state-subtitle">{subtitleText}</p>

  {#if config.hasAction && onAction}
    <button type="button" class="empty-state-action" onclick={onAction}>
      {config.actionLabel}
    </button>
  {/if}
</div>

<style>
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    min-height: 200px;
    padding: 2rem;
    text-align: center;
  }

  .empty-state-icon {
    width: 48px;
    height: 48px;
    color: var(--text-muted);
    margin-bottom: 1rem;
  }

  .empty-state-icon svg {
    width: 100%;
    height: 100%;
  }

  .empty-state-title {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .empty-state-subtitle {
    margin: 0.5rem 0 0;
    font-size: 0.875rem;
    color: var(--text-muted);
  }

  .empty-state-action {
    margin-top: 1.25rem;
    padding: 0.5rem 1rem;
    background: var(--accent-primary);
    color: var(--text-inverse);
    border: none;
    border-radius: var(--radius-md);
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
    transition: background var(--transition-fast);
  }

  .empty-state-action:hover {
    background: var(--accent-hover);
  }

  .empty-state-action:focus-visible {
    outline: 2px solid var(--accent-primary);
    outline-offset: 2px;
  }
</style>
