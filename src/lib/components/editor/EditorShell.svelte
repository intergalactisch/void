<script lang="ts">
  /**
   * EditorShell - presentational editor chrome.
   *
   * The application service owns ProseMirror. This component owns DOM slots,
   * floating menus, title editing, and toolbar actions.
   */

  import { onDestroy } from 'svelte';
  import { editorStore, settingsStore, toastStore, aiStore, notesStore } from '$lib/stores';
  import type { Document } from '$lib/domain/entities/Document';
  import { normalizeNoteTag } from '$lib/domain/values';
  import { events } from '$lib/events';
  import { buildRefId } from '$lib/domain/values';
  import { copyTextToClipboard } from '$lib/utils/clipboard';
  import type { SlashMenuState } from '$lib/adapters/prosemirror/plugins/slashMenu';
  import type { PageLinkNote, PageLinkState } from '$lib/adapters/prosemirror/plugins/pageLink';
  import { SlashMenu, BlockMenu, EditorToolbar, PageLinkPopup, FindReplaceBar, RelationsPanel, LineageHistoryWorkspace, BranchPicker, SessionRibbon } from '$lib/components/editor';
  import type { BlockMenuAction } from '$lib/components/editor/BlockMenu.svelte';
  import type { RegisteredCommand } from '$lib/ports/outbound';
  import type { BlockType } from '$lib/domain/values/BlockType';
  import { LocateFixed, Plus, X } from '@lucide/svelte';

  interface Props {
    document: Document;
    onSaveStatusChange?: (status: 'saved' | 'saving' | 'unsaved') => void;
    onCountsChange?: (wordCount: number, charCount: number) => void;
    onError?: (error: string | null) => void;
    onTitleRename?: (newTitle: string) => void;
    editorStyle?: string;
  }

  let {
    document: doc,
    onSaveStatusChange,
    onCountsChange,
    onError,
    onTitleRename,
    editorStyle = '',
  }: Props = $props();

  const DEFAULT_SLASH_MENU_STATE: SlashMenuState = {
    isOpen: false,
    query: '',
    filteredCommands: [],
    selectedIndex: 0,
    triggerPos: 0,
    coords: null,
    openAbove: false,
    isAIPromptMode: false,
    aiPrompt: '',
    source: 'slash',
    blockType: '',
  };

  let editorContainer: HTMLDivElement | undefined = $state(undefined);
  let editorScrollElement: HTMLDivElement | undefined = $state(undefined);
  let titleElement: HTMLHeadingElement | undefined = $state(undefined);
  let previousDocId: string | null = null;
  let countTimeout: ReturnType<typeof setTimeout> | null = null;
  let wordCount = $state(0);
  let charCount = $state(0);
  let tagInputOpen = $state(false);
  let tagDraft = $state('');
  let tagInputElement: HTMLInputElement | undefined = $state(undefined);
  let aiFollowPaused = $state(false);
  let lastAIActiveBlockId: string | null = null;
  let aiFollowProgrammatic = false;
  let aiFollowClearTimer: ReturnType<typeof setTimeout> | null = null;

  const slashMenuState = $derived.by(() =>
    (editorStore.slashMenuState as SlashMenuState | null) ?? DEFAULT_SLASH_MENU_STATE
  );

  const pageLinkState = $derived.by(() =>
    editorStore.pageLinkMenuState as PageLinkState | null
  );

  const blockMenuState = $derived.by(() => {
    const request = editorStore.blockMenuRequest;
    return {
      isOpen: request !== null,
      blockId: request?.blockId ?? '',
      lineIndex: request?.lineIndex ?? 0,
      position: request?.position ?? { top: 0, left: 0 },
      currentType: request?.currentType ?? 'paragraph',
      mode: request?.mode ?? 'actions',
    };
  });

  const saveStatus = $derived.by(() =>
    editorStore.isSaving ? 'saving' : editorStore.isDirty ? 'unsaved' : 'saved'
  );

  const noteTags = $derived(editorStore.document?.meta.tags ?? doc.meta.tags);
  const aiActiveBlockId = $derived(editorStore.aiActiveBlockId);

  function updateCounts() {
    const text = editorStore.getTextContent();
    charCount = text.length;
    wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
    onCountsChange?.(wordCount, charCount);
  }

  function scheduleCountUpdate() {
    if (countTimeout) clearTimeout(countTimeout);
    countTimeout = setTimeout(updateCounts, 150);
  }

  async function mountEditor(document: Document) {
    if (!editorContainer) {
      onError?.('Editor container not found');
      return;
    }

    const result = await editorStore.mount(
      editorContainer,
      document,
      settingsStore.settings?.autoSaveDelay ?? 1000,
    );

    if (!result.ok) {
      onError?.(result.error.message);
      return;
    }

    onError?.(null);
    updateCounts();
    aiStore.setActiveDocument(document);
    requestAnimationFrame(() => editorStore.focus());
  }

  function handleBlockMenuAction(action: BlockMenuAction) {
    const blockId = blockMenuState.blockId;

    switch (action.type) {
      case 'turnInto':
        editorStore.selectBlock(blockId);
        editorStore.setBlockType(action.blockType);
        break;
      case 'inspectLineage':
        events.emit('editor:lineage-inspect-request', {
          blockId,
          lineIndex: blockMenuState.lineIndex,
          position: blockMenuState.position,
          currentType: blockMenuState.currentType,
        });
        break;
      case 'duplicate':
        editorStore.duplicateBlock(blockId);
        break;
      case 'copyLink':
        copyBlockRef(blockId);
        break;
      case 'delete':
        editorStore.deleteBlock(blockId);
        toastStore.info('Block deleted. Press Cmd+Z to undo');
        break;
    }

    editorStore.clearBlockMenuRequest();
    editorStore.focus();
  }

  async function copyBlockRef(blockId: string) {
    const notePath = editorStore.activePath ?? editorStore.document?.path ?? doc.path;
    const success = await copyTextToClipboard(buildRefId({ kind: 'block', notePath, blockId }));
    if (success) toastStore.info('Ref copied');
    else toastStore.error('Failed to copy ref');
  }

  function handleBlockMenuClose() {
    editorStore.clearBlockMenuRequest();
    editorStore.focus();
  }

  function handleAIPrompt(text: string, range: Range) {
    const resolved = editorStore.resolveSelectionFromDOM(range);
    if (resolved) {
      editorStore.aiPromptSelectionAt(resolved.from, resolved.to, text);
    }
  }

  function handleToolbarAction(action: string, value?: string) {
    switch (action) {
      case 'bold':
      case 'italic':
      case 'underline':
      case 'strikethrough':
      case 'code':
      case 'highlight':
        editorStore.toggleMark('highlight', { color: value ?? 'yellow' });
        break;
      case 'setLink':
        if (value) editorStore.setLink(value);
        break;
      case 'removeLink':
        editorStore.removeLink();
        break;
      case 'openPageLinkPicker':
        editorStore.openPageLinkPicker();
        break;
      case 'removePageLink':
        editorStore.removePageLink();
        break;
      case 'blockType':
        if (value) editorStore.setBlockType(value as BlockType);
        break;
      case 'undo':
        editorStore.undo();
        break;
      case 'redo':
        editorStore.redo();
        break;
    }
    editorStore.focus();
  }

  function handleSlashMenuSelect(command: RegisteredCommand) {
    editorStore.executeSlashMenuCommand(command);
  }

  function handleSlashMenuClose() {
    editorStore.closeSlashMenu();
  }

  function handlePageLinkSelect(note: PageLinkNote) {
    editorStore.selectPageLink(note);
    editorStore.focus();
  }

  function handlePageLinkClose() {
    editorStore.closePageLinkMenu();
    editorStore.focus();
  }

  function handlePageLinkQueryChange(query: string) {
    editorStore.updatePageLinkQuery(query);
  }

  function handlePageLinkNavigate(direction: 'next' | 'prev') {
    editorStore.movePageLinkSelection(direction);
  }

  function handleTitleBlur() {
    if (!titleElement) return;
    const newTitle = titleElement.textContent?.trim() || '';
    const currentTitle = editorStore.document?.meta.title ?? doc.meta.title;
    if (newTitle && newTitle !== currentTitle) {
      onTitleRename?.(newTitle);
    } else if (!newTitle) {
      titleElement.textContent = currentTitle;
    }
  }

  function handleTitleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === 'ArrowDown') {
      e.preventDefault();
      titleElement?.blur();
      editorStore.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (titleElement) {
        titleElement.textContent = editorStore.document?.meta.title ?? doc.meta.title;
      }
      titleElement?.blur();
      editorStore.focus();
    }
  }

  function openTagInput() {
    tagInputOpen = true;
    requestAnimationFrame(() => tagInputElement?.focus());
  }

  function closeTagInput() {
    tagDraft = '';
    tagInputOpen = false;
  }

  function addTag() {
    const tag = normalizeNoteTag(tagDraft);
    if (!tag) {
      closeTagInput();
      return;
    }

    if (noteTags.includes(tag)) {
      closeTagInput();
      return;
    }

    const result = editorStore.updateDocumentMeta({ tags: [...noteTags, tag] });
    if (result.ok) {
      closeTagInput();
    } else {
      toastStore.error('Failed to add tag');
    }
  }

  function removeTag(tag: string) {
    const result = editorStore.updateDocumentMeta({
      tags: noteTags.filter((item) => item !== tag),
    });
    if (!result.ok) {
      toastStore.error('Failed to remove tag');
    }
  }

  function handleTagSubmit(event: SubmitEvent) {
    event.preventDefault();
    addTag();
  }

  function handleTagKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeTagInput();
      editorStore.focus();
    }
  }

  function markProgrammaticAIFollow() {
    aiFollowProgrammatic = true;
    if (aiFollowClearTimer) clearTimeout(aiFollowClearTimer);
    aiFollowClearTimer = setTimeout(() => {
      aiFollowProgrammatic = false;
      aiFollowClearTimer = null;
    }, 700);
  }

  function scrollToActiveAIBlock(mode: 'nearest' | 'center' | 'smart' = 'smart') {
    const blockId = editorStore.aiActiveBlockId;
    if (!blockId) return;
    markProgrammaticAIFollow();
    editorStore.scrollBlockIntoView(blockId, mode);
  }

  function pauseAIFollow() {
    if (!editorStore.aiActiveBlockId || aiFollowProgrammatic) return;
    aiFollowPaused = true;
  }

  function resumeAIFollow() {
    aiFollowPaused = false;
    scrollToActiveAIBlock('center');
  }

  function handleEditorScroll() {
    pauseAIFollow();
  }

  function handleEditorUserIntent(event: Event) {
    const target = event.target as HTMLElement | null;
    if (target?.closest('.ai-follow-jump')) return;
    pauseAIFollow();
  }

  export async function triggerSave() {
    await editorStore.saveDocument();
  }

  export function getCurrentDocument(): Document | null {
    return editorStore.document;
  }

  export function getSaveStatus(): 'saved' | 'saving' | 'unsaved' {
    return saveStatus;
  }

  export function getWordCount(): number {
    return wordCount;
  }

  export function getCharCount(): number {
    return charCount;
  }

  $effect(() => {
    const docId = doc?.meta?.id ?? null;
    if (docId && docId !== previousDocId && editorContainer) {
      previousDocId = docId;
      mountEditor(doc);
    }
  });

  $effect(() => {
    onSaveStatusChange?.(saveStatus);
  });

  $effect(() => {
    const document = editorStore.document;
    if (document) {
      aiStore.setActiveDocument(document);
      scheduleCountUpdate();
    }
  });

  $effect(() => {
    const blockId = aiActiveBlockId;
    if (!blockId) {
      lastAIActiveBlockId = null;
      aiFollowPaused = false;
      return;
    }

    if (blockId !== lastAIActiveBlockId) {
      lastAIActiveBlockId = blockId;
      aiFollowPaused = false;
    }

    if (!aiFollowPaused) {
      requestAnimationFrame(() => scrollToActiveAIBlock('smart'));
    }
  });

  onDestroy(() => {
    if (countTimeout) clearTimeout(countTimeout);
    if (aiFollowClearTimer) clearTimeout(aiFollowClearTimer);
  });
