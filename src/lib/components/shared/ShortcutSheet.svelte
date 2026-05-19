<script lang="ts">
  import { onDestroy } from 'svelte';
  import { createFocusTrap } from '$lib/utils/focusTrap';
  import { keymapStore } from '$lib/stores';
  import { formatChord, detectPlatform } from '$lib/domain/values/KeyChord';
  import type { CommandCategory } from '$lib/domain/values';
  import type { KeyBinding } from '$lib/ports/inbound/KeymapService';

  /**
   * ShortcutSheet - Keyboard shortcut cheat sheet overlay
   *
   * Modal overlay showing grouped keyboard shortcuts.
   * Opened via Cmd+/ and closed with Escape or backdrop click.
   *
   * Reads from KeymapService (via keymapStore) so the displayed list always
   * reflects what's actually registered — including user overrides.
   */

  interface Props {
    /** Whether the sheet is visible */
    isOpen: boolean;
    /** Callback to close the sheet */
    onClose: () => void;
  }

  let { isOpen, onClose }: Props = $props();
  let sheetRef: HTMLDivElement | null = $state(null);
  let focusTrapCleanup: (() => void) | null = null;

  // Display labels per command category. Falls back to title-case for
  // unknown categories (added later by plugins or waves).
  const CATEGORY_LABELS: Partial<Record<CommandCategory, string>> = {
    navigation: 'Navigation',
    view: 'View',
    note: 'Notes',
    tasks: 'Tasks',
    search: 'Search',
    settings: 'Settings',
    editor: 'Editor',
    ai: 'AI',
    system: 'System',
    tools: 'Tools',
  };

  // Static notes for shortcuts not modelled as commands (input rules,
  // ProseMirror-internal keymaps, slash menu trigger). These complement
  // the registry-derived list.
  interface StaticGroup {
    label: string;
    rows: { keys: string; description: string }[];
  }
  const STATIC_GROUPS: StaticGroup[] = [
    {
      label: 'Editor (in-document)',
      rows: [
        { keys: '/', description: 'Open slash menu' },
        { keys: 'Cmd+B / Cmd+I', description: 'Bold / Italic' },
        { keys: 'Cmd+U', description: 'Underline' },
        { keys: 'Cmd+Shift+S', description: 'Strikethrough' },
        { keys: 'Cmd+E', description: 'Inline code' },
        { keys: 'Cmd+K', description: 'Insert or edit link' },
        { keys: 'Cmd+Z / Cmd+Shift+Z', description: 'Undo / Redo' },
      ],
    },
    {
      label: 'Block Selection',
      rows: [
        { keys: 'Escape', description: 'Select block / clear selection' },
        { keys: 'Cmd+A', description: 'Select all (escalating: text → block → all)' },
        { keys: 'Shift+Up / Shift+Down', description: 'Extend block selection' },
        { keys: 'Cmd+Shift+Up / Cmd+Shift+Down', description: 'Move block up / down' },
        { keys: 'Cmd+D', description: 'Duplicate block' },
        { keys: 'Cmd+Shift+Delete', description: 'Delete selected block(s)' },
      ],
    },
    {
      label: 'AI (in-editor)',
      rows: [
        { keys: 'Cmd+J', description: 'AI inline edit on selection' },
        { keys: 'Cmd+Shift+R', description: 'AI rewrite current block' },
        { keys: 'Cmd+Shift+E', description: 'AI expand / elaborate' },
        { keys: 'Cmd+Enter', description: 'Accept AI rewrite' },
        { keys: 'Cmd+Escape', description: 'Cancel AI operation' },
      ],
    },
    {
      label: 'List Editing',
      rows: [
        { keys: 'Tab / Shift+Tab', description: 'Indent / outdent list item' },
        { keys: 'Enter', description: 'Split list item' },
        { keys: 'Backspace', description: 'Lift from list (at start)' },
      ],
    },
    {
      label: 'Markdown Input Rules',
      rows: [
        { keys: '# + Space', description: 'Heading 1' },
        { keys: '## + Space', description: 'Heading 2' },
        { keys: '### + Space', description: 'Heading 3' },
        { keys: '> + Space', description: 'Blockquote' },
        { keys: '- + Space', description: 'Bullet list' },
        { keys: '1. + Space', description: 'Numbered list' },
        { keys: '- [ ] + Space', description: 'Todo item' },
        { keys: '--- + Enter', description: 'Divider' },
        { keys: '```', description: 'Code block' },
        { keys: '**text**', description: 'Bold' },
        { keys: '*text*', description: 'Italic' },
      ],
    },
  ];

  let platform = $derived(detectPlatform());

  let registryGroups = $derived.by(() => {
    const groups = new Map<string, KeyBinding[]>();
    for (const binding of keymapStore.bindings) {
      if (!binding.chord.key) continue;
      const cmd = findCommandCategory(binding.commandId);
      const list = groups.get(cmd) ?? [];
      list.push(binding);
      groups.set(cmd, list);
    }
    const out: { label: string; rows: { keys: string; description: string; isOverride: boolean }[] }[] = [];
    for (const [category, bindings] of groups) {
      const label = CATEGORY_LABELS[category as CommandCategory]
        ?? (category.charAt(0).toUpperCase() + category.slice(1));
      out.push({
        label,
        rows: bindings.map((b) => ({
          keys: formatChord(b.chord, platform),
          description: prettyCommandLabel(b.commandId),
          isOverride: b.isOverride,
        })),
      });
    }
    return out.sort((a, b) => a.label.localeCompare(b.label));
  });

  // We don't have direct access to the command's category from a binding
  // without crossing a port boundary. Derive a sensible category from the
  // commandId prefix ('view.toggleSidebar' → 'view'). Falls back to 'system'.
  function findCommandCategory(commandId: string): string {
    const prefix = commandId.split('.')[0] ?? 'system';
    return prefix;
  }

  // Pretty label fallback when the registry-bound command name isn't
  // available here. This covers id-only display until Wave 1.6 lands a
  // joined keybinding/command view.
  function prettyCommandLabel(commandId: string): string {
    const tail = commandId.split('.').slice(1).join('.') || commandId;
    return tail
      .replace(/([A-Z])/g, ' $1')
      .replace(/[-_]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^./, (c) => c.toUpperCase());
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  }

  $effect(() => {
    if (isOpen && sheetRef) {
      focusTrapCleanup = createFocusTrap({
        container: sheetRef,
        onEscape: onClose,
      });
    } else if (focusTrapCleanup) {
      focusTrapCleanup();
      focusTrapCleanup = null;
    }
  });

  onDestroy(() => {
    focusTrapCleanup?.();
  });
