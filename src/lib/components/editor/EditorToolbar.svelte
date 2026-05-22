<script lang="ts">
  /**
   * EditorToolbar - Floating selection toolbar.
   *
   * Appears above (or below, when space is tight) the active text selection.
   * Buttons reflect the marks and block type currently applied at the caret,
   * so the user always sees what state their selection is in.
   */

  import { onMount, onDestroy } from 'svelte';
  import { FileText, Highlighter, Link2 } from '@lucide/svelte';

  interface Props {
    canUndo?: boolean;
    canRedo?: boolean;
    isSaving?: boolean;
    isDirty?: boolean;
    /** Reference to the editor element for selection-scope checks */
    editorElement?: HTMLElement | null;
    /** Callback when a toolbar action fires */
    onAction: (action: string, value?: string) => void;
    /** Callback when AI rewrite is invoked — called with selection text + range
     *  before focus leaves the editor (so we can preserve the range). */
    onAIPrompt?: (selectionText: string, selectionRange: Range) => void;
    aiUnavailable?: boolean;
    aiUnavailableMessage?: string;
    onAIUnavailable?: () => void;
  }

  let {
    canUndo = false,
    canRedo = false,
    isSaving = false,
    isDirty = false,
    editorElement = null,
    onAction,
    onAIPrompt,
    aiUnavailable = false,
    aiUnavailableMessage = 'Install a local AI to use this feature.',
    onAIUnavailable,
  }: Props = $props();

  /* ── Visibility & position ──────────────────────────────────────────── */
  let isVisible = $state(false);
  let position = $state({ top: 0, left: 0, openAbove: true });
  let toolbarElement: HTMLDivElement | undefined = $state(undefined);

  /* ── Active state (reflects marks + block at the caret) ─────────────── */
  let activeMarks = $state<Set<string>>(new Set());
  let activeBlockType = $state<string | null>(null);

  /* ── Highlight picker ───────────────────────────────────────────────── */
  let isHighlightPickerOpen = $state(false);
  let selectedHighlightColor = $state<string | null>(null);

  /* ── Link popup ─────────────────────────────────────────────────────── */
  let isLinkPopupOpen = $state(false);
  let linkUrl = $state('');
  let isEditingLink = $state(false);
  let linkInputElement: HTMLInputElement | undefined = $state(undefined);

  /** Highlight palette — single horizontal strip + a leading "no highlight" */
  const highlightColors = [
    { name: 'yellow', color: 'var(--bg-highlight-yellow)', label: 'Yellow' },
    { name: 'orange', color: 'var(--bg-highlight-orange)', label: 'Orange' },
    { name: 'red', color: 'var(--bg-highlight-red)', label: 'Red' },
    { name: 'pink', color: 'var(--bg-highlight-pink)', label: 'Pink' },
    { name: 'purple', color: 'var(--bg-highlight-purple)', label: 'Purple' },
    { name: 'blue', color: 'var(--bg-highlight-blue)', label: 'Blue' },
    { name: 'green', color: 'var(--bg-highlight-green)', label: 'Green' },
    { name: 'brown', color: 'var(--bg-highlight-brown)', label: 'Brown' },
    { name: 'gray', color: 'var(--bg-highlight-gray)', label: 'Gray' },
  ];

  /**
   * Walk up from the selection's anchor to detect which inline marks and
   * which block type currently wrap the caret. We use DOM traversal (not
   * ProseMirror state) to keep this component free of editor coupling —
   * it works against any contenteditable surface that uses our schema's
   * standard tags + data-block-type attributes.
   */
  function detectActiveState(): { marks: Set<string>; blockType: string | null } {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !editorElement) {
      return { marks: new Set(), blockType: null };
    }
    const marks = new Set<string>();
    let blockType: string | null = null;
    let node: Node | null = sel.anchorNode;
    while (node && node !== editorElement) {
      if (node instanceof HTMLElement) {
        const tag = node.tagName.toLowerCase();
        if (tag === 'strong' || tag === 'b') marks.add('bold');
        if (tag === 'em' || tag === 'i') marks.add('italic');
        if (tag === 's' || tag === 'strike' || tag === 'del') marks.add('strikethrough');
        if (tag === 'u') marks.add('underline');
        if (tag === 'code' && !node.closest('pre')) marks.add('code');
        if (tag === 'a') {
          if (node.dataset?.pageLink !== undefined) marks.add('pageLink');
          else marks.add('link');
        }
        if (!blockType && node.dataset?.blockType) {
          blockType = node.dataset.blockType;
        }
      }
      node = node.parentNode;
    }
    return { marks, blockType };
  }

  /* ── Position / visibility ──────────────────────────────────────────── */
  function updatePosition() {
    // Keep toolbar visible while user is typing a URL into the link popup
    if (isLinkPopupOpen && toolbarElement && toolbarElement.contains(document.activeElement)) {
      return;
    }

    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) {
      isVisible = false;
      isHighlightPickerOpen = false;
      isLinkPopupOpen = false;
      return;
    }

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    if (editorElement) {
      const selectionNode = selection.anchorNode;
      if (!selectionNode || !editorElement.contains(selectionNode)) {
        isVisible = false;
        isHighlightPickerOpen = false;
        isLinkPopupOpen = false;
        return;
      }
    }

    // Centred on selection's mid-x; CSS handles the actual centring via
    // translateX(-50%). Estimate width for viewport clamping only — once
    // rendered we re-measure, but the estimate keeps the first paint stable.
    const measured = toolbarElement?.offsetWidth ?? 0;
    const estimatedWidth = measured > 0 ? measured : 360;
    const halfWidth = estimatedWidth / 2;
    const minLeft = 8 + halfWidth;
    const maxLeft = window.innerWidth - 8 - halfWidth;
    const desiredLeft = rect.left + rect.width / 2;
    const left = Math.max(minLeft, Math.min(maxLeft, desiredLeft));

    const gap = 10;
    const estimatedHeight = 36;
    const openAbove = rect.top - estimatedHeight - gap >= 8;
    const top = openAbove ? rect.top - gap : rect.bottom + gap;

    position = { top, left, openAbove };
    isVisible = true;

    const detected = detectActiveState();
    activeMarks = detected.marks;
    activeBlockType = detected.blockType;
    if (!activeMarks.has('highlight')) selectedHighlightColor = null;
  }

  function handleSelectionChange() {
    requestAnimationFrame(updatePosition);
  }

  function handleMouseUp() {
    setTimeout(updatePosition, 10);
  }

  function handleKeyUp(event: KeyboardEvent) {
    if (event.shiftKey || event.key === 'Shift') updatePosition();
  }

  function handleKeyDown(event: KeyboardEvent) {
    const isMod = event.metaKey || event.ctrlKey;
    if (!isMod || event.shiftKey || event.key.toLowerCase() !== 'k') return;

    const selection = window.getSelection();
    const node = selection?.anchorNode;
    if (!selection || !node || selection.isCollapsed || !editorElement?.contains(node)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    updatePosition();
    const existing = detectExistingLink();
    isEditingLink = existing !== null;
    linkUrl = existing ?? '';
    isLinkPopupOpen = true;
    isHighlightPickerOpen = false;
    requestAnimationFrame(() => linkInputElement?.focus());
  }

  function handleDocumentClick(event: MouseEvent) {
    if (toolbarElement && !toolbarElement.contains(event.target as Node)) {
      isHighlightPickerOpen = false;
      isLinkPopupOpen = false;
    }
  }

  onMount(() => {
    document.addEventListener('selectionchange', handleSelectionChange);
    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('keyup', handleKeyUp);
    document.addEventListener('click', handleDocumentClick);
  });

  onDestroy(() => {
    document.removeEventListener('selectionchange', handleSelectionChange);
    document.removeEventListener('mouseup', handleMouseUp);
    document.removeEventListener('keydown', handleKeyDown, true);
    document.removeEventListener('keyup', handleKeyUp);
    document.removeEventListener('click', handleDocumentClick);
  });

  /* ── Action dispatchers ─────────────────────────────────────────────── */
  function handleFormat(format: string) {
    onAction(format);
  }
  function handleHeading(level: 1 | 2 | 3) {
    onAction('blockType', `heading${level}`);
  }
  function handleHighlight(colorName: string) {
    selectedHighlightColor = colorName === 'none' ? null : colorName;
    onAction('highlight', colorName);
    isHighlightPickerOpen = false;
  }
  function getHighlightColor(name: string | null): string {
    return highlightColors.find((c) => c.name === name)?.color ?? 'transparent';
  }
  function toggleHighlightPicker(event: MouseEvent) {
    event.stopPropagation();
    isHighlightPickerOpen = !isHighlightPickerOpen;
    isLinkPopupOpen = false;
  }
  function detectExistingLink(kind: 'link' | 'pageLink' = 'link'): string | null {
    const selection = window.getSelection();
    if (!selection || !selection.rangeCount) return null;
    let node: Node | null = selection.anchorNode;
    while (node && node !== editorElement) {
      if (node instanceof HTMLElement && node.tagName === 'A') {
        const isPageLink = node.dataset?.pageLink !== undefined;
        if ((kind === 'pageLink' && !isPageLink) || (kind === 'link' && isPageLink)) {
          node = node.parentNode;
          continue;
        }
        return node.getAttribute('href') || '';
      }
      node = node.parentNode;
    }
    return null;
  }
  function toggleLinkPopup(event: MouseEvent) {
    event.stopPropagation();
    isHighlightPickerOpen = false;
    if (isLinkPopupOpen) {
      isLinkPopupOpen = false;
      return;
    }
    const existing = detectExistingLink();
    isEditingLink = existing !== null;
    linkUrl = existing ?? '';
    isLinkPopupOpen = true;
    requestAnimationFrame(() => linkInputElement?.focus());
  }
  function openPageLinkPicker(event: MouseEvent) {
    event.stopPropagation();
    isHighlightPickerOpen = false;
    isLinkPopupOpen = false;
    onAction('openPageLinkPicker');
  }
  function applyLink() {
    let url = linkUrl.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url) && !url.startsWith('/') && !url.startsWith('#')) {
      url = 'https://' + url;
    }
    onAction('setLink', url);
    isLinkPopupOpen = false;
    linkUrl = '';
  }
  function handleRemoveLink() {
    onAction('removeLink');
    isLinkPopupOpen = false;
    linkUrl = '';
  }
  function handleLinkKeyDown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      event.preventDefault();
      applyLink();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      isLinkPopupOpen = false;
    }
  }

  /** True when the caret is in a block of the given type. Paragraph is the default. */
  function isBlockType(type: string): boolean {
    if (!activeBlockType) return type === 'paragraph';
    return activeBlockType === type;
  }
