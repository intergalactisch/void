/**
 * EditorServiceImpl - application-owned editor lifecycle.
 *
 * UI components talk to this inbound service. The service creates the concrete
 * editor port through an outbound factory, relays editor events, owns autosave,
 * and coordinates cross-service side effects such as todos, links, and AI.
 */

import type {
  AIAssistantService,
  EditorMountOptions,
  EditorService,
  EditorState,
  FrecencyService,
  LineageRecordOptions,
  LineageService,
  NotesListItem,
  NotesService,
  TodoService,
} from '$lib/ports/inbound';
import type {
  BlockInfo,
  CommandRegistryPort,
  DocumentPort,
  EditorBlockMenuRequest,
  EditorInlineGenerateCallbacks,
  EditorInlineGenerateRequest,
  EditorInlineGenerateResult,
  EditorNotesProvider,
  EditorPageLinkNote,
  EditorPort,
  EditorPortFactory,
  ExternalNavigationPort,
  RegisteredCommand,
} from '$lib/ports/outbound';
import type { MarkdownSerializerPort } from '$lib/ports/outbound/MarkdownSerializerPort';
import type { Document, Block, EditorSession } from '$lib/domain';
import { createEditorSession, ConflictError } from '$lib/domain';
import type { DocumentMeta, Selection } from '$lib/domain/values';
import { normalizeNoteTags } from '$lib/domain/values';
import { EMPTY_SELECTION } from '$lib/domain/values/Selection';
import type { ToolId } from '$lib/domain/values/ToolId';
import type { Conversation } from '$lib/domain/entities/Conversation';
import type { Result } from '$lib/core';
import { combineMarkdownWithFrontmatter, ok, err } from '$lib/core';
import { events } from '$lib/events';
import { resolveNoteLinkTarget } from './NoteLinkResolver';

const INITIAL_STATE: EditorState = {
  document: null,
  tabs: [],
  activePath: null,
  selection: EMPTY_SELECTION,
  isReady: false,
  isDirty: false,
  isSaving: false,
  conflictState: 'clean',
  aiProcessing: null,
};

const IN_APP_MUTATION_GRACE_MS = 2000;
const INLINE_SELECTION_TOOL_IDS = [
  'editor:replace',
  'editor:replace-block',
  'editor:apply-note-patch',
] as ToolId[];

const INLINE_SELECTION_SYSTEM_PROMPT = `You are Void's inline note editor AI. The user selected text inside a note and asked a visible prompt.

Choose the least invasive correct outcome:
- If the user asks a question, asks what something means, asks for critique, or requests explanation, answer only and do not call tools.
- If the selected range itself should be rewritten, call editor:replace with from and to.
- If only one exact substring inside the selection should change, call editor:replace with targetText and occurrence, or with an explicit subrange if provided.
- If a whole visible block should be rewritten, call editor:replace-block with one of the supplied block IDs.
- If the entire note must change, call editor:apply-note-patch with complete markdown for the note.

Only use these editor write tools when the user's request truly asks for an edit. Never invent a broader edit when an answer or smaller replacement is enough.
Always include a concise user-facing response. When you edit, summarize what changed; do not paste the entire replacement unless that is genuinely useful.`;

export class EditorServiceImpl implements EditorService {
  private state: EditorState = { ...INITIAL_STATE };
  private subscribers: Set<(state: EditorState) => void> = new Set();
  private editorPort: EditorPort | null = null;
  private editorElement: HTMLElement | null = null;
  private editorUnsubscribers: Array<() => void> = [];
  private todoSyncCleanup: (() => void) | null = null;
  private autoSaveDelayMs = 1000;
  private saveTimeout: ReturnType<typeof setTimeout> | null = null;
  private readonly lineageClusters = new Map<string, { id: string; lastTouchedAt: number }>();
  private readonly lineageClusterWindowMs = 8000;

  /**
   * Multi-tab session map. One entry per open tab; the active session
   * matches `state.activePath`. Each session carries its own document
   * snapshot (re-synced from the editor on switch/save), dirty flag,
   * and conflict state.
   *
   * Note: this implementation uses ONE active EditorPort at a time. On
   * tab switch, the current editor's content is captured back into its
   * session, the port is destroyed, and a new port is mounted from the
   * target session. ProseMirror history (undo/redo) does not survive
   * a tab switch yet — that needs per-tab EditorViews and is a future
   * enhancement noted in the plan.
   */
  private sessions: Map<string, EditorSession> = new Map();

  /** Cleanup function for the file:changed bus subscription. */
  private fileChangedCleanup: (() => void) | null = null;
  private noteRenamedCleanup: (() => void) | null = null;
  private readonly recentInAppMutations = new Map<string, number>();

  constructor(
    private readonly documentPort: DocumentPort,
    private readonly commandRegistry: CommandRegistryPort,
    private readonly editorPortFactory?: EditorPortFactory,
    private readonly externalNavigation?: ExternalNavigationPort,
    private readonly aiAssistant?: AIAssistantService,
    private readonly todoService?: TodoService,
    private readonly notesService?: NotesService,
    private readonly notesPath?: string,
    private readonly markdown?: MarkdownSerializerPort,
    private readonly lineageService?: LineageService,
    private readonly frecency?: FrecencyService,
  ) {
    this.subscribeToTodoWorkspaceSync();
    this.subscribeToFileChanges();
    this.subscribeToNoteRenames();
  }

  /**
   * React to disk-level file changes for any open session.
   *
   * Strategy:
   * - If the changed path matches an open session AND that session is
   *   clean (no unsaved edits), silently reload its document so the
   *   editor reflects the on-disk state.
   * - If the session is dirty, mark its conflict state so the UI can
   *   show a banner (Phase 6 wires the actual UI).
   * - Self-induced events (the active editor wrote the file) are
   *   filtered: a save just bumped lastSavedAt, so events arriving
   *   within a short grace window after a save are ignored.
   */
  private subscribeToFileChanges(): void {
    const SELF_WRITE_GRACE_MS = 500;

    const handler = async (payload: { path: string; kind: string }): Promise<void> => {
      this.pruneRecentInAppMutations();
      if (this.hasRecentInAppMutation(payload.path)) return;

      const matched = this.matchSessionToAbsolutePath(payload.path);
      if (!matched) return;

      // Filter self-induced events.
      if (matched.lastSavedAt) {
        const sinceSave = Date.now() - matched.lastSavedAt.getTime();
        if (sinceSave < SELF_WRITE_GRACE_MS) return;
      }

      if (payload.kind === 'remove') {
        matched.conflictState = 'external-deleted';
        events.emit('editor:conflict', { path: matched.path, kind: 'deleted' });
        this.updateState({});
        return;
      }

      if (matched.isDirty) {
        matched.conflictState = 'external-modified';
        events.emit('editor:conflict', { path: matched.path, kind: 'modified' });
        this.updateState({});
        return;
      }

      // Clean session — reload silently.
      const result = await this.documentPort.load(matched.path);
      if (!result.ok) {
        events.emit('document:load-failed', { path: matched.path, error: result.error });
        return;
      }
      await this.ensureLineageBaseline(result.value);
      matched.document = result.value;
      matched.conflictState = 'clean';

      // If this is the active session, refresh the editor mount.
      if (this.state.activePath === matched.path && this.editorElement) {
        await this.mount(this.editorElement, matched.document);
      }
      this.updateState({
        document: this.state.activePath === matched.path ? matched.document : this.state.document,
      });
    };

    // Coordinate self-writes from any in-app writer (TodoService,
    // MarkdownAdapter.save, etc.). Stamping lastSavedAt here means the
    // existing 500ms grace check above treats the upcoming watcher event
    // as a self-write and skips conflict detection.
    const selfWriteHandler = (payload: { path: string }): void => {
      this.rememberInAppMutation(payload.path);
      const matched = this.matchSessionToAbsolutePath(payload.path);
      if (!matched) return;
      matched.lastSavedAt = new Date();
    };

    events.on('file:changed', handler);
    events.on('editor:self-write', selfWriteHandler);
    this.fileChangedCleanup = () => {
      events.off('file:changed', handler);
      events.off('editor:self-write', selfWriteHandler);
    };
  }

