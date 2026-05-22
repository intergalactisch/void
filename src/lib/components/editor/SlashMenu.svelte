<script lang="ts">
  /**
   * SlashMenu Component
   *
   * Displays a positioned popup with filtered commands when the user
   * types "/" in the editor. Supports keyboard navigation and click
   * selection.
   *
   * Features:
   * - Categorized command sections (Basic, Media, Advanced, AI)
   * - Search/filter input that shows current query
   * - Keyboard hints for markdown shortcuts
   * - Smooth hover transitions
   * - Full keyboard navigation (Arrow Up/Down, Enter, Escape)
   */

  import { onMount, tick, type Component } from 'svelte';
  import type { SlashMenuState } from '$lib/adapters/prosemirror/plugins/slashMenu';
  import type { RegisteredCommand, CommandContext } from '$lib/ports/outbound';
  import {
    Type,
    Heading1,
    Heading2,
    Heading3,
    List,
    ListOrdered,
    ListChecks,
    Quote,
    Code,
    Minus,
    Info,
    ChevronRight,
    Table,
    Image,
    Sparkles,
    Maximize2,
    Minimize2,
    Hash,
  } from '@lucide/svelte';

  interface Props {
    /** Current slash menu state from the plugin */
    menuState: SlashMenuState;
    /** Callback to execute a command */
    onSelect: (command: RegisteredCommand) => void;
    /** Callback to close the menu */
    onClose: () => void;
    aiUnavailable?: boolean;
    aiUnavailableMessage?: string;
    onAIUnavailable?: () => void;
  }

  let {
    menuState,
    onSelect,
    onClose,
    aiUnavailable = false,
    aiUnavailableMessage = 'Install a local AI to use this feature.',
    onAIUnavailable,
  }: Props = $props();

  // Local selected index for keyboard navigation (synced from menuState but can be overridden)
  let selectedIndex = $state(0);

  // Menu container ref for focus management
  let menuElement: HTMLDivElement | undefined = $state(undefined);

  // Sync selected index when menuState changes
  $effect(() => {
    selectedIndex = menuState.selectedIndex;
  });

  // Scroll selected item into view
  $effect(() => {
    if (menuState.isOpen && menuElement) {
      const selectedItem = menuElement.querySelector('.slash-menu-item.is-selected');
      selectedItem?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  });

  // Compute aria-activedescendant value safely
  let activeDescendant = $derived.by(() => {
    const cmd = menuState.filteredCommands[selectedIndex];
    return cmd ? `slash-menu-item-${cmd.id}` : '';
  });

  /** `/ai` is a special prompt prefix, not a selectable command. */
  let isAIQueryHint = $derived.by(() =>
    !menuState.isAIPromptMode && menuState.query.trim().toLowerCase() === 'ai'
  );

  /** Category display order */
  const CATEGORY_ORDER: Array<string> = [
    'basic',
    'media',
    'advanced',
    'ai',
  ];

  /** Block type commands that can be used for "Convert To" */
  const CONVERT_COMMAND_IDS = new Set([
    'paragraph', 'heading1', 'heading2', 'heading3',
    'bulletList', 'numberedList', 'todoItem',
    'blockquote', 'codeBlock', 'callout',
  ]);

  /** Map ProseMirror node type names to command IDs for current-type matching */
  const BLOCK_TYPE_TO_COMMAND: Record<string, string> = {
    paragraph: 'paragraph',
    heading1: 'heading1',
    heading2: 'heading2',
    heading3: 'heading3',
    bulletList: 'bulletList',
    numberedList: 'numberedList',
    listItem: 'bulletList', // listItem in a bulletList context
    todoItem: 'todoItem',
    blockquote: 'blockquote',
    codeBlock: 'codeBlock',
    callout: 'callout',
  };

  /** Check if a command matches the current block type */
  function isCurrentBlockType(command: RegisteredCommand): boolean {
    if (menuState.source !== 'gutter' || !menuState.blockType) return false;
    const commandId = BLOCK_TYPE_TO_COMMAND[menuState.blockType];
    return command.id === commandId;
  }

  /** Group commands by category for display, maintaining order */
  let groupedCommands = $derived.by(() => {
    const isGutter = menuState.source === 'gutter';
    const groups = new Map<string, RegisteredCommand[]>();

    // When opened from gutter, add "Convert To" section first
    const order = isGutter ? ['convert', ...CATEGORY_ORDER] : CATEGORY_ORDER;
    for (const category of order) {
      groups.set(category, []);
    }

    // Populate groups
    for (const cmd of menuState.filteredCommands) {
      if (isGutter && CONVERT_COMMAND_IDS.has(cmd.id)) {
        // Put block-type commands in the "Convert To" section
        const existing = groups.get('convert') ?? [];
        existing.push(cmd);
        groups.set('convert', existing);
      } else {
        const existing = groups.get(cmd.category) ?? [];
        existing.push(cmd);
        groups.set(cmd.category, existing);
      }
    }

    // Filter out empty categories
    return new Map(
      [...groups.entries()].filter(([_, commands]) => commands.length > 0)
    );
  });

  /** Get display label for a category */
  function getCategoryLabel(category: string): string {
    switch (category) {
      case 'convert':
        return 'Convert To';
      case 'basic':
        return 'Basic';
      case 'media':
        return 'Media';
      case 'advanced':
        return 'Advanced';
      case 'ai':
        return 'AI';
      default:
        return category;
    }
  }

  /** Get the flat index for a command in grouped display */
  function getFlatIndex(command: RegisteredCommand): number {
    return menuState.filteredCommands.indexOf(command);
  }

  /** Check if command is currently selected */
  function isSelected(command: RegisteredCommand): boolean {
    return getFlatIndex(command) === selectedIndex;
  }

  /** Handle command click */
  function handleClick(command: RegisteredCommand): void {
    onSelect(command);
  }

  /** Handle click outside to close */
  function handleBackdropClick(event: MouseEvent): void {
    event.stopPropagation();
    onClose();
  }

  /** Handle keyboard navigation */
  function handleKeyDown(event: KeyboardEvent): void {
    const commands = menuState.filteredCommands;
    if (commands.length === 0) return;

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        event.stopPropagation();
        selectedIndex = (selectedIndex + 1) % commands.length;
        break;

      case 'ArrowUp':
        event.preventDefault();
        event.stopPropagation();
        selectedIndex = (selectedIndex - 1 + commands.length) % commands.length;
        break;

      case 'Enter':
      case 'Tab':
        event.preventDefault();
        event.stopPropagation();
        if (menuState.isAIPromptMode && aiUnavailable) {
          onAIUnavailable?.();
        } else if (!menuState.isAIPromptMode) {
          const command = commands[selectedIndex];
          if (command) onSelect(command);
        }
        break;

      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        onClose();
        break;
    }
  }

  /**
   * Map command icon names to Lucide components. Keeps stroke weight,
   * corner rounding, and metric size consistent with the rest of the
   * app's iconography (sidebar, header, block menu).
   */
  const ICON_MAP: Record<string, Component> = {
    text: Type,
    heading1: Heading1,
    heading2: Heading2,
    heading3: Heading3,
    list: List,
    listOrdered: ListOrdered,
    checkSquare: ListChecks,
    quote: Quote,
    code: Code,
    minus: Minus,
    alertCircle: Info,
    chevronRight: ChevronRight,
    table: Table,
    image: Image,
    sparkles: Sparkles,
    maximize: Maximize2,
    minimize: Minimize2,
    toggle: ChevronRight,
    hash: Hash,
  };

  function getIconComponent(iconName: string | undefined): Component {
    return ICON_MAP[iconName ?? ''] ?? Type;
  }

  /** Format shortcut for display (add trailing space to indicate markdown) */
  function formatShortcut(shortcut: string | undefined): string | null {
    if (!shortcut) return null;
    // Add space to indicate these are typed before content
    return `${shortcut} `;
  }
