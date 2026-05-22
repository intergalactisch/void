<script lang="ts">
  /**
   * EditorShell - presentational editor chrome.
   *
   * The application service owns ProseMirror. This component owns DOM slots,
   * floating menus, title editing, and toolbar actions.
   */

  import { onDestroy, onMount, tick } from 'svelte';
  import {
    editorStore,
    settingsStore,
    toastStore,
    aiStore,
    notesStore,
    inlineAIStore,
    lineageStore,
    noteAIActivityStore,
    uiStore,
  } from '$lib/stores';
  import type { Document } from '$lib/domain/entities/Document';
  import { normalizeNoteTag } from '$lib/domain/values';
  import { events } from '$lib/events';
  import { buildRefId } from '$lib/domain/values';
  import { AI_UNAVAILABLE_MESSAGE } from '$lib/domain/values/AIAvailability';
  import { copyTextToClipboard } from '$lib/utils/clipboard';
  import type { SlashMenuState } from '$lib/adapters/prosemirror/plugins/slashMenu';
  import type { PageLinkNote, PageLinkState } from '$lib/adapters/prosemirror/plugins/pageLink';
  import { SlashMenu, BlockMenu, EditorToolbar, PageLinkPopup, FindReplaceBar, RelationsPanel, LineageHistoryWorkspace, BranchPicker, SessionRibbon } from '$lib/components/editor';
  import type { BlockMenuAction } from '$lib/components/editor/BlockMenu.svelte';
  import type { EditorInlineAIComposerView, RegisteredCommand } from '$lib/ports/outbound';
  import type { BlockType } from '$lib/domain/values/BlockType';
  import { LocateFixed, MessageSquare, Plus, Send, Sparkles, X } from '@lucide/svelte';

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
  let inlineAILoadedPath: string | null = null;
  let inlineAIObserver: IntersectionObserver | null = null;
  let inlineAIMarkers = $state<Array<{ id: string; top: number; unread: boolean }>>([]);
  let inlineAIComposerPositions = $state<Record<string, {
    top: number;
    left: number;
    maxWidth: number;
    visible: boolean;
  }>>({});
  let focusedComposerInputId: string | null = null;

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
  const inlineAIComposers = $derived(editorStore.aiInlineComposers);
  const offscreenInlineAIComposers = $derived.by(() =>
    inlineAIComposers.filter((composer) => {
      const position = inlineAIComposerPositions[composer.id];
      return position && !position.visible;
    })
  );

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
    if (!aiStore.ensureAIAvailable()) {
      toastStore.info(aiStore.availabilityMessage ?? AI_UNAVAILABLE_MESSAGE);
      return;
    }
    const resolved = editorStore.resolveSelectionFromDOM(range);
    if (resolved) {
      editorStore.aiPromptSelectionAt(resolved.from, resolved.to, text);
    }
  }

  function getInlineAIComposerHighlight(composerId: string): HTMLElement | null {
    if (!editorContainer) return null;
    return editorContainer.querySelector(
      `[data-ai-composer-id="${CSS.escape(composerId)}"]`
    ) as HTMLElement | null;
  }

  function refreshInlineAIComposerPositions() {
    if (!editorScrollElement || !editorContainer) {
      inlineAIComposerPositions = {};
      return;
    }

    const scrollRect = editorScrollElement.getBoundingClientRect();
    const next: typeof inlineAIComposerPositions = {};
    for (const composer of inlineAIComposers) {
      const highlight = getInlineAIComposerHighlight(composer.id);
      if (!highlight) continue;

      const rects = Array.from(highlight.getClientRects());
      const anchorRect = rects.at(-1) ?? highlight.getBoundingClientRect();
      const visible = anchorRect.bottom >= scrollRect.top && anchorRect.top <= scrollRect.bottom;
      if (!visible) {
        next[composer.id] = { top: 0, left: 0, maxWidth: 0, visible: false };
        continue;
      }

      const expanded = composer.isActive;
      const estimatedHeight = expanded ? 50 : 32;
      const preferredTop = anchorRect.bottom + 8;
      const top = preferredTop + estimatedHeight > scrollRect.bottom - 12
        ? Math.max(scrollRect.top + 12, anchorRect.top - estimatedHeight - 8)
        : preferredTop;
      const idealWidth = expanded ? 520 : 190;
      const minLeft = scrollRect.left + 14;
      const maxLeft = Math.max(minLeft, scrollRect.right - idealWidth - 14);
      const left = Math.min(Math.max(anchorRect.left, minLeft), maxLeft);
      const maxWidth = Math.max(220, Math.min(560, scrollRect.right - left - 14));

      next[composer.id] = { top, left, maxWidth, visible: true };
    }

    inlineAIComposerPositions = next;
  }

  async function focusInlineAIComposerInput(composerId: string) {
    await tick();
    refreshInlineAIComposerPositions();
    const input = document.querySelector(
      `[data-inline-ai-composer="${CSS.escape(composerId)}"] input`
    ) as HTMLInputElement | null;
    input?.focus({ preventScroll: true });
  }

  function handleComposerInput(composer: EditorInlineAIComposerView, event: Event) {
    const target = event.target as HTMLInputElement | null;
    editorStore.updateAIInlineComposerDraft(composer.id, target?.value ?? '');
  }

  function submitComposer(composer: EditorInlineAIComposerView) {
    const prompt = composer.draftPrompt.trim();
    if (!prompt) return;
    focusedComposerInputId = null;
    editorStore.submitAIInlineComposer(composer.id, prompt);
    requestAnimationFrame(refreshInlineAIComposerPositions);
  }

  function cancelComposer(composerId: string) {
    focusedComposerInputId = null;
    editorStore.cancelAIInlineComposer(composerId);
    requestAnimationFrame(refreshInlineAIComposerPositions);
  }

  function focusComposer(composerId: string) {
    editorStore.focusAIInlineComposer(composerId);
    void focusInlineAIComposerInput(composerId);
  }

  function handleComposerKeyDown(
    event: KeyboardEvent,
    composer: EditorInlineAIComposerView,
  ) {
    event.stopPropagation();
    if (event.key === 'Enter') {
      event.preventDefault();
      submitComposer(composer);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelComposer(composer.id);
    }
  }

  function stopComposerEvent(event: Event) {
    event.stopPropagation();
  }

  function showAIUnavailableMessage() {
    aiStore.ensureAIAvailable();
    toastStore.info(aiStore.availabilityMessage ?? AI_UNAVAILABLE_MESSAGE);
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
    refreshInlineAIMarkers();
    refreshInlineAIComposerPositions();
  }

  function handleEditorUserIntent(event: Event) {
    const target = event.target as HTMLElement | null;
    if (target?.closest('.ai-follow-jump, .inline-ai-jump-pill, .inline-ai-composer-jump-pill, .inline-ai-scroll-marker, .floating-inline-ai-composer')) return;
    pauseAIFollow();
  }

  function getInlineAIThreadElement(threadId: string): HTMLElement | null {
    if (!editorContainer) return null;
    const direct = editorContainer.querySelector(
      `[data-inline-ai-thread-id="${CSS.escape(threadId)}"]`
    ) as HTMLElement | null;
    if (direct) return direct;
    return editorContainer.querySelector(
      `[data-inline-ai-thread-ids~="${CSS.escape(threadId)}"]`
    ) as HTMLElement | null;
  }

  function refreshInlineAIMarkers() {
    if (!editorScrollElement) {
      inlineAIMarkers = [];
      return;
    }
    const scrollHeight = Math.max(editorScrollElement.scrollHeight, 1);
    const markersByElement = new Map<string, { id: string; top: number; unread: boolean }>();
    for (const thread of inlineAIStore.visibleThreads) {
      const element = getInlineAIThreadElement(thread.id);
      if (!element) continue;
      const top = Math.min(96, Math.max(4, (element.offsetTop / scrollHeight) * 100));
      const key = element.dataset.inlineAiThreadIds || element.dataset.inlineAiThreadId || thread.id;
      const existing = markersByElement.get(key);
      markersByElement.set(key, {
        id: existing?.id ?? thread.id,
        top,
        unread: Boolean(existing?.unread || (!thread.seenAt && thread.status !== 'generating')),
      });
    }
    inlineAIMarkers = [...markersByElement.values()];
  }

  function setupInlineAIObserver() {
    inlineAIObserver?.disconnect();
    inlineAIObserver = null;
    if (!editorScrollElement || !editorContainer) return;

    inlineAIObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const element = entry.target as HTMLElement;
        const threadIds = (element.dataset.inlineAiThreadIds || element.dataset.inlineAiThreadId || '')
          .split(/\s+/)
          .filter(Boolean);
        for (const threadId of threadIds) void inlineAIStore.markSeen(threadId);
      }
    }, {
      root: editorScrollElement,
      threshold: 0.45,
    });

    const observed = new Set<HTMLElement>();
    for (const thread of inlineAIStore.visibleThreads) {
      const element = getInlineAIThreadElement(thread.id);
      if (!element || observed.has(element)) continue;
      observed.add(element);
      inlineAIObserver.observe(element);
    }
  }

  function jumpToInlineAIThread(threadId: string) {
    const element = getInlineAIThreadElement(threadId);
    if (element) {
      element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
      const threadIds = (element.dataset.inlineAiThreadIds || element.dataset.inlineAiThreadId || threadId)
        .split(/\s+/)
        .filter(Boolean);
      for (const id of threadIds) void inlineAIStore.markSeen(id);
      return;
    }
    editorStore.scrollInlineAIThreadIntoView(threadId);
  }

  function jumpToNearestUnreadInlineAI() {
    const target = inlineAIStore.unreadThreads[0] ?? inlineAIStore.visibleThreads[0];
    if (target) jumpToInlineAIThread(target.id);
  }

  function jumpToInlineAIComposer(composerId: string) {
    const highlight = getInlineAIComposerHighlight(composerId);
    if (highlight) {
      highlight.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
    }
    requestAnimationFrame(() => {
      refreshInlineAIComposerPositions();
      focusComposer(composerId);
    });
  }

  function jumpToNearestInlineAIComposer() {
    const activeOffscreen = offscreenInlineAIComposers.find((composer) => composer.isActive);
    const target = activeOffscreen ?? offscreenInlineAIComposers[0];
    if (target) jumpToInlineAIComposer(target.id);
  }

  async function handleInlineAIAction(event: Event) {
    const detail = (event as CustomEvent<{
      action: string;
      threadId: string;
      threadIds?: string[];
      prompt?: string;
    }>).detail;
    if (!detail?.threadId) return;

    const thread = inlineAIStore.visibleThreads.find((candidate) => candidate.id === detail.threadId);
    const threadIds = detail.threadIds?.length ? detail.threadIds : [detail.threadId];
    switch (detail.action) {
      case 'accept':
        if (!(await inlineAIStore.accept(detail.threadId))) {
          toastStore.warning(inlineAIStore.error?.message ?? 'Inline AI proposal is stale');
        }
        break;
      case 'cancel':
        if (await inlineAIStore.cancel(detail.threadId)) toastStore.info('Inline AI proposal canceled');
        break;
      case 'retry':
        if (!(await inlineAIStore.retry(detail.threadId))) {
          toastStore.error(inlineAIStore.error?.message ?? 'Retry failed');
        }
        break;
      case 'follow-up':
        if (!(await inlineAIStore.followUp(detail.threadId, detail.prompt ?? ''))) {
          toastStore.error(inlineAIStore.error?.message ?? 'Follow-up failed');
        }
        break;
      case 'dismiss':
        await inlineAIStore.dismiss(detail.threadId);
        break;
      case 'dismiss-cluster':
        await Promise.all(threadIds.map((threadId) => inlineAIStore.dismiss(threadId)));
        break;
      case 'copy':
        if (thread?.turns.at(-1)?.response) {
          const copied = await copyTextToClipboard(thread.turns.at(-1)!.response);
          if (copied) toastStore.info('AI response copied');
          else toastStore.error('Failed to copy AI response');
        }
        break;
      case 'open-chat':
        if (thread?.conversationId) {
          window.dispatchEvent(new CustomEvent('void:open-ai-chat', {
            detail: { conversationId: thread.conversationId },
          }));
        } else {
          toastStore.info('No chat is linked to this response');
        }
        break;
      case 'open-history': {
        const notePath = thread?.notePath ?? editorStore.document?.path ?? null;
        if (!notePath) {
          toastStore.info('No note history is linked to this marker');
          break;
        }
        uiStore.openLineageWorkspace();
        await lineageStore.openWorkspace(notePath);
        await noteAIActivityStore.loadForDocument(notePath);
        noteAIActivityStore.selectItem(detail.threadId);
        window.dispatchEvent(new CustomEvent('void:lineage-workspace-view', {
          detail: { view: 'ai', threadId: detail.threadId },
        }));
        break;
      }
      case 'undo':
        editorStore.undo();
        toastStore.info('Applied edit undone');
        break;
    }
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
    const path = doc.path;
    if (path && path !== inlineAILoadedPath) {
      inlineAILoadedPath = path;
      void inlineAIStore.loadForDocument(path);
    }
  });

  $effect(() => {
    const threads = inlineAIStore.visibleThreads;
    const isReady = editorStore.isReady;
    if (isReady) {
      editorStore.setInlineAIThreads(threads);
    }
    requestAnimationFrame(() => {
      setupInlineAIObserver();
      refreshInlineAIMarkers();
    });
  });

  $effect(() => {
    const composers = inlineAIComposers;
    const activeComposerId = editorStore.activeAIInlineComposerId;
    if (!editorStore.isReady) {
      inlineAIComposerPositions = {};
      return;
    }

    void tick().then(() => {
      refreshInlineAIComposerPositions();
      if (activeComposerId && activeComposerId !== focusedComposerInputId) {
        focusedComposerInputId = activeComposerId;
        void focusInlineAIComposerInput(activeComposerId);
      }
      if (!activeComposerId) {
        focusedComposerInputId = null;
      }
    });
    void composers;
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

  onMount(() => {
    window.addEventListener('resize', refreshInlineAIComposerPositions);
    window.addEventListener('void:inline-ai-thread-action', handleInlineAIAction);
    return () => {
      window.removeEventListener('resize', refreshInlineAIComposerPositions);
      window.removeEventListener('void:inline-ai-thread-action', handleInlineAIAction);
    };
  });

  onDestroy(() => {
    if (countTimeout) clearTimeout(countTimeout);
    if (aiFollowClearTimer) clearTimeout(aiFollowClearTimer);
    inlineAIObserver?.disconnect();
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

  {#if inlineAIStore.unreadCount > 0}
    <button
      type="button"
      class="inline-ai-jump-pill"
      onclick={jumpToNearestUnreadInlineAI}
      onpointerdown={(event) => event.preventDefault()}
      title="Jump to AI response"
      aria-label="Jump to unread AI response"
    >
      <MessageSquare size={14} strokeWidth={2} aria-hidden="true" />
      <span>AI response</span>
      <strong>{inlineAIStore.unreadCount}</strong>
    </button>
  {/if}

  {#if offscreenInlineAIComposers.length > 0}
    <button
      type="button"
      class="inline-ai-composer-jump-pill"
      class:has-response-pill={inlineAIStore.unreadCount > 0}
      onclick={jumpToNearestInlineAIComposer}
      onpointerdown={(event) => event.preventDefault()}
      title="Jump to AI draft"
      aria-label="Jump to off-screen AI draft"
    >
      <Sparkles size={14} strokeWidth={2} aria-hidden="true" />
      <span>AI draft</span>
      <strong>{offscreenInlineAIComposers.length}</strong>
    </button>
  {/if}

  {#if inlineAIMarkers.length > 0}
    <div class="inline-ai-scroll-markers" aria-label="AI response markers">
      {#each inlineAIMarkers as marker (marker.id)}
        <button
          type="button"
          class:unread={marker.unread}
          class="inline-ai-scroll-marker"
          style={`top: ${marker.top}%`}
          onclick={() => jumpToInlineAIThread(marker.id)}
          title="Jump to AI response"
          aria-label="Jump to AI response"
        ></button>
      {/each}
    </div>
  {/if}

  {#each inlineAIComposers as composer (composer.id)}
    {@const position = inlineAIComposerPositions[composer.id]}
    {#if position?.visible}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <div
        class:active={composer.isActive}
        class="floating-inline-ai-composer"
        data-inline-ai-composer={composer.id}
        style={`top: ${position.top}px; left: ${position.left}px; max-width: ${position.maxWidth}px;`}
        onpointerdown={stopComposerEvent}
        onmousedown={stopComposerEvent}
        onclick={stopComposerEvent}
      >
        {#if composer.isActive}
          <div class="floating-inline-ai-composer-shell">
            <Sparkles size={15} strokeWidth={2} aria-hidden="true" />
            <input
              name={`inline-ai-composer-${composer.id}`}
              type="text"
              aria-label="Describe what AI should do with this text"
              placeholder="Describe what to do with this text..."
              autocomplete="off"
              spellcheck="false"
              value={composer.draftPrompt}
              oninput={(event) => handleComposerInput(composer, event)}
              onkeydown={(event) => handleComposerKeyDown(event, composer)}
              oncopy={stopComposerEvent}
              oncut={stopComposerEvent}
              onpaste={stopComposerEvent}
            />
            <button
              type="button"
              class="floating-inline-ai-send"
              disabled={!composer.draftPrompt.trim()}
              onclick={() => submitComposer(composer)}
              title="Send"
              aria-label="Send inline AI request"
            >
              <Send size={14} strokeWidth={2} aria-hidden="true" />
              <span>Send</span>
            </button>
            <button
              type="button"
              class="floating-inline-ai-close"
              onclick={() => cancelComposer(composer.id)}
              title="Close"
              aria-label="Close inline AI composer"
            >
              <X size={14} strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
        {:else}
          <button
            type="button"
            class="floating-inline-ai-composer-chip"
            onclick={() => focusComposer(composer.id)}
            title="Continue inline Ask"
            aria-label="Open inline AI composer"
          >
            <Sparkles size={14} strokeWidth={2} aria-hidden="true" />
            <span>Ask</span>
          </button>
        {/if}
      </div>
    {/if}
  {/each}

  <EditorToolbar
    editorElement={editorContainer}
    onAction={handleToolbarAction}
    onAIPrompt={handleAIPrompt}
    aiUnavailable={!aiStore.canStartAIWork}
    aiUnavailableMessage={aiStore.availabilityMessage ?? AI_UNAVAILABLE_MESSAGE}
    onAIUnavailable={showAIUnavailableMessage}
  />

  <SlashMenu
    menuState={slashMenuState}
    onSelect={handleSlashMenuSelect}
    onClose={handleSlashMenuClose}
    aiUnavailable={!aiStore.canStartAIWork}
    aiUnavailableMessage={aiStore.availabilityMessage ?? AI_UNAVAILABLE_MESSAGE}
    onAIUnavailable={showAIUnavailableMessage}
  />

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

  .inline-ai-jump-pill {
    position: absolute;
    top: 52px;
    right: 22px;
    z-index: 36;
    display: inline-flex;
    align-items: center;
    gap: 7px;
    min-height: 30px;
    padding: 5px 8px 5px 10px;
    border: 1px solid color-mix(in srgb, var(--accent-primary) 42%, var(--border-light));
    border-radius: var(--radius-full);
    background: var(--bg-card);
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-caption);
    font-weight: 650;
    box-shadow: var(--shadow-md);
    cursor: pointer;
    transition:
      background var(--transition-fast),
      border-color var(--transition-fast),
      transform var(--transition-fast);
  }

  .inline-ai-jump-pill strong {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    border-radius: var(--radius-full);
    background: var(--accent-primary);
    color: var(--text-inverse);
    font-size: 11px;
    line-height: 1;
  }

  .inline-ai-jump-pill:hover,
  .inline-ai-jump-pill:focus-visible {
    background: var(--bg-hover);
    border-color: var(--accent-primary);
    outline: none;
  }

  .inline-ai-jump-pill:active {
    transform: translateY(1px);
  }

  .inline-ai-composer-jump-pill {
    position: absolute;
    top: 52px;
    right: 22px;
    z-index: 36;
    display: inline-flex;
    align-items: center;
    gap: 7px;
    min-height: 30px;
    padding: 5px 8px 5px 10px;
    border: 1px solid color-mix(in srgb, var(--accent-primary) 32%, var(--border-light));
    border-radius: var(--radius-full);
    background: var(--bg-card);
    color: var(--accent-primary);
    font: inherit;
    font-size: var(--text-caption);
    font-weight: 650;
    box-shadow: var(--shadow-md);
    cursor: pointer;
  }

  .inline-ai-composer-jump-pill.has-response-pill {
    top: 88px;
  }

  .inline-ai-composer-jump-pill strong {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    border-radius: var(--radius-full);
    background: color-mix(in srgb, var(--accent-primary) 12%, transparent);
    color: var(--accent-primary);
    font-size: 11px;
    line-height: 1;
  }

  .inline-ai-composer-jump-pill:hover,
  .inline-ai-composer-jump-pill:focus-visible {
    background: var(--bg-hover);
    border-color: var(--accent-primary);
    outline: none;
  }

  .inline-ai-scroll-markers {
    position: absolute;
    top: 72px;
    right: 7px;
    bottom: 72px;
    z-index: 34;
    width: 10px;
    pointer-events: none;
  }

  .inline-ai-scroll-marker {
    position: absolute;
    right: 0;
    width: 8px;
    height: 20px;
    padding: 0;
    border: 0;
    border-radius: var(--radius-full);
    background: var(--border-medium);
    cursor: pointer;
    pointer-events: auto;
    transition:
      background var(--transition-fast),
      transform var(--transition-fast),
      width var(--transition-fast);
  }

  .inline-ai-scroll-marker.unread {
    width: 10px;
    background: var(--accent-primary);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent-primary) 18%, transparent);
  }

  .inline-ai-scroll-marker:hover,
  .inline-ai-scroll-marker:focus-visible {
    width: 12px;
    background: var(--accent-primary);
    outline: none;
  }

  .floating-inline-ai-composer {
    position: fixed;
    z-index: 48;
    pointer-events: auto;
  }

  .floating-inline-ai-composer-shell {
    display: flex;
    align-items: center;
    gap: 7px;
    width: min(520px, calc(100vw - 32px));
    max-width: inherit;
    min-height: 38px;
    padding: 4px 5px 4px 10px;
    border: 1px solid color-mix(in srgb, var(--accent-primary) 32%, var(--border-light));
    border-radius: var(--radius-md);
    background: var(--bg-card);
    color: var(--accent-primary);
    box-shadow: 0 10px 28px rgba(15, 23, 42, 0.12);
  }

  .floating-inline-ai-composer-shell input {
    flex: 1;
    min-width: 0;
    height: 30px;
    padding: 0 4px;
    border: 0;
    background: transparent;
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-small);
    outline: none;
  }

  .floating-inline-ai-composer-shell input::placeholder {
    color: var(--text-tertiary);
  }

  .floating-inline-ai-send,
  .floating-inline-ai-close,
  .floating-inline-ai-composer-chip {
    border: 0;
    font: inherit;
    cursor: pointer;
  }

  .floating-inline-ai-send {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    min-height: 30px;
    padding: 0 9px 0 7px;
    border-radius: var(--radius-sm);
    background: var(--accent-primary);
    color: var(--text-inverse);
    font-size: var(--text-caption);
    font-weight: 650;
  }

  .floating-inline-ai-send:disabled {
    cursor: default;
    opacity: 0.45;
  }

  .floating-inline-ai-send:not(:disabled):hover,
  .floating-inline-ai-send:not(:disabled):focus-visible {
    background: color-mix(in srgb, var(--accent-primary) 86%, black);
    outline: none;
  }

  .floating-inline-ai-close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    padding: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-tertiary);
  }

  .floating-inline-ai-close:hover,
  .floating-inline-ai-close:focus-visible {
    background: var(--bg-hover);
    color: var(--text-primary);
    outline: none;
  }

  .floating-inline-ai-composer-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 30px;
    padding: 4px 10px 4px 8px;
    border: 1px solid color-mix(in srgb, var(--accent-primary) 28%, var(--border-light));
    border-radius: var(--radius-full);
    background: var(--bg-card);
    color: var(--accent-primary);
    font-size: var(--text-caption);
    font-weight: 650;
    box-shadow: var(--shadow-sm);
  }

  .floating-inline-ai-composer-chip:hover,
  .floating-inline-ai-composer-chip:focus-visible {
    border-color: var(--accent-primary);
    background: var(--bg-hover);
    outline: none;
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
