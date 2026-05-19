<script lang="ts">
  /**
   * BlockMenu - Context menu for editor blocks
   *
   * Provides block-level operations:
   * - Turn Into: Convert block to a different type
   * - Duplicate: Clone the block
   * - Copy Link: Copy a link to the block
   * - Delete: Remove the block
   *
   * Supports keyboard navigation in either action or conversion mode.
   */

  import { onMount } from 'svelte';
  import type { BlockType } from '$lib/domain/values/BlockType';
  import { Clock3 } from '@lucide/svelte';

  export type BlockMenuMode = 'actions' | 'convert';

  /** Action dispatched when a menu item is selected */
  export type BlockMenuAction =
    | { type: 'turnInto'; blockType: BlockType }
    | { type: 'inspectLineage' }
    | { type: 'duplicate' }
    | { type: 'copyLink' }
    | { type: 'delete' };

  interface Props {
    /** The block this menu operates on */
    blockId: string;
    /** Screen position for the menu */
    position: { top: number; left: number };
    /** Current block type (to highlight in conversion mode) */
    currentType?: BlockType;
    /** Which menu surface to show */
    mode?: BlockMenuMode;
    /** Callback when an action is selected */
    onAction: (action: BlockMenuAction) => void;
    /** Callback to close the menu */
    onClose: () => void;
  }

  let {
    blockId,
    position,
    currentType = 'paragraph',
    mode = 'actions',
    onAction,
    onClose,
  }: Props = $props();

  /** Menu items for the main menu. Icons are inline SVG paths to keep
   * monochrome consistency across platforms (avoiding emoji rendering drift). */
  interface MenuItem {
    id: string;
    label: string;
    icon?: string; // SVG path data, drawn inside a 14\u00D714 viewBox
    Icon?: typeof Clock3;
    shortcut?: string;
    destructive?: boolean;
  }

  // Icon path strings \u2014 drawn at 14\u00D714, stroke-based. Tight, calm shapes.
  const ICON_DUPLICATE = 'M5 3h6v6H5zM3 5h2v8h6v2H3z';
  const ICON_LINK = 'M5.5 8.5L8.5 5.5M4 7l-1.5 1.5a2.121 2.121 0 003 3L7 10M7 7l1.5-1.5a2.121 2.121 0 013 3L10 10';
  const ICON_TRASH = 'M3 4h8M5 4V3a1 1 0 011-1h2a1 1 0 011 1v1M4.5 4l.5 8a1 1 0 001 1h3a1 1 0 001-1l.5-8M6 7v3M8 7v3';

  const MENU_ITEMS: MenuItem[] = [
    { id: 'lineage', label: 'Line history', Icon: Clock3 },
    { id: 'duplicate', label: 'Duplicate', icon: ICON_DUPLICATE, shortcut: '\u2318D' },
    { id: 'copyLink', label: 'Copy Ref', icon: ICON_LINK },
    { id: 'delete', label: 'Delete', icon: ICON_TRASH, shortcut: '\u2318\u232B', destructive: true },
  ];

  /** Block types available in conversion mode. Type label uses the same
   * mono-typography as the gutter folio mark for visual continuity. */
  interface TurnIntoOption {
    type: BlockType;
    label: string;
    icon: string; // 1-3 char glyph (mono)
  }

  const TURN_INTO_OPTIONS: TurnIntoOption[] = [
    { type: 'paragraph', label: 'Text', icon: 'P' },
    { type: 'heading1', label: 'Heading 1', icon: 'H1' },
    { type: 'heading2', label: 'Heading 2', icon: 'H2' },
    { type: 'heading3', label: 'Heading 3', icon: 'H3' },
    { type: 'bulletList', label: 'Bulleted list', icon: 'UL' },
    { type: 'numberedList', label: 'Numbered list', icon: 'OL' },
    { type: 'todoItem', label: 'To-do', icon: 'TD' },
    { type: 'blockquote', label: 'Quote', icon: 'BQ' },
    { type: 'codeBlock', label: 'Code', icon: 'CD' },
    { type: 'callout', label: 'Callout', icon: 'CO' },
  ];

  /** Currently selected index in the active menu */
  let selectedIndex = $state(0);

  /** Selected index in the conversion menu */
  let submenuIndex = $state(getCurrentTypeIndex());

  /** Menu element ref */
  let menuElement: HTMLDivElement | undefined = $state(undefined);

  /** Active items based on which menu is shown */
  let activeItems = $derived(mode === 'convert' ? TURN_INTO_OPTIONS : MENU_ITEMS);

  function getCurrentTypeIndex(): number {
    const index = TURN_INTO_OPTIONS.findIndex((option) => option.type === currentType);
    return index === -1 ? 0 : index;
  }

  /** Focus menu on mount */
  onMount(() => {
    submenuIndex = getCurrentTypeIndex();
    menuElement?.focus();
  });

  /** Handle main menu item selection */
  function selectItem(item: MenuItem) {
    switch (item.id) {
      case 'lineage':
        onAction({ type: 'inspectLineage' });
        break;
      case 'duplicate':
        onAction({ type: 'duplicate' });
        break;
      case 'copyLink':
        onAction({ type: 'copyLink' });
        break;
      case 'delete':
        onAction({ type: 'delete' });
        break;
    }
  }

  /** Handle Turn Into option selection */
  function selectTurnInto(option: TurnIntoOption) {
    onAction({ type: 'turnInto', blockType: option.type });
  }

  /** Handle keyboard navigation */
  function handleKeyDown(event: KeyboardEvent) {
    const count = activeItems.length;
    if (count === 0) return;

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        event.stopPropagation();
        if (mode === 'convert') {
          submenuIndex = Math.min(submenuIndex + 1, count - 1);
        } else {
          selectedIndex = Math.min(selectedIndex + 1, count - 1);
        }
        scrollSelectedIntoView();
        break;

      case 'ArrowUp':
        event.preventDefault();
        event.stopPropagation();
        if (mode === 'convert') {
          submenuIndex = Math.max(submenuIndex - 1, 0);
        } else {
          selectedIndex = Math.max(selectedIndex - 1, 0);
        }
        scrollSelectedIntoView();
        break;

      case 'Enter':
        event.preventDefault();
        event.stopPropagation();
        if (mode === 'convert') {
          const option = TURN_INTO_OPTIONS[submenuIndex];
          if (option) selectTurnInto(option);
        } else {
          const item = MENU_ITEMS[selectedIndex];
          if (item) selectItem(item);
        }
        break;

      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        onClose();
        break;
    }
  }

  /** Scroll selected item into view */
  function scrollSelectedIntoView() {
    requestAnimationFrame(() => {
      const selected = menuElement?.querySelector('.block-menu-item.is-selected');
      selected?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  }

  /** Handle click outside */
  function handleBackdropClick(event: MouseEvent) {
    event.stopPropagation();
    onClose();
  }
</script>

<!-- Backdrop for click-outside detection -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="fixed inset-0 z-40"
  role="presentation"
  onclick={handleBackdropClick}
  onkeydown={handleKeyDown}
></div>

<!-- Menu popup -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
  bind:this={menuElement}
  class="block-menu"
  style="top: {position.top}px; left: {position.left}px;"
  role="menu"
  aria-label={mode === 'convert' ? 'Change block type' : 'Block options'}
  tabindex="0"
  onkeydown={handleKeyDown}
>
  {#if mode === 'convert'}
    <!-- Direct conversion menu -->
    <div class="block-menu-header">
      <span class="block-menu-title">
        Turn into
      </span>
    </div>

    <div class="block-menu-list">
      {#each TURN_INTO_OPTIONS as option, idx}
        <button
          type="button"
          class="block-menu-item"
          class:is-selected={idx === submenuIndex}
          class:is-current={option.type === currentType}
          role="menuitem"
          onclick={() => selectTurnInto(option)}
          onmouseenter={() => { submenuIndex = idx; }}
        >
          <span class="block-menu-icon block-menu-icon-mono">{option.icon}</span>
          <span class="block-menu-label">{option.label}</span>
          {#if option.type === currentType}
            <span class="block-menu-check" aria-label="Current type">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                <path d="M2.5 6.5l2.5 2.5 4.5-5.5"/>
              </svg>
            </span>
          {/if}
        </button>
      {/each}
    </div>
  {:else}
    <!-- Main menu -->
    <div class="block-menu-list">
      {#each MENU_ITEMS as item, idx}
        <button
          type="button"
          class="block-menu-item"
          class:is-selected={idx === selectedIndex}
          class:is-destructive={item.destructive}
          role="menuitem"
          onclick={() => selectItem(item)}
          onmouseenter={() => { selectedIndex = idx; }}
        >
          <span class="block-menu-icon" class:is-destructive={item.destructive} aria-hidden="true">
            {#if item.Icon}
              {@const Icon = item.Icon}
              <Icon size={14} strokeWidth={1.6} aria-hidden="true" />
            {:else if item.icon}
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
                <path d={item.icon}/>
              </svg>
            {/if}
          </span>
          <span class="block-menu-label">{item.label}</span>
          {#if item.shortcut}
            <span class="block-menu-shortcut">{item.shortcut}</span>
          {/if}
        </button>
      {/each}
    </div>
  {/if}

  <!-- Footer hint -->
  <div class="block-menu-footer">
    <span class="block-menu-footer-key">{'\u2191\u2193'}</span> navigate
    <span class="block-menu-footer-sep">&middot;</span>
    <span class="block-menu-footer-key">Enter</span> select
    <span class="block-menu-footer-sep">&middot;</span>
    <span class="block-menu-footer-key">Esc</span> close
  </div>
</div>

<style>
  /* Premium popover — borderless face, whisper-quiet shadow, fast entrance.
   * The user perceives this as paper resting on the page, not a card popping. */
  .block-menu {
    position: fixed;
    z-index: var(--z-popover);
    width: 208px;
    max-height: 360px;
    display: flex;
    flex-direction: column;
    border-radius: 10px;
    border: 1px solid rgba(20, 19, 16, 0.06);
    background: rgba(255, 255, 255, 0.985);
    backdrop-filter: saturate(140%) blur(12px);
    -webkit-backdrop-filter: saturate(140%) blur(12px);
    box-shadow:
      0 1px 1px rgba(20, 19, 16, 0.04),
      0 8px 28px -6px rgba(20, 19, 16, 0.18),
      0 16px 48px -12px rgba(20, 19, 16, 0.10);
    overflow: hidden;
    animation: block-menu-in 120ms cubic-bezier(0.2, 0, 0, 1);
    transform-origin: top left;
    outline: none;
  }

  .block-menu:focus-visible {
    box-shadow:
      0 0 0 2px var(--accent-primary),
      0 8px 28px -6px rgba(20, 19, 16, 0.18);
  }

  @keyframes block-menu-in {
    from { opacity: 0; transform: translateY(-2px) scale(0.98); }
    to   { opacity: 1; transform: translateY(0)    scale(1); }
  }

  /* Menu header */
  .block-menu-header {
    border-bottom: 1px solid rgba(20, 19, 16, 0.05);
    padding: 4px;
  }

  .block-menu-title {
    display: flex;
    align-items: center;
    min-height: 24px;
    padding: 5px 8px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text-tertiary);
  }

  /* Scrollable list */
  .block-menu-list {
    flex: 1;
    overflow-y: auto;
    padding: 4px;
  }

  /* Menu item */
  .block-menu-item {
    display: flex;
    width: 100%;
    align-items: center;
    gap: 10px;
    padding: 6px 8px;
    text-align: left;
    color: var(--text-primary);
    background: transparent;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    transition:
      background-color 100ms ease,
      color 100ms ease;
  }

  .block-menu-item:hover { background-color: rgba(20, 19, 16, 0.04); }

  .block-menu-item.is-selected {
    background-color: rgba(35, 131, 226, 0.09);
  }

  .block-menu-item.is-selected .block-menu-label {
    color: var(--accent-primary);
  }

  .block-menu-item.is-selected .block-menu-icon {
    color: var(--accent-primary);
    background: rgba(35, 131, 226, 0.10);
  }

  /* Destructive item — red ink only when selected to avoid alarmism at rest */
  .block-menu-item.is-destructive .block-menu-label { color: var(--text-primary); }
  .block-menu-item.is-destructive.is-selected,
  .block-menu-item.is-destructive:hover {
    background-color: var(--color-error-bg);
  }
  .block-menu-item.is-destructive:hover .block-menu-label,
  .block-menu-item.is-destructive.is-selected .block-menu-label {
    color: var(--color-error);
  }
  .block-menu-item.is-destructive:hover .block-menu-icon,
  .block-menu-item.is-destructive.is-selected .block-menu-icon {
    color: var(--color-error);
    background: rgba(217, 48, 37, 0.10);
  }

  /* Icon container — flat by default, fills on item-state */
  .block-menu-icon {
    display: flex;
    height: 22px;
    width: 22px;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    border-radius: 5px;
    color: var(--text-muted);
    background: transparent;
    transition: all 100ms ease;
  }

  /* Mono-glyph icon variant (used in Turn Into list, mirrors the gutter folio mark) */
  .block-menu-icon-mono {
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text-placeholder);
    background: rgba(20, 19, 16, 0.04);
  }

  .block-menu-item.is-selected .block-menu-icon-mono {
    color: var(--accent-primary);
    background: rgba(35, 131, 226, 0.10);
  }

  /* Label */
  .block-menu-label {
    flex: 1;
    font-size: 13px;
    font-weight: 500;
    color: var(--text-primary);
    transition: color 100ms ease;
  }

  /* Keyboard shortcut hint at the right of the row */
  .block-menu-shortcut {
    flex-shrink: 0;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-placeholder);
    letter-spacing: 0.02em;
  }

  /* Checkmark for current type */
  .block-menu-check {
    display: flex;
    flex-shrink: 0;
    color: var(--accent-primary);
  }

  /* Current type marker — subtle bold (no decorative dot) */
  .block-menu-item.is-current .block-menu-label {
    font-weight: 600;
  }

  /* Footer hint strip */
  .block-menu-footer {
    border-top: 1px solid rgba(20, 19, 16, 0.05);
    padding: 6px 10px;
    font-size: 11px;
    color: var(--text-tertiary);
    background-color: rgba(247, 245, 241, 0.4);
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 4px;
  }

  .block-menu-footer-key {
    font-family: var(--font-mono);
    font-weight: 500;
    color: var(--text-secondary);
    font-variant-numeric: tabular-nums;
    background: rgba(20, 19, 16, 0.05);
    padding: 1px 5px;
    border-radius: 3px;
    font-size: 10px;
  }

  .block-menu-footer-sep {
    color: var(--text-placeholder);
    opacity: 0.6;
  }
</style>