</script>

<div class="editor-shell-wrap">
<div class="editor-area">
  <FindReplaceBar />
  <div
    bind:this={editorScrollElement}
    class="scrollbar-thin editor-scroll"
    style="background: var(--bg-editor); {editorStyle}"
    onscroll={handleEditorScroll}
  >
    {#key doc.meta.id}
      <div class="editor-content-wrapper">
        <SessionRibbon notePath={doc.path} />
        <!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
        <h1
          bind:this={titleElement}
          class="note-title"
          contenteditable="true"
          spellcheck="false"
          onblur={handleTitleBlur}
          onkeydown={handleTitleKeyDown}
          role="textbox"
          aria-label="Note title"
        >{doc.meta.title}</h1>

        <div class="note-tags" aria-label="Note tags">
          {#each noteTags as tag (tag)}
            <span class="tag-chip">
              <button
                type="button"
                class="tag-label"
                onclick={() => notesStore.selectTagView(tag)}
                title={`See all notes tagged #${tag}`}
                aria-label={`Open #${tag} detail view`}
              >#{tag}</button>
              <button
                type="button"
                class="tag-remove"
                onclick={() => removeTag(tag)}
                aria-label={`Remove #${tag}`}
                title={`Remove #${tag}`}
              >
                <X size={12} strokeWidth={2} aria-hidden="true" />
              </button>
            </span>
          {/each}

          {#if tagInputOpen}
            <form class="tag-form" onsubmit={handleTagSubmit}>
              <input
                bind:this={tagInputElement}
                class="tag-input"
                name="note-tag"
                aria-label="Add tag"
                placeholder="#tag"
                bind:value={tagDraft}
                onkeydown={handleTagKeyDown}
                onblur={() => {
                  if (tagDraft.trim()) addTag();
                  else closeTagInput();
                }}
              />
            </form>
          {:else}
            <button
              type="button"
              class="tag-add"
              onclick={openTagInput}
              aria-label="Add tag"
              title="Add tag"
            >
              <Plus size={13} strokeWidth={2} aria-hidden="true" />
              <span>Add tag</span>
            </button>
          {/if}
        </div>

        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          bind:this={editorContainer}
          class="void-editor"
          onkeydown={handleEditorUserIntent}
          onbeforeinput={handleEditorUserIntent}
          onpointerdown={handleEditorUserIntent}
        ></div>
      </div>
    {/key}
  </div>

  {#if aiActiveBlockId && aiFollowPaused}
    <button
      type="button"
      class="ai-follow-jump"
      onclick={resumeAIFollow}
      onpointerdown={(event) => event.preventDefault()}
      title="Jump to AI"
      aria-label="Jump to AI"
    >
      <LocateFixed size={14} strokeWidth={2} aria-hidden="true" />
      <span>Jump to AI</span>
    </button>
  {/if}

  <EditorToolbar
    editorElement={editorContainer}
    onAction={handleToolbarAction}
    onAIPrompt={handleAIPrompt}
  />

  <SlashMenu menuState={slashMenuState} onSelect={handleSlashMenuSelect} onClose={handleSlashMenuClose} />

  {#if pageLinkState}
    <PageLinkPopup
      state={pageLinkState}
      onSelect={handlePageLinkSelect}
      onClose={handlePageLinkClose}
      onQueryChange={handlePageLinkQueryChange}
      onNavigate={handlePageLinkNavigate}
    />
  {/if}

  {#if blockMenuState.isOpen}
    <BlockMenu
      blockId={blockMenuState.blockId}
      position={blockMenuState.position}
      currentType={blockMenuState.currentType}
      mode={blockMenuState.mode}
      onAction={handleBlockMenuAction}
      onClose={handleBlockMenuClose}
    />
  {/if}
</div>
<RelationsPanel />
<LineageHistoryWorkspace />
</div>

<BranchPicker />

<style>
  .editor-shell-wrap {
    flex: 1;
    display: flex;
    flex-direction: row;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }

  .editor-area {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    position: relative;
    background: var(--bg-editor);
  }

  .editor-scroll {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
  }

  .ai-follow-jump {
    position: absolute;
    top: 16px;
    right: 22px;
    z-index: 35;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 30px;
    padding: 5px 10px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-full);
    background: var(--bg-card);
    color: var(--text-secondary);
    font: inherit;
    font-size: var(--text-caption);
    font-weight: 600;
    box-shadow: var(--shadow-md);
    cursor: pointer;
    transition:
      background var(--transition-fast),
      border-color var(--transition-fast),
      color var(--transition-fast),
      transform var(--transition-fast);
  }

  .ai-follow-jump:hover,
  .ai-follow-jump:focus-visible {
    background: var(--bg-hover);
    border-color: var(--accent-primary);
    color: var(--text-primary);
    outline: none;
  }

  .ai-follow-jump:active {
    transform: translateY(1px);
  }

  .editor-content-wrapper {
    max-width: var(--content-max-width);
    margin: 0 auto;
    padding: 64px 60px 180px;
    animation: editor-fade-in 280ms var(--ease-out-soft);
  }

  .note-title {
    font-size: var(--text-note-title);
    font-weight: var(--text-note-title-weight);
    line-height: var(--text-note-title-line-height);
    letter-spacing: var(--text-note-title-tracking);
    color: var(--text-primary);
    margin: 0 0 20px;
    padding: 0;
    word-wrap: break-word;
    outline: none;
    cursor: text;
  }

  .note-title:empty::before {
    content: 'Untitled';
    color: var(--text-placeholder);
    pointer-events: none;
  }

  .note-tags {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    min-height: 26px;
    margin: -8px 0 22px;
  }

  .tag-chip,
  .tag-add,
  .tag-form {
    display: inline-flex;
    align-items: center;
    min-height: 24px;
  }

  .tag-chip {
    gap: 4px;
    padding: 2px 4px 2px 8px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-full);
    background: var(--bg-subtle);
    color: var(--text-secondary);
    font-size: var(--text-caption);
    line-height: 1.4;
  }

  .tag-label {
    max-width: 180px;
    overflow: hidden;
    padding: 0;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    text-decoration: none;
    text-overflow: ellipsis;
    white-space: nowrap;
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: color var(--transition-fast);
  }

  .tag-label:hover,
  .tag-label:focus-visible {
    color: var(--text-primary);
    text-decoration: underline;
    text-underline-offset: 2px;
    outline: none;
  }

  .tag-chip:has(.tag-label:hover),
  .tag-chip:has(.tag-label:focus-visible) {
    border-color: var(--border-medium);
    background: var(--bg-hover);
  }

  .tag-remove,
  .tag-add {
    border: none;
    background: transparent;
    color: var(--text-tertiary);
    border-radius: var(--radius-full);
    cursor: pointer;
    font-family: inherit;
    transition: background var(--transition-fast), color var(--transition-fast);
  }

  .tag-remove {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    padding: 0;
  }

  .tag-remove:hover,
  .tag-remove:focus-visible,
  .tag-add:hover,
  .tag-add:focus-visible {
    background: var(--bg-hover);
    color: var(--text-primary);
    outline: none;
  }

  .tag-add {
    gap: 4px;
    min-height: 24px;
    padding: 2px 8px 2px 6px;
    font-size: var(--text-caption);
  }

  .tag-input {
    width: 120px;
    height: 24px;
    padding: 2px 8px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-full);
    background: var(--bg-card);
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-caption);
    outline: none;
  }

  .tag-input:focus {
    border-color: var(--accent-primary);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }

  @keyframes editor-fade-in {
    from { opacity: 0; transform: translateY(2px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  @media (max-width: 840px) {
    .editor-content-wrapper {
      padding: 40px 32px 120px;
    }
  }
</style>