  private subscribeToNoteRenames(): void {
    const handler = (payload: { oldPath: string; newPath: string; newTitle: string }): void => {
      this.handleNoteRenamed(payload.oldPath, payload.newPath, payload.newTitle);
    };

    events.on('note:renamed', handler);
    this.noteRenamedCleanup = () => {
      events.off('note:renamed', handler);
    };
  }

  private handleNoteRenamed(oldPath: string, newPath: string, newTitle: string): void {
    if (!this.sessions.has(oldPath)) return;

    if (this.state.activePath === oldPath) {
      this.syncActiveSessionFromEditor();
      this.clearSaveTimer();
    }

    const current = this.sessions.get(oldPath);
    if (!current) return;

    const renamedDocument: Document = {
      ...current.document,
      path: newPath,
      meta: {
        ...current.document.meta,
        title: newTitle,
        updatedAt: new Date(),
      },
    };

    if (oldPath === newPath) {
      current.document = renamedDocument;
      if (this.state.activePath === oldPath) {
        this.editorPort?.updateMetadata(renamedDocument.meta);
        this.updateState({ document: renamedDocument });
      } else {
        this.updateState({});
      }
      return;
    }

    const renamedSession: EditorSession = {
      ...current,
      path: newPath,
      document: renamedDocument,
      conflictState: 'clean',
    };

    const nextSessions = new Map<string, EditorSession>();
    for (const [path, session] of this.sessions) {
      nextSessions.set(path === oldPath ? newPath : path, path === oldPath ? renamedSession : session);
    }
    this.sessions = nextSessions;

    if (this.state.activePath === oldPath) {
      this.editorPort?.update(renamedDocument);
      this.updateState({
        document: renamedDocument,
        activePath: newPath,
        isDirty: renamedSession.isDirty,
        isSaving: renamedSession.isSaving,
      });
    } else {
      this.updateState({});
    }
  }

  /**
   * Find the open session whose document path resolves to the given
   * absolute file path. Sessions store paths relative to the notes
   * directory; the watcher emits absolute paths.
   */
  private matchSessionToAbsolutePath(absolutePath: string): EditorSession | null {
    const normalizedAbsolutePath = this.normalizeAbsolutePath(absolutePath);
    if (!normalizedAbsolutePath) return null;

    for (const session of this.sessions.values()) {
      const sessionAbs = this.normalizeAbsolutePath(this.getAbsolutePath(session.path));
      if (sessionAbs === normalizedAbsolutePath) return session;
      if (sessionAbs && normalizedAbsolutePath.endsWith('/' + session.path)) return session;
    }
    return null;
  }

  getState(): EditorState {
    return { ...this.state };
  }

  /**
   * Test/backward-compatibility hook for code that manually provides a port.
   */
  setEditorPort(editorPort: EditorPort): void {
    this.cleanupEditorSubscriptions();
    this.editorPort = editorPort;
    this.subscribeToEditorPort(editorPort);
  }

  async mount(
    element: HTMLElement,
    document: Document | undefined = this.state.document ?? undefined,
    options: EditorMountOptions = {},
  ): Promise<Result<void, Error>> {
    if (options.autoSaveDelayMs !== undefined) {
      this.setAutoSaveDelay(options.autoSaveDelayMs);
    }

    const documentToMount = document ?? this.state.document;
    if (!documentToMount) {
      return err(new Error('No document open'));
    }

    this.editorElement = element;

    if (this.editorPortFactory) {
      this.cleanupEditorSubscriptions();
      this.editorPort?.destroy();
      const notesProvider = this.createNotesProvider();
      const factoryOptions = {
        commandRegistry: this.commandRegistry,
        enableDragDrop: true,
        enableAIRewrite: true,
        onBlockMenuRequest: () => undefined,
        onLineageInspectRequest: () => undefined,
        onTodoToggle: () => undefined,
        onExternalLinkClick: () => undefined,
      };
      if (notesProvider) {
        Object.assign(factoryOptions, { notesProvider });
      }

      this.editorPort = this.editorPortFactory.create(factoryOptions);
      this.subscribeToEditorPort(this.editorPort);
    }

    if (!this.editorPort) {
      return err(new Error('Editor port not set'));
    }

    const result = await this.editorPort.mount(element, documentToMount);
    if (!result.ok) return result;

    this.updateState({
      document: documentToMount,
      isReady: true,
      isDirty: false,
      isSaving: false,
    });

    return ok(undefined);
  }

  destroy(): void {
    this.clearSaveTimer();
    this.cleanupEditorSubscriptions();
    this.editorPort?.destroy();
    this.editorPort = null;
    this.editorElement = null;
    this.sessions.clear();
    this.recentInAppMutations.clear();
    this.fileChangedCleanup?.();
    this.fileChangedCleanup = null;
    this.noteRenamedCleanup?.();
    this.noteRenamedCleanup = null;
    this.updateState({ ...INITIAL_STATE });
  }

  setAutoSaveDelay(delayMs: number): void {
    if (Number.isFinite(delayMs) && delayMs >= 0) {
      this.autoSaveDelayMs = delayMs;
    }
  }

  async openDocument(path: string): Promise<Result<Document, Error>> {
    // If the path is already open in a tab, just activate it — preserve
    // any unsaved edits in that session.
    if (this.sessions.has(path)) {
      const switchResult = await this.switchTab(path);
      if (!switchResult.ok) return err(switchResult.error);
      const session = this.sessions.get(path)!;
      return ok(session.document);
    }

    // Capture the active editor's content into its session before
    // swapping; this happens inside switchTab on subsequent activations,
    // but for the initial open we do it here so the previous session's
    // in-memory state stays current after the port is destroyed.
    this.syncActiveSessionFromEditor();
    this.clearSaveTimer();

    if (this.editorPort) {
      this.cleanupEditorSubscriptions();
      this.editorPort.destroy();
      this.editorPort = null;
    }

    const result = await this.documentPort.load(path);
    if (!result.ok) {
      events.emit('document:load-failed', { path, error: result.error });
      return result;
    }

    const document = result.value;
    await this.ensureLineageBaseline(document);
    const session = this.upsertSession(document);
    session.document = document;
    session.isDirty = false;
    session.isSaving = false;
    session.conflictState = 'clean';

    this.updateState({
      document,
      activePath: document.path,
      selection: EMPTY_SELECTION,
      isReady: false,
      isDirty: false,
      isSaving: false,
      aiProcessing: null,
    });

    events.emit('document:opened', { document });

    if (this.editorElement) {
      const mountResult = await this.mount(this.editorElement, document);
      if (!mountResult.ok) {
        events.emit('document:load-failed', { path, error: mountResult.error });
        return err(mountResult.error);
      }
    }

    return ok(document);
  }

