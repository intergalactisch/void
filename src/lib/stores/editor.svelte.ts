/**
 * Editor Store - Primary Adapter
 *
 * This is a Svelte 5 store using runes ($state) that connects
 * the UI layer to the EditorService application service.
 *
 * Tracks editor state including document, selection, and processing flags.
 *
 * Part of Hexagonal Architecture primary adapters layer.
 */

import type { EditorPaneState, EditorService, EditorState } from '$lib/ports/inbound';
import type { Document, Block } from '$lib/domain';
import type { InlineAIThread } from '$lib/domain/entities/InlineAIThread';
import type { DocumentMeta, Selection } from '$lib/domain/values';
import { EMPTY_SELECTION } from '$lib/domain/values';
import { events } from '$lib/events';
import type { BlockType } from '$lib/domain/values/BlockType';
import type { EditorImageBlockAttrs, EditorInlineAIComposerView, EditorMenuPosition, EditorPageLinkNote, RegisteredCommand } from '$lib/ports/outbound';

/**
 * Operation result for tracking the last completed operation.
 */
export interface EditorOperationResult {
  type: string;
  success: boolean;
  error?: Error | undefined;
  timestamp: Date;
}

/**
 * Initial editor state when no document is open.
 */
const INITIAL_STATE: EditorState = {
  document: null,
  tabs: [],
  activePath: null,
  activePaneId: null,
  panes: {},
  selection: EMPTY_SELECTION,
  isReady: false,
  isDirty: false,
  isSaving: false,
  conflictState: 'clean',
  aiProcessing: null,
  aiInlineComposers: [],
  activeAIInlineComposerId: null,
};

/**
 * Editor Store class with reactive state using Svelte 5 runes.
 *
 * Provides reactive access to editor state and methods to interact
 * with the underlying EditorService.
 */
class EditorStore {
  #service: EditorService | null = null;
  #unsubscribe: (() => void) | null = null;
  #eventCleanup: (() => void)[] = [];

  // Reactive state
  document = $state<Document | null>(null);
  tabs = $state<EditorState['tabs']>([]);
  activePath = $state<string | null>(null);
  activePaneId = $state<string | null>(null);
  panes = $state<Record<string, EditorPaneState>>({});
  selection = $state<Selection>(EMPTY_SELECTION);
  isReady = $state(false);
  isDirty = $state(false);
  isSaving = $state(false);
  conflictState = $state<EditorState['conflictState']>('clean');
  aiProcessing = $state<EditorState['aiProcessing']>(null);
  aiInlineComposers = $state<EditorInlineAIComposerView[]>([]);
  activeAIInlineComposerId = $state<string | null>(null);
  error = $state<Error | null>(null);

  // Operation tracking (for event-driven architecture)
  /** Currently executing operation type, or null if idle */
  operationInProgress = $state<string | null>(null);
  /** Result of the last completed operation */
  lastOperation = $state<EditorOperationResult | null>(null);

  // Block-level state (reactive mirrors of PM plugin state, updated via events)
  /** IDs of blocks currently selected via gutter click (empty = no block selection) */
  selectedBlockIds = $state<string[]>([]);
  /** Map of block ID -> operation label for blocks currently locked by AI */
  aiLockedBlocks = $state<Map<string, string>>(new Map());
  /** Map of block ID -> current AI lifecycle state */
  aiBlockStates = $state<Map<string, { operation: string; phase: string }>>(new Map());
  /** Block the AI is currently working on or asking the viewport to follow */
  aiActiveBlockId = $state<string | null>(null);
  /** Current slash menu state emitted by the editor adapter */
  slashMenuState = $state<unknown>(null);
  /** Current page-link autocomplete state emitted by the editor adapter */
  pageLinkMenuState = $state<unknown>(null);
  /** Latest block menu open request */
  blockMenuRequest = $state<{
    blockId: string;
    lineIndex: number;
    position: EditorMenuPosition;
    currentType: BlockType;
    mode: 'actions' | 'convert';
  } | null>(null);

