<script lang="ts">
  /**
   * Main Page - Notes Editor
   *
   * Modern, minimal notes interface with sidebar navigation,
   * block-based editing, and a persistent status bar.
   */

  import { onMount, onDestroy, untrack } from 'svelte';
  import { notesStore, toastStore, settingsStore, aiStore, operationsStore, filesStore, editorStore, todoStore, uiStore, lineageStore, updaterStore, noteWorkspaceStore, protectionStore } from '$lib/stores';
  import { Sidebar, Breadcrumbs, QuickSwitcher, TagDetailView, FolderOverview, SearchPanel, GraphView } from '$lib/components/navigation';
  import NoteContextMenu from '$lib/components/navigation/NoteContextMenu.svelte';
  import CreateFolderModal from '$lib/components/navigation/CreateFolderModal.svelte';
  import DeleteFolderModal from '$lib/components/navigation/DeleteFolderModal.svelte';
  import { NotePaneWorkspace, WorkspaceTabs } from '$lib/components/editor';
  import { StatusBar, SettingsPanel, LogPanel, ToastContainer, PulseInbox, ClipboardHistoryPicker, SyncConflictWorkspace, ProtectionUnlockSheet, FolderReconnectSheet } from '$lib/components/shared';
  import { logStore } from '$lib/stores';
  import { AICommandCenter } from '$lib/components/ai-command';
  import { TodoWorkspace } from '$lib/components/todo';
  import { AlertCircle, Copy, FileText, FolderOpen, FolderSearch, Hash, History, MoreHorizontal, Star, Trash2, Upload, X } from '@lucide/svelte';
  import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
  import { listenToMenuBarCommands, type MenuBarCommand } from '$lib/desktop/menuBar';
  import {
    formatMarkdownDropAcceptedLabel,
    formatMarkdownDropSkippedLabel,
    formatMarkdownImportTargetFolder,
    type MarkdownDropPreview,
    openImportedMarkdownSummary,
    resolveMarkdownImportTargetFolder,
    summarizeMarkdownDropPaths,
  } from '$lib/desktop/markdownImportFlow';
  import { DEFAULT_TODO_VIEW, type TodoView } from '$lib/domain/values/TodoView';
  import { events } from '$lib/events';
  import type { EventMap } from '$lib/events/types';
  import { isActiveAgentRun } from '$lib/domain/entities/AgentRun';
  import { createFocusTrap } from '$lib/utils/focusTrap';
  import { TOKENS } from '$lib/core';
  import { getAppContext } from '$lib/bootstrap';
  import {
    attachGlobalKeymapBinder,
    buildScopeSnapshot,
    type GlobalKeymapBinder,
  } from '$lib/keymap';
  import { formatChord, type KeyChord } from '$lib/domain/values/KeyChord';
  import { AI_UNAVAILABLE_MESSAGE, buildRefId, deriveTextNoteTitle, type NotePaneDirection } from '$lib/domain/values';
  import { copyTextToClipboard } from '$lib/utils/clipboard';
  import type { CommandService } from '$lib/ports/inbound/CommandService';
  import type { DocumentService } from '$lib/ports/inbound/DocumentService';
  import type { KeymapService } from '$lib/ports/inbound/KeymapService';
  import type { FrecencyService } from '$lib/ports/inbound/FrecencyService';
  import type { FolderDropPosition, MarkdownImportSummary } from '$lib/ports/inbound';

  function formatShortcut(chord: KeyChord): string {
    return formatChord(chord, navigator.platform.toLowerCase().includes('mac') ? 'mac' : 'other');
  }

  function prettyShortcut(chordString: string): string {
    return chordString
      .split('+')
      .map((p) => {
        if (p === 'mod' || p === 'cmd' || p === 'meta') return '⌘';
        if (p === 'shift') return '⇧';
        if (p === 'alt' || p === 'opt' || p === 'option') return '⌥';
        if (p === 'ctrl' || p === 'control') return '⌃';
        if (p.length === 1) return p.toUpperCase();
        return p.charAt(0).toUpperCase() + p.slice(1);
      })
      .join('');
  }

  function keymapSnapshot() {
    return buildScopeSnapshot();
  }

  type PendingNoteDelete = {
    path: string;
    title: string;
  };

  // Panel visibility now lives in uiStore so registered commands can mutate
  // these flags from anywhere. The route reads them as derived state.
  let aiSidebarVisible = $derived(uiStore.aiSidebarVisible);
  let quickSwitcherOpen = $derived(uiStore.quickSwitcherOpen);
  let settingsOpen = $derived(uiStore.settingsOpen);
  let focusMode = $derived(uiStore.focusMode);
  let tasksWorkspaceOpen = $derived(uiStore.tasksWorkspaceOpen);
  let markdownDropPreview = $state<MarkdownDropPreview | null>(null);
  let pasteCreateInFlight = false;

  const LIKELY_SECRET_CONTENT_PATTERNS = [
    /^\s*(?:export\s+)?[A-Z0-9_]{3,}\s*=\s*['"]?[^'"\s#]{12,}/im,
    /-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----/,
    /\b(?:sk|pk|rk|ghp|github_pat|xox[baprs])_[A-Za-z0-9_\-]{16,}\b/,
    /\bAKIA[0-9A-Z]{16}\b/,
    /\bAIza[0-9A-Za-z_\-]{20,}\b/,
  ] as const;

  // Note context menu state (component-local — only opened from this page)
  let noteContextMenu = $state<{
    path: string;
    title: string;
    isFolder: boolean;
    position: { x: number; y: number };
  } | null>(null);

  // Create-folder modal state. Opened from the sidebar header (root), folder
  // hover Plus button, or the folder context menu. null = closed.
  let createFolderTarget = $state<{ parentPath: string | null } | null>(null);

  function openCreateFolderModal(parentPath: string | null) {
    createFolderTarget = { parentPath };
  }

  async function handleCreateFolderSubmit(name: string) {
    const target = createFolderTarget;
    if (!target) return;
    const created = await notesStore.createFolder(target.parentPath, name);
    if (created) {
      toastStore.success('Folder created');
      createFolderTarget = null;
    } else {
      throw notesStore.error ?? new Error('Could not create folder');
    }
  }

  // Delete-folder confirm modal state. Opened from the folder context menu.
  let pendingFolderDelete = $state<{
    path: string;
    title: string;
    noteCount: number;
    folderCount: number;
  } | null>(null);

  function requestFolderDelete(path: string, title: string) {
    const counts = notesStore.countFolderContents(path);
    pendingFolderDelete = {
      path,
      title,
      noteCount: counts.notes,
      folderCount: counts.folders,
    };
  }

  async function handleFolderDeleteConfirm() {
    const target = pendingFolderDelete;
    if (!target) return;
    const ok = await notesStore.deleteFolder(target.path);
    if (ok) {
      const items = target.noteCount + target.folderCount;
      toastStore.success(items > 0 ? `Folder + ${items} items deleted` : 'Folder deleted');
      pendingFolderDelete = null;
    } else {
      throw notesStore.error ?? new Error('Could not delete folder');
    }
  }

  // Delete-confirm dialog state. The pending payload lives in uiStore
  // (so commands can request a deletion); the in-flight flag and DOM refs
  // remain local because they're tied to this component's mounted dialog.
  let pendingNoteDelete = $derived<PendingNoteDelete | null>(uiStore.pendingNoteDelete);
  let deleteInProgress = $state(false);
  let deleteDialogRef: HTMLDivElement | null = $state(null);
  let deleteConfirmButton: HTMLButtonElement | null = $state(null);
  let deleteFocusTrapCleanup: (() => void) | null = null;

  // Global keymap binder (attached in onMount, disposed in onDestroy)
  let keymapBinder: GlobalKeymapBinder | null = null;

  // Cached app context — set in onMount once bootstrap has resolved.
  let appCommands: CommandService | null = $state(null);
  let appKeymap: KeymapService | null = $state(null);
  let appFrecency: FrecencyService | null = $state(null);
  // Bumped after every command execution to invalidate frecency-derived caches.
  let frecencyTick = $state(0);

  // Palette commands derived from the registered command set. Slash-only
  // commands (insert block) are filtered out — those belong to the in-editor
  // slash menu, not the global palette. Sorted by frecency so recently-used
  // commands surface first.
  let paletteCommands = $derived.by(() => {
    void frecencyTick;
    if (!appCommands || !appKeymap) return [];
    const SLASH_CATEGORIES = new Set(['basic', 'media', 'advanced']);
    const bindings = new Map(appKeymap.getBindings().map((b) => [b.commandId, b]));
    const all = appCommands.getAllCommands();
    const filtered = all.filter((cmd) => !SLASH_CATEGORIES.has(cmd.category));
    if (appFrecency) {
      const frecency = appFrecency;
      filtered.sort((a, b) => frecency.compare('command', a.id, b.id));
    }
    return filtered
      .map((cmd) => {
        const binding = bindings.get(cmd.id);
        const shortcut = binding && binding.chord.key
          ? formatShortcut(binding.chord)
          : cmd.defaultKeybinding
            ? prettyShortcut(cmd.defaultKeybinding)
            : '';
        return {
          id: cmd.id,
          label: cmd.label,
          ...(shortcut ? { shortcut } : {}),
          action: () => {
            void appCommands!.executeById(cmd.id, {
              scope: keymapSnapshot(),
            });
          },
        };
      });
  });

  // Editor state
  let error = $state<string | null>(null);

  // Current document being edited
  let currentDocument = $derived(editorStore.document);

  // Embedded tag detail view (replaces the standalone /tags/[tag] route)
  let activeTagView = $derived(notesStore.activeTagView);
  let activeFolderOverview = $derived(notesStore.activeFolderOverview);
  let currentNoteFavorite = $derived(
    notesStore.selectedPath ? notesStore.isFavorite(notesStore.selectedPath, 'note') : false
  );

  // Save/count state (mirrored from EditorShell via callbacks)
  let saveStatus = $state<'saved' | 'saving' | 'unsaved'>('saved');
  let wordCount = $state(0);
  let charCount = $state(0);

  // Track if component is mounted (DOM is ready)
  let isMounted = $state(false);

  let todoWorkspace: TodoWorkspace | undefined = $state(undefined);
  let noteActionsMenuOpen = $state(false);

  // Derived typography style from settings
  let editorStyle = $derived.by(() => {
    const s = settingsStore.settings;
    if (!s) return '';
    return `--editor-font-size: ${s.fontSize}px; --editor-line-height: ${s.lineHeight}; --content-max-width: ${s.contentWidth}px;`;
  });

  let activeAgentRunCount = $derived.by(() => {
    const ids = new Set<string>();
    for (const run of aiStore.agentRunState.runs) {
      if (isActiveAgentRun(run)) {
        ids.add(run.id);
      }
    }

    const current = aiStore.agentRunState.currentRun;
    if (isActiveAgentRun(current)) {
      ids.add(current.id);
    }

    return ids.size;
  });

  let activeWorkCount = $derived(operationsStore.activeOperations.length + activeAgentRunCount);

  let activeWorkLabel = $derived.by(() => {
    const run = aiStore.agentRunState.currentRun;
    if (run?.status === 'waiting_approval') return 'Agent waiting approval';
    if (aiStore.agentRunState.isRunning) return 'Agent working';
    if (operationsStore.activeOperations.length > 0) return 'Operation running';
    return 'AI work';
  });



  async function loadSelectedDocument(path: string) {
    const result = await editorStore.loadDocument(path);
    if (result.ok) {
      error = null;
    } else {
      error = result.error.message;
    }
  }

  async function saveDocument() {
    await editorStore.saveDocument();
  }

  function handleTitleRename(newTitle: string, notePath?: string) {
    const title = newTitle.trim();
    if (!title) return;

    const path = notePath ?? editorStore.activePath ?? notesStore.selectedPath;
    if (!path) return;

    const previousTitle = editorStore.activePath === path
      ? editorStore.document?.meta.title ?? notesStore.titleForPath(path)
      : notesStore.titleForPath(path);
    notesStore.previewNoteTitle(path, title);

    const result = editorStore.updateDocumentMeta({ title });
    if (!result.ok) {
      notesStore.previewNoteTitle(path, previousTitle);
      error = result.error.message;
      return;
    }

    error = null;
  }

  async function revealCurrentNote() {
    if (!currentDocument) {
      toastStore.error('No document to reveal');
      return;
    }

    const result = await editorStore.revealCurrentDocument();
    if (!result.ok) {
      toastStore.error('Could not show note in Finder');
    }
  }

  function closeNoteActionsMenu() {
    noteActionsMenuOpen = false;
  }

  function toggleCurrentNoteFavorite() {
    const path = notesStore.selectedPath;
    if (!path) {
      toastStore.error('No document to favorite');
      return;
    }

    const wasFavorite = notesStore.isFavorite(path, 'note');
    notesStore.toggleFavorite(path, 'note');
    toastStore.info(wasFavorite ? 'Removed from favorites' : 'Added to favorites');
    closeNoteActionsMenu();
  }

  async function revealCurrentNoteFromMenu() {
    closeNoteActionsMenu();
    await revealCurrentNote();
  }

  async function copyCurrentNoteRefFromMenu() {
    const path = notesStore.selectedPath;
    closeNoteActionsMenu();
    if (!path) {
      toastStore.error('No document ref to copy');
      return;
    }
    const success = await copyTextToClipboard(buildRefId({ kind: 'note', notePath: path }));
    if (success) toastStore.info('Ref copied');
    else toastStore.error('Failed to copy ref');
  }

  function requestCurrentNoteDeleteFromMenu() {
    closeNoteActionsMenu();
    requestCurrentNoteDelete();
  }

  function handleNoteActionsKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeNoteActionsMenu();
    }
  }

  function openCurrentNoteHistory() {
    if (!notesStore.selectedPath) {
      toastStore.error('No document history to show');
      return;
    }
    uiStore.openLineageWorkspace();
    void lineageStore.openWorkspace(notesStore.selectedPath);
  }

  function requestNoteDelete(path: string, title: string) {
    uiStore.requestNoteDelete(path, title || path.split('/').pop() || 'this note');
  }

  function requestCurrentNoteDelete() {
    if (!currentDocument || !notesStore.selectedPath) {
      toastStore.error('No document to delete');
      return;
    }

    const title = currentDocument.meta.title || notesStore.selectedPath.split('/').pop() || 'this note';
    requestNoteDelete(notesStore.selectedPath, title);
  }

  function closeDeleteConfirmation() {
    if (deleteInProgress) return;
    uiStore.clearPendingNoteDelete();
  }

  async function confirmDeleteNote() {
    if (!pendingNoteDelete) return;

    const note = pendingNoteDelete;
    deleteInProgress = true;
    let deleted = false;
    try {
      deleted = await notesStore.deleteNote(note.path);
    } finally {
      deleteInProgress = false;
    }
    if (deleted) {
      const nextPath = noteWorkspaceStore.removeNotePath(note.path);
      uiStore.clearPendingNoteDelete();
      error = null;
      toastStore.info('Note moved to Trash');
      if (nextPath) {
        notesStore.selectNote(nextPath);
      }
      return;
    }

    toastStore.error(notesStore.error?.message ?? 'Failed to delete note');
  }

  async function exportAsMarkdown() {
    if (!currentDocument) {
      toastStore.error('No document to export');
      return;
    }

    try {
      const markdownResult = editorStore.getMarkdown();
      if (!markdownResult.ok) {
        toastStore.error('Export failed');
        return;
      }
      const markdown = markdownResult.value;
      const title = currentDocument.meta.title || 'Untitled';

      const filePath = await saveDialog({
        title: 'Export as Markdown',
        defaultPath: `${title}.md`,
        filters: [{ name: 'Markdown', extensions: ['md'] }],
      });

      if (!filePath) return;

      const result = await filesStore.write(filePath, markdown);

      if (result.ok) {
        toastStore.success('Exported as Markdown');
      } else {
        toastStore.error('Export failed');
      }
    } catch (e) {
      console.error('Export error:', e);
      toastStore.error('Export failed');
    }
  }

  function getMarkdownImportTargetFolder(): string {
    return resolveMarkdownImportTargetFolder({
      activeFolderPath: notesStore.activeFolderPath,
      selectedPath: notesStore.selectedPath,
    });
  }

  function getSkippedImportMessage(summary: MarkdownImportSummary): string | null {
    const skippedCount = summary.skipped.length;
    if (skippedCount === 0) return null;

    if (summary.imported.length === 0) {
      if (summary.skipped.every((item) => item.reason === 'not-markdown')) {
        return 'Only .md files can be opened.';
      }
      if (summary.skipped.every((item) => item.reason === 'unsupported-directory')) {
        return 'Folder imports are not supported yet.';
      }
      return summary.skipped[0]?.message ?? 'No markdown files were imported.';
    }

    const fileLabel = skippedCount === 1 ? 'file' : 'files';
    if (summary.skipped.every((item) => item.reason === 'not-markdown')) {
      return `Skipped ${skippedCount} non-.md ${fileLabel}.`;
    }
    if (summary.skipped.every((item) => item.reason === 'unsupported-directory')) {
      return `Skipped ${skippedCount} folder ${skippedCount === 1 ? 'drop' : 'drops'}.`;
    }
    return `Skipped ${skippedCount} ${fileLabel} that could not be imported.`;
  }

  function showMarkdownImportToasts(summary: MarkdownImportSummary): void {
    if (summary.imported.length === 1) {
      toastStore.success(`Imported ${summary.imported[0]?.title ?? 'markdown file'}`);
    } else if (summary.imported.length > 1) {
      toastStore.success(`Imported ${summary.imported.length} markdown files`);
    }

    const skippedMessage = getSkippedImportMessage(summary);
    if (!skippedMessage) return;

    if (summary.imported.length > 0) {
      toastStore.warning(skippedMessage);
    } else {
      toastStore.error(skippedMessage);
    }
  }

  function containsLikelySecretContent(text: string): boolean {
    return LIKELY_SECRET_CONTENT_PATTERNS.some((pattern) => pattern.test(text));
  }

  async function protectSuggestedNote(path: string): Promise<void> {
    if (editorStore.activePath === path && editorStore.isDirty) {
      const saved = await editorStore.saveDocument();
      if (!saved.ok) {
        toastStore.error(saved.error.message);
        return;
      }
    }
    const meta = await protectionStore.protectNote(path);
    if (!meta) {
      toastStore.error(protectionStore.error?.message ?? 'Could not protect note');
      return;
    }
    await notesStore.refresh();
    if (editorStore.activePath === path) {
      const result = await editorStore.reloadDocument(path, { flushDirty: true });
      if (!result.ok) {
        toastStore.error(result.error.message);
        return;
      }
    }
    toastStore.success('Note protected');
  }

  function suggestProtectNote(path: string, source: 'paste' | 'import'): void {
    toastStore.warning(
      source === 'paste'
        ? 'This paste looks like secrets. Click to protect the note.'
        : 'Imported note may contain secrets. Click to protect it.',
      {
        duration: 12000,
        onClick: () => {
          void protectSuggestedNote(path);
        },
      },
    );
  }

  async function suggestProtectionForImportedSecrets(summary: MarkdownImportSummary): Promise<void> {
    if (summary.imported.length === 0) return;
    const ctx = getAppContext();
    if (!ctx) return;
    const documents = ctx.container.resolve<DocumentService>(TOKENS.DocumentService);
    for (const item of summary.imported) {
      const content = await documents.readContent(item.path);
      if (content.ok && containsLikelySecretContent(content.value)) {
        suggestProtectNote(item.path, 'import');
      }
    }
  }

  function showMarkdownDropPreview(paths: string[]): void {
    markdownDropPreview = paths.length > 0 ? summarizeMarkdownDropPaths(paths) : null;
  }

  function clearMarkdownDropPreview(): void {
    markdownDropPreview = null;
  }

  async function importExternalMarkdownPaths(paths: string[]): Promise<void> {
    if (paths.length === 0) return;

    const ctx = getAppContext();
    if (!ctx) {
      toastStore.error('Void is still starting up');
      return;
    }

    const result = await ctx.markdownImport.importFiles(paths, {
      targetFolder: getMarkdownImportTargetFolder(),
    });

    if (!result.ok) {
      toastStore.error(`Import failed: ${result.error.message}`);
      return;
    }

    const summary = result.value;
    await openImportedMarkdownSummary(summary, {
      refreshNotes: () => notesStore.refresh(),
      openDocument: (path) => editorStore.loadDocument(path),
      selectNote: (path) => notesStore.selectNote(path),
    });
    showMarkdownImportToasts(summary);
    await suggestProtectionForImportedSecrets(summary);
  }

  async function openExternalMarkdownDialog(): Promise<void> {
    try {
      const selected = await openDialog({
        title: 'Open Markdown File',
        multiple: true,
        filters: [{ name: 'Markdown', extensions: ['md'] }],
      });

      if (!selected) return;
      await importExternalMarkdownPaths(Array.isArray(selected) ? selected : [selected]);
    } catch (e) {
      console.error('Open markdown file error:', e);
      toastStore.error('Could not open Markdown file');
    }
  }

  function getPasteTarget(event: ClipboardEvent): HTMLElement | null {
    if (event.target instanceof HTMLElement) return event.target;
    return document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }

  function isEditablePasteTarget(target: HTMLElement | null): boolean {
    return !!target?.closest(
      '.ProseMirror, input, textarea, select, [contenteditable], .command-center',
    );
  }

  async function createNoteFromClipboardText(text: string): Promise<void> {
    const ctx = getAppContext();
    if (!ctx) {
      toastStore.error('Void is still starting up');
      return;
    }

    pasteCreateInFlight = true;
    try {
      const documents = ctx.container.resolve<DocumentService>(TOKENS.DocumentService);
      const folder = notesStore.activeFolderPath ?? '';
      const title = deriveTextNoteTitle(text, { fallbackPrefix: 'Paste' });
      const result = await documents.createWithContent(
        folder,
        title,
        text,
        { type: 'user', autoFocus: true },
        {
          actor: { kind: 'user' },
          intentKind: 'import',
          summary: 'Created from clipboard paste',
          source: { type: 'pasteboard' },
        },
      );

      if (!result.ok) {
        toastStore.error(`Paste failed: ${result.error.message}`);
      } else if (containsLikelySecretContent(text)) {
        suggestProtectNote(result.value.path, 'paste');
      }
    } finally {
      pasteCreateInFlight = false;
    }
  }

  function handleEmptyWorkspacePaste(event: ClipboardEvent): void {
    if (event.defaultPrevented || pasteCreateInFlight) return;
    if (notesStore.selectedPath !== null || editorStore.activePath !== null) return;

    const snapshot = buildScopeSnapshot();
    if (snapshot.modalOpen || snapshot.paletteOpen || snapshot.tasksWorkspaceOpen) return;
    if (isEditablePasteTarget(getPasteTarget(event))) return;

    const text = event.clipboardData?.getData('text/plain') ?? '';
    if (!text.trim()) return;

    event.preventDefault();
    void createNoteFromClipboardText(text);
  }

  async function handleQuickCreate() {
    const doc = await notesStore.createQuickNote();
    if (doc) {
      toastStore.success('Note created');
    }
  }

  function getTaskStartupView(): TodoView {
    return settingsStore.settings?.taskDefaultView ?? DEFAULT_TODO_VIEW;
  }

  function openTasksWorkspace() {
    if (!tasksWorkspaceOpen) {
      uiStore.openTasksWorkspace(notesStore.selectedPath, aiSidebarVisible);
    }
    uiStore.closeAISidebar();
    todoStore.openWorkspace(getTaskStartupView());
    notesStore.hideSidebar();
    notesStore.selectNote(null);
    notesStore.selectTagView(null);
  }

  function closeTasksWorkspace() {
    const noteToRestore = uiStore.notePathBeforeTasks;
    const restoreAISidebar = uiStore.aiSidebarWasOpenBeforeTasks;
    uiStore.closeTasksWorkspace();
    todoStore.closeWorkspace();
    notesStore.showSidebar();

    if (noteToRestore) {
      notesStore.selectNote(noteToRestore);
    }
    if (restoreAISidebar) {
      uiStore.openAISidebar();
    }
  }

  function toggleTasksWorkspace() {
    if (tasksWorkspaceOpen) {
      closeTasksWorkspace();
    } else {
      openTasksWorkspace();
    }
  }

  function navigateToTodoSource(filePath: string) {
    const restoreAISidebar = uiStore.aiSidebarWasOpenBeforeTasks;
    uiStore.closeTasksWorkspace();
    todoStore.closeWorkspace();
    notesStore.showSidebar();
    notesStore.selectNoteByAnyPath(filePath);
    if (restoreAISidebar) {
      uiStore.openAISidebar();
    }
  }

  function openHomeScreen() {
    uiStore.closeTasksWorkspace();
    todoStore.closeWorkspace();
    notesStore.showSidebar();
    notesStore.selectNote(null);
    notesStore.selectTagView(null);
    error = null;
  }

  function openTagView(tag: string) {
    uiStore.closeTasksWorkspace();
    todoStore.closeWorkspace();
    notesStore.selectTagView(tag);
    error = null;
  }

  function closeTagView() {
    notesStore.selectTagView(null);
  }

  function handleBreadcrumbNavigate(folderPath: string) {
    if (folderPath) {
      notesStore.selectFolderView(folderPath);
    } else {
      openHomeScreen();
    }
    notesStore.showSidebar();
  }

  async function createNoteInActiveFolder() {
    const folder = notesStore.activeFolderPath;
    if (!folder) return;

    const doc = await notesStore.createQuickNote(folder);
    if (doc) {
      toastStore.success('Note created');
    } else {
      toastStore.error(notesStore.error?.message ?? 'Could not create note');
    }
  }

  function searchActiveFolder() {
    uiStore.openQuickSwitcher();
  }

  async function summarizeActiveFolder() {
    const folder = notesStore.activeFolderPath;
    if (!folder) return;
    if (!aiStore.ensureAIAvailable()) {
      toastStore.error(aiStore.availabilityMessage ?? AI_UNAVAILABLE_MESSAGE);
      uiStore.openAISidebar();
      return;
    }

    const operation = await operationsStore.queueFromTemplate('summarize-folder', { folder });
    if (operation) {
      toastStore.info('Folder summary queued');
    } else {
      toastStore.error(operationsStore.error?.message ?? 'Could not summarize folder');
    }
  }

  function openFolderNote(path: string) {
    notesStore.selectNote(path);
  }

  function openNoteAsSplit(path: string, direction: NotePaneDirection) {
    uiStore.closeTasksWorkspace();
    todoStore.closeWorkspace();
    notesStore.showSidebar();

    const activeTab = noteWorkspaceStore.activeTab;
    if (!activeTab || !noteWorkspaceStore.activeNotePath) {
      noteWorkspaceStore.openNoteTab(path);
      notesStore.selectNote(path);
      return;
    }

    const intent = direction === 'horizontal' ? 'right' : 'bottom';
    const result = noteWorkspaceStore.splitPaneWithNote(activeTab.id, activeTab.activePaneId, intent, path);
    if (result.notePath) notesStore.selectNote(result.notePath);
    else {
      noteWorkspaceStore.openNoteTab(path);
      notesStore.selectNote(path);
    }
  }

  function openFolderOverview(path: string) {
    notesStore.selectFolderView(path);
  }

  async function reorderFolderFromOverview(
    path: string,
    targetPath: string,
    position: FolderDropPosition
  ) {
    return notesStore.reorderFolder(path, targetPath, position);
  }

  function handleMenuBarCommand(command: MenuBarCommand) {
    switch (command) {
      case 'new-note':
        void handleQuickCreate();
        break;
      case 'open-markdown-file':
        void openExternalMarkdownDialog();
        break;
      case 'open-search':
        uiStore.openQuickSwitcher();
        break;
      case 'ask-void':
        uiStore.openAISidebar();
        break;
      case 'open-tasks':
        openTasksWorkspace();
        break;
      case 'open-settings':
        uiStore.openSettings();
        break;
      case 'check-updates':
        void runManualUpdateCheck();
        break;
    }
  }

  async function runManualUpdateCheck() {
    const checkingId = toastStore.info('Checking for updates…', { duration: 0 });
    const result = await updaterStore.checkForUpdates({ silent: false });
    toastStore.remove(checkingId);
    if (!result.ok) {
      toastStore.error(`Update check failed: ${result.error.message}`, { duration: 6000 });
      return;
    }
    const update = result.value;
    if (!update) {
      toastStore.success('Void is up to date');
      return;
    }
    toastStore.info(`Void v${update.version} available`, {
      duration: 10000,
      onClick: () => uiStore.openSettings('updates'),
    });
    uiStore.openSettings('updates');
  }

  onDestroy(() => {
    deleteFocusTrapCleanup?.();
    // EditorShell handles its own cleanup
  });

  $effect(() => {
    if (pendingNoteDelete && deleteDialogRef) {
      deleteFocusTrapCleanup?.();
      deleteFocusTrapCleanup = createFocusTrap({
        container: deleteDialogRef,
        initialFocus: deleteConfirmButton,
        onEscape: closeDeleteConfirmation,
      });
    } else {
      deleteFocusTrapCleanup?.();
      deleteFocusTrapCleanup = null;
    }
  });

  onMount(() => {
    isMounted = true;
    noteWorkspaceStore.init();

    const restoredNotePath = noteWorkspaceStore.activeNotePath;
    if (restoredNotePath && !notesStore.selectedPath) {
      notesStore.selectNote(restoredNotePath);
    }

    // ─── Responsive sidebar default ───
    // The sidebar defaults to "open" in the store (good for desktop), but
    // on narrow viewports an open drawer hides everything behind a
    // backdrop. Sync the initial state to viewport width, and track
    // crossings of the overlay breakpoint so the chrome stays sensible
    // when the window is resized between sessions.
    const OVERLAY_BREAKPOINT = 880;
    const isOverlayViewport = () => window.innerWidth < OVERLAY_BREAKPOINT;
    let wasOverlay = isOverlayViewport();
    if (wasOverlay) {
      notesStore.hideSidebar();
    }
    const handleViewportResize = () => {
      const nowOverlay = isOverlayViewport();
      if (nowOverlay === wasOverlay) return;
      wasOverlay = nowOverlay;
      // Crossing into overlay mode: tuck the drawer away so users see
      // their content. Crossing back to desktop: reveal the sidebar so
      // the persistent layout returns automatically.
      if (nowOverlay) {
        notesStore.hideSidebar();
      } else {
        notesStore.showSidebar();
      }
    };
    window.addEventListener('resize', handleViewportResize);

    // Suppress default context menu outside editable areas (native feel)
    const contextMenuHandler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.ProseMirror, input, textarea, [contenteditable="true"], .command-center')) {
        e.preventDefault();
      }
    };
    document.addEventListener('contextmenu', contextMenuHandler);
    document.addEventListener('paste', handleEmptyWorkspacePaste);

    // Escape inside the tasks workspace closes it. This stays a route-level
    // handler because Escape semantics are highly contextual (modal-aware,
    // scope-sensitive) and cheap to express directly.
    const escapeHandler = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key !== 'Escape') return;
      if (!uiStore.tasksWorkspaceOpen) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      e.preventDefault();
      closeTasksWorkspace();
    };
    window.addEventListener('keydown', escapeHandler);

    const paneCycleHandler = (e: KeyboardEvent) => {
      if (e.key !== 'F6') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('[data-pane-resizer]')) return;
      if (!noteWorkspaceStore.isActiveTabSplit) return;
      e.preventDefault();
      const path = noteWorkspaceStore.focusNextPane(e.shiftKey ? -1 : 1);
      if (path) {
        notesStore.selectNote(path);
        const paneId = noteWorkspaceStore.activePaneId;
        if (paneId) editorStore.focusPane(paneId);
      }
    };
    window.addEventListener('keydown', paneCycleHandler);

    // Power-user command spine: every other shortcut is now resolved by
    // the global keymap binder against the registered command set.
    const ctx = getAppContext();
    if (ctx) {
      appCommands = ctx.commands;
      appKeymap = ctx.keymap;
      appFrecency = ctx.frecency;
      keymapBinder = attachGlobalKeymapBinder({
        keymap: ctx.keymap,
        commands: ctx.commands,
      });
    }
    // Re-render palette commands when frecency mutates so recently-used
    // entries surface to the top.
    const handleCommandExecuted = () => {
      frecencyTick += 1;
    };
    events.on('command:executed', handleCommandExecuted);

    const handleAppNavigate = (event: EventMap['app:navigate']) => {
      switch (event.view) {
        case 'home':
          uiStore.closeTasksWorkspace();
          todoStore.closeWorkspace();
          notesStore.showSidebar();
          notesStore.selectNote(null);
          notesStore.selectTagView(null);
          break;
        case 'note':
          uiStore.closeTasksWorkspace();
          todoStore.closeWorkspace();
          notesStore.showSidebar();
          notesStore.selectNote(event.path);
          break;
        case 'folder':
          uiStore.closeTasksWorkspace();
          todoStore.closeWorkspace();
          notesStore.showSidebar();
          notesStore.selectFolderByAnyPath(event.path);
          break;
        case 'tag':
          if (event.tag) {
            openTagView(event.tag);
          } else {
            closeTagView();
          }
          break;
        case 'search':
          uiStore.openQuickSwitcher();
          break;
        case 'tasks':
          // Toggle behaviour preserved: navigating to 'tasks' while it's
          // already open closes the workspace (matches the prior keystroke
          // semantics for view.toggleTasks).
          if (uiStore.tasksWorkspaceOpen) {
            closeTasksWorkspace();
          } else {
            openTasksWorkspace();
          }
          break;
        case 'actions':
          uiStore.openAISidebar();
          aiStore.setSidebarView('actions');
          break;
        case 'settings':
          uiStore.openSettings();
          break;
        case 'back':
          notesStore.goBack();
          break;
        case 'forward':
          notesStore.goForward();
          break;
      }
    };
    events.on('app:navigate', handleAppNavigate);

    // Bridge command requests that need DOM-level orchestration this route
    // owns (file dialogs, focusing the tasks capture input).
    const handleOpenMarkdownRequest = () => { void openExternalMarkdownDialog(); };
    events.on('app:request-open-markdown-file', handleOpenMarkdownRequest);
    const handleExportRequest = () => { void exportAsMarkdown(); };
    events.on('app:request-export-markdown', handleExportRequest);

    let dragDropDisposed = false;
    let unlistenDragDrop: (() => void) | null = null;
    import('@tauri-apps/api/window')
      .then(({ getCurrentWindow }) =>
        getCurrentWindow().onDragDropEvent((event) => {
          if (event.payload.type === 'enter') {
            showMarkdownDropPreview(event.payload.paths);
            return;
          }
          if (event.payload.type === 'leave') {
            clearMarkdownDropPreview();
            return;
          }
          if (event.payload.type !== 'drop') return;
          clearMarkdownDropPreview();
          void importExternalMarkdownPaths(event.payload.paths);
        })
      )
      .then((unlisten) => {
        if (dragDropDisposed) {
          unlisten();
        } else {
          unlistenDragDrop = unlisten;
        }
      })
      .catch(() => {
        // Browser-only dev and tests do not have a Tauri window to subscribe to.
      });

    const handleOpenAIChat = (event: Event) => {
      const detail = (event as CustomEvent<{ conversationId?: string }>).detail;
      uiStore.openAISidebar();
      aiStore.setSidebarView('chat');
      if (detail?.conversationId) {
        void aiStore.switchConversation(detail.conversationId);
      }
    };
    window.addEventListener('void:open-ai-chat', handleOpenAIChat);

    const handleTasksNewRequest = () => {
      todoWorkspace?.focusCapture();
    };
    events.on('tasks:request-new', handleTasksNewRequest);
    const handleTasksSearchRequest = () => {
      todoWorkspace?.focusSearch();
    };
    events.on('tasks:request-search', handleTasksSearchRequest);
    const handleTasksEditSelectedRequest = () => {
      todoWorkspace?.focusSelectedTitle();
    };
    events.on('tasks:request-edit-selected', handleTasksEditSelectedRequest);

    let menuBarDisposed = false;
    let unlistenMenuBar: (() => void) | null = null;
    listenToMenuBarCommands(handleMenuBarCommand).then((unlisten) => {
      if (menuBarDisposed) {
        unlisten();
      } else {
        unlistenMenuBar = unlisten;
      }
    });

    return () => {
      menuBarDisposed = true;
      dragDropDisposed = true;
      unlistenMenuBar?.();
      unlistenDragDrop?.();
      window.removeEventListener('keydown', escapeHandler);
      window.removeEventListener('keydown', paneCycleHandler);
      window.removeEventListener('resize', handleViewportResize);
      keymapBinder?.dispose();
      keymapBinder = null;
      events.off('app:navigate', handleAppNavigate);
      events.off('app:request-open-markdown-file', handleOpenMarkdownRequest);
      events.off('app:request-export-markdown', handleExportRequest);
      events.off('tasks:request-new', handleTasksNewRequest);
      events.off('tasks:request-search', handleTasksSearchRequest);
      events.off('tasks:request-edit-selected', handleTasksEditSelectedRequest);
      events.off('command:executed', handleCommandExecuted);
      window.removeEventListener('void:open-ai-chat', handleOpenAIChat);
      document.removeEventListener('paste', handleEmptyWorkspacePaste);
      document.removeEventListener('contextmenu', contextMenuHandler);
    };
  });

  // React to selectedPath changes and load the document
  let previousSelectedPath: string | null = null;
  $effect(() => {
    const selectedPath = notesStore.selectedPath;

    if (!isMounted) return;

    if (selectedPath !== previousSelectedPath) {
      const oldPath = previousSelectedPath;
      previousSelectedPath = selectedPath;

      if (selectedPath) {
        const restoreAISidebar = uiStore.tasksWorkspaceOpen && uiStore.aiSidebarWasOpenBeforeTasks;
        uiStore.closeTasksWorkspace();
        todoStore.closeWorkspace();
        if (restoreAISidebar) {
          uiStore.openAISidebar();
        }
        // On overlay viewports the sidebar floats over content, so once
        // the user has picked a note, tuck it away so they can read.
        if (typeof window !== 'undefined' && window.innerWidth < 880) {
          notesStore.hideSidebar();
        }
        untrack(() => {
          if (noteWorkspaceStore.activeNotePath !== selectedPath) {
            noteWorkspaceStore.openNoteTab(selectedPath);
          }
          void loadSelectedDocument(selectedPath);
        });
      } else if (oldPath !== null) {
        untrack(() => {
          if (!uiStore.tasksWorkspaceOpen && !activeTagView && !activeFolderOverview) {
            noteWorkspaceStore.closeActiveTab();
          }
          editorStore.closeDocument();
          wordCount = 0;
          charCount = 0;
        });
      }
    }
  });