</script>

{#if isOpen}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="shortcut-backdrop"
    onclick={onClose}
    onkeydown={handleKeyDown}
    role="presentation"
  >
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <!-- svelte-ignore a11y_interactive_supports_focus -->
    <div
      bind:this={sheetRef}
      class="shortcut-sheet"
      onclick={(e) => e.stopPropagation()}
      onkeydown={handleKeyDown}
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
    >
      <div class="shortcut-header">
        <h2 class="shortcut-title">Keyboard Shortcuts</h2>
        <button
          type="button"
          class="shortcut-close"
          onclick={onClose}
          aria-label="Close"
        >
          <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div class="shortcut-groups">
        {#each registryGroups as group (group.label)}
          <div class="shortcut-group">
            <h3 class="group-label">{group.label}</h3>
            {#each group.rows as row (row.description + row.keys)}
              <div class="shortcut-row">
                <span class="shortcut-desc">
                  {row.description}
                  {#if row.isOverride}
                    <span class="override-badge" title="Custom keybinding">·</span>
                  {/if}
                </span>
                <kbd class="shortcut-keys">{row.keys}</kbd>
              </div>
            {/each}
          </div>
        {/each}
        {#each STATIC_GROUPS as group (group.label)}
          <div class="shortcut-group">
            <h3 class="group-label">{group.label}</h3>
            {#each group.rows as row (row.description + row.keys)}
              <div class="shortcut-row">
                <span class="shortcut-desc">{row.description}</span>
                <kbd class="shortcut-keys">{row.keys}</kbd>
              </div>
            {/each}
          </div>
        {/each}
      </div>

      <div class="shortcut-footer">
        Press <kbd class="shortcut-keys-inline">Cmd+/</kbd> to toggle this sheet
      </div>
    </div>
  </div>
{/if}

<style>
  /* ─── Shortcut sheet ─── */
  .shortcut-backdrop {
    position: fixed;
    inset: 0;
    z-index: var(--z-modal);
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg-overlay);
    backdrop-filter: blur(8px) saturate(140%);
    -webkit-backdrop-filter: blur(8px) saturate(140%);
    animation: backdrop-in 200ms var(--ease-out-soft);
  }

  @keyframes backdrop-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  .shortcut-sheet {
    width: 520px;
    max-width: 92vw;
    max-height: 82vh;
    display: flex;
    flex-direction: column;
    border-radius: var(--radius-xl);
    border: 1px solid var(--border-light);
    background: var(--bg-card);
    box-shadow: var(--shadow-dialog);
    overflow: hidden;
    animation: sheet-in 240ms var(--ease-out-soft);
  }

  @keyframes sheet-in {
    from { opacity: 0; transform: scale(0.97) translateY(8px); }
    to   { opacity: 1; transform: scale(1) translateY(0); }
  }

  .shortcut-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 18px 22px;
    border-bottom: 1px solid var(--border-faint);
  }

  .shortcut-title {
    font-size: 16px;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0;
    letter-spacing: -0.012em;
  }

  .shortcut-close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: none;
    background: transparent;
    color: var(--text-tertiary);
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: background var(--transition-fast), color var(--transition-fast);
  }

  .shortcut-close:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .shortcut-groups {
    flex: 1;
    overflow-y: auto;
    padding: 14px 22px 18px;
  }

  .shortcut-group {
    margin-bottom: 22px;
  }

  .shortcut-group:last-child {
    margin-bottom: 0;
  }

  .group-label {
    font-size: var(--text-label);
    font-weight: var(--text-label-weight);
    text-transform: uppercase;
    letter-spacing: var(--text-label-tracking);
    color: var(--text-tertiary);
    margin: 0 0 8px;
  }

  .shortcut-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 0;
    border-bottom: 1px solid var(--border-faint);
  }

  .shortcut-row:last-child {
    border-bottom: none;
  }

  .shortcut-desc {
    font-size: var(--text-small);
    color: var(--text-secondary);
    letter-spacing: -0.003em;
  }

  .shortcut-keys {
    font-family: var(--font-sans);
    font-size: 11px;
    font-weight: 500;
    color: var(--text-secondary);
    background: var(--bg-subtle);
    border: 1px solid var(--border-light);
    padding: 1px 7px;
    border-radius: 4px;
    letter-spacing: 0.02em;
  }

  .shortcut-footer {
    padding: 12px 22px;
    border-top: 1px solid var(--border-faint);
    font-size: var(--text-caption);
    color: var(--text-tertiary);
    text-align: center;
    background: var(--bg-app);
  }

  .shortcut-keys-inline {
    font-family: var(--font-sans);
    font-size: 11px;
    font-weight: 500;
    color: var(--text-secondary);
    background: var(--bg-subtle);
    border: 1px solid var(--border-light);
    padding: 0 5px;
    border-radius: 4px;
  }

  .override-badge {
    color: var(--accent-primary);
    margin-left: 4px;
    font-weight: 700;
  }
</style>