  async switchTab(path: string): Promise<Result<void, Error>> {
    const target = this.sessions.get(path);
    if (!target) {
      return err(new Error(`Tab not open: ${path}`));
    }
    if (this.state.activePath === path) {
      return ok(undefined);
    }

    // Capture current editor state into its session, then clear the
    // pending autosave for the outgoing tab — its session.document now
    // holds the latest content, and a save against that snapshot can be
    // re-scheduled if the user comes back to it dirty.
    this.syncActiveSessionFromEditor();
    this.clearSaveTimer();

    if (this.editorPort) {
      this.cleanupEditorSubscriptions();
      this.editorPort.destroy();
      this.editorPort = null;
    }

    this.updateState({
      document: target.document,
      activePath: target.path,
      selection: EMPTY_SELECTION,
      isReady: false,
      isDirty: target.isDirty,
      isSaving: target.isSaving,
      aiProcessing: null,
    });

    events.emit('document:opened', { document: target.document });

    if (this.editorElement) {
      const mountResult = await this.mount(this.editorElement, target.document);
      if (!mountResult.ok) {
        events.emit('document:load-failed', { path, error: mountResult.error });
        return err(mountResult.error);
      }
    }
    return ok(undefined);
  }

  async resolveConflict(
    path: string,
    action: 'keep-local' | 'take-remote',
  ): Promise<Result<void, Error>> {
    const session = this.sessions.get(path);
    if (!session) return err(new Error(`Tab not open: ${path}`));
    if (session.conflictState === 'clean') return ok(undefined);

    if (action === 'take-remote') {
      // Discard in-memory edits and reload from disk.
      const result = await this.documentPort.load(path);
      if (!result.ok) {
        events.emit('document:load-failed', { path, error: result.error });
        return result;
      }
      session.document = result.value;
      session.isDirty = false;
      session.conflictState = 'clean';

      // If this is the active session, refresh the editor mount.
      if (this.state.activePath === path && this.editorElement) {
        const mountResult = await this.mount(this.editorElement, session.document);
        if (!mountResult.ok) return mountResult;
      }
      this.updateState({
        document: this.state.activePath === path ? session.document : this.state.document,
        isDirty: this.state.activePath === path ? false : this.state.isDirty,
      });
      return ok(undefined);
    }

    // keep-local: clear conflict and force-save the in-memory document.
    session.conflictState = 'clean';
    this.updateState({});

    // For deleted files, the save will recreate them. For modified files,
    // it overwrites the external version with our copy. Either way, the
    // user explicitly chose this — that's what conflict resolution means.
    if (this.state.activePath === path) {
      return await this.saveDocument();
    }
    // Save a non-active session by routing through documentPort directly.
    const writeResult = await this.documentPort.save(session.document);
    if (!writeResult.ok) {
      events.emit('document:save-failed', { path, error: writeResult.error });
      return writeResult;
    }
    session.isDirty = false;
    session.lastSavedAt = new Date();
    this.updateState({});
    return ok(undefined);
  }

  async closeTab(path: string): Promise<Result<void, Error>> {
    const session = this.sessions.get(path);
    if (!session) return ok(undefined);
    const openPaths = [...this.sessions.keys()];
    const closedIndex = openPaths.indexOf(path);
    const adjacentPath = openPaths[closedIndex + 1] ?? openPaths[closedIndex - 1] ?? null;

    // If closing the active tab, capture its latest state and flush any
    // pending save so we never lose work to a half-completed timer.
    const wasActive = this.state.activePath === path;
    if (wasActive) {
      this.syncActiveSessionFromEditor();
      if (session.isDirty) {
        const saveResult = await this.saveDocument();
        if (!saveResult.ok) return err(saveResult.error);
      } else {
        this.clearSaveTimer();
      }
    }

    this.sessions.delete(path);
    await this.clearTodoSnapshotForPath(path);
    events.emit('document:closed', { path });

    if (!wasActive) {
      // Just refresh tabs[] for subscribers — no remount needed.
      this.updateState({});
      return ok(undefined);
    }

    // The active tab was closed. Activate the next available, or fully
    // tear down the editor if none remain.
    if (!adjacentPath || !this.sessions.has(adjacentPath)) {
      this.destroy();
      return ok(undefined);
    }
    return this.switchTab(adjacentPath);
  }

  async saveDocument(lineage?: LineageRecordOptions): Promise<Result<void, Error>> {
    const currentDocument = this.getCurrentDocumentForSave();
    if (!currentDocument) {
      const error = new Error('No document open');
      events.emit('document:save-failed', { path: null, error });
      return err(error);
    }

    // Pre-save guard: refuse to overwrite an externally-modified file.
    // The user must explicitly resolve the conflict via resolveConflict(...)
    // before a save is allowed.
    const session = this.sessions.get(currentDocument.path);
    if (session && session.conflictState !== 'clean') {
      const error = new ConflictError(
        currentDocument.path,
        session.conflictState === 'external-deleted'
          ? `Cannot save ${currentDocument.path}: file was deleted externally`
          : `Cannot save ${currentDocument.path}: file was modified externally`,
      );
      events.emit('document:save-failed', { path: currentDocument.path, error });
      return err(error);
    }

    this.clearSaveTimer();
    this.updateState({ isSaving: true });

    // Mark the session saving while the disk write is in flight, and
    // snapshot the edit counter so we can tell whether any editor:change
    // events landed between now and the post-save writeback. Comparing the
    // counter is robust to non-content noise in proseMirrorToDomain (e.g.
    // fresh block ids for nodes whose PM attrs.id is null) that would
    // otherwise make two derived snapshots look unequal.
    if (session) session.isSaving = true;
    const editCounterAtStart = session?.editCounter ?? 0;

    const result = await this.documentPort.save(currentDocument);
    if (!result.ok) {
      if (session) session.isSaving = false;
      this.updateState({ isSaving: false });
      events.emit('document:save-failed', {
        path: currentDocument.path,
        error: result.error,
      });
      return result;
    }

    // Save succeeded on disk. Keep the visible state in "saving" until the
    // lineage trace is durable too, so "Saved" means the note and history agree.
    await this.recordLineageForDocument(currentDocument, lineage);
    await this.clearTodoSnapshotForPath(currentDocument.path);

    // Save + lineage succeeded enough for user-facing bookkeeping. Lineage
    // failures are logged inside recordLineageForDocument and do not block the
    // markdown save. If another in-memory edit landed while the disk write was
    // in flight, keep that newer editor state dirty instead of stamping the
    // older saved snapshot back over it.
    const latestDocument = this.getCurrentDocumentForSave();
    const editCounterAtEnd = session?.editCounter ?? editCounterAtStart;
    const changedDuringSave = editCounterAtEnd !== editCounterAtStart;
    const stateDocument =
      changedDuringSave && latestDocument !== null && latestDocument.path === currentDocument.path
        ? latestDocument
        : currentDocument;
    const dirtyAfterSave = changedDuringSave;

    if (session) {
      session.document = { ...stateDocument, isDirty: dirtyAfterSave };
      session.isDirty = dirtyAfterSave;
      session.isSaving = false;
      session.lastSavedAt = new Date();
    }

    this.updateState({
      document: { ...stateDocument, isDirty: dirtyAfterSave },
      isDirty: dirtyAfterSave,
      isSaving: false,
    });
    events.emit('document:saved', { path: currentDocument.path });

    return ok(undefined);
  }