</script>

{#if menuState.isOpen && menuState.coords}
  <!-- Backdrop for click-outside detection -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="slash-menu-backdrop"
    role="presentation"
    onclick={handleBackdropClick}
    onkeydown={handleKeyDown}
  ></div>

  <!-- Menu popup -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div
    bind:this={menuElement}
    class="slash-menu"
    class:slash-menu-above={menuState.openAbove}
    style="{menuState.openAbove ? 'bottom' : 'top'}: {menuState.openAbove ? (window.innerHeight - menuState.coords.top) : menuState.coords.top}px; left: {menuState.coords.left}px;"
    role="listbox"
    aria-label="Slash commands"
    aria-activedescendant={activeDescendant}
    tabindex="0"
    onkeydown={handleKeyDown}
  >
    <!-- Search/filter display -->
    <div class="slash-menu-search">
      <span class="slash-menu-search-icon">/</span>
      <span class="slash-menu-search-query">
        {#if menuState.query}
          {menuState.query}
        {:else}
          <span class="slash-menu-search-placeholder">Type to filter...</span>
        {/if}
      </span>
    </div>

    <!-- Commands list -->
    <div class="slash-menu-list">
      {#if menuState.isAIPromptMode}
        <div class="slash-menu-ai-mode">
          <span class="slash-menu-ai-badge">/ai</span>
          <span class="slash-menu-ai-hint">{aiUnavailable ? aiUnavailableMessage : 'Press Enter to generate'}</span>
        </div>
      {:else if isAIQueryHint}
        <div class="slash-menu-ai-mode">
          <span class="slash-menu-ai-badge">/ai</span>
          <span class="slash-menu-ai-hint">Keep typing a prompt after /ai</span>
        </div>
      {:else if menuState.filteredCommands.length === 0}
        <div class="slash-menu-empty">
          No results for "{menuState.query}"
        </div>
      {:else}
        {#each [...groupedCommands.entries()] as [category, commands]}
          <div class="slash-menu-group">
            <!-- Category header -->
            <div class="slash-menu-category">
              {getCategoryLabel(category)}
            </div>

            <!-- Commands in category -->
            {#each commands as command, idx}
              {@const IconComponent = getIconComponent(command.icon)}
              <button
                type="button"
                class="slash-menu-item"
                class:is-selected={isSelected(command)}
                id="slash-menu-item-{command.id}"
                role="option"
                aria-selected={isSelected(command)}
                onclick={() => handleClick(command)}
                onmouseenter={() => { selectedIndex = getFlatIndex(command); }}
              >
                <!-- Icon -->
                <span class="slash-menu-icon">
                  <IconComponent size={17} strokeWidth={1.6} aria-hidden="true" />
                </span>

                <!-- Label and description -->
                <div class="slash-menu-content">
                  <span class="slash-menu-label">{command.label}</span>
                  {#if command.description}
                    <span class="slash-menu-description">
                      {command.description}
                    </span>
                  {/if}
                </div>

                <!-- Current type checkmark (for gutter Convert To) -->
                {#if isCurrentBlockType(command)}
                  <span class="slash-menu-check" aria-label="Current type">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                  </span>
                <!-- Keyboard hint (right-aligned) -->
                {:else if command.shortcut}
                  <kbd class="slash-menu-shortcut">
                    {formatShortcut(command.shortcut)}
                  </kbd>
                {/if}
              </button>
            {/each}
          </div>
        {/each}
      {/if}
    </div>

    <!-- Footer hint -->
    <div class="slash-menu-footer">
      {#if menuState.isAIPromptMode}
        {#if !aiUnavailable}
          <span class="slash-menu-footer-key">Enter</span> generate
          <span class="slash-menu-footer-sep">\u00B7</span>
        {/if}
        <span class="slash-menu-footer-key">Esc</span> close
      {:else if isAIQueryHint}
        <span class="slash-menu-footer-key">Space</span> add prompt
        <span class="slash-menu-footer-sep">\u00B7</span>
        <span class="slash-menu-footer-key">Esc</span> close
      {:else}
        <span class="slash-menu-footer-key">{'\u2191\u2193'}</span> navigate
        <span class="slash-menu-footer-sep">\u00B7</span>
        <span class="slash-menu-footer-key">Enter</span> select
        <span class="slash-menu-footer-sep">\u00B7</span>
        <span class="slash-menu-footer-key">Esc</span> close
      {/if}
    </div>
  </div>
{/if}

<style>
  .slash-menu-backdrop {
    position: fixed;
    inset: 0;
    z-index: calc(var(--z-popover) - 1);
  }

  .slash-menu {
    position: fixed;
    z-index: var(--z-popover);
    width: 340px;
    max-height: 420px;
    display: flex;
    flex-direction: column;
    border-radius: var(--radius-lg);
    border: 1px solid var(--border-light);
    background-color: rgba(255, 255, 255, 0.92);
    backdrop-filter: blur(20px) saturate(180%);
    -webkit-backdrop-filter: blur(20px) saturate(180%);
    box-shadow: var(--shadow-popover);
    overflow: hidden;
    animation: menu-scale-in 180ms var(--ease-out-soft);
    transform-origin: top left;
    outline: none;
  }

  .slash-menu-above {
    transform-origin: bottom left;
  }

  .slash-menu:focus-visible {
    box-shadow: var(--shadow-lg), 0 0 0 2px var(--accent-primary);
  }

  @keyframes menu-scale-in {
    from {
      opacity: 0;
      transform: scale(0.95);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }

  /* Search input display */
  .slash-menu-search {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 14px;
    border-bottom: 1px solid var(--border-faint);
    background-color: rgba(247, 245, 241, 0.7);
  }

  .slash-menu-search-icon {
    font-size: 13px;
    font-weight: 600;
    color: var(--accent-primary);
    font-family: var(--font-mono);
  }

  .slash-menu-search-query {
    font-size: 13.5px;
    color: var(--text-primary);
    letter-spacing: -0.005em;
  }

  .slash-menu-search-placeholder {
    color: var(--text-tertiary);
  }

  /* Scrollable list */
  .slash-menu-list {
    flex: 1;
    overflow-y: auto;
    padding: 4px 0;
  }

  .slash-menu-empty {
    padding: 28px 14px;
    text-align: center;
    font-size: 13px;
    color: var(--text-tertiary);
  }

  .slash-menu-group {
    padding: 2px 0;
  }

  .slash-menu-group:not(:last-child) {
    border-bottom: 1px solid var(--border-faint);
    margin-bottom: 4px;
    padding-bottom: 6px;
  }

  .slash-menu-category {
    padding: 8px 14px 4px;
    font-size: var(--text-label);
    font-weight: var(--text-label-weight);
    text-transform: uppercase;
    letter-spacing: var(--text-label-tracking);
    color: var(--text-tertiary);
  }

  .slash-menu-item {
    display: flex;
    width: 100%;
    align-items: center;
    gap: 10px;
    padding: 7px 12px 7px 10px;
    margin: 0 4px;
    border-radius: var(--radius-sm);
    text-align: left;
    color: var(--text-primary);
    background: transparent;
    border: none;
    cursor: pointer;
    font-family: inherit;
    transition: background var(--transition-fast), color var(--transition-fast);
  }

  .slash-menu-item:hover {
    background-color: var(--bg-hover);
  }

  .slash-menu-item:focus-visible {
    outline: 2px solid var(--accent-primary);
    outline-offset: -2px;
  }

  .slash-menu-item.is-selected {
    background-color: var(--accent-light);
  }

  .slash-menu-item.is-selected .slash-menu-label {
    color: var(--accent-primary);
  }

  .slash-menu-icon {
    display: inline-flex;
    height: 28px;
    width: 28px;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-md);
    background-color: var(--bg-subtle);
    color: var(--text-secondary);
    box-shadow: inset 0 0 0 1px rgba(28, 27, 24, 0.04);
    transition: background-color var(--transition-fast), color var(--transition-fast),
                box-shadow var(--transition-fast);
  }

  .slash-menu-item:hover .slash-menu-icon {
    background-color: var(--bg-card);
    color: var(--text-primary);
    box-shadow: inset 0 0 0 1px rgba(28, 27, 24, 0.07);
  }

  .slash-menu-item.is-selected .slash-menu-icon {
    background-color: #ffffff;
    color: var(--accent-primary);
    box-shadow: inset 0 0 0 1px rgba(44, 92, 213, 0.18),
                0 1px 2px rgba(44, 92, 213, 0.08);
  }

  .slash-menu-content {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .slash-menu-label {
    font-size: var(--text-small);
    font-weight: 500;
    color: var(--text-primary);
    letter-spacing: -0.005em;
    transition: color var(--transition-fast);
  }

  .slash-menu-description {
    font-size: 11.5px;
    color: var(--text-tertiary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .slash-menu-shortcut {
    flex-shrink: 0;
    border-radius: 4px;
    background-color: var(--bg-subtle);
    border: 1px solid var(--border-light);
    padding: 0 5px;
    font-size: 10.5px;
    font-family: var(--font-sans);
    font-weight: 500;
    line-height: 16px;
    color: var(--text-muted);
    letter-spacing: 0.02em;
    transition: all var(--transition-fast);
  }

  .slash-menu-item.is-selected .slash-menu-shortcut {
    background-color: rgba(255, 255, 255, 0.7);
    color: var(--accent-primary);
    border-color: rgba(44, 92, 213, 0.20);
  }

  .slash-menu-check {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    color: var(--accent-primary);
  }

  /* AI prompt mode */
  .slash-menu-ai-mode {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 14px;
  }

  .slash-menu-ai-badge {
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    background: var(--ai-accent-light);
    color: var(--ai-accent);
    border-radius: 10px;
    font-size: 12px;
    font-weight: 600;
    font-family: var(--font-mono);
    letter-spacing: 0.02em;
  }

  .slash-menu-ai-hint {
    font-size: 13px;
    color: var(--text-tertiary);
  }

  .slash-menu-footer {
    border-top: 1px solid var(--border-faint);
    padding: 8px 14px;
    font-size: 11px;
    color: var(--text-tertiary);
    background-color: rgba(247, 245, 241, 0.6);
  }

  .slash-menu-footer-key {
    font-weight: 500;
    color: var(--text-secondary);
    font-variant-numeric: tabular-nums;
  }

  .slash-menu-footer-sep {
    margin: 0 6px;
    opacity: 0.5;
  }
</style>