  /** Whether any block is AI-locked */
  get hasAILockedBlocks(): boolean {
    return this.aiLockedBlocks.size > 0;
  }
  /** Whether block selection mode is active */
  get isBlockSelectionActive(): boolean {
    return this.selectedBlockIds.length > 0;
  }

  /**
   * Initialize the store with an EditorService instance.
   * Must be called before using any other methods.
   *
   * @param service - The EditorService to use
   */
  init(service: EditorService) {
    // Cleanup previous subscription if any
    this.#cleanup();

    this.#service = service;

    // Subscribe to service state changes
    this.#unsubscribe = service.subscribe((state) => {
      this.document = state.document;
      this.tabs = state.tabs;
      this.activePath = state.activePath;
      this.activePaneId = state.activePaneId;
      this.panes = state.panes;
      this.selection = state.selection;
      this.isReady = state.isReady;
      this.isDirty = state.isDirty;
      this.isSaving = state.isSaving;
      this.conflictState = state.conflictState;
      this.aiProcessing = state.aiProcessing;
      this.aiInlineComposers = state.aiInlineComposers;
      this.activeAIInlineComposerId = state.activeAIInlineComposerId;
    });

    // Initialize with current state
    const initialState = service.getState();
    this.document = initialState.document;
    this.tabs = initialState.tabs;
    this.activePath = initialState.activePath;
    this.activePaneId = initialState.activePaneId;
    this.panes = initialState.panes;
    this.selection = initialState.selection;
    this.isReady = initialState.isReady;
    this.isDirty = initialState.isDirty;
    this.isSaving = initialState.isSaving;
    this.conflictState = initialState.conflictState;
    this.aiProcessing = initialState.aiProcessing;
    this.aiInlineComposers = initialState.aiInlineComposers;
    this.activeAIInlineComposerId = initialState.activeAIInlineComposerId;

    // Subscribe to document events for operation tracking
    this.#subscribeToEvents();
  }

  /**
   * Subscribe to document events to track operation state.
   */
  #subscribeToEvents() {
    // Track document save operations
    const handleSaved = () => {
      this.operationInProgress = null;
      this.lastOperation = {
        type: 'save',
        success: true,
        timestamp: new Date(),
      };
    };

    // Track document open operations
    const handleOpened = () => {
      this.operationInProgress = null;
      this.lastOperation = {
        type: 'open',
        success: true,
        timestamp: new Date(),
      };
    };

    // Track document close operations
    const handleClosed = () => {
      this.operationInProgress = null;
      this.lastOperation = {
        type: 'close',
        success: true,
        timestamp: new Date(),
      };
    };

    // Block-level event handlers
    const handleBlockSelected = ({ blockIds }: { blockIds: string[] }) => {
      this.selectedBlockIds = blockIds;
    };

    const handleBlockAILocked = ({ blockId, operation }: { blockId: string; operation: string }) => {
      this.aiLockedBlocks = new Map([...this.aiLockedBlocks, [blockId, operation]]);
      this.aiBlockStates = new Map([...this.aiBlockStates, [blockId, { operation, phase: 'locking' }]]);
      this.aiActiveBlockId = blockId;
    };

    const handleBlockAIUnlocked = ({ blockId }: { blockId: string }) => {
      const next = new Map(this.aiLockedBlocks);
      next.delete(blockId);
      this.aiLockedBlocks = next;
      const nextStates = new Map(this.aiBlockStates);
      nextStates.delete(blockId);
      this.aiBlockStates = nextStates;
      if (this.aiActiveBlockId === blockId) {
        this.aiActiveBlockId = nextStates.keys().next().value ?? null;
      }
    };

    const handleBlockAIPhase = ({ blockId, operation, phase }: { blockId: string; operation: string; phase: string }) => {
      this.aiBlockStates = new Map([...this.aiBlockStates, [blockId, { operation, phase }]]);
      if (phase !== 'complete') {
        this.aiActiveBlockId = blockId;
      }
    };

    const handleBlockAIActiveTarget = ({ blockId }: { blockId: string | null }) => {
      this.aiActiveBlockId = blockId;
    };

    const handleSlashMenuChange = ({ state }: { state: unknown }) => {
      this.slashMenuState = state;
    };

    const handlePageLinkMenuChange = ({ state }: { state: unknown }) => {
      this.pageLinkMenuState = state;
    };

    const handleBlockMenuRequest = (request: {
      blockId: string;
      lineIndex: number;
      position: EditorMenuPosition;
      currentType: BlockType;
      mode: 'actions' | 'convert';
    }) => {
      this.blockMenuRequest = request;
    };

    events.on('document:saved', handleSaved);
    events.on('document:opened', handleOpened);
    events.on('document:closed', handleClosed);
    events.on('editor:block-selected', handleBlockSelected);
    events.on('editor:block-ai-locked', handleBlockAILocked);
    events.on('editor:block-ai-unlocked', handleBlockAIUnlocked);
    events.on('editor:block-ai-phase', handleBlockAIPhase);
    events.on('editor:block-ai-active-target', handleBlockAIActiveTarget);
    events.on('editor:slash-menu-change', handleSlashMenuChange);
    events.on('editor:page-link-menu-change', handlePageLinkMenuChange);
    events.on('editor:block-menu-request', handleBlockMenuRequest);

    // Store cleanup functions
    this.#eventCleanup = [
      () => events.off('document:saved', handleSaved),
      () => events.off('document:opened', handleOpened),
      () => events.off('document:closed', handleClosed),
      () => events.off('editor:block-selected', handleBlockSelected),
      () => events.off('editor:block-ai-locked', handleBlockAILocked),
      () => events.off('editor:block-ai-unlocked', handleBlockAIUnlocked),
      () => events.off('editor:block-ai-phase', handleBlockAIPhase),
      () => events.off('editor:block-ai-active-target', handleBlockAIActiveTarget),
      () => events.off('editor:slash-menu-change', handleSlashMenuChange),
      () => events.off('editor:page-link-menu-change', handlePageLinkMenuChange),
      () => events.off('editor:block-menu-request', handleBlockMenuRequest),
    ];
  }

  /**
   * Mount the editor into a DOM host.
   */
  async mount(element: HTMLElement, document?: Document, autoSaveDelayMs?: number) {
    if (!this.#service) throw new Error('EditorStore not initialized');
    return this.#service.mount(
      element,
      document,
      autoSaveDelayMs === undefined ? {} : { autoSaveDelayMs },
    );
  }

  /**
   * Mount a live editor into a workspace pane.
   */
  async mountPane(
    paneId: string,
    element: HTMLElement,
    path: string,
    document?: Document,
    autoSaveDelayMs?: number,
  ) {
    if (!this.#service) throw new Error('EditorStore not initialized');
    return this.#service.mountPane(
      paneId,
      element,
      path,
      document,
      autoSaveDelayMs === undefined ? {} : { autoSaveDelayMs },
    );
  }

  /**
   * Unmount a workspace pane without discarding its note session.
   */
  unmountPane(paneId: string, element?: HTMLElement | null) {
    if (!this.#service) throw new Error('EditorStore not initialized');
    this.#service.unmountPane(paneId, element);
  }

  /**
   * Make a workspace pane the active command target.
   */
  focusPane(paneId: string) {
    if (!this.#service) throw new Error('EditorStore not initialized');
    this.#service.focusPane(paneId);
  }

  /**
   * Save a specific workspace pane.
   */
  async savePane(paneId: string) {
    if (!this.#service) throw new Error('EditorStore not initialized');
    this.error = null;
    this.operationInProgress = 'saving';

    const result = await this.#service.savePane(paneId);

    if (!result.ok) {
      this.error = result.error;
      this.operationInProgress = null;
      this.lastOperation = {
        type: 'save',
        success: false,
        error: result.error,
        timestamp: new Date(),
      };
    }

    return result;
  }

  getPaneState(paneId: string): EditorPaneState | null {
    return this.#service?.getPaneState(paneId) ?? this.panes[paneId] ?? null;
  }

  getPaneDocument(paneId: string): Document | null {
    return this.getPaneState(paneId)?.document ?? null;
  }

  isPaneActive(paneId: string): boolean {
    return this.activePaneId === paneId;
  }

  /**
   * Clear the pending block menu request after UI closes it.
   */
  clearBlockMenuRequest() {
    this.blockMenuRequest = null;
  }

  /**
   * Load a document by path.
   *
   * @param path - Relative path to the document
   */
  async loadDocument(path: string) {
    if (!this.#service) throw new Error('EditorStore not initialized');

    this.error = null;
    this.operationInProgress = 'opening';

    const result = await this.#service.openDocument(path);

    if (!result.ok) {
      this.error = result.error;
      this.operationInProgress = null;
      this.lastOperation = {
        type: 'open',
        success: false,
        error: result.error,
        timestamp: new Date(),
      };
    }

    return result;
  }

  async reloadDocument(path: string, options?: { flushDirty?: boolean }) {
    if (!this.#service) throw new Error('EditorStore not initialized');

    this.error = null;
    this.operationInProgress = 'opening';

    const result = await this.#service.reloadDocument(path, options);

    if (!result.ok) {
      this.error = result.error;
      this.operationInProgress = null;
      this.lastOperation = {
        type: 'open',
        success: false,
        error: result.error,
        timestamp: new Date(),
      };
    }

    return result;
  }

  async prepareProtectedDocumentsForLock() {
    if (!this.#service) throw new Error('EditorStore not initialized');
    const result = await this.#service.prepareProtectedDocumentsForLock();
    if (!result.ok) this.error = result.error;
    return result;
  }

  async reloadProtectedDocuments(options?: { flushDirty?: boolean }) {
    if (!this.#service) throw new Error('EditorStore not initialized');
    const result = await this.#service.reloadProtectedDocuments(options);
    if (!result.ok) this.error = result.error;
    return result;
  }

  /**
   * Save the current document.
   */
  async saveDocument() {
    if (!this.#service) throw new Error('EditorStore not initialized');

    this.error = null;
    this.operationInProgress = 'saving';

    const result = await this.#service.saveDocument();

    if (!result.ok) {
      this.error = result.error;
      this.operationInProgress = null;
      this.lastOperation = {
        type: 'save',
        success: false,
        error: result.error,
        timestamp: new Date(),
      };
    }

    return result;
  }

  /**
   * Reveal the current markdown file in the system file manager.
   */
  async revealCurrentDocument() {
    if (!this.#service) throw new Error('EditorStore not initialized');

    this.error = null;

    const result = await this.#service.revealCurrentDocument();
    if (!result.ok) {
      this.error = result.error;
    }

    return result;
  }

  /**
   * Update metadata on the open document without remounting editor content.
   */
  updateDocumentMeta(updates: Partial<DocumentMeta>) {
    if (!this.#service) throw new Error('EditorStore not initialized');

    this.error = null;
    const result = this.#service.updateDocumentMeta(updates);
    if (!result.ok) {
      this.error = result.error;
    }
    return result;
  }

  /**
   * Close the current document.
   */
  closeDocument() {
    if (!this.#service) throw new Error('EditorStore not initialized');
    this.#service.closeDocument();
    this.error = null;
  }

  /**
   * Activate an already-open tab. The path must already exist in `tabs`;
   * call `loadDocument(path)` to open + activate a new path instead.
   */
  async switchTab(path: string) {
    if (!this.#service) throw new Error('EditorStore not initialized');
    this.error = null;
    const result = await this.#service.switchTab(path);
    if (!result.ok) this.error = result.error;
    return result;
  }

  /**
   * Close a tab by path. Flushes any pending save before unmounting.
   */
  async closeTab(path: string) {
    if (!this.#service) throw new Error('EditorStore not initialized');
    this.error = null;
    const result = await this.#service.closeTab(path);
    if (!result.ok) this.error = result.error;
    return result;
  }

  /**
   * Resolve an external-modification or external-deletion conflict.
   *   - 'take-remote': discard in-memory edits, reload from disk.
   *   - 'keep-local':  force-save the in-memory document.
   */
  async resolveConflict(path: string, action: 'keep-local' | 'take-remote') {
    if (!this.#service) throw new Error('EditorStore not initialized');
    this.error = null;
    const result = await this.#service.resolveConflict(path, action);
    if (!result.ok) this.error = result.error;
    return result;
  }

  /**
   * Create a new document.
   *
   * @param path - Path for the new document
   * @param title - Optional title
   */
  async createDocument(path: string, title?: string) {
    if (!this.#service) throw new Error('EditorStore not initialized');

    this.error = null;
    const result = await this.#service.createDocument(path, title);

    if (!result.ok) {
      this.error = result.error;
    }

    return result;
  }

  /**
   * Insert a block at the current position or after specified block.
   *
   * @param type - Block type to insert
   * @param afterBlockId - Optional ID of block to insert after
   */
  insertBlock(type: Block['type'], afterBlockId?: string) {
    if (!this.#service) throw new Error('EditorStore not initialized');
    this.#service.insertBlock(type, afterBlockId);
  }

  /**
   * Delete a block by ID.
   *
   * @param blockId - ID of the block to delete
   */
  deleteBlock(blockId: string) {
    if (!this.#service) throw new Error('EditorStore not initialized');
    this.#service.deleteBlock(blockId);
  }

  /**
   * Move a block to a new position.
   *
   * @param blockId - ID of the block to move
   * @param targetIndex - Target index
   */
  moveBlock(blockId: string, targetIndex: number) {
    if (!this.#service) throw new Error('EditorStore not initialized');
    this.#service.moveBlock(blockId, targetIndex);
  }

  /**
   * Update block content.
   *
   * @param blockId - ID of the block to update
   * @param updates - Partial updates to apply
   */
  updateBlock(blockId: string, updates: Partial<Block>) {
    if (!this.#service) throw new Error('EditorStore not initialized');
    this.#service.updateBlock(blockId, updates);
  }

  /**
   * Execute a slash command by ID.
   *
   * @param commandId - ID of the command to execute
   */
  async executeCommand(commandId: string) {
    if (!this.#service) throw new Error('EditorStore not initialized');
    await this.#service.executeCommand(commandId);
  }

  /**
   * Toggle an inline mark on the current selection.
   *
   * @param mark - Mark type to toggle (e.g., 'bold', 'italic')
   */
  toggleMark(mark: string, attrs?: Record<string, unknown>) {
    if (!this.#service) throw new Error('EditorStore not initialized');
    if (attrs === undefined) {
      this.#service.toggleMark(mark);
    } else {
      this.#service.toggleMark(mark, attrs);
    }
  }

  setLink(href: string, title?: string) {
    if (!this.#service) throw new Error('EditorStore not initialized');
    this.#service.setLink(href, title);
  }

  removeLink() {
    if (!this.#service) throw new Error('EditorStore not initialized');
    this.#service.removeLink();
  }

  openPageLinkPicker() {
    if (!this.#service) throw new Error('EditorStore not initialized');
    this.#service.openPageLinkPicker();
  }

  setPageLink(note: EditorPageLinkNote) {
    if (!this.#service) throw new Error('EditorStore not initialized');
    this.#service.setPageLink(note);
  }

  removePageLink() {
    if (!this.#service) throw new Error('EditorStore not initialized');
    this.#service.removePageLink();
  }

  updatePageLinkQuery(query: string) {
    this.#service?.updatePageLinkQuery(query);
  }

  movePageLinkSelection(direction: 'next' | 'prev') {
    this.#service?.movePageLinkSelection(direction);
  }

  selectPageLink(note: EditorPageLinkNote) {
    this.#service?.selectPageLink(note);
  }

  closePageLinkMenu() {
    this.#service?.closePageLinkMenu();
  }

  /**
   * Set the block type of the current selection.
   *
   * @param type - Block type to set
   */
  setBlockType(type: Block['type']) {
    if (!this.#service) throw new Error('EditorStore not initialized');
    this.#service.setBlockType(type);
  }

  /**
   * Focus the editor.
   */
  focus() {
    if (!this.#service) throw new Error('EditorStore not initialized');
    this.#service.focus();
  }

  getTextContent(paneId?: string): string {
    if (!this.#service) return '';
    return this.#service.getTextContent(paneId);
  }

  getTextBetween(from: number, to: number): string {
    if (!this.#service) return '';
    return this.#service.getTextBetween(from, to);
  }

  rangeIntersectsProtectedBlock(from: number, to: number): boolean {
    return this.#service?.rangeIntersectsProtectedBlock(from, to) ?? false;
  }

  getMarkdown() {
    if (!this.#service) throw new Error('EditorStore not initialized');
    return this.#service.getMarkdown();
  }

  resolveSelectionFromDOM(range: Range) {
    return this.#service?.resolveSelectionFromDOM(range) ?? null;
  }

  aiPromptSelectionAt(from: number, to: number, text: string) {
    this.#service?.aiPromptSelectionAt(from, to, text);
  }

  updateAIInlineComposerDraft(id: string, prompt: string) {
    this.#service?.updateAIInlineComposerDraft(id, prompt);
  }

  submitAIInlineComposer(id: string, prompt: string) {
    this.#service?.submitAIInlineComposer(id, prompt);
  }

  cancelAIInlineComposer(id: string) {
    this.#service?.cancelAIInlineComposer(id);
  }

  focusAIInlineComposer(id: string) {
    this.#service?.focusAIInlineComposer(id);
  }

  executeSlashMenuCommand(command: RegisteredCommand) {
    this.#service?.executeSlashMenuCommand(command);
  }

  closeSlashMenu() {
    this.#service?.closeSlashMenu();
  }

  // ─── Find / Replace passthrough ───
  openFindReplace(mode: 'find' | 'replace') {
    this.#service?.openFindReplace(mode);
  }
  closeFindReplace() {
    this.#service?.closeFindReplace();
  }
  setFindQuery(query: string, options?: { regex?: boolean; caseSensitive?: boolean; wholeWord?: boolean }) {
    this.#service?.setFindQuery(query, options);
  }
  findNextMatch() {
    this.#service?.findNextMatch();
  }
  findPrevMatch() {
    this.#service?.findPrevMatch();
  }
  replaceCurrentMatch(replacement: string) {
    this.#service?.replaceCurrentMatch(replacement);
  }
  replaceRange(from: number, to: number, markdown: string) {
    this.#service?.replaceRange(from, to, markdown);
  }
  setInlineAIThreads(threads: InlineAIThread[]) {
    this.#service?.setInlineAIThreads(threads);
  }
  scrollInlineAIThreadIntoView(threadId: string) {
    this.#service?.scrollInlineAIThreadIntoView(threadId);
  }
  replaceAllMatches(replacement: string) {
    this.#service?.replaceAllMatches(replacement);
  }
  getFindReplaceState() {
    return this.#service?.getFindReplaceState() ?? null;
  }

  activateQuickJump() {
    this.#service?.activateQuickJump();
  }

  toggleSelectedTodos(): number {
    return this.#service?.toggleSelectedTodos() ?? 0;
  }

  /**
   * Get the current selection.
   */
  getSelection(): Selection {
    if (!this.#service) return EMPTY_SELECTION;
    return this.#service.getSelection();
  }

  /**
   * Undo the last change.
   */
  undo() {
    if (!this.#service) throw new Error('EditorStore not initialized');
    this.#service.undo();
  }

  /**
   * Redo the last undone change.
   */
  redo() {
    if (!this.#service) throw new Error('EditorStore not initialized');
    this.#service.redo();
  }

  /**
   * Check if undo is available.
   */
  canUndo(): boolean {
    if (!this.#service) return false;
    return this.#service.canUndo();
  }

  /**
   * Check if redo is available.
   */
  canRedo(): boolean {
    if (!this.#service) return false;
    return this.#service.canRedo();
  }

  // ========== Block-level operations ==========

  selectBlock(blockId: string) {
    this.#service?.selectBlock(blockId);
  }

  selectBlockRange(startBlockId: string, endBlockId: string) {
    this.#service?.selectBlockRange(startBlockId, endBlockId);
  }

  duplicateBlock(blockId: string) {
    this.#service?.duplicateBlock(blockId);
  }

  convertBlock(blockId: string, targetType: Block['type']) {
    this.#service?.convertBlock(blockId, targetType);
  }

  lockBlockForAI(blockId: string, operationLabel: string) {
    this.#service?.lockBlockForAI(blockId, operationLabel);
  }

  unlockBlockFromAI(blockId: string) {
    this.#service?.unlockBlockFromAI(blockId);
  }

  replaceBlockContent(blockId: string, markdown: string) {
    this.#service?.replaceBlockContent(blockId, markdown);
  }

  startAIBlockOperation(blockId: string, operationLabel: string, expectedContent?: string) {
    this.#service?.startAIBlockOperation(blockId, operationLabel, expectedContent);
  }

  streamAIBlock(blockId: string, textDelta: string) {
    this.#service?.streamAIBlock(blockId, textDelta);
  }

  finishAIBlockOperation(blockId: string, finalMarkdown: string) {
    this.#service?.finishAIBlockOperation(blockId, finalMarkdown);
  }

  failAIBlockOperation(blockId: string, message: string) {
    this.#service?.failAIBlockOperation(blockId, message);
  }

  cancelAIBlockOperation(blockId: string) {
    this.#service?.cancelAIBlockOperation(blockId);
  }

  scrollBlockIntoView(blockId: string, mode: 'nearest' | 'center' | 'smart' = 'smart') {
    this.#service?.scrollBlockIntoView(blockId, mode);
  }

  insertContent(markdown: string) {
    this.#service?.insertContent(markdown);
  }

  insertContentAfterBlock(blockId: string, markdown: string) {
    this.#service?.insertContentAfterBlock(blockId, markdown);
  }

  updateImageBlockAttrs(blockId: string, attrs: EditorImageBlockAttrs) {
    this.#service?.updateImageBlockAttrs(blockId, attrs);
  }

  getAILockedBlocks(): string[] {
    return this.#service?.getAILockedBlocks() ?? [];
  }

  getBlockInfo(blockId: string) {
    return this.#service?.getBlockInfo(blockId) ?? null;
  }

  /**
   * Check if the store has been initialized.
   */
  get isInitialized(): boolean {
    return this.#service !== null;
  }

  /**
   * Check if a document is currently open.
   */
  get hasDocument(): boolean {
    return this.document !== null;
  }

  /**
   * Check if any operation is currently in progress.
   */
  get isBusy(): boolean {
    return this.operationInProgress !== null;
  }

  /**
   * Check if the last operation succeeded.
   */
  get lastOperationSucceeded(): boolean {
    return this.lastOperation?.success ?? true;
  }

  /**
   * Cleanup subscriptions, event listeners, and reset state.
   */
  #cleanup() {
    if (this.#unsubscribe) {
      this.#unsubscribe();
      this.#unsubscribe = null;
    }

    // Cleanup event listeners
    for (const cleanup of this.#eventCleanup) {
      cleanup();
    }
    this.#eventCleanup = [];
  }

  /**
   * Destroy the store and cleanup resources.
   */
  destroy() {
    this.#cleanup();
    this.#service = null;
    this.document = null;
    this.selection = EMPTY_SELECTION;
    this.isReady = false;
    this.isDirty = false;
    this.isSaving = false;
    this.aiProcessing = null;
    this.error = null;
    this.operationInProgress = null;
    this.lastOperation = null;
    this.selectedBlockIds = [];
    this.aiLockedBlocks = new Map();
    this.slashMenuState = null;
    this.pageLinkMenuState = null;
    this.blockMenuRequest = null;
  }
}

export const editorStore = new EditorStore();