  async revealCurrentDocument(): Promise<Result<void, Error>> {
    const currentDocument = this.getCurrentDocumentForSave();
    if (!currentDocument) {
      return err(new Error('No document open'));
    }
    if (!this.externalNavigation) {
      return err(new Error('External navigation is not available'));
    }

    const path = this.getAbsolutePath(currentDocument.path);
    if (!path) {
      return err(new Error('Unable to resolve document path'));
    }

    return this.externalNavigation.revealPath(path);
  }

  updateDocumentMeta(updates: Partial<DocumentMeta>): Result<Document, Error> {
    const currentDocument = this.getCurrentDocumentForSave();
    if (!currentDocument) {
      return err(new Error('No document open'));
    }

    const meta: DocumentMeta = {
      ...currentDocument.meta,
      ...updates,
      tags: updates.tags !== undefined
        ? normalizeNoteTags(updates.tags)
        : currentDocument.meta.tags,
      custom: updates.custom
        ? { ...currentDocument.meta.custom, ...updates.custom }
        : currentDocument.meta.custom,
      updatedAt: new Date(),
    };

    const document: Document = {
      ...currentDocument,
      meta,
      isDirty: true,
    };

    this.editorPort?.updateMetadata(meta);
    this.updateState({ document, isDirty: true });
    events.emit('editor:change', { document });
    this.scheduleAutosave();

    return ok(document);
  }

  closeDocument(): void {
    const path = this.state.activePath ?? this.state.document?.path ?? null;
    if (path) {
      // Fire-and-forget; closeTab handles flush-on-close internally.
      // We expose this sync wrapper for legacy callers that don't await.
      this.closeTab(path).catch(() => undefined);
    } else {
      this.destroy();
    }
  }

  async createDocument(path: string, title?: string): Promise<Result<Document, Error>> {
    const result = await this.documentPort.create(path, title);
    if (!result.ok) return result;
    return this.openDocument(path);
  }

  insertBlock(type: Block['type']): void {
    this.editorPort?.execute('insertBlock', type, undefined);
  }

  deleteBlock(blockId: string): void {
    this.editorPort?.execute('deleteBlock', blockId);
  }

  moveBlock(blockId: string, targetIndex: number): void {
    this.editorPort?.execute('moveBlock', blockId, targetIndex);
  }

  updateBlock(blockId: string, updates: Partial<Block>): void {
    if (!this.state.document) return;

    const updateRecursive = (blocks: Block[]): Block[] =>
      blocks.map((block) => {
        if (block.id === blockId) {
          return { ...block, ...updates };
        }
        return { ...block, children: updateRecursive(block.children) };
      });

    this.updateState({
      document: {
        ...this.state.document,
        blocks: updateRecursive(this.state.document.blocks),
        isDirty: true,
      },
      isDirty: true,
    });
  }

  insertContent(markdown: string): void {
    this.editorPort?.execute('insertContent', markdown);
  }

  getTextContent(): string {
    if (this.editorPort) return this.editorPort.getTextContent();
    return this.state.document?.blocks.map((block) => block.content).join('\n') ?? '';
  }