</script>

{#if isVisible}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    bind:this={toolbarElement}
    class="floating-toolbar"
    class:above={position.openAbove}
    role="toolbar"
    tabindex="-1"
    aria-label="Text formatting"
    style="top: {position.top}px; left: {position.left}px;"
    onmousedown={(e) => e.preventDefault()}
  >
    <!-- Inline marks -->
    <div class="tb-group">
      <button
        type="button"
        class="tb-btn"
        class:is-active={activeMarks.has('bold')}
        title="Bold (⌘B)"
        aria-label="Bold"
        aria-pressed={activeMarks.has('bold')}
        onclick={() => handleFormat('bold')}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z" />
          <path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z" />
        </svg>
      </button>

      <button
        type="button"
        class="tb-btn"
        class:is-active={activeMarks.has('italic')}
        title="Italic (⌘I)"
        aria-label="Italic"
        aria-pressed={activeMarks.has('italic')}
        onclick={() => handleFormat('italic')}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
          <line x1="18.5" y1="4" x2="10.5" y2="4" />
          <line x1="13.5" y1="20" x2="5.5" y2="20" />
          <line x1="14.5" y1="4" x2="9.5" y2="20" />
        </svg>
      </button>

      <button
        type="button"
        class="tb-btn"
        class:is-active={activeMarks.has('strikethrough')}
        title="Strikethrough"
        aria-label="Strikethrough"
        aria-pressed={activeMarks.has('strikethrough')}
        onclick={() => handleFormat('strikethrough')}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M17.3 4.9c-2.3-.6-4.4-1-6.2-.9-2.7 0-5.3.7-5.3 3.6 0 1.5 1.1 2.4 3.1 3" />
          <path d="M4 12h16" />
          <path d="M17.6 16.5c0 3.7-3.4 4.2-6.1 4.2-1.8 0-4-.5-6-1.6" />
        </svg>
      </button>

      <button
        type="button"
        class="tb-btn"
        class:is-active={activeMarks.has('code')}
        title="Inline code"
        aria-label="Inline code"
        aria-pressed={activeMarks.has('code')}
        onclick={() => handleFormat('code')}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polyline points="16 18 22 12 16 6" />
          <polyline points="8 6 2 12 8 18" />
        </svg>
      </button>
    </div>

    <span class="tb-divider" aria-hidden="true"></span>

    <!-- Block type -->
    <div class="tb-group">
      <button
        type="button"
        class="tb-btn tb-btn-text"
        class:is-active={isBlockType('paragraph')}
        title="Body text"
        aria-label="Body text"
        aria-pressed={isBlockType('paragraph')}
        onclick={() => onAction('blockType', 'paragraph')}
      >T</button>
      <button
        type="button"
        class="tb-btn tb-btn-text"
        class:is-active={isBlockType('heading1')}
        title="Heading 1"
        aria-label="Heading 1"
        aria-pressed={isBlockType('heading1')}
        onclick={() => handleHeading(1)}
      >H1</button>
      <button
        type="button"
        class="tb-btn tb-btn-text"
        class:is-active={isBlockType('heading2')}
        title="Heading 2"
        aria-label="Heading 2"
        aria-pressed={isBlockType('heading2')}
        onclick={() => handleHeading(2)}
      >H2</button>
      <button
        type="button"
        class="tb-btn tb-btn-text"
        class:is-active={isBlockType('heading3')}
        title="Heading 3"
        aria-label="Heading 3"
        aria-pressed={isBlockType('heading3')}
        onclick={() => handleHeading(3)}
      >H3</button>
    </div>

    <span class="tb-divider" aria-hidden="true"></span>

    <!-- Highlight + link -->
    <div class="tb-group">
      <div class="tb-popover-wrap">
        <button
          type="button"
          class="tb-btn"
          class:is-active={isHighlightPickerOpen || selectedHighlightColor !== null}
          title="Highlight"
          aria-label="Highlight"
          aria-expanded={isHighlightPickerOpen}
          aria-haspopup="menu"
          aria-pressed={selectedHighlightColor !== null}
          onclick={toggleHighlightPicker}
        >
          <Highlighter size={15} strokeWidth={1.8} aria-hidden="true" />
          <span class="tb-color-bar" style="background: {getHighlightColor(selectedHighlightColor)};" aria-hidden="true"></span>
        </button>

        {#if isHighlightPickerOpen}
          <div class="tb-popover tb-color-popover" role="menu" tabindex="-1" aria-label="Highlight color"
               onmousedown={(e) => e.preventDefault()}>
            <button
              type="button"
              class="tb-color-none"
              role="menuitem"
              title="No highlight"
              aria-label="No highlight"
              onclick={() => handleHighlight('none')}
            >
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true">
                <line x1="2.5" y1="2.5" x2="8.5" y2="8.5"/>
                <line x1="8.5" y1="2.5" x2="2.5" y2="8.5"/>
              </svg>
            </button>
            <span class="tb-color-divider" aria-hidden="true"></span>
            {#each highlightColors as color}
              <button
                type="button"
                class="tb-color"
                class:is-active={selectedHighlightColor === color.name}
                role="menuitem"
                title="{color.label} highlight"
                aria-label="{color.label} highlight"
                style="--swatch: {color.color};"
                onclick={() => handleHighlight(color.name)}
              ></button>
            {/each}
          </div>
        {/if}
      </div>

      <div class="tb-popover-wrap">
        <button
          type="button"
          class="tb-btn"
          class:is-active={isLinkPopupOpen || activeMarks.has('link')}
          title="Link (⌘K)"
          aria-label="Insert link"
          aria-expanded={isLinkPopupOpen}
          aria-haspopup="dialog"
          aria-pressed={activeMarks.has('link')}
          onclick={toggleLinkPopup}
        >
          <Link2 size={15} strokeWidth={1.8} aria-hidden="true" />
        </button>

        {#if isLinkPopupOpen}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="tb-popover tb-link-popover"
            role="dialog"
            tabindex="-1"
            aria-label="Insert link"
            onmousedown={(e) => e.preventDefault()}
          >
            <span class="tb-link-icon" aria-hidden="true">
              <Link2 size={13} strokeWidth={1.8} />
            </span>
            <input
              bind:this={linkInputElement}
              type="url"
              class="tb-link-input"
              placeholder="Paste URL or type"
              bind:value={linkUrl}
              onkeydown={handleLinkKeyDown}
            />
            <div class="tb-link-actions">
              {#if isEditingLink}
                <button type="button" class="tb-link-remove" onclick={handleRemoveLink} title="Remove link">Remove</button>
              {/if}
              <button
                type="button"
                class="tb-link-apply"
                onclick={applyLink}
                disabled={!linkUrl.trim()}
              >
                {isEditingLink ? 'Update' : 'Apply'}
              </button>
            </div>
          </div>
        {/if}
      </div>

      <button
        type="button"
        class="tb-btn"
        class:is-active={activeMarks.has('pageLink')}
        title="Reference note (⌘⇧K)"
        aria-label="Reference note"
        aria-pressed={activeMarks.has('pageLink')}
        onclick={openPageLinkPicker}
      >
        <FileText size={15} strokeWidth={1.8} aria-hidden="true" />
      </button>
    </div>

    <span class="tb-divider" aria-hidden="true"></span>

    <!-- AI rewrite — primary affordance, indigo, labeled -->
    <button
      type="button"
      class="tb-btn tb-btn-ai"
      class:tb-btn-ai-unavailable={aiUnavailable}
      title={aiUnavailable ? aiUnavailableMessage : 'Rewrite with AI (⌘J)'}
      aria-label="AI rewrite selection"
      onmousedown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (aiUnavailable) {
          onAIUnavailable?.();
          return;
        }
        const sel = window.getSelection();
        if (sel && !sel.isCollapsed && sel.rangeCount > 0) {
          onAIPrompt?.(sel.toString(), sel.getRangeAt(0).cloneRange());
        }
      }}
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <path d="M8 1.5l1.3 4.2L13.5 7l-4.2 1.3L8 12.5l-1.3-4.2L2.5 7l4.2-1.3z"/>
        <path d="M12.5 0.5l0.55 1.55L14.6 2.6l-1.55 0.55L12.5 4.7l-0.55-1.55L10.4 2.6l1.55-0.55z" opacity="0.55"/>
      </svg>
      <span class="tb-btn-label">Ask</span>
    </button>
  </div>
{/if}

<style>
  /* ─────────────────────────────────────────────────────────────────────
   * Container — paper card on a frosted-glass base. Centred horizontally
   * over selection's mid-x via translateX(-50%). Vertically anchors above
   * (default) or below (when there's no room above) the selection.
   * ───────────────────────────────────────────────────────────────────── */
  .floating-toolbar {
    position: fixed;
    z-index: var(--z-popover, 500);
    display: flex;
    align-items: center;
    gap: 0;
    padding: 4px;
    background: rgba(255, 255, 255, 0.96);
    backdrop-filter: blur(20px) saturate(180%);
    -webkit-backdrop-filter: blur(20px) saturate(180%);
    border: 1px solid rgba(28, 27, 24, 0.06);
    border-radius: 10px;
    box-shadow:
      0 1px 1px rgba(20, 19, 16, 0.04),
      0 8px 28px -6px rgba(20, 19, 16, 0.18),
      0 16px 48px -12px rgba(20, 19, 16, 0.10);
    user-select: none;
    transform: translate(-50%, 0);
    transform-origin: top center;
    animation: tb-in-below 140ms cubic-bezier(0.2, 0, 0, 1);
  }

  .floating-toolbar.above {
    transform: translate(-50%, -100%);
    transform-origin: bottom center;
    animation-name: tb-in-above;
  }

  @keyframes tb-in-below {
    from { opacity: 0; transform: translate(-50%, -4px) scale(0.985); }
    to   { opacity: 1; transform: translate(-50%, 0) scale(1); }
  }

  @keyframes tb-in-above {
    from { opacity: 0; transform: translate(-50%, calc(-100% + 4px)) scale(0.985); }
    to   { opacity: 1; transform: translate(-50%, -100%) scale(1); }
  }

  /* ── Groups & dividers ─────────────────────────────────────────────── */
  .tb-group {
    display: flex;
    align-items: center;
    gap: 1px;
  }

  .tb-divider {
    display: inline-block;
    width: 1px;
    height: 18px;
    margin: 0 5px;
    background: rgba(28, 27, 24, 0.08);
    border-radius: 0.5px;
  }

  /* ── Base button ───────────────────────────────────────────────────── */
  .tb-btn {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--text-secondary);
    border-radius: 6px;
    cursor: pointer;
    font-family: inherit;
    transition:
      background-color 100ms cubic-bezier(0.2, 0, 0, 1),
      color 100ms cubic-bezier(0.2, 0, 0, 1);
  }

  .tb-btn:hover {
    background: rgba(28, 27, 24, 0.05);
    color: var(--text-primary);
  }

  .tb-btn:active {
    background: rgba(28, 27, 24, 0.09);
  }

  /* Active = mark/block currently applied — accent on a faint accent wash */
  .tb-btn.is-active {
    background: var(--accent-soft);
    color: var(--accent-primary);
  }
  .tb-btn.is-active:hover {
    background: rgba(44, 92, 213, 0.14);
  }

  .tb-btn:focus-visible {
    outline: 2px solid var(--accent-primary);
    outline-offset: 1px;
  }

  /* Text-glyph buttons — T / H1 / H2 / H3 */
  .tb-btn-text {
    width: auto;
    min-width: 28px;
    padding: 0 8px;
    font-size: 12px;
    font-weight: 600;
    font-family: var(--font-sans);
    letter-spacing: -0.01em;
    line-height: 1;
    font-variant-numeric: tabular-nums;
  }

  /* AI button — indigo brand, slight wash at rest, label visible */
  .tb-btn-ai {
    width: auto;
    padding: 0 9px 0 7px;
    gap: 5px;
    color: var(--ai-accent);
    background: var(--ai-accent-light);
  }
  .tb-btn-ai:hover {
    background: rgba(99, 102, 241, 0.16);
    color: var(--ai-accent-strong);
  }

  .tb-btn-ai-unavailable,
  .tb-btn-ai-unavailable:hover {
    background: var(--bg-hover);
    color: var(--text-muted);
  }
  .tb-btn-ai .tb-btn-label {
    font-size: 12px;
    font-weight: 600;
    letter-spacing: -0.005em;
    line-height: 1;
  }

  /* Color indicator bar under highlight button — only shows when a color is picked */
  .tb-color-bar {
    position: absolute;
    bottom: 4px;
    left: 50%;
    transform: translateX(-50%);
    width: 12px;
    height: 2.5px;
    border-radius: 1.5px;
    pointer-events: none;
  }

  /* ─────────────────────────────────────────────────────────────────────
   * Popovers — shared visual language for highlight + link
   * ───────────────────────────────────────────────────────────────────── */
  .tb-popover-wrap {
    position: relative;
    display: inline-flex;
  }

  .tb-popover {
    position: absolute;
    top: calc(100% + 7px);
    left: 50%;
    transform: translateX(-50%);
    background: rgba(255, 255, 255, 0.98);
    backdrop-filter: blur(14px) saturate(160%);
    -webkit-backdrop-filter: blur(14px) saturate(160%);
    border: 1px solid rgba(28, 27, 24, 0.06);
    border-radius: 9px;
    box-shadow:
      0 1px 1px rgba(20, 19, 16, 0.04),
      0 8px 24px -8px rgba(20, 19, 16, 0.18);
    animation: tb-pop-in 120ms cubic-bezier(0.2, 0, 0, 1);
    z-index: 1;
  }

  /* Above-mode popovers flip up so they stay close to the button */
  .floating-toolbar.above .tb-popover {
    top: auto;
    bottom: calc(100% + 7px);
    animation-name: tb-pop-in-above;
  }

  @keyframes tb-pop-in {
    from { opacity: 0; transform: translateX(-50%) translateY(-3px) scale(0.985); }
    to   { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); }
  }
  @keyframes tb-pop-in-above {
    from { opacity: 0; transform: translateX(-50%) translateY(3px) scale(0.985); }
    to   { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); }
  }

  /* ── Highlight color popover — single horizontal strip ─────────────── */
  .tb-color-popover {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 5px;
  }

  .tb-color {
    position: relative;
    width: 22px;
    height: 22px;
    padding: 0;
    border: none;
    border-radius: 5px;
    background: var(--swatch, transparent);
    cursor: pointer;
    transition: transform 100ms ease, box-shadow 100ms ease;
    box-shadow: inset 0 0 0 1px rgba(28, 27, 24, 0.06);
  }
  .tb-color:hover {
    transform: scale(1.08);
    box-shadow: inset 0 0 0 1px rgba(28, 27, 24, 0.1);
  }
  .tb-color.is-active {
    box-shadow: 0 0 0 1.5px var(--accent-primary), inset 0 0 0 1px rgba(28, 27, 24, 0.06);
  }
  .tb-color:focus-visible {
    outline: none;
    box-shadow: 0 0 0 2px var(--accent-primary);
  }

  .tb-color-none {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border: none;
    border-radius: 5px;
    background: transparent;
    color: var(--text-tertiary);
    cursor: pointer;
    transition: background-color 100ms ease, color 100ms ease;
  }
  .tb-color-none:hover {
    background: rgba(28, 27, 24, 0.05);
    color: var(--text-primary);
  }

  .tb-color-divider {
    width: 1px;
    height: 14px;
    background: rgba(28, 27, 24, 0.08);
    margin: 0 1px;
  }

  /* ── Link popover — single inline row: icon + input + actions ──────── */
  .tb-link-popover {
    width: 320px;
    padding: 4px 4px 4px 9px;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .tb-link-icon {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    color: var(--text-tertiary);
  }

  .tb-link-input {
    flex: 1;
    min-width: 0;
    padding: 6px 0;
    border: none;
    background: transparent;
    color: var(--text-primary);
    font-family: inherit;
    font-size: 13px;
    letter-spacing: -0.005em;
    outline: none;
  }
  .tb-link-input::placeholder {
    color: var(--text-placeholder);
  }

  .tb-link-actions {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
  }

  .tb-link-apply,
  .tb-link-remove {
    height: 24px;
    padding: 0 10px;
    font-family: inherit;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: -0.005em;
    border: none;
    border-radius: 5px;
    cursor: pointer;
    transition: background-color 100ms ease, color 100ms ease, opacity 100ms ease;
  }

  .tb-link-apply {
    background: var(--accent-primary);
    color: var(--text-inverse);
  }
  .tb-link-apply:hover:not(:disabled) {
    background: var(--accent-hover);
  }
  .tb-link-apply:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .tb-link-apply:focus-visible {
    outline: 2px solid var(--accent-primary);
    outline-offset: 1px;
  }

  .tb-link-remove {
    background: transparent;
    color: var(--color-error);
  }
  .tb-link-remove:hover {
    background: var(--color-error-bg);
  }
  .tb-link-remove:focus-visible {
    outline: 2px solid var(--accent-primary);
    outline-offset: 1px;
  }
</style>
