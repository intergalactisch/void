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
    protectionStore,
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
  import type { AIContextAuthorization, AIContextAuthorizationScope } from '$lib/domain/values/Protection';
  import {
    createAISelectionResource,
    isAISelectionResource,
  } from '$lib/domain/values/Protection';
  import { EMPTY_SELECTION, normalizeNoteTag } from '$lib/domain/values';
  import { events } from '$lib/events';
  import { buildRefId } from '$lib/domain/values';
  import { AI_UNAVAILABLE_MESSAGE } from '$lib/domain/values/AIAvailability';
  import { copyTextToClipboard } from '$lib/utils/clipboard';
  import type { SlashMenuState } from '$lib/adapters/prosemirror/plugins/slashMenu';
  import type { PageLinkNote, PageLinkState } from '$lib/adapters/prosemirror/plugins/pageLink';
  import { SlashMenu, BlockMenu, EditorToolbar, PageLinkPopup, FindReplaceBar, RelationsPanel, LineageHistoryWorkspace, BranchPicker, SessionRibbon } from '$lib/components/editor';
  import InlineAIComposer from './InlineAIComposer.svelte';
  import type { BlockMenuAction } from '$lib/components/editor/BlockMenu.svelte';
  import type { EditorInlineAIComposerView, RegisteredCommand } from '$lib/ports/outbound';
  import type { BlockType } from '$lib/domain/values/BlockType';
  import { CheckCircle2, KeyRound, LocateFixed, Lock, MessageSquare, Plus, Shield, ShieldOff, Sparkles, Unlock, X } from '@lucide/svelte';

  const LEGACY_EDITOR_PANE_ID = '__legacy__';

  interface Props {
    document: Document;
    paneId?: string;
    activateOnMount?: boolean;
    onSaveStatusChange?: (status: 'saved' | 'saving' | 'unsaved') => void;
    onCountsChange?: (wordCount: number, charCount: number) => void;
    onError?: (error: string | null) => void;
    onTitleRename?: (newTitle: string, path?: string) => void;
    editorStyle?: string;
  }

  let {
    document: doc,
    paneId,
    activateOnMount = false,
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
  let recoveredEmptyHost = false;
  let mountRunId = 0;
  let destroyed = false;
  let mountedHost: HTMLDivElement | null = null;
  let mountedPaneId = LEGACY_EDITOR_PANE_ID;
  let countTimeout: ReturnType<typeof setTimeout> | null = null;
  let wordCount = $state(0);
  let charCount = $state(0);
  let tagInputOpen = $state(false);
  let tagDraft = $state('');
  let tagInputElement: HTMLInputElement | undefined = $state(undefined);
  let titleEditing = $state(false);
  let titleEditOriginal: string | null = null;
  let titleEditPath: string | null = null;
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
  let aiApprovalOpen = $state(false);
  let grantingAIApproval = $state(false);
  let pendingInlineApprovalComposerId: string | null = $state(null);
  let grantingInlineAIApproval = $state(false);
  const inlineAIComposerDrafts = new Map<string, string>();

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

  const paneState = $derived.by(() => paneId ? editorStore.getPaneState(paneId) : null);
  const shellIsActive = $derived(!paneId || editorStore.activePaneId === paneId);
  const currentPaneDocument = $derived(paneState?.document ?? doc);
  const saveStatus = $derived.by(() =>
    paneId
      ? paneState?.isSaving
        ? 'saving'
        : paneState?.isDirty
          ? 'unsaved'
          : 'saved'
      : editorStore.isSaving ? 'saving' : editorStore.isDirty ? 'unsaved' : 'saved'
  );

  const noteTags = $derived(currentPaneDocument.meta.tags ?? doc.meta.tags);
  const protection = $derived(currentPaneDocument.meta.protection ?? doc.meta.protection ?? null);
  const isProtected = $derived(protection?.level === 'protected');
  const isLocked = $derived(protection?.lockState === 'locked');
  const activeSelection = $derived.by(() =>
    shellIsActive
      ? paneState?.selection ?? editorStore.selection
      : EMPTY_SELECTION
  );
  const hasTextSelection = $derived(
    activeSelection.from !== activeSelection.to
      && activeSelection.text.trim().length > 0,
  );
  const selectionOverlapsProtectedLines = $derived(
    shellIsActive
      && activeSelection.from !== activeSelection.to
      && editorStore.rangeIntersectsProtectedBlock(activeSelection.from, activeSelection.to),
  );
  const canProtectTextSelection = $derived(
    hasTextSelection && !selectionOverlapsProtectedLines,
  );
  const noteLevelAIAuthorization = $derived.by(() => {
    if (!protection || protection.level !== 'protected') return null;
    const active = protectionStore.authorizations
      .filter((authorization) =>
        authorization.noteIds.includes(protection.noteId) &&
        (
          authorization.resources.length === 0 ||
          authorization.resources.some((resource) => !isAISelectionResource(resource))
        )
      )
      .sort((a, b) => new Date(b.expiresAt).getTime() - new Date(a.expiresAt).getTime());
    return active[0] ?? null;
  });
  const aiAccessSummary = $derived.by(() =>
    noteLevelAIAuthorization
      ? `AI approved · ${formatAuthorizationScopes(noteLevelAIAuthorization.scopes)} · ${formatAuthorizationTimeLeft(noteLevelAIAuthorization)}`
      : 'AI blocked'
  );
  const aiActiveBlockId = $derived(shellIsActive ? editorStore.aiActiveBlockId : null);
  const inlineAIComposers = $derived(shellIsActive ? editorStore.aiInlineComposers : []);
  const offscreenInlineAIComposers = $derived.by(() =>
    inlineAIComposers.filter((composer) => {
      const position = inlineAIComposerPositions[composer.id];
      return position && !position.visible;
    })
  );

  function updateCounts() {
    const text = editorStore.getTextContent(paneId);
    charCount = text.length;
    wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
    onCountsChange?.(wordCount, charCount);
  }

  function scheduleCountUpdate() {
    if (countTimeout) clearTimeout(countTimeout);
    countTimeout = setTimeout(updateCounts, 150);
  }

  function nextFrame(): Promise<void> {
    if (typeof requestAnimationFrame !== 'function') {
      return new Promise((resolve) => setTimeout(resolve, 0));
    }
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
  }

  function mountIsCurrent(runId: number): boolean {
    return !destroyed && runId === mountRunId;
  }

  function mountKeyFor(document: Document): string {
    const documentId = document.meta.id || document.path;
    const lockState = document.meta.protection?.lockState ?? 'normal';
    return `${paneId ?? LEGACY_EDITOR_PANE_ID}:${document.path}:${documentId}:${lockState}`;
  }

  async function waitForEditorContainer(runId: number): Promise<HTMLDivElement | null> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await tick();
      if (!mountIsCurrent(runId)) return null;
      if (editorContainer?.isConnected) return editorContainer;
      await nextFrame();
      if (!mountIsCurrent(runId)) return null;
      if (editorContainer?.isConnected) return editorContainer;
    }
    return null;
  }

  async function mountEditor(document: Document) {
    const runId = ++mountRunId;
    const currentPaneId = paneId ?? LEGACY_EDITOR_PANE_ID;
    const paneMode = currentPaneId !== LEGACY_EDITOR_PANE_ID;
    mountedPaneId = currentPaneId;
    mountedHost = null;
    if (document.meta.protection?.lockState === 'locked') {
      onCountsChange?.(0, 0);
      return;
    }

    const container = await waitForEditorContainer(runId);
    if (!container || !mountIsCurrent(runId)) return;

    const autoSaveDelay = settingsStore.settings?.autoSaveDelay ?? 1000;
    const result = paneMode
      ? await editorStore.mountPane(currentPaneId, container, document.path, document, autoSaveDelay)
      : await editorStore.mount(container, document, autoSaveDelay);

    if (!mountIsCurrent(runId) || editorContainer !== container || !container.isConnected) {
      editorStore.unmountPane(currentPaneId, container);
      return;
    }

    if (!result.ok) {
      onError?.(result.error.message);
      return;
    }

    mountedHost = container;
    onError?.(null);
    updateCounts();
    if (paneMode && activateOnMount) {
      editorStore.focusPane(currentPaneId);
      requestAnimationFrame(() => editorStore.focusPane(currentPaneId));
    }
    requestAnimationFrame(() => {
      if (!mountIsCurrent(runId) || recoveredEmptyHost || !editorContainer?.isConnected || editorContainer.childElementCount > 0) return;
      recoveredEmptyHost = true;
      void (paneMode
        ? editorStore.mountPane(currentPaneId, editorContainer, document.path, document, autoSaveDelay)
        : editorStore.mount(editorContainer, document, autoSaveDelay));
    });
    if (shellIsActive) aiStore.setActiveDocument(document);
    if (!paneMode || editorStore.activePaneId === currentPaneId) {
      requestAnimationFrame(() => editorStore.focus());
    }
  }

  function focusShellPane() {
    if (paneId) editorStore.focusPane(paneId);
  }

  function handleBlockMenuAction(action: BlockMenuAction) {
    const menuContext = {
      blockId: blockMenuState.blockId,
      lineIndex: blockMenuState.lineIndex,
      position: blockMenuState.position,
      currentType: blockMenuState.currentType,
    };

    editorStore.clearBlockMenuRequest();
    focusShellPane();

    switch (action.type) {
      case 'turnInto':
        editorStore.selectBlock(menuContext.blockId);
        editorStore.setBlockType(action.blockType);
        break;
      case 'inspectLineage':
        events.emit('editor:lineage-inspect-request', {
          blockId: menuContext.blockId,
          lineIndex: menuContext.lineIndex,
          position: menuContext.position,
          currentType: menuContext.currentType,
        });
        return;
      case 'duplicate':
        editorStore.duplicateBlock(menuContext.blockId);
        break;
      case 'copyLink':
        copyBlockRef(menuContext.blockId);
        break;
      case 'delete':
        editorStore.deleteBlock(menuContext.blockId);
        toastStore.info('Block deleted. Press Cmd+Z to undo');
        break;
    }

    editorStore.focus();
  }

  async function copyBlockRef(blockId: string) {
    focusShellPane();
    const notePath = (paneId ? currentPaneDocument.path : editorStore.activePath) ?? editorStore.document?.path ?? doc.path;
    const success = await copyTextToClipboard(buildRefId({ kind: 'block', notePath, blockId }));
    if (success) toastStore.info('Ref copied');
    else toastStore.error('Failed to copy ref');
  }

  function handleBlockMenuClose() {
    editorStore.clearBlockMenuRequest();
    focusShellPane();
    editorStore.focus();
  }

  function handleAIPrompt(text: string, range: Range) {
    focusShellPane();
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

  function getInlineAIComposerDraft(composer: EditorInlineAIComposerView): string {
    return inlineAIComposerDrafts.get(composer.id) ?? composer.draftPrompt;
  }

  function rememberInlineAIComposerDraft(composerId: string, value: string) {
    inlineAIComposerDrafts.set(composerId, value);
  }

  function pruneInlineAIComposerDrafts(composers: EditorInlineAIComposerView[]) {
    const activeIds = new Set(composers.map((composer) => composer.id));
    for (const composerId of inlineAIComposerDrafts.keys()) {
      if (!activeIds.has(composerId)) inlineAIComposerDrafts.delete(composerId);
    }
  }

  async function submitComposer(composer: EditorInlineAIComposerView, draftPrompt = getInlineAIComposerDraft(composer)) {
    const prompt = draftPrompt.trim();
    if (!prompt) return;
    if (!(await ensureInlineAIApproval(composer))) return;
    focusedComposerInputId = null;
    inlineAIComposerDrafts.delete(composer.id);
    editorStore.submitAIInlineComposer(composer.id, prompt);
    requestAnimationFrame(refreshInlineAIComposerPositions);
  }

  function cancelComposer(composerId: string) {
    focusedComposerInputId = null;
    inlineAIComposerDrafts.delete(composerId);
    editorStore.cancelAIInlineComposer(composerId);
    requestAnimationFrame(refreshInlineAIComposerPositions);
  }

  async function focusComposer(composerId: string) {
    const composer = inlineAIComposers.find((candidate) => candidate.id === composerId);
    if (composer && !(await ensureInlineAIApproval(composer))) return;
    editorStore.focusAIInlineComposer(composerId);
    void focusInlineAIComposerInput(composerId);
  }

  function stopComposerEvent(event: Event) {
    event.stopPropagation();
  }

  function showAIUnavailableMessage() {
    aiStore.ensureAIAvailable();
    toastStore.info(aiStore.availabilityMessage ?? AI_UNAVAILABLE_MESSAGE);
  }

  async function reloadDocument() {
    await editorStore.reloadDocument(doc.path, { flushDirty: true });
  }

  async function handleProtectNote() {
    if (editorStore.activePath === doc.path && editorStore.isDirty) {
      const saved = await editorStore.saveDocument();
      if (!saved.ok) {
        toastStore.error(saved.error.message);
        return;
      }
    }
    const result = await protectionStore.protectNote(doc.path);
    if (!result) {
      toastStore.error(protectionStore.error?.message ?? 'Could not protect note');
      return;
    }
    toastStore.success('Note protected');
    await reloadDocument();
  }

  async function handleUnlockNote() {
    const unlocked = await protectionStore.unlockWithRecoveryPrompt();
    if (!unlocked) {
      toastStore.error(protectionStore.error?.message ?? 'Could not unlock protected notes');
      return;
    }
    toastStore.success('Protected notes unlocked');
    await reloadDocument();
  }

  async function handleLockNotes() {
    const prepared = await editorStore.prepareProtectedDocumentsForLock();
    if (!prepared.ok) {
      toastStore.error(prepared.error.message);
      return;
    }
    const locked = await protectionStore.lock();
    if (!locked) {
      toastStore.error(protectionStore.error?.message ?? 'Could not lock protected notes');
      return;
    }
    toastStore.info('Protected notes locked');
    const reloaded = await editorStore.reloadProtectedDocuments({ flushDirty: false });
    if (!reloaded.ok) {
      toastStore.error(reloaded.error.message);
    }
  }

  async function handleUnprotectNote() {
    const confirmed = typeof window === 'undefined' || window.confirm(
      'Remove protection from this note?\n\nThis will decrypt the note and save it as normal markdown on disk.'
    );
    if (!confirmed) return;

    const unprotected = await protectionStore.unprotectNote(doc.path);
    if (!unprotected) {
      toastStore.error(protectionStore.error?.message ?? 'Could not remove protection');
      return;
    }
    toastStore.success('Protection removed');
    await reloadDocument();
  }

  async function protectSelectedRange(text: string, from: number, to: number) {
    const selectedText = text.trim() ? text : editorStore.getTextBetween(from, to);
    if (!selectedText.trim() || from === to) {
      toastStore.info('Highlight one or more lines first');
      return;
    }
    if (editorStore.rangeIntersectsProtectedBlock(from, to)) {
      toastStore.info('Selected lines are already protected');
      return;
    }
    let capsule = await protectionStore.protectBlock(
      selectedText,
      countSelectedLines(selectedText),
    );
    if (!capsule && /locked|workspace protection key|recovery passphrase/i.test(protectionStore.error?.message ?? '')) {
      const unlocked = await protectionStore.unlockWithRecoveryPrompt();
      if (unlocked) {
        capsule = await protectionStore.protectBlock(
          selectedText,
          countSelectedLines(selectedText),
        );
      }
    }
    if (!capsule) {
      toastStore.error(protectionStore.error?.message ?? 'Could not protect selected lines');
      return;
    }
    editorStore.replaceRange(from, to, capsule);
    const saved = await editorStore.saveDocument();
    if (!saved.ok) {
      toastStore.error(saved.error.message);
      return;
    }
    toastStore.success('Selected lines protected');
  }

  async function handleProtectSelectedLines() {
    focusShellPane();
    const selection = editorStore.getSelection();
    await protectSelectedRange(selection.text, selection.from, selection.to);
  }

  async function handleProtectToolbarSelection(text: string, range: Range) {
    focusShellPane();
    const resolved = editorStore.resolveSelectionFromDOM(range);
    if (!resolved) {
      toastStore.info('Highlight text inside the note first');
      return;
    }
    const selectedText = editorStore.getTextBetween(resolved.from, resolved.to) || text;
    await protectSelectedRange(selectedText, resolved.from, resolved.to);
  }

  function countSelectedLines(text: string): number {
    const trimmed = text.replace(/\n+$/, '');
    return Math.max(1, trimmed ? trimmed.split(/\r?\n/).length : 1);
  }

  async function handleGrantNoteAIAccess(scopes: AIContextAuthorizationScope[] = ['note.read', 'note.write']) {
    const noteProtection = protection;
    if (!noteProtection) return;
    grantingAIApproval = true;
    const authorization = await protectionStore.authorizeContext(noteProtection, doc.path, {
      scopes,
      durationMinutes: 30,
      reason: 'Approved from protected note editor',
    });
    grantingAIApproval = false;
    if (!authorization) {
      toastStore.error(protectionStore.error?.message ?? 'Could not authorize AI access');
      return;
    }
    aiApprovalOpen = false;
    toastStore.info('AI access granted for this note');
  }

  function handleRevokeAI() {
    if (!noteLevelAIAuthorization) return;
    protectionStore.revokeContext(noteLevelAIAuthorization.id);
    aiApprovalOpen = false;
    toastStore.info('AI access revoked for this note');
  }

  function inlineSelectionResource(composer: EditorInlineAIComposerView): string {
    return createAISelectionResource({
      notePath: doc.path,
      from: composer.from,
      to: composer.to,
      selectedText: composer.selectionText,
    });
  }

  function hasInlineAIApproval(composer: EditorInlineAIComposerView): boolean {
    if (!protection || protection.level !== 'protected') return true;
    if (protection.lockState === 'locked') return false;
    const resource = inlineSelectionResource(composer);
    return protectionStore.hasAuthorization(protection.noteId, 'selection.read', resource)
      && protectionStore.hasAuthorization(protection.noteId, 'note.write', resource);
  }

  async function ensureInlineAIApproval(composer: EditorInlineAIComposerView): Promise<boolean> {
    if (hasInlineAIApproval(composer)) {
      pendingInlineApprovalComposerId = null;
      return true;
    }
    pendingInlineApprovalComposerId = composer.id;
    requestAnimationFrame(refreshInlineAIComposerPositions);
    return false;
  }

  async function grantInlineAIApproval(composer: EditorInlineAIComposerView) {
    const noteProtection = protection;
    if (!noteProtection || noteProtection.level !== 'protected') return;
    if (noteProtection.lockState === 'locked') {
      toastStore.error('Unlock the vault first');
      return;
    }

    grantingInlineAIApproval = true;
    const authorization = await protectionStore.authorizeContext(noteProtection, doc.path, {
      scopes: ['selection.read', 'note.write'],
      resources: [inlineSelectionResource(composer)],
      durationMinutes: 15,
      reason: 'Approved inline Ask for highlighted text',
    });
    grantingInlineAIApproval = false;
    if (!authorization) {
      toastStore.error(protectionStore.error?.message ?? 'Could not grant AI access');
      return;
    }
    pendingInlineApprovalComposerId = null;
    editorStore.focusAIInlineComposer(composer.id);
    void focusInlineAIComposerInput(composer.id);
    toastStore.info('AI access granted for this highlighted text');
  }

  function cancelInlineAIApproval(composerId: string) {
    if (pendingInlineApprovalComposerId === composerId) {
      pendingInlineApprovalComposerId = null;
    }
  }

  function formatAuthorizationScopes(scopes: AIContextAuthorizationScope[]): string {
    const labels: string[] = [];
    if (scopes.includes('selection.read')) labels.push('Selected text');
    if (scopes.includes('note.read')) labels.push('This note');
    if (scopes.includes('related.read')) labels.push('Related notes');
    if (scopes.includes('history.read')) labels.push('History');
    if (scopes.includes('note.write')) labels.push('Edit proposals');
    if (labels.length === 0) return 'Custom access';
    if (labels.length === 2 && labels[1] === 'Edit proposals') {
      return `${labels[0]} + edit proposals`;
    }
    return labels.join(' + ');
  }

  function formatAuthorizationTimeLeft(authorization: AIContextAuthorization): string {
    const remainingMs = new Date(authorization.expiresAt).getTime() - Date.now();
    if (remainingMs <= 0) return 'expired';
    const remainingMinutes = Math.max(1, Math.ceil(remainingMs / 60_000));
    if (remainingMinutes >= 60) {
      const hours = Math.floor(remainingMinutes / 60);
      const minutes = remainingMinutes % 60;
      return minutes ? `${hours}h ${minutes}m left` : `${hours}h left`;
    }
    return `${remainingMinutes}m left`;
  }

  function handleToolbarAction(action: string, value?: string) {
    focusShellPane();
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
    focusShellPane();
    editorStore.executeSlashMenuCommand(command);
  }

  function handleSlashMenuClose() {
    editorStore.closeSlashMenu();
  }

  function handlePageLinkSelect(note: PageLinkNote) {
    focusShellPane();
    editorStore.selectPageLink(note);
    editorStore.focus();
  }

  function handlePageLinkClose() {
    focusShellPane();
    editorStore.closePageLinkMenu();
    editorStore.focus();
  }

  function handlePageLinkQueryChange(query: string) {
    focusShellPane();
    editorStore.updatePageLinkQuery(query);
  }

  function handlePageLinkNavigate(direction: 'next' | 'prev') {
    focusShellPane();
    editorStore.movePageLinkSelection(direction);
  }

  function currentTitle(): string {
    return currentPaneDocument.meta.title ?? doc.meta.title;
  }

  function titleDraft(): string {
    return titleElement?.textContent?.trim() ?? '';
  }

  function syncTitleElement(title: string, path: string | null, force = false): void {
    if (!titleElement) return;
    if (!force && titleEditing && titleEditPath === path) return;
    if (titleElement.textContent !== title) {
      titleElement.textContent = title;
    }
  }

  function commitTitleDraft(newTitle: string): boolean {
    const trimmed = newTitle.trim();
    if (!trimmed) return false;
    if (trimmed === currentTitle()) return true;
    focusShellPane();
    onTitleRename?.(trimmed, currentPaneDocument.path ?? doc.path);
    return true;
  }

  function handleTitleFocus() {
    if (isLocked) return;
    titleEditing = true;
    titleEditPath = currentPaneDocument.path ?? doc.path;
    titleEditOriginal = currentTitle();
  }

  function handleTitleInput() {
    if (isLocked) return;
    commitTitleDraft(titleDraft());
  }

  function handleTitleBlur() {
    if (isLocked) return;
    if (!titleElement) return;
    const newTitle = titleDraft();
    if (!newTitle) {
      titleElement.textContent = currentTitle();
    } else {
      commitTitleDraft(newTitle);
    }
    titleEditing = false;
    titleEditPath = null;
    titleEditOriginal = null;
    syncTitleElement(currentTitle(), currentPaneDocument.path ?? doc.path, true);
  }

  function handleTitleKeyDown(e: KeyboardEvent) {
    if (isLocked) return;
    if (e.key === 'Enter' || e.key === 'ArrowDown') {
      e.preventDefault();
      titleElement?.blur();
      focusShellPane();
      editorStore.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      const restoreTitle = titleEditOriginal ?? currentTitle();
      titleEditing = false;
      titleEditPath = null;
      if (titleElement) {
        titleElement.textContent = restoreTitle;
      }
      commitTitleDraft(restoreTitle);
      titleEditOriginal = null;
      titleElement?.blur();
      focusShellPane();
      editorStore.focus();
    }
  }

  function openTagInput() {
    if (isLocked) return;
    focusShellPane();
    tagInputOpen = true;
    requestAnimationFrame(() => tagInputElement?.focus());
  }

  function closeTagInput() {
    tagDraft = '';
    tagInputOpen = false;
  }

  function addTag() {
    focusShellPane();
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
    if (isLocked) return;
    focusShellPane();
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
      focusShellPane();
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
    const blockId = aiActiveBlockId;
    if (!blockId) return;
    markProgrammaticAIFollow();
    editorStore.scrollBlockIntoView(blockId, mode);
  }

  function pauseAIFollow() {
    if (!aiActiveBlockId || aiFollowProgrammatic) return;
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

  async function handleEditorClick(event: MouseEvent) {
    handleEditorUserIntent(event);
    const target = event.target as HTMLElement | null;
    if (!target?.closest('.void-protected-lines-locked')) return;
    event.preventDefault();
    event.stopPropagation();
    await handleUnlockNote();
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
    if (!shellIsActive) return;
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
    if (paneId) await editorStore.savePane(paneId);
    else await editorStore.saveDocument();
  }

  export function getCurrentDocument(): Document | null {
    return paneId ? currentPaneDocument : editorStore.document;
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
    const docKey = mountKeyFor(doc);
    if (doc.meta.protection?.lockState === 'locked') {
      mountRunId += 1;
      previousDocId = docKey;
      onCountsChange?.(0, 0);
      return;
    }
    if (docKey !== previousDocId && editorContainer?.isConnected) {
      previousDocId = docKey;
      recoveredEmptyHost = false;
      mountEditor(doc);
    }
  });

  $effect(() => {
    onSaveStatusChange?.(saveStatus);
  });

  $effect(() => {
    const document = currentPaneDocument;
    if (document && shellIsActive) {
      aiStore.setActiveDocument(document);
    }
    if (document) {
      scheduleCountUpdate();
    }
  });

  $effect(() => {
    const title = currentPaneDocument.meta.title ?? doc.meta.title;
    const path = currentPaneDocument.path ?? doc.path;
    if (titleEditing && titleEditPath !== null && path !== titleEditPath) {
      titleEditing = false;
      titleEditPath = null;
      titleEditOriginal = null;
    }
    if (isLocked && titleEditing) {
      titleEditing = false;
      titleEditPath = null;
      titleEditOriginal = null;
    }
    syncTitleElement(title, path, path !== titleEditPath || isLocked);
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
    if (shellIsActive && isReady) {
      editorStore.setInlineAIThreads(threads);
    }
    requestAnimationFrame(() => {
      setupInlineAIObserver();
      refreshInlineAIMarkers();
    });
  });

  $effect(() => {
    const composers = inlineAIComposers;
    const activeComposerId = shellIsActive ? editorStore.activeAIInlineComposerId : null;
    if (!shellIsActive || !editorStore.isReady) {
      inlineAIComposerPositions = {};
      return;
    }

    pruneInlineAIComposerDrafts(composers);
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
    mountedPaneId = paneId ?? LEGACY_EDITOR_PANE_ID;
    window.addEventListener('resize', refreshInlineAIComposerPositions);
    window.addEventListener('void:inline-ai-thread-action', handleInlineAIAction);
    void tick().then(() => {
      if (destroyed || doc.meta.protection?.lockState === 'locked' || !editorContainer?.isConnected) return;
      const docKey = mountKeyFor(doc);
      if (docKey === previousDocId) return;
      previousDocId = docKey;
      recoveredEmptyHost = false;
      void mountEditor(doc);
    });
    return () => {
      window.removeEventListener('resize', refreshInlineAIComposerPositions);
      window.removeEventListener('void:inline-ai-thread-action', handleInlineAIAction);
    };
  });

  onDestroy(() => {
    destroyed = true;
    mountRunId += 1;
    editorStore.unmountPane(mountedPaneId, mountedHost ?? editorContainer ?? null);
    if (countTimeout) clearTimeout(countTimeout);
    if (aiFollowClearTimer) clearTimeout(aiFollowClearTimer);
    inlineAIObserver?.disconnect();
  });
</script>

<div class="editor-shell-wrap" class:pane-mode={paneId}>
<div class="editor-area">
  {#if shellIsActive}
    <FindReplaceBar />
  {/if}
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
          contenteditable={!isLocked}
          spellcheck="false"
          onfocus={handleTitleFocus}
          oninput={handleTitleInput}
          onblur={handleTitleBlur}
          onkeydown={handleTitleKeyDown}
          role="textbox"
          aria-label="Note title"
        ></h1>

        <div class="protection-bar" class:protected={isProtected} class:locked={isLocked}>
          {#if isProtected}
            <span class="protection-state">
              {#if isLocked}
                <Lock size={14} strokeWidth={2} aria-hidden="true" />
                <span>Locked</span>
              {:else}
                <Unlock size={14} strokeWidth={2} aria-hidden="true" />
                <span>Unlocked for this session</span>
              {/if}
            </span>
            {#if isLocked}
              <button type="button" class="protection-action" onclick={handleUnlockNote}>
                <KeyRound size={14} strokeWidth={2} aria-hidden="true" />
                <span>Unlock to edit</span>
              </button>
            {:else}
              <div class="protection-ai-control">
                <span class="protection-state ai-state" class:approved={Boolean(noteLevelAIAuthorization)}>
                  {#if noteLevelAIAuthorization}
                    <CheckCircle2 size={14} strokeWidth={2} aria-hidden="true" />
                  {:else}
                    <Sparkles size={14} strokeWidth={2} aria-hidden="true" />
                  {/if}
                  <span>{aiAccessSummary}</span>
                </span>
                <button
                  type="button"
                  class="protection-action"
                  onclick={() => { aiApprovalOpen = !aiApprovalOpen; }}
                  aria-expanded={aiApprovalOpen}
                >
                  <Sparkles size={14} strokeWidth={2} aria-hidden="true" />
                  <span>{noteLevelAIAuthorization ? 'Change' : 'Grant AI access'}</span>
                </button>
                {#if noteLevelAIAuthorization}
                  <button type="button" class="protection-action subtle" onclick={handleRevokeAI}>
                    <X size={14} strokeWidth={2} aria-hidden="true" />
                    <span>Revoke</span>
                  </button>
                {/if}
                {#if aiApprovalOpen}
                  <div class="protection-ai-popover" role="dialog" aria-label="Protected note AI access">
                    <strong>Grant AI access</strong>
                    <p>Allows AI to read this protected note and propose edits for 30 minutes.</p>
                    <div class="protection-ai-popover-actions">
                      <button
                        type="button"
                        class="protection-action"
                        onclick={() => handleGrantNoteAIAccess(['note.read', 'note.write'])}
                        disabled={grantingAIApproval}
                      >
                        <Sparkles size={14} strokeWidth={2} aria-hidden="true" />
                        <span>{grantingAIApproval ? 'Granting' : 'This note + edits'}</span>
                      </button>
                      <button
                        type="button"
                        class="protection-action subtle"
                        onclick={() => handleGrantNoteAIAccess(['note.read'])}
                        disabled={grantingAIApproval}
                      >
                        <span>This note only</span>
                      </button>
                    </div>
                  </div>
                {/if}
              </div>
              {#if canProtectTextSelection}
                <button type="button" class="protection-action subtle" onclick={handleProtectSelectedLines}>
                  <Lock size={14} strokeWidth={2} aria-hidden="true" />
                  <span>Protect selected lines</span>
                </button>
              {/if}
              <button type="button" class="protection-action lock-action" onclick={handleLockNotes} title="Lock protected notes" aria-label="Lock protected notes">
                <Lock size={14} strokeWidth={2} aria-hidden="true" />
                <span>Lock vault</span>
              </button>
              <button type="button" class="protection-action remove-protection-action" onclick={handleUnprotectNote} title="Remove protection" aria-label="Remove protection">
                <ShieldOff size={14} strokeWidth={2} aria-hidden="true" />
                <span>Remove protection</span>
              </button>
            {/if}
          {:else}
            <button type="button" class="protection-action subtle" onclick={handleProtectNote}>
              <Shield size={14} strokeWidth={2} aria-hidden="true" />
              <span>Protect note</span>
            </button>
            {#if canProtectTextSelection}
              <button type="button" class="protection-action subtle" onclick={handleProtectSelectedLines}>
                <Lock size={14} strokeWidth={2} aria-hidden="true" />
                <span>Protect selected lines</span>
              </button>
            {/if}
          {/if}
        </div>

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
              {#if !isLocked}
                <button
                  type="button"
                  class="tag-remove"
                  onclick={() => removeTag(tag)}
                  aria-label={`Remove #${tag}`}
                  title={`Remove #${tag}`}
                >
                  <X size={12} strokeWidth={2} aria-hidden="true" />
                </button>
              {/if}
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
          {:else if !isLocked}
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

        {#if isLocked}
          <div class="locked-note-surface" role="status">
            <Lock size={22} strokeWidth={1.8} aria-hidden="true" />
            <p>Protected content is hidden while this note is locked.</p>
            <button type="button" onclick={handleUnlockNote}>
              <KeyRound size={14} strokeWidth={2} aria-hidden="true" />
              <span>Unlock to edit</span>
            </button>
          </div>
        {:else}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            bind:this={editorContainer}
            class="void-editor"
            data-pane-editor={paneId ?? LEGACY_EDITOR_PANE_ID}
            onkeydown={handleEditorUserIntent}
            onbeforeinput={handleEditorUserIntent}
            onpointerdown={handleEditorUserIntent}
            onclick={handleEditorClick}
          ></div>
        {/if}
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

  {#if shellIsActive && inlineAIStore.unreadCount > 0}
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

  {#if shellIsActive && offscreenInlineAIComposers.length > 0}
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

  {#if shellIsActive && inlineAIMarkers.length > 0}
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
        {#if pendingInlineApprovalComposerId === composer.id && !hasInlineAIApproval(composer)}
          <div class="floating-inline-ai-approval">
            <div class="floating-inline-ai-approval-copy">
              <Sparkles size={15} strokeWidth={2} aria-hidden="true" />
              <div>
                <strong>Grant AI access to this highlighted text?</strong>
                <span>AI can read this highlighted text and propose edits for 15 minutes.</span>
              </div>
            </div>
            <div class="floating-inline-ai-approval-actions">
              <button
                type="button"
                class="floating-inline-ai-send"
                onclick={() => grantInlineAIApproval(composer)}
                disabled={grantingInlineAIApproval}
              >
                <Sparkles size={14} strokeWidth={2} aria-hidden="true" />
                <span>{grantingInlineAIApproval ? 'Granting' : 'Grant access'}</span>
              </button>
              <button
                type="button"
                class="floating-inline-ai-close"
                onclick={() => cancelInlineAIApproval(composer.id)}
                title="Cancel"
                aria-label="Cancel inline AI approval"
              >
                <X size={14} strokeWidth={2} aria-hidden="true" />
              </button>
            </div>
          </div>
        {:else if composer.isActive}
          <InlineAIComposer
            composerId={composer.id}
            initialDraft={getInlineAIComposerDraft(composer)}
            onDraftChange={rememberInlineAIComposerDraft}
            onSubmit={(prompt) => submitComposer(composer, prompt)}
            onCancel={() => cancelComposer(composer.id)}
          />
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

  {#if !isLocked && shellIsActive}
    <EditorToolbar
      editorElement={editorContainer ?? null}
      onAction={handleToolbarAction}
      onAIPrompt={handleAIPrompt}
      onProtectSelection={handleProtectToolbarSelection}
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
  {/if}
</div>
{#if shellIsActive}
  <RelationsPanel />
  <LineageHistoryWorkspace />
{/if}
</div>

{#if shellIsActive}
  <BranchPicker />
{/if}

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
    container-type: inline-size;
  }

  .editor-scroll {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
  }

  .protection-bar {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
    min-height: 28px;
    margin: -4px 0 12px;
    color: var(--text-tertiary);
    font-size: var(--text-caption);
  }

  .protection-ai-control {
    position: relative;
    display: inline-flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
  }

  .protection-state,
  .protection-action {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-height: 26px;
    border-radius: var(--radius-sm);
    letter-spacing: 0;
  }

  .protection-state {
    padding: 0 8px;
    border: 1px solid var(--border-light);
    background: var(--bg-subtle);
    color: var(--text-secondary);
    font-weight: 600;
  }

  .protection-state.ai-state.approved {
    border-color: color-mix(in srgb, var(--accent-primary) 35%, var(--border-light));
    color: var(--text-primary);
  }

  .protection-bar.locked .protection-state {
    border-color: color-mix(in srgb, var(--color-warning, #b98500) 35%, var(--border-light));
    color: var(--color-warning, #8a6200);
  }

  .protection-action,
  .locked-note-surface button {
    border: 1px solid var(--border-light);
    background: var(--bg-card);
    color: var(--text-secondary);
    font: inherit;
    font-size: var(--text-caption);
    font-weight: 650;
    cursor: pointer;
    transition: background var(--transition-fast), color var(--transition-fast), border-color var(--transition-fast);
  }

  .protection-action {
    padding: 0 9px;
  }

  .protection-action.subtle {
    background: transparent;
  }

  .remove-protection-action {
    color: var(--color-danger, #b42318);
  }

  .protection-ai-popover {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    z-index: 45;
    display: grid;
    gap: 8px;
    width: min(280px, calc(100vw - 48px));
    padding: 10px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-md);
    background: var(--bg-card);
    color: var(--text-secondary);
    box-shadow: var(--shadow-md);
  }

  .protection-ai-popover strong {
    color: var(--text-primary);
    font-size: var(--text-caption);
  }

  .protection-ai-popover p {
    margin: 0;
    font-size: var(--text-caption);
    line-height: 1.4;
  }

  .protection-ai-popover-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }

  .protection-action:hover,
  .protection-action:focus-visible,
  .locked-note-surface button:hover,
  .locked-note-surface button:focus-visible {
    border-color: var(--accent-primary);
    background: var(--bg-hover);
    color: var(--text-primary);
    outline: none;
  }

  :global(.void-protected-lines) {
    margin: 14px 0;
    border: 1px solid var(--border-light);
    border-radius: 8px;
    background: var(--bg-card);
    box-shadow: 0 1px 0 color-mix(in srgb, var(--text-primary) 4%, transparent);
    overflow: hidden;
  }

  :global(.void-protected-lines-locked) {
    cursor: pointer;
  }

  :global(.void-protected-lines-locked:hover) {
    border-color: color-mix(in srgb, var(--accent-primary) 38%, var(--border-light));
    background: color-mix(in srgb, var(--accent-primary) 5%, var(--bg-card));
  }

  :global(.void-protected-lines-header) {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 10px;
    min-height: 46px;
    padding: 8px 10px;
    color: var(--text-secondary);
    font-size: var(--text-caption);
    user-select: none;
  }

  :global(.void-protected-lines-unlocked .void-protected-lines-header) {
    border-bottom: 1px solid var(--border-subtle);
    background: color-mix(in srgb, var(--accent-primary) 4%, transparent);
  }

  :global(.void-protected-lines-icon) {
    position: relative;
    display: inline-flex;
    width: 24px;
    height: 24px;
    align-items: center;
    justify-content: center;
    border-radius: 7px;
    background: color-mix(in srgb, var(--accent-primary) 11%, transparent);
    color: var(--accent-primary);
  }

  :global(.void-protected-lines-icon::before) {
    content: '';
    position: absolute;
    width: 9px;
    height: 7px;
    bottom: 6px;
    border: 1.8px solid currentColor;
    border-radius: 2px;
  }

  :global(.void-protected-lines-icon::after) {
    content: '';
    position: absolute;
    width: 8px;
    height: 7px;
    top: 5px;
    border: 1.8px solid currentColor;
    border-bottom: 0;
    border-radius: 6px 6px 0 0;
  }

  :global(.void-protected-lines-copy) {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 1px;
  }

  :global(.void-protected-lines-title) {
    color: var(--text-primary);
    font-weight: 650;
    line-height: 1.25;
  }

  :global(.void-protected-lines-meta) {
    color: var(--text-muted);
    line-height: 1.25;
  }

  :global(.void-protected-lines-action) {
    justify-self: end;
    border: 1px solid var(--border-light);
    border-radius: 999px;
    padding: 4px 8px;
    background: var(--bg-subtle);
    color: var(--text-secondary);
    font-size: 11px;
    font-weight: 650;
    line-height: 1;
    white-space: nowrap;
  }

  :global(.void-protected-lines-locked:hover .void-protected-lines-action) {
    border-color: color-mix(in srgb, var(--accent-primary) 38%, var(--border-light));
    color: var(--accent-primary);
  }

  :global(.void-protected-lines-content) {
    padding: 10px 12px;
  }

  :global(.void-protected-lines-locked .void-protected-lines-content) {
    display: none;
  }

  .locked-note-surface {
    display: flex;
    min-height: 260px;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    gap: 12px;
    padding: 32px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-md);
    background: var(--bg-subtle);
    color: var(--text-secondary);
    text-align: center;
  }

  .locked-note-surface p {
    margin: 0;
    color: var(--text-secondary);
    font-size: var(--text-small);
  }

  .locked-note-surface button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 30px;
    padding: 0 11px;
    border-radius: var(--radius-sm);
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

  .floating-inline-ai-approval {
    display: grid;
    gap: 9px;
    width: min(360px, calc(100vw - 32px));
    max-width: inherit;
    padding: 10px;
    border: 1px solid color-mix(in srgb, var(--accent-primary) 28%, var(--border-light));
    border-radius: var(--radius-md);
    background: var(--bg-card);
    color: var(--text-secondary);
    box-shadow: 0 10px 28px rgba(15, 23, 42, 0.12);
  }

  .floating-inline-ai-approval-copy {
    display: flex;
    align-items: flex-start;
    gap: 8px;
  }

  .floating-inline-ai-approval-copy :global(svg) {
    margin-top: 1px;
    color: var(--accent-primary);
    flex-shrink: 0;
  }

  .floating-inline-ai-approval-copy strong,
  .floating-inline-ai-approval-copy span {
    display: block;
  }

  .floating-inline-ai-approval-copy strong {
    color: var(--text-primary);
    font-size: var(--text-caption);
  }

  .floating-inline-ai-approval-copy span {
    margin-top: 2px;
    font-size: var(--text-caption);
    line-height: 1.35;
  }

  .floating-inline-ai-approval-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    justify-content: flex-end;
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

  .pane-mode .editor-content-wrapper {
    width: 100%;
    max-width: min(var(--content-max-width), calc(100% - 28px));
    padding: 34px clamp(18px, 6cqw, 46px) 128px;
  }

  @container (max-width: 560px) {
    .pane-mode .editor-content-wrapper {
      max-width: calc(100% - 20px);
      padding-inline: 16px;
    }

    .pane-mode .note-title {
      font-size: calc(var(--text-note-title) * 0.82);
      line-height: 1.14;
    }
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