  getMarkdown(): Result<string, Error> {
    if (!this.editorPort) return err(new Error('Editor not mounted'));
    try {
      const markdown = this.editorPort.getMarkdown();
      const document = this.getCurrentDocumentForSave();
      return ok(document ? combineMarkdownWithFrontmatter(markdown, document.meta) : markdown);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  async executeCommand(commandId: string): Promise<void> {
    if (!this.editorPort) return;
    const command = this.commandRegistry.get(commandId);
    if (!command) return;
    this.editorPort.executeSlashMenuCommand(command);
  }

  openFindReplace(mode: 'find' | 'replace'): void {
    this.editorPort?.execute('openFindReplace', mode);
  }

  closeFindReplace(): void {
    this.editorPort?.execute('closeFindReplace');
  }

  setFindQuery(
    query: string,
    options?: { regex?: boolean; caseSensitive?: boolean; wholeWord?: boolean }
  ): void {
    this.editorPort?.execute('setFindQuery', query, options);
  }

  findNextMatch(): void {
    this.editorPort?.execute('findNextMatch');
  }

  findPrevMatch(): void {
    this.editorPort?.execute('findPrevMatch');
  }

  replaceCurrentMatch(replacement: string): void {
    this.editorPort?.execute('replaceCurrentMatch', replacement);
  }

  replaceRange(from: number, to: number, markdown: string): void {
    this.editorPort?.execute('replaceRange', from, to, markdown);
  }

  replaceAllMatches(replacement: string): void {
    this.editorPort?.execute('replaceAllMatches', replacement);
  }

  getFindReplaceState() {
    if (!this.editorPort) return null;
    const adapter = this.editorPort as unknown as {
      getFindReplaceState?: () => ReturnType<EditorService['getFindReplaceState']>;
    };
    return adapter.getFindReplaceState?.() ?? null;
  }

  activateQuickJump(): void {
    this.editorPort?.execute('activateQuickJump');
  }

  toggleSelectedTodos(): number {
    if (!this.editorPort) return 0;
    const adapter = this.editorPort as unknown as { toggleSelectedTodos?: () => number };
    return adapter.toggleSelectedTodos?.() ?? 0;
  }

  toggleMark(mark: string, attrs?: Record<string, unknown>): void {
    this.editorPort?.execute('toggleMark', mark, attrs);
  }

  setBlockType(type: Block['type']): void {
    this.editorPort?.execute('setBlockType', type);
  }

  setLink(href: string, title?: string): void {
    this.editorPort?.execute('setLink', href, title);
  }

  removeLink(): void {
    this.editorPort?.execute('removeLink');
  }

  openPageLinkPicker(): void {
    this.editorPort?.execute('openPageLinkPicker');
  }

  setPageLink(note: EditorPageLinkNote): void {
    this.editorPort?.execute('setPageLink', note);
  }

  removePageLink(): void {
    this.editorPort?.execute('removePageLink');
  }

  updatePageLinkQuery(query: string): void {
    this.editorPort?.execute('updatePageLinkQuery', query);
  }

  movePageLinkSelection(direction: 'next' | 'prev'): void {
    this.editorPort?.execute('movePageLinkSelection', direction);
  }

  selectPageLink(note: EditorPageLinkNote): void {
    this.editorPort?.execute('selectPageLink', note);
  }

  closePageLinkMenu(): void {
    this.editorPort?.execute('closePageLinkMenu');
  }

  aiPromptSelectionAt(from: number, to: number, text: string): void {
    this.editorPort?.execute('aiPromptSelectionAt', from, to, text);
  }

  resolveSelectionFromDOM(range: Range): { from: number; to: number } | null {
    return this.editorPort?.resolveSelectionFromDOM(range) ?? null;
  }

  executeSlashMenuCommand(command: RegisteredCommand): void {
    this.editorPort?.executeSlashMenuCommand(command);
  }

  closeSlashMenu(): void {
    this.editorPort?.closeSlashMenu();
  }

  focus(): void {
    this.editorPort?.execute('focus');
  }

  getSelection(): Selection {
    return this.editorPort?.getSelection() ?? EMPTY_SELECTION;
  }

  undo(): void {
    this.editorPort?.execute('undo');
  }

  redo(): void {
    this.editorPort?.execute('redo');
  }

  canUndo(): boolean {
    return this.editorPort?.canUndo() ?? false;
  }

  canRedo(): boolean {
    return this.editorPort?.canRedo() ?? false;
  }

  toggleTodoChecked(blockId: string, content: string, checked: boolean): boolean {
    return this.editorPort?.toggleTodoChecked(blockId, content, checked) ?? false;
  }

  selectBlock(blockId: string): void {
    this.editorPort?.execute('selectBlock', blockId);
  }

  selectBlockRange(startBlockId: string, endBlockId: string): void {
    this.editorPort?.execute('selectBlockRange', startBlockId, endBlockId);
  }

  duplicateBlock(blockId: string): void {
    this.editorPort?.execute('duplicateBlock', blockId);
  }

  convertBlock(blockId: string, targetType: Block['type']): void {
    this.editorPort?.execute('convertBlock', blockId, targetType);
  }

  lockBlockForAI(blockId: string, operationLabel: string): void {
    this.editorPort?.execute('lockBlockForAI', blockId, operationLabel);
  }

  unlockBlockFromAI(blockId: string): void {
    this.editorPort?.execute('unlockBlockFromAI', blockId);
  }

  replaceBlockContent(blockId: string, markdown: string): void {
    this.editorPort?.execute('replaceBlockContent', blockId, markdown);
  }

  startAIBlockOperation(blockId: string, operationLabel: string, expectedContent?: string): void {
    this.editorPort?.execute('startAIBlockOperation', blockId, operationLabel, expectedContent);
  }

  streamAIBlock(blockId: string, textDelta: string): void {
    this.editorPort?.execute('streamAIBlock', blockId, textDelta);
  }

  finishAIBlockOperation(blockId: string, finalMarkdown: string): void {
    this.editorPort?.execute('finishAIBlockOperation', blockId, finalMarkdown);
  }

  failAIBlockOperation(blockId: string, message: string): void {
    this.editorPort?.execute('failAIBlockOperation', blockId, message);
  }

  cancelAIBlockOperation(blockId: string): void {
    this.editorPort?.execute('cancelAIBlockOperation', blockId);
  }

  scrollBlockIntoView(blockId: string, mode: 'nearest' | 'center' | 'smart' = 'smart'): void {
    this.editorPort?.execute('scrollBlockIntoView', blockId, mode);
  }

  insertContentAfterBlock(blockId: string, markdown: string): void {
    this.editorPort?.execute('insertContentAfterBlock', blockId, markdown);
  }

  getAILockedBlocks(): string[] {
    return this.editorPort?.getAILockedBlocks() ?? [];
  }

  getBlockInfo(blockId: string): BlockInfo | null {
    return this.editorPort?.getBlockInfo(blockId) ?? null;
  }

  subscribe(callback: (state: EditorState) => void): () => void {
    this.subscribers.add(callback);
    callback(this.getState());
    return () => {
      this.subscribers.delete(callback);
    };
  }

  private subscribeToEditorPort(editorPort: EditorPort): void {
    this.editorUnsubscribers = [
      editorPort.on('editor:ready', () => {
        this.updateState({ isReady: true });
        events.emit('editor:ready');
      }),
      editorPort.on('editor:change', ({ document }) => {
        const session = this.state.activePath
          ? this.sessions.get(this.state.activePath)
          : null;
        if (session) session.editCounter += 1;
        this.updateState({ document: { ...document, isDirty: true }, isDirty: true });
        events.emit('editor:change', { document });
        this.syncTodoSnapshotFromEditor(document);
        this.scheduleAutosave();
      }),
      editorPort.on('editor:selection', ({ selection }) => {
        this.updateState({ selection });
        events.emit('editor:selection', { selection });
      }),
      editorPort.on('editor:focus', () => events.emit('editor:focus')),
      editorPort.on('editor:blur', () => events.emit('editor:blur')),
      editorPort.on('editor:slash-menu-change', (payload) =>
        events.emit('editor:slash-menu-change', payload),
      ),
      editorPort.on('editor:page-link-menu-change', (payload) =>
        events.emit('editor:page-link-menu-change', payload),
      ),
      editorPort.on('editor:block-menu-request', (payload) =>
        this.handleBlockMenuRequest(payload),
      ),
      editorPort.on('editor:lineage-inspect-request', (payload) =>
        events.emit('editor:lineage-inspect-request', payload),
      ),
      editorPort.on('editor:page-link-clicked', ({ path }) => {
        const resolvedPath = this.resolvePageLinkPath(path);
        events.emit('editor:page-link-clicked', { path: resolvedPath });
        this.notesService?.selectNote(resolvedPath);
      }),
      editorPort.on('editor:external-link-clicked', ({ url }) => {
        events.emit('editor:external-link-clicked', { url });
        this.externalNavigation?.openUrl(url);
      }),
      editorPort.on('editor:todo-toggled', (payload) => this.handleEditorTodoToggle(payload)),
      editorPort.on('editor:block-selected', (payload) =>
        events.emit('editor:block-selected', payload),
      ),
      editorPort.on('editor:block-moved', (payload) =>
        events.emit('editor:block-moved', payload),
      ),
      editorPort.on('editor:block-converted', (payload) =>
        events.emit('editor:block-converted', payload),
      ),
      editorPort.on('editor:block-ai-locked', ({ blockId, operation }) => {
        this.updateState({ aiProcessing: { blockId, operation } });
        events.emit('editor:block-ai-locked', { blockId, operation });
      }),
      editorPort.on('editor:block-ai-unlocked', ({ blockId }) => {
        if (this.state.aiProcessing?.blockId === blockId) {
          this.updateState({ aiProcessing: null });
        }
        events.emit('editor:block-ai-unlocked', { blockId });
      }),
      editorPort.on('editor:block-ai-phase', (payload) => {
        this.updateState({
          aiProcessing: payload.phase === 'complete'
            ? this.state.aiProcessing
            : { blockId: payload.blockId, operation: payload.operation },
        });
        events.emit('editor:block-ai-phase', payload);
      }),
      editorPort.on('editor:block-ai-active-target', (payload) =>
        events.emit('editor:block-ai-active-target', payload),
      ),
      editorPort.on('editor:block-scrolled-into-view', (payload) =>
        events.emit('editor:block-scrolled-into-view', payload),
      ),
      editorPort.on('editor:ai-inline-generate', ({ prompt, selectionText, callbacks, request }) => {
        this.handleAIInlineGenerate(prompt, selectionText, callbacks, request);
      }),
    ];
  }

  private handleBlockMenuRequest(payload: EditorBlockMenuRequest): void {
    events.emit('editor:block-menu-request', payload);
  }

  private async handleEditorTodoToggle(payload: {
    blockId: string;
    content: string;
    checked: boolean;
  }): Promise<void> {
    events.emit('editor:todo-toggled', payload);
    const docPath = this.getAbsoluteCurrentDocumentPath();
    if (!docPath || !this.todoService) return;
    await this.todoService.toggleFromEditor(
      payload.blockId,
      payload.content,
      payload.checked,
      docPath,
    );
  }

  private async handleAIInlineGenerate(
    prompt: string,
    selectionText: string | null,
    callbacks: EditorInlineGenerateCallbacks,
    request?: EditorInlineGenerateRequest,
  ): Promise<void> {
    if (!this.aiAssistant) {
      callbacks.onError('AI is not configured');
      return;
    }

    try {
      if (request?.mode === 'selection' && selectionText && callbacks.onResult) {
        await this.handleAIInlineSelectionRequest(prompt, selectionText, callbacks, request);
        return;
      }

      const noteTitle = this.state.document?.meta.title ?? 'Untitled';
      const parts = [`You are helping write a note titled "${noteTitle}".`];

      if (selectionText) {
        parts.push(
          'The user has selected the following text:',
          `\n---\n${selectionText}\n---\n`,
          'Apply the following instruction to the selected text:',
        );
      } else {
        parts.push('Generate the following content.');
      }

      parts.push(
        'Respond ONLY with the content — no preamble, no explanation.',
        'Use markdown formatting where appropriate.',
        `\n${prompt}`,
      );

      const result = await this.aiAssistant.prompt(parts.join(' '));
      if (!result.ok) {
        callbacks.onError(result.error.message);
        return;
      }

      if (result.value.chat) {
        callbacks.onComplete(result.value.chat);
      } else {
        callbacks.onError('AI did not return a response');
      }
    } catch (error) {
      callbacks.onError(error instanceof Error ? error.message : 'AI generation failed');
    }
  }

  private async handleAIInlineSelectionRequest(
    prompt: string,
    selectionText: string,
    callbacks: EditorInlineGenerateCallbacks,
    request: EditorInlineGenerateRequest,
  ): Promise<void> {
    const noteTitle = this.state.document?.meta.title ?? 'Untitled';
    const notePath = request.notePath ?? this.state.document?.path ?? null;
    const internalPrompt = buildInlineSelectionPrompt({
      prompt,
      selectedText: selectionText,
      noteTitle,
      notePath,
      from: request.from,
      to: request.to,
      blockIds: request.blockIds,
    });

    const result = await this.aiAssistant!.prompt(internalPrompt, {
      autoExecuteTools: true,
      displayMessage: prompt,
      persistAssistantMessage: true,
      documentPath: notePath,
      allowedToolIds: [...INLINE_SELECTION_TOOL_IDS],
      systemPrompt: INLINE_SELECTION_SYSTEM_PROMPT,
    });

    const conversation = this.aiAssistant!.getCurrentConversation();
    const conversationId = conversation?.id ?? null;

    if (!result.ok) {
      callbacks.onError(result.error.message);
      return;
    }

    const failedToolMessage = getLatestToolFailureMessage(conversation);
    if (failedToolMessage) {
      const errorMessage = `I could not apply that edit: ${failedToolMessage}`;
      if (conversationId) {
        await this.aiAssistant!.appendAssistantMessage(errorMessage, conversationId);
      }
      callbacks.onError(errorMessage);
      return;
    }

    const response = result.value;
    const didMutate = response.toolCalls.length > 0;
    const message = response.chat.trim() || (didMutate ? 'Done.' : 'I do not have an answer for that yet.');
    const inlineResult: EditorInlineGenerateResult = {
      message,
      didMutate,
      toolCount: response.toolCalls.length,
    };
    if (conversationId) {
      inlineResult.conversationId = conversationId;
    }
    callbacks.onResult?.(inlineResult);
  }

  private subscribeToTodoWorkspaceSync(): void {
    if (!this.todoService || this.todoSyncCleanup) return;

    const handler = ({ filePath, content, checked }: { filePath: string; content: string; checked: boolean }) => {
      const current = this.state.document;
      if (!current) return;
      const docPath = current.path;
      const isSameDocument =
        filePath === docPath ||
        filePath.endsWith('/' + docPath) ||
        this.getAbsoluteCurrentDocumentPath() === filePath;
      if (!isSameDocument) return;
      this.toggleTodoChecked('', content, checked);
    };

    events.on('todo:sync-to-editor', handler);
    const updateHandler = ({
      filePath,
      content,
      previousContent,
      checked,
    }: {
      filePath: string;
      id: string;
      content: string;
      previousContent?: string;
      checked: boolean;
    }) => {
      if (!this.isCurrentDocumentPath(filePath)) return;
      this.editorPort?.execute('updateTodoContent', previousContent ?? content, content, checked);
    };
    const deleteHandler = ({ filePath, content }: { filePath: string; id: string; content?: string }) => {
      if (!content || !this.isCurrentDocumentPath(filePath)) return;
      this.editorPort?.execute('deleteTodoContent', content);
    };

    events.on('todo:update-in-editor', updateHandler);
    events.on('todo:delete-from-editor', deleteHandler);
    this.todoSyncCleanup = () => {
      events.off('todo:sync-to-editor', handler);
      events.off('todo:update-in-editor', updateHandler);
      events.off('todo:delete-from-editor', deleteHandler);
    };
  }

  private scheduleAutosave(): void {
    this.clearSaveTimer();
    this.saveTimeout = setTimeout(async () => {
      const result = await this.saveDocument();
      if (!result.ok) {
        events.emit('document:save-failed', {
          path: this.state.document?.path ?? null,
          error: result.error,
        });
      }
    }, this.autoSaveDelayMs);
  }

  private clearSaveTimer(): void {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }
  }

  private getCurrentDocumentForSave(): Document | null {
    if (this.editorPort && this.editorElement && this.state.isReady) {
      try {
        return this.editorPort.getDocument();
      } catch {
        return this.state.document;
      }
    }
    return this.state.document;
  }

  private getAbsoluteCurrentDocumentPath(): string | null {
    const docPath = this.state.document?.path;
    return this.getAbsolutePath(docPath);
  }

  private getAbsolutePath(docPath: string | null | undefined): string | null {
    if (!docPath) return null;
    if (docPath.startsWith('/')) return docPath;
    if (!this.notesPath) return docPath;
    return `${this.notesPath.replace(/\/$/, '')}/${docPath}`;
  }

  private normalizeAbsolutePath(path: string | null | undefined): string | null {
    if (!path) return null;
    const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '');
    const absolute = normalized.startsWith('/') ? normalized : this.getAbsolutePath(normalized);
    return absolute?.replace(/\\/g, '/').replace(/\/+$/, '') ?? normalized;
  }