</script>

<!-- Skip link for keyboard users -->
<a href="#main-content" class="skip-link">Skip to main content</a>

<div
  class="app-shell"
  class:focus-mode={focusMode}
  class:sidebar-open={notesStore.sidebarVisible}
>
  <!-- Backdrop for sidebar overlay on narrow viewports.
       Visible only when the sidebar is open AND viewport is below the lg
       breakpoint — CSS handles that via :where(.sidebar-open) + media query. -->
  <button
    type="button"
    class="sidebar-overlay-backdrop"
    aria-label="Close sidebar"
    onclick={() => notesStore.hideSidebar()}
  ></button>

  {#if markdownDropPreview}
    <div
      class="markdown-drop-overlay"
      class:markdown-drop-overlay-mixed={markdownDropPreview.state === 'mixed'}
      class:markdown-drop-overlay-invalid={markdownDropPreview.state === 'invalid'}
      role="status"
      aria-live="polite"
      aria-label={markdownDropPreview.state === 'invalid' ? 'Only markdown files can be opened' : 'Release to import markdown files'}
    >
      <div class="markdown-drop-panel">
        <div class="markdown-drop-icon" aria-hidden="true">
          {#if markdownDropPreview.state === 'invalid'}
            <AlertCircle size={24} strokeWidth={1.8} />
          {:else}
            <Upload size={24} strokeWidth={1.8} />
          {/if}
        </div>
        <div class="markdown-drop-copy">
          <span class="markdown-drop-kicker">External Markdown</span>
          {#if markdownDropPreview.state === 'invalid'}
            <h2>Only .md files can be opened</h2>
            <p>Drop a Markdown file to import it into {formatMarkdownImportTargetFolder(getMarkdownImportTargetFolder())}.</p>
          {:else}
            <h2>
              Release to import {markdownDropPreview.markdownCount}
              {markdownDropPreview.markdownCount === 1 ? 'Markdown file' : 'Markdown files'}
            </h2>
            <p>
              Void will copy {markdownDropPreview.markdownCount === 1 ? 'it' : 'them'} into
              {formatMarkdownImportTargetFolder(getMarkdownImportTargetFolder())} and leave the original
              {markdownDropPreview.markdownCount === 1 ? 'file' : 'files'} untouched.
            </p>
          {/if}
        </div>
        <div class="markdown-drop-facts" aria-label="Drop summary">
          {#if markdownDropPreview.markdownCount > 0}
            <span class="markdown-drop-fact markdown-drop-fact-valid">
              <FileText size={13} strokeWidth={1.8} aria-hidden="true" />
              <span class="markdown-drop-fact-label">{formatMarkdownDropAcceptedLabel(markdownDropPreview)}</span>
            </span>
          {/if}
          {#if markdownDropPreview.unsupportedCount > 0}
            <span class="markdown-drop-fact markdown-drop-fact-invalid">
              <AlertCircle size={13} strokeWidth={1.8} aria-hidden="true" />
              <span class="markdown-drop-fact-label">{formatMarkdownDropSkippedLabel(markdownDropPreview)}</span>
            </span>
          {/if}
        </div>
      </div>
    </div>
  {/if}

  <!-- Sidebar navigation -->
  <Sidebar
    visible={notesStore.sidebarVisible}
    onCreateNote={handleQuickCreate}
    onOpenHome={openHomeScreen}
    onOpenSettings={() => { uiStore.openSettings(); }}
    onOpenQuickSwitcher={() => { uiStore.openQuickSwitcher(); }}
    onOpenTasks={toggleTasksWorkspace}
    onRequestDeleteNote={requestNoteDelete}
    onNoteContextMenu={(path, title, position, isFolder = false) => { noteContextMenu = { path, title, isFolder, position }; }}
    onRequestCreateFolder={openCreateFolderModal}
    onSplitNote={openNoteAsSplit}
  />

  <!-- Main column: header + content -->
  <div class="app-main">
    <!-- Document toolbar -->
    <header class="app-header" role="toolbar" aria-label="Document toolbar">
      <div class="header-left">
        <!-- Sidebar toggle -->
        <button
          type="button"
          class="header-btn"
          onclick={() => notesStore.toggleSidebar()}
          title="Toggle sidebar (Cmd+B)"
          aria-label="Toggle sidebar"
        >
          <svg width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.6">
            <path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>

        <!-- Back/Forward navigation -->
        <button
          type="button"
          class="header-btn"
          onclick={() => notesStore.goBack()}
          disabled={!notesStore.canGoBack}
          title="Back (Cmd+[)"
          aria-label="Go back"
        >
          <svg width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.7">
            <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <button
          type="button"
          class="header-btn"
          onclick={() => notesStore.goForward()}
          disabled={!notesStore.canGoForward}
          title="Forward (Cmd+])"
          aria-label="Go forward"
        >
          <svg width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.7">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>

        <!-- Breadcrumb navigation -->
        {#if currentDocument && notesStore.selectedPath}
          <Breadcrumbs
            path={notesStore.selectedPath}
            title={notesStore.titleForPath(notesStore.selectedPath, currentDocument.meta.title)}
            onNavigate={handleBreadcrumbNavigate}
          />
        {:else if activeTagView}
          <div class="tag-context" aria-label="Tag detail view">
            <button
              type="button"
              class="tag-context-root"
              onclick={openHomeScreen}
              title="Back to workspace"
            >
              Workspace
            </button>
            <span class="tag-context-sep" aria-hidden="true">/</span>
            <span class="tag-context-current">
              <Hash size={12} strokeWidth={2} aria-hidden="true" />
              <span>{activeTagView}</span>
            </span>
            <button
              type="button"
              class="tag-context-close"
              onclick={closeTagView}
              title="Close tag view"
              aria-label="Close tag view"
            >
              <X size={12} strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
        {:else if activeFolderOverview}
          <div class="tag-context" aria-label="Folder overview">
            <button
              type="button"
              class="tag-context-root"
              onclick={openHomeScreen}
              title="Back to workspace"
            >
              Workspace
            </button>
            <span class="tag-context-sep" aria-hidden="true">/</span>
            <span class="tag-context-current">
              <FolderOpen size={12} strokeWidth={2} aria-hidden="true" />
              <span>{activeFolderOverview.title}</span>
            </span>
            <button
              type="button"
              class="tag-context-close"
              onclick={openHomeScreen}
              title="Close folder view"
              aria-label="Close folder view"
            >
              <X size={12} strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
        {/if}
      </div>

      <div class="header-right">
        {#if currentDocument}
          <!-- Save status dot with subtle label on hover -->
          <span
            class="save-indicator"
            class:save-saved={saveStatus === 'saved'}
            class:save-saving={saveStatus === 'saving'}
            class:save-unsaved={saveStatus === 'unsaved'}
            role="status"
            aria-label={saveStatus === 'saved' ? 'Document saved' : saveStatus === 'saving' ? 'Saving document' : 'Unsaved changes'}
            title={saveStatus === 'saved' ? 'Saved' : saveStatus === 'saving' ? 'Saving…' : 'Unsaved changes'}
          >
            <span class="save-dot"></span>
          </span>

          <button
            type="button"
            class="header-btn"
            class:header-btn-active={uiStore.lineageWorkspaceOpen}
            onclick={openCurrentNoteHistory}
            title="Open history (⌘⌥T)"
            aria-label="Open note history"
          >
            <History size={15} strokeWidth={1.7} aria-hidden="true" />
          </button>

          <div class="header-menu-wrap">
            <button
              type="button"
              class="header-btn"
              class:header-btn-active={noteActionsMenuOpen}
              onclick={() => { noteActionsMenuOpen = !noteActionsMenuOpen; }}
              title="Note actions"
              aria-label="Note actions"
              aria-expanded={noteActionsMenuOpen}
            >
              <MoreHorizontal size={15} strokeWidth={1.7} aria-hidden="true" />
            </button>

            {#if noteActionsMenuOpen}
              <button
                type="button"
                class="header-menu-backdrop"
                aria-label="Close note actions"
                onclick={closeNoteActionsMenu}
              ></button>
              <div class="header-menu" role="menu" aria-label="Note actions" tabindex="-1" onkeydown={handleNoteActionsKeydown}>
                <button
                  type="button"
                  class="header-menu-item"
                  role="menuitem"
                  onclick={toggleCurrentNoteFavorite}
                >
                  <Star size={14} strokeWidth={1.7} fill={currentNoteFavorite ? 'currentColor' : 'none'} aria-hidden="true" />
                  <span>{currentNoteFavorite ? 'Remove from Favorites' : 'Add to Favorites'}</span>
                </button>
                <button
                  type="button"
                  class="header-menu-item"
                  role="menuitem"
                  onclick={copyCurrentNoteRefFromMenu}
                >
                  <Copy size={14} strokeWidth={1.7} aria-hidden="true" />
                  <span>Copy Ref</span>
                </button>
                <button
                  type="button"
                  class="header-menu-item"
                  role="menuitem"
                  onclick={revealCurrentNoteFromMenu}
                >
                  <FolderSearch size={14} strokeWidth={1.7} aria-hidden="true" />
                  <span>Show in Finder</span>
                </button>
                <div class="header-menu-separator" role="separator"></div>
                <button
                  type="button"
                  class="header-menu-item header-menu-item-danger"
                  role="menuitem"
                  onclick={requestCurrentNoteDeleteFromMenu}
                >
                  <Trash2 size={14} strokeWidth={1.7} aria-hidden="true" />
                  <span>Move to Trash</span>
                </button>
              </div>
            {/if}
          </div>

          <span class="header-divider" aria-hidden="true"></span>

          <!-- Quick switcher / search -->
          <button
            type="button"
            class="header-btn header-btn-search"
            onclick={() => { uiStore.openQuickSwitcher(); }}
            title="Quick switcher (⌘P)"
            aria-label="Quick switcher"
          >
            <svg width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.7">
              <circle cx="11" cy="11" r="7" />
              <path stroke-linecap="round" d="M21 21l-4.35-4.35" />
            </svg>
            <span class="header-btn-kbd">⌘P</span>
          </button>

          <!-- AI button — refined sparkle -->
          <button
            type="button"
            class="header-btn header-btn-ai"
            class:header-btn-active={aiSidebarVisible}
            onclick={() => { uiStore.toggleAISidebar(); }}
            title="Ask Void (⌘⇧O)"
            aria-label="Toggle AI assistant"
          >
            <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.6">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 3v3M12 18v3M21 12h-3M6 12H3M18.36 5.64l-2.12 2.12M7.76 16.24l-2.12 2.12M18.36 18.36l-2.12-2.12M7.76 7.76L5.64 5.64" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            <span class="header-btn-label">Ask</span>
          </button>
        {/if}
      </div>
    </header>

    <!-- Content area -->
    <main id="main-content" class="app-content">
      {#if tasksWorkspaceOpen}
        <TodoWorkspace bind:this={todoWorkspace} onClose={closeTasksWorkspace} onNavigateToFile={navigateToTodoSource} />
      {:else if activeTagView}
        <TagDetailView tag={activeTagView} />
      {:else if activeFolderOverview}
        <FolderOverview
          overview={activeFolderOverview}
          onCreateNote={createNoteInActiveFolder}
          onOpenNote={openFolderNote}
          onOpenFolder={openFolderOverview}
          onReorderFolder={reorderFolderFromOverview}
          onSearch={searchActiveFolder}
          onSummarize={summarizeActiveFolder}
        />
      {:else if error}
        <!-- Error state -->
        <div class="state-container">
          <div class="error-icon">
            <svg width="24" height="24" style="color: var(--color-error);" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
            </svg>
          </div>
          <p class="state-text">{error}</p>
          <button
            onclick={() => {
              error = null;
              if (notesStore.selectedPath) {
                loadSelectedDocument(notesStore.selectedPath);
              }
            }}
            class="btn btn-primary"
          >
            Try again
          </button>
        </div>
      {:else if !currentDocument && !noteWorkspaceStore.hasTabs}
        <!-- Empty state — refined, with quick paths -->
        <div class="state-container animate-scale-in-subtle">
          <div class="empty-mark" aria-hidden="true">
            <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
              <circle cx="20" cy="20" r="19" stroke="currentColor" stroke-width="1" stroke-dasharray="2 4" opacity="0.35"/>
              <circle cx="20" cy="20" r="3" fill="currentColor" opacity="0.85"/>
            </svg>
          </div>
          <h2 class="empty-heading">What are we capturing today?</h2>
          <p class="empty-subtext">Start a note, open your tasks, or ask Void to organize the next step.</p>

          <div class="empty-actions">
            <button type="button" class="empty-action empty-action-primary" onclick={handleQuickCreate}>
              <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 5v14M5 12h14" />
              </svg>
              New note
              <kbd>⌘N</kbd>
            </button>
            <button type="button" class="empty-action" onclick={() => { uiStore.openQuickSwitcher(); }}>
              <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8">
                <circle cx="11" cy="11" r="7" />
                <path stroke-linecap="round" d="M21 21l-4.35-4.35" />
              </svg>
              Open
              <kbd>⌘P</kbd>
            </button>
            <button type="button" class="empty-action" onclick={() => { uiStore.openAISidebar(); }}>
              <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.7">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 3v3M12 18v3M21 12h-3M6 12H3M18.36 5.64l-2.12 2.12M7.76 16.24l-2.12 2.12M18.36 18.36l-2.12-2.12M7.76 7.76L5.64 5.64" />
                <circle cx="12" cy="12" r="3" />
              </svg>
              Ask
              <kbd>⌘⇧O</kbd>
            </button>
          </div>
        </div>
      {:else}
        <WorkspaceTabs />
        <NotePaneWorkspace
          document={currentDocument}
          onSaveStatusChange={(status) => { saveStatus = status; }}
          onCountsChange={(wc, cc) => { wordCount = wc; charCount = cc; }}
          onError={(err) => { error = err; }}
          onTitleRename={handleTitleRename}
          {editorStyle}
        />
      {/if}
    </main>
  </div>

  <!-- AI Command Center -->
  <AICommandCenter visible={aiSidebarVisible} onClose={() => { uiStore.closeAISidebar(); }} />

  <!-- Status Bar (full width, below everything) -->
  <StatusBar
    hasDocument={!!currentDocument}
    {wordCount}
    {charCount}
    {saveStatus}
    onToggleLogs={() => logStore.toggle()}
    logErrorCount={logStore.errorCount}
    activeOperationCount={activeWorkCount}
    activeOperationLabel={activeWorkLabel}
    onToggleOperations={() => { uiStore.openAISidebar(); aiStore.setSidebarView('actions'); }}
  />

  <!-- Quick Switcher / Command Palette -->
  <QuickSwitcher
    isOpen={quickSwitcherOpen}
    onClose={() => uiStore.closeQuickSwitcher()}
    commands={paletteCommands}
  />

  <!-- Find in Files (Cmd+Shift+F) -->
  <SearchPanel
    isOpen={uiStore.searchPanelOpen}
    onClose={() => uiStore.closeSearchPanel()}
  />

  <!-- Local Graph (Cmd+Shift+G) -->
  <GraphView />

  <!-- Pulse Inbox (Cmd+Shift+U) -->
  <PulseInbox />

  <!-- Clipboard History (Cmd+Shift+V) -->
  <ClipboardHistoryPicker />

  <!-- GitHub sync conflict workspace -->
  <SyncConflictWorkspace />

  <!-- Protected notes unlock -->
  <ProtectionUnlockSheet />

  <!-- macOS notes folder reconnect -->
  <FolderReconnectSheet />

  {#if pendingNoteDelete}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="delete-confirm-backdrop"
      onclick={closeDeleteConfirmation}
      role="presentation"
    >
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        bind:this={deleteDialogRef}
        class="delete-confirm-dialog"
        onclick={(event) => event.stopPropagation()}
        onkeydown={(event) => event.stopPropagation()}
        role="dialog"
        tabindex="-1"
        aria-modal="true"
        aria-labelledby="delete-confirm-title"
        aria-describedby="delete-confirm-description"
      >
        <div class="delete-confirm-header">
          <h2 id="delete-confirm-title" class="delete-confirm-title">Move note to Trash?</h2>
          <p id="delete-confirm-description" class="delete-confirm-description">
            This moves "{pendingNoteDelete.title}" to Trash. You can restore it later.
          </p>
        </div>
        <div class="delete-confirm-actions">
          <button
            type="button"
            class="delete-confirm-cancel"
            onclick={closeDeleteConfirmation}
            disabled={deleteInProgress}
          >
            Cancel
          </button>
          <button
            bind:this={deleteConfirmButton}
            type="button"
            class="delete-confirm-delete"
            onclick={confirmDeleteNote}
            disabled={deleteInProgress}
          >
            {deleteInProgress ? 'Moving...' : 'Move to Trash'}
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- Settings Panel -->
  <SettingsPanel
    isOpen={settingsOpen}
    onClose={() => uiStore.closeSettings()}
  />

  <!-- Log Panel -->
  <LogPanel />

  <!-- Note Context Menu -->
  {#if noteContextMenu}
    <NoteContextMenu
      path={noteContextMenu.path}
      title={noteContextMenu.title}
      isFolder={noteContextMenu.isFolder}
      position={noteContextMenu.position}
      onRequestDeleteNote={requestNoteDelete}
      onRequestCreateFolder={(parentPath) => {
        noteContextMenu = null;
        openCreateFolderModal(parentPath);
      }}
      onRequestDeleteFolder={(path, title) => {
        noteContextMenu = null;
        requestFolderDelete(path, title);
      }}
      onClose={() => { noteContextMenu = null; }}
    />
  {/if}

  <!-- Create Folder Modal -->
  {#if createFolderTarget}
    <CreateFolderModal
      parentPath={createFolderTarget.parentPath}
      onSubmit={handleCreateFolderSubmit}
      onClose={() => { createFolderTarget = null; }}
    />
  {/if}

  <!-- Delete Folder Modal -->
  {#if pendingFolderDelete}
    <DeleteFolderModal
      path={pendingFolderDelete.path}
      title={pendingFolderDelete.title}
      noteCount={pendingFolderDelete.noteCount}
      folderCount={pendingFolderDelete.folderCount}
      onConfirm={handleFolderDeleteConfirm}
      onClose={() => { pendingFolderDelete = null; }}
    />
  {/if}
</div>

<!-- Toast notifications (overlay, outside the app shell so they sit on top) -->
<ToastContainer />

<style>
  /* App shell — full viewport grid.
     `position: relative` so the sidebar can promote to an overlay layer
     (position: absolute) on narrow viewports without escaping the shell. */
  .app-shell {
    position: relative;
    display: grid;
    grid-template-columns: auto 1fr auto;
    grid-template-rows: 1fr auto;
    height: 100%;
    overflow: hidden;
    background: var(--bg-app);
    color: var(--text-primary);
  }

  /* Sidebar overlay backdrop — only visible when sidebar overlays the
     main content (below the lg breakpoint). Hidden by default; the
     media query at the bottom flips visibility based on .sidebar-open. */
  .sidebar-overlay-backdrop {
    display: none;
  }

  .markdown-drop-overlay {
    position: fixed;
    inset: 0;
    z-index: var(--z-modal);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    pointer-events: none;
    background: color-mix(in srgb, var(--bg-editor) 74%, transparent);
    backdrop-filter: blur(8px) saturate(120%);
    -webkit-backdrop-filter: blur(8px) saturate(120%);
    animation: markdown-drop-overlay-in 120ms var(--ease-out-soft);
  }

  .markdown-drop-overlay::before {
    content: '';
    position: absolute;
    inset: 14px;
    border: 1.5px dashed var(--accent-primary);
    border-radius: 8px;
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent-primary) 12%, transparent);
    opacity: 0.9;
  }

  .markdown-drop-overlay-mixed::before {
    border-color: var(--color-warning);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-warning) 18%, transparent);
  }

  .markdown-drop-overlay-invalid::before {
    border-color: var(--color-error);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-error) 16%, transparent);
  }

  .markdown-drop-panel {
    position: relative;
    z-index: 1;
    width: min(440px, calc(100vw - 56px));
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 14px;
    padding: 18px;
    border: 1px solid var(--border-light);
    border-radius: 8px;
    background: var(--bg-card);
    box-shadow: var(--shadow-dialog);
  }

  .markdown-drop-icon {
    width: 44px;
    height: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 8px;
    color: var(--accent-primary);
    background: var(--ai-accent-light);
  }

  .markdown-drop-overlay-mixed .markdown-drop-icon {
    color: var(--color-warning);
    background: color-mix(in srgb, var(--color-warning) 12%, var(--bg-subtle));
  }

  .markdown-drop-overlay-invalid .markdown-drop-icon {
    color: var(--color-error);
    background: var(--color-error-bg);
  }

  .markdown-drop-copy {
    min-width: 0;
  }

  .markdown-drop-kicker {
    display: block;
    margin-bottom: 3px;
    color: var(--text-tertiary);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .markdown-drop-copy h2 {
    margin: 0;
    color: var(--text-primary);
    font-size: 17px;
    font-weight: 650;
    line-height: 1.25;
  }

  .markdown-drop-copy p {
    margin: 6px 0 0;
    color: var(--text-secondary);
    font-size: var(--text-small);
    line-height: 1.45;
  }

  .markdown-drop-facts {
    grid-column: 2;
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: -2px;
  }

  .markdown-drop-fact {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
    min-height: 23px;
    max-width: min(300px, 100%);
    padding: 3px 8px;
    border: 1px solid var(--border-light);
    border-radius: 999px;
    background: var(--bg-subtle);
    color: var(--text-secondary);
    font-size: 11px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .markdown-drop-fact-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .markdown-drop-fact-valid {
    color: var(--accent-primary);
    border-color: color-mix(in srgb, var(--accent-primary) 28%, var(--border-light));
  }

  .markdown-drop-fact-invalid {
    color: var(--color-error);
    border-color: color-mix(in srgb, var(--color-error) 24%, var(--border-light));
  }

  @keyframes markdown-drop-overlay-in {
    from {
      opacity: 0;
      transform: scale(0.99);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }

  /* Focus/zen mode — hide chrome */
  .focus-mode .app-header,
  .focus-mode :global(.statusbar) {
    opacity: 0;
    pointer-events: none;
    height: 0;
    min-height: 0;
    overflow: hidden;
    transition: opacity 360ms var(--ease-out-soft), height 360ms var(--ease-out-soft);
  }

  .app-header {
    transition: opacity 360ms var(--ease-out-soft), height 360ms var(--ease-out-soft);
  }

  /* Main column */
  .app-main {
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-width: 0;
    background: var(--bg-editor);
    border-left: 1px solid var(--border-light);
  }

  /* ─── Header ─── refined, lighter, breathable */
  .app-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: var(--header-height);
    padding: 0 12px;
    background: var(--bg-editor);
    border-bottom: 1px solid var(--border-faint);
    flex-shrink: 0;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 4px;
    flex: 1;
    min-width: 0;
  }

  .header-right {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .header-divider {
    width: 1px;
    height: 14px;
    background: var(--border-light);
    margin: 0 4px;
  }

  .header-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 26px;
    min-width: 26px;
    padding: 0 6px;
    border: 1px solid transparent;
    background: transparent;
    color: var(--text-secondary);
    border-radius: var(--radius-sm);
    cursor: pointer;
    font-size: var(--text-caption);
    font-family: inherit;
    transition: background-color var(--transition-fast), color var(--transition-fast),
                border-color var(--transition-fast);
  }

  .header-btn:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .header-btn:disabled {
    color: var(--text-placeholder);
    cursor: not-allowed;
  }

  .header-btn-search {
    gap: 6px;
    padding: 0 8px 0 8px;
  }

  .header-btn-ai {
    gap: 5px;
    padding: 0 9px 0 8px;
  }

  .header-btn-label {
    font-size: var(--text-caption);
    font-weight: 500;
    color: inherit;
  }

  .header-btn-kbd {
    font-size: 10px;
    color: var(--text-muted);
    font-family: var(--font-sans);
    font-variant-numeric: tabular-nums;
    margin-left: 2px;
    letter-spacing: 0.02em;
  }

  .header-btn-active {
    color: var(--ai-accent);
    background: var(--ai-accent-light);
  }

  .header-btn-active:hover:not(:disabled) {
    background: var(--ai-accent-light);
    color: var(--ai-accent);
  }

  .header-btn:focus-visible {
    outline: 2px solid var(--accent-primary);
    outline-offset: 1px;
  }

  .header-menu-wrap {
    position: relative;
    display: inline-flex;
  }

  .header-menu-backdrop {
    position: fixed;
    inset: 0;
    z-index: calc(var(--z-popover) - 1);
    border: 0;
    background: transparent;
    cursor: default;
  }

  .header-menu {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    z-index: var(--z-popover);
    width: 190px;
    padding: 5px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-lg);
    background: var(--bg-card);
    box-shadow: var(--shadow-popover);
    backdrop-filter: blur(18px) saturate(140%);
    -webkit-backdrop-filter: blur(18px) saturate(140%);
  }

  .header-menu-item {
    display: flex;
    width: 100%;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-small);
    text-align: left;
    cursor: pointer;
  }

  .header-menu-item:hover,
  .header-menu-item:focus-visible {
    background: var(--bg-hover);
    outline: none;
  }

  .header-menu-item-danger {
    color: var(--color-error);
  }

  .header-menu-item-danger:hover,
  .header-menu-item-danger:focus-visible {
    background: var(--color-error-bg);
  }

  .header-menu-separator {
    height: 1px;
    margin: 5px 6px;
    background: var(--border-light);
  }

  /* ─── Header tag context ─── breadcrumb-style indicator for embedded tag view */
  .tag-context {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    margin-left: 4px;
    min-width: 0;
    flex: 1;
    font-size: var(--text-caption);
    color: var(--text-tertiary);
    letter-spacing: -0.003em;
  }

  .tag-context-root {
    border: 0;
    background: none;
    padding: 2px 5px;
    margin: 0 -3px;
    color: var(--text-tertiary);
    font: inherit;
    cursor: pointer;
    border-radius: var(--radius-xs);
    transition: background var(--transition-fast), color var(--transition-fast);
  }

  .tag-context-root:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .tag-context-root:focus-visible {
    outline: 2px solid var(--accent-primary);
    outline-offset: 1px;
  }

  .tag-context-sep {
    color: var(--text-placeholder);
    font-size: 11px;
    margin: 0 1px;
  }

  .tag-context-current {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--text-primary);
    font-weight: 500;
    letter-spacing: -0.005em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 320px;
  }

  .tag-context-current :global(svg) {
    color: var(--accent-primary);
    flex-shrink: 0;
  }

  .tag-context-close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    padding: 0;
    margin-left: 2px;
    border: 0;
    background: transparent;
    color: var(--text-muted);
    border-radius: var(--radius-xs);
    cursor: pointer;
    transition: background var(--transition-fast), color var(--transition-fast);
  }

  .tag-context-close:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .tag-context-close:focus-visible {
    outline: 2px solid var(--accent-primary);
    outline-offset: 1px;
  }

  .delete-confirm-backdrop {
    position: fixed;
    inset: 0;
    z-index: var(--z-modal);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: var(--bg-overlay);
    backdrop-filter: blur(8px) saturate(140%);
    -webkit-backdrop-filter: blur(8px) saturate(140%);
  }

  .delete-confirm-dialog {
    width: 340px;
    max-width: 100%;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-lg);
    background: var(--bg-card);
    box-shadow: var(--shadow-dialog);
    overflow: hidden;
    outline: none;
  }

  .delete-confirm-header {
    padding: 18px 18px 14px;
  }

  .delete-confirm-title {
    margin: 0 0 6px;
    font-size: 15px;
    font-weight: 600;
    color: var(--text-primary);
    letter-spacing: -0.003em;
  }

  .delete-confirm-description {
    margin: 0;
    color: var(--text-secondary);
    font-size: var(--text-small);
    line-height: 1.5;
  }

  .delete-confirm-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 12px 14px 14px;
    border-top: 1px solid var(--border-faint);
    background: var(--bg-subtle);
  }

  .delete-confirm-cancel,
  .delete-confirm-delete {
    min-width: 78px;
    height: 30px;
    padding: 0 12px;
    border-radius: var(--radius-sm);
    font-family: inherit;
    font-size: var(--text-small);
    font-weight: 500;
    cursor: pointer;
  }

  .delete-confirm-cancel {
    border: 1px solid var(--border-light);
    background: var(--bg-card);
    color: var(--text-secondary);
  }

  .delete-confirm-cancel:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .delete-confirm-delete {
    border: 1px solid var(--color-error);
    background: var(--color-error);
    color: var(--text-inverse);
  }

  .delete-confirm-delete:hover:not(:disabled) {
    filter: brightness(0.95);
  }

  .delete-confirm-cancel:disabled,
  .delete-confirm-delete:disabled {
    cursor: not-allowed;
    opacity: 0.65;
  }

  .delete-confirm-cancel:focus-visible,
  .delete-confirm-delete:focus-visible {
    outline: 2px solid var(--accent-primary);
    outline-offset: 2px;
  }

  /* ─── Save indicator ─── pill with dot */
  .save-indicator {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: var(--radius-full);
  }

  .save-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
    transition: background var(--transition-normal);
  }

  .save-saved .save-dot {
    background: var(--color-success);
    opacity: 0.7;
  }

  .save-saving .save-dot {
    background: var(--color-warning);
    animation: save-pulse 1.4s var(--ease-in-soft) infinite;
  }

  .save-unsaved .save-dot {
    background: var(--color-warning);
  }

  @keyframes save-pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.4; transform: scale(0.85); }
  }

  /* Content area */
  .app-content {
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    background: var(--bg-editor);
  }

  /* Status bar spans full width */
  .app-shell > :global(.statusbar) {
    grid-column: 1 / -1;
  }

  /* ─── State containers ─── */
  .state-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    padding: 48px 24px;
    text-align: center;
  }

  .error-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    background: var(--color-error-bg);
    margin-bottom: 16px;
  }

  .state-text {
    font-size: var(--text-body);
    color: var(--text-secondary);
    margin-bottom: 16px;
  }

  /* ─── Empty state ─── intentional, inviting */
  .empty-mark {
    color: var(--accent-primary);
    margin-bottom: 28px;
    opacity: 0.7;
  }

  .empty-heading {
    font-size: 20px;
    font-weight: 600;
    letter-spacing: -0.012em;
    color: var(--text-primary);
    margin: 0;
  }

  .empty-subtext {
    font-size: var(--text-body);
    color: var(--text-tertiary);
    margin: 6px 0 0;
    max-width: 320px;
    line-height: 1.5;
  }

  .empty-actions {
    margin-top: 28px;
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    justify-content: center;
  }

  .empty-action {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 7px 12px 7px 11px;
    font-size: var(--text-small);
    font-weight: 500;
    color: var(--text-secondary);
    background: var(--bg-card);
    border: 1px solid var(--border-medium);
    border-radius: var(--radius-md);
    cursor: pointer;
    box-shadow: var(--shadow-xs);
    font-family: inherit;
    transition: background var(--transition-fast), border-color var(--transition-fast),
                color var(--transition-fast), box-shadow var(--transition-fast);
  }

  .empty-action:hover {
    background: var(--bg-subtle);
    border-color: var(--border-dark);
    color: var(--text-primary);
  }

  .empty-action-primary {
    color: var(--text-inverse);
    background: var(--accent-primary);
    border-color: transparent;
    box-shadow: 0 1px 2px rgba(20, 19, 16, 0.10), inset 0 1px 0 rgba(255, 255, 255, 0.10);
  }

  .empty-action-primary:hover {
    background: var(--accent-hover);
    border-color: transparent;
    color: var(--text-inverse);
  }

  .empty-action kbd {
    font-size: 10px;
    color: inherit;
    background: rgba(255, 255, 255, 0.18);
    padding: 1px 5px;
    border-radius: 4px;
    margin-left: 2px;
    border: none;
    font-family: var(--font-sans);
    opacity: 0.85;
  }

  .empty-action:not(.empty-action-primary) kbd {
    background: var(--bg-subtle);
    color: var(--text-muted);
    border: 1px solid var(--border-light);
  }

  /* Skip link */
  :global(.skip-link) {
    position: absolute;
    left: -9999px;
    top: auto;
    width: 1px;
    height: 1px;
    overflow: hidden;
  }

  :global(.skip-link:focus) {
    position: fixed;
    top: 0;
    left: 0;
    width: auto;
    height: auto;
    padding: 8px 16px;
    background: var(--accent-primary);
    color: var(--text-inverse);
    z-index: 1000;
    font-size: var(--text-small);
  }

  /* ─── Tablet & smaller: sidebar overlays content ─────────────────────
     Below the lg breakpoint, the sidebar becomes an absolutely-positioned
     overlay drawer. Once it's absolute it is no longer a grid item, so
     we collapse the grid to a single column for the main content. The
     status bar still spans the full width thanks to `grid-column: 1/-1`. */
  @media (max-width: 879px) {
    .app-shell {
      grid-template-columns: 1fr;
    }

    .app-shell :global(.sidebar) {
      position: absolute;
      top: 0;
      bottom: 0;
      left: 0;
      z-index: var(--z-overlay);
      box-shadow: var(--shadow-lg);
      transform: translateX(-100%);
      transition:
        transform 280ms var(--ease-out-soft),
        opacity 220ms var(--ease-out-soft);
    }

    .app-shell.sidebar-open :global(.sidebar) {
      transform: translateX(0);
    }

    /* Hide resize handle when sidebar is a drawer. */
    .app-shell :global(.sidebar .resize-handle) {
      display: none;
    }

    /* Main column should always get the full width at this size. */
    .app-main {
      border-left: none;
      min-width: 0;
    }

    /* Backdrop appears when sidebar drawer is open. */
    .app-shell.sidebar-open .sidebar-overlay-backdrop {
      display: block;
      position: absolute;
      inset: 0;
      z-index: calc(var(--z-overlay) - 1);
      border: 0;
      padding: 0;
      background: var(--bg-overlay);
      cursor: default;
      animation: backdrop-in 200ms var(--ease-out-soft);
    }
  }

  @keyframes backdrop-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  /* ─── Tablet: tighten header chrome and hide kbd hints ─── */
  @media (max-width: 879px) {
    .app-header {
      padding: 0 8px;
      gap: 4px;
    }

    .header-left {
      gap: 2px;
    }

    .header-right {
      gap: 4px;
    }

    /* Search button collapses to icon-only. */
    .header-btn-search .header-btn-kbd {
      display: none;
    }

    /* Ask button collapses to icon-only. */
    .header-btn-ai .header-btn-label {
      display: none;
    }

    /* Note actions menu can stay; it's only visible for documents. */
    .tag-context-current {
      max-width: 200px;
    }
  }

  /* ─── Phone: hide back/forward and the breadcrumb root, lean on swipe */
  @media (max-width: 479px) {
    /* Hide the leading workspace label in breadcrumbs; keep current item. */
    .tag-context-root,
    .tag-context-sep {
      display: none;
    }

    .tag-context-current {
      max-width: 60vw;
    }

    /* Empty state: stack actions so they don't crowd. */
    .empty-actions {
      flex-direction: column;
      align-items: stretch;
      width: 100%;
      max-width: 280px;
    }

    .empty-action {
      justify-content: center;
    }
  }
</style>