  private rememberInAppMutation(path: string): void {
    this.pruneRecentInAppMutations();
    const normalized = this.normalizeAbsolutePath(path);
    if (!normalized) return;
    this.recentInAppMutations.set(normalized, Date.now());
  }

  private hasRecentInAppMutation(path: string): boolean {
    const normalized = this.normalizeAbsolutePath(path);
    if (!normalized) return false;
    const timestamp = this.recentInAppMutations.get(normalized);
    if (timestamp === undefined) return false;
    if (Date.now() - timestamp > IN_APP_MUTATION_GRACE_MS) {
      this.recentInAppMutations.delete(normalized);
      return false;
    }
    return true;
  }

  private pruneRecentInAppMutations(): void {
    const now = Date.now();
    for (const [path, timestamp] of this.recentInAppMutations) {
      if (now - timestamp > IN_APP_MUTATION_GRACE_MS) {
        this.recentInAppMutations.delete(path);
      }
    }
  }

  private isCurrentDocumentPath(filePath: string): boolean {
    const current = this.state.document;
    if (!current) return false;
    const docPath = current.path;
    const absolute = this.getAbsoluteCurrentDocumentPath();
    return filePath === docPath || filePath.endsWith('/' + docPath) || absolute === filePath;
  }

  private syncTodoSnapshotFromEditor(document: Document): void {
    if (!this.todoService || !this.editorPort) return;
    const filePath = this.getAbsolutePath(document.path);
    if (!filePath) return;

    try {
      const markdown = this.editorPort.getMarkdown();
      this.todoService.syncFileSnapshot(filePath, markdown).catch((error) => {
        console.warn('[EditorService] Todo snapshot sync failed:', error);
      });
    } catch (error) {
      console.warn('[EditorService] Todo snapshot sync failed:', error);
    }
  }

  private async clearTodoSnapshotForPath(path: string): Promise<void> {
    if (!this.todoService) return;
    const filePath = this.getAbsolutePath(path);
    if (!filePath) return;
    await this.todoService.clearFileSnapshot(filePath);
  }

  private createNotesProvider(): EditorNotesProvider | undefined {
    if (!this.notesService) return undefined;

    return {
      getAllNotes: (context) => this.rankPageLinkNotes('', context?.activePath ?? this.state.activePath).slice(0, 30),
      searchNotes: (query, context) =>
        this.rankPageLinkNotes(query, context?.activePath ?? this.state.activePath).slice(0, 40),
    };
  }

  private resolvePageLinkPath(path: string): string {
    if (!this.notesService) return path;
    const resolved = resolveNoteLinkTarget(
      path,
      this.state.activePath ?? this.state.document?.path ?? this.notesService.getSelectedPath(),
      this.notesService.getState().items,
    );
    return resolved ?? path;
  }

  private rankPageLinkNotes(query: string, activePath?: string | null): EditorPageLinkNote[] {
    if (!this.notesService) return [];
    const normalized = query.trim().toLowerCase();
    const tagQuery = normalized.replace(/^#/, '');
    const active = activePath ?? this.notesService.getSelectedPath();

    const ranked: EditorPageLinkNote[] = [];
    for (const note of this.flattenPageLinkNotes(this.notesService.getState().items)) {
      if (note.path === active) continue;

      const title = note.title.toLowerCase();
      const path = note.path.toLowerCase();
      const tags = note.tags ?? [];
      const tagMatch = tagQuery
        ? tags.find((tag) => tag.toLowerCase().includes(tagQuery))
        : undefined;
      const frecencyScore = this.frecency?.score('note', note.path) ?? 0;
      const modifiedScore = this.modifiedRecencyScore(note.modifiedAt);

      let score = frecencyScore * 120 + modifiedScore;
      let matchKind: EditorPageLinkNote['matchKind'] = frecencyScore > 0 ? 'recent' : 'all';
      let matchLabel: string | undefined = frecencyScore > 0 ? 'Recent' : note.folder;

      if (normalized) {
        score = 0;
        if (title === normalized) {
          score += 1000;
          matchKind = 'title';
          matchLabel = 'Exact title';
        } else if (title.startsWith(normalized)) {
          score += 780;
          matchKind = 'title';
          matchLabel = 'Title';
        } else if (title.includes(normalized)) {
          score += 620;
          matchKind = 'title';
          matchLabel = 'Title';
        } else {
          const fuzzy = this.fuzzyScore(title, normalized);
          if (fuzzy > 0) {
            score += 320 + fuzzy;
            matchKind = 'title';
            matchLabel = 'Title';
          }
        }

        if (path.includes(normalized)) {
          score += 220;
          if (matchKind === 'all') {
            matchKind = 'path';
            matchLabel = note.folder || 'Path';
          }
        }

        if (tagMatch) {
          score += 360;
          matchKind = 'tag';
          matchLabel = `#${tagMatch}`;
        }

        if (score <= 0) continue;
        score += frecencyScore * 80 + modifiedScore;
      }

      ranked.push({
        ...note,
        score,
        matchKind,
        ...(matchLabel ? { matchLabel } : {}),
        relation: 'none',
        isRecent: frecencyScore > 0,
      });
    }

    return ranked.sort((a, b) => {
      const scoreDelta = (b.score ?? 0) - (a.score ?? 0);
      if (Math.abs(scoreDelta) > 0.001) return scoreDelta;
      const aModified = a.modifiedAt?.getTime() ?? 0;
      const bModified = b.modifiedAt?.getTime() ?? 0;
      if (aModified !== bModified) return bModified - aModified;
      return a.title.localeCompare(b.title);
    });
  }

  private flattenPageLinkNotes(items: NotesListItem[]): EditorPageLinkNote[] {
    const notes: EditorPageLinkNote[] = [];
    for (const item of items) {
      if (item.isFolder) {
        notes.push(...this.flattenPageLinkNotes(item.children ?? []));
        continue;
      }
      const folder = item.path.includes('/') ? item.path.slice(0, item.path.lastIndexOf('/')) : undefined;
      notes.push({
        path: item.path,
        title: item.title,
        ...(folder ? { folder } : {}),
        tags: item.tags ?? [],
        modifiedAt: item.modifiedAt,
      });
    }
    return notes;
  }

  private fuzzyScore(value: string, query: string): number {
    if (!query) return 0;
    let score = 0;
    let lastIndex = -1;
    for (const char of query) {
      const index = value.indexOf(char, lastIndex + 1);
      if (index === -1) return 0;
      score += 18;
      if (index === lastIndex + 1) score += 18;
      if (index === 0) score += 8;
      score -= Math.min(Math.max(index - lastIndex - 1, 0), 12);
      lastIndex = index;
    }
    return score;
  }

  private modifiedRecencyScore(modifiedAt: Date | undefined): number {
    if (!modifiedAt) return 0;
    const ageDays = Math.max(0, (Date.now() - modifiedAt.getTime()) / (24 * 60 * 60 * 1000));
    return Math.max(0, 18 - ageDays);
  }

  private cleanupEditorSubscriptions(): void {
    for (const unsubscribe of this.editorUnsubscribers) {
      unsubscribe();
    }
    this.editorUnsubscribers = [];
  }

  private updateState(partial: Partial<EditorState>): void {
    this.state = { ...this.state, ...partial };
    // Mirror the active-session bookkeeping so the session map stays
    // truthful between explicit syncs (switch / save).
    if (this.state.activePath) {
      const session = this.sessions.get(this.state.activePath);
      if (session) {
        if (partial.isDirty !== undefined) session.isDirty = partial.isDirty;
        if (partial.isSaving !== undefined) session.isSaving = partial.isSaving;
        if (partial.document) session.document = partial.document;
      }
    }
    // Refresh derived tabs[] + active conflictState views.
    this.state = {
      ...this.state,
      tabs: this.computeTabs(),
      conflictState: this.computeActiveConflictState(),
    };
    this.notifySubscribers();
  }

  private async recordLineageForDocument(
    document: Document,
    lineage?: LineageRecordOptions,
  ): Promise<void> {
    if (!this.markdown || !this.lineageService) return;
    const markdown = this.markdown.serializeBlocks(document.blocks);
    const clusterId = lineage?.clusterId ?? this.getLineageClusterId(document.path);
    const captureReason = lineage?.captureReason ?? inferEditorCaptureReason(lineage);
    const result = await this.lineageService.enqueueMarkdownChange(document.path, markdown, {
      actor: lineage?.actor ?? { kind: 'user' },
      intentKind: lineage?.intentKind ?? 'update',
      summary: lineage?.summary ?? 'User saved editor document',
      clusterId,
      captureReason,
      ...(lineage?.prompt !== undefined ? { prompt: lineage.prompt } : {}),
      ...(lineage?.commandId !== undefined ? { commandId: lineage.commandId } : {}),
      ...(lineage?.agentRunId !== undefined ? { agentRunId: lineage.agentRunId } : {}),
      ...(lineage?.agentTaskId !== undefined ? { agentTaskId: lineage.agentTaskId } : {}),
      ...(lineage?.receiptId !== undefined ? { receiptId: lineage.receiptId } : {}),
      ...(lineage?.provenanceEventId !== undefined ? { provenanceEventId: lineage.provenanceEventId } : {}),
      ...(lineage?.provenanceType !== undefined ? { provenanceType: lineage.provenanceType } : {}),
      ...(lineage?.branchId !== undefined ? { branchId: lineage.branchId } : {}),
      ...(lineage?.operationId !== undefined ? { operationId: lineage.operationId } : {}),
      source: lineage?.source ?? { type: 'keyboard' },
    });
    if (!result.ok) {
      console.warn('[EditorService] Failed to queue lineage:', result.error);
      return;
    }
    const flushed = await this.lineageService.flush(document.path);
    if (!flushed.ok) {
      console.warn('[EditorService] Failed to flush lineage:', flushed.error);
    }
  }

  private async ensureLineageBaseline(document: Document): Promise<void> {
    if (!this.markdown || !this.lineageService) return;

    const markdown = this.markdown.serializeBlocks(document.blocks);
    if (markdown.trim().length === 0) return;

    const snapshotResult = await this.lineageService.getSnapshot(document.path);
    if (!snapshotResult.ok) {
      console.warn('[EditorService] Failed to inspect lineage baseline:', snapshotResult.error);
      return;
    }

    if (snapshotResult.value) {
      const materialized = await this.lineageService.materialize(document.path);
      if (!materialized.ok) {
        console.warn('[EditorService] Failed to materialize lineage baseline:', materialized.error);
        return;
      }
      if (materialized.value === markdown) return;

      const reconcile = await this.lineageService.enqueueMarkdownChange(document.path, markdown, {
        actor: { kind: 'external-editor' },
        intentKind: 'external-reconcile',
        summary: 'Reconcile note content on open',
        clusterId: this.getLineageClusterId(document.path),
        captureReason: 'external-reconcile',
        source: { type: 'file-import' },
      });
      if (!reconcile.ok) {
        console.warn('[EditorService] Failed to queue lineage reconciliation:', reconcile.error);
        return;
      }
      const flushed = await this.lineageService.flush(document.path);
      if (!flushed.ok) {
        console.warn('[EditorService] Failed to flush lineage reconciliation:', flushed.error);
      }
      return;
    }

    const seed = await this.lineageService.enqueueMarkdownChange(document.path, markdown, {
      actor: { kind: 'importer', name: 'Void' },
      intentKind: 'import',
      summary: 'Seed lineage baseline from existing note',
      clusterId: this.getLineageClusterId(document.path),
      captureReason: 'import',
      source: { type: 'file-import' },
    });
    if (!seed.ok) {
      console.warn('[EditorService] Failed to queue lineage baseline:', seed.error);
      return;
    }
    const flushed = await this.lineageService.flush(document.path);
    if (!flushed.ok) {
      console.warn('[EditorService] Failed to flush lineage baseline:', flushed.error);
    }
  }

  private getLineageClusterId(path: string): string {
    const now = Date.now();
    const existing = this.lineageClusters.get(path);
    if (existing && now - existing.lastTouchedAt <= this.lineageClusterWindowMs) {
      existing.lastTouchedAt = now;
      return existing.id;
    }

    const id = `cluster_save_${now}_${Math.random().toString(36).slice(2, 8)}`;
    this.lineageClusters.set(path, { id, lastTouchedAt: now });
    return id;
  }

  /** Build the EditorState.tabs[] view from the internal sessions Map. */
  private computeTabs(): EditorState['tabs'] {
    const tabs: EditorState['tabs'] = [];
    for (const session of this.sessions.values()) {
      tabs.push({
        path: session.path,
        title: session.document.meta.title,
        isDirty: session.isDirty,
        isSaving: session.isSaving,
        conflictState: session.conflictState,
      });
    }
    return tabs;
  }

  /** Conflict state of the currently-active session, or 'clean'. */
  private computeActiveConflictState(): EditorState['conflictState'] {
    const path = this.state.activePath;
    if (!path) return 'clean';
    return this.sessions.get(path)?.conflictState ?? 'clean';
  }

  /**
   * Capture the live editor's current content into the active session's
   * document field, so the session has the latest in-memory copy when
   * we destroy the port (on switch / close).
   */
  private syncActiveSessionFromEditor(): void {
    if (!this.editorPort || !this.state.activePath) return;
    const session = this.sessions.get(this.state.activePath);
    if (!session) return;
    try {
      const liveDoc = this.editorPort.getDocument();
      session.document = liveDoc;
      session.isDirty = this.state.isDirty;
    } catch {
      // Editor in odd state — fall back to the last known doc.
    }
  }

  /** Add or replace a session for the given document. */
  private upsertSession(document: Document): EditorSession {
    const existing = this.sessions.get(document.path);
    if (existing) {
      existing.document = document;
      return existing;
    }
    const session = createEditorSession(document);
    this.sessions.set(document.path, session);
    return session;
  }

  private notifySubscribers(): void {
    const state = this.getState();
    for (const callback of this.subscribers) {
      try {
        callback(state);
      } catch (error) {
        console.error('Error in EditorService subscriber:', error);
      }
    }
  }
}

function buildInlineSelectionPrompt(input: {
  prompt: string;
  selectedText: string;
  noteTitle: string;
  notePath: string | null;
  from: number | null;
  to: number | null;
  blockIds: string[];
}): string {
  const location = [
    `Note title: ${input.noteTitle}`,
    `Note path: ${input.notePath ?? '(active note)'}`,
    `Selection from: ${input.from ?? '(unknown)'}`,
    `Selection to: ${input.to ?? '(unknown)'}`,
    `Active block ids: ${input.blockIds.length ? input.blockIds.join(', ') : '(none)'}`,
  ].join('\n');

  return [
    'Inline note AI request.',
    '',
    location,
    '',
    'Selected text:',
    '```text',
    input.selectedText,
    '```',
    '',
    'User prompt:',
    input.prompt,
    '',
    'Decide whether to answer only or apply an edit with the available editor tools.',
    'For exact selection replacement, prefer editor:replace with the supplied from/to range.',
    'For substring replacement, use targetText and occurrence when exact coordinates are not known.',
  ].join('\n');
}

function getLatestToolFailureMessage(conversation: Conversation | null | undefined): string | null {
  const assistant = conversation?.messages
    .slice()
    .reverse()
    .find((message) => message.role === 'assistant' && message.toolInvocations.length > 0);
  if (!assistant) return null;

  const failed = assistant.toolInvocations.find(
    (invocation) => invocation.status === 'failed' || invocation.status === 'cancelled'
  );
  if (!failed) return null;

  if (failed.result?.status === 'failure') return failed.result.error.message;
  if (failed.result?.status === 'cancelled') return failed.result.reason;
  return failed.message ?? `Tool ${failed.toolId} did not complete`;
}

function inferEditorCaptureReason(lineage?: LineageRecordOptions): NonNullable<LineageRecordOptions['captureReason']> {
  if (lineage?.source?.type === 'tool') return 'tool';
  if (lineage?.intentKind === 'accept-branch' || lineage?.intentKind === 'branch') return 'branch';
  if (lineage?.intentKind === 'restore') return 'restore';
  if (lineage?.intentKind === 'external-reconcile') return 'external-reconcile';
  return 'autosave';
}

