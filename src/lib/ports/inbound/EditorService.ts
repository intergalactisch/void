/**
 * EditorService - Inbound port for main editor API
 *
 * This port defines the application API for the editor, exposing what the
 * UI layer can do with the editor. Primary adapters (Svelte components, stores)
 * depend on this interface.
 *
 * Part of the Hexagonal Architecture inbound ports layer.
 */

import type { Document, Block } from '$lib/domain';
import type { DocumentMeta } from '$lib/domain/values';
import type { Selection } from '$lib/domain/values';
import type { Result } from '$lib/core';
import type {
  BlockInfo,
  EditorInlineAIComposerView,
  EditorInlineAIRangeAnchorInput,
  EditorInlineAIRangeAnchorResult,
  EditorImageBlockAttrs,
  EditorPageLinkNote,
} from '$lib/ports/outbound/EditorPort';
import type { RegisteredCommand } from '$lib/ports/outbound/CommandRegistryPort';
import type { LineageRecordOptions } from './LineageService';
import type { InlineAIThread } from '$lib/domain/entities/InlineAIThread';
import type { InlineAIThreadService } from './InlineAIThreadService';

export interface EditorMountOptions {
  autoSaveDelayMs?: number;
}

/**
 * Per-tab metadata exposed to the UI for the tab strip.
 * Lightweight; full document content lives in the service's session map.
 */
export interface EditorTabInfo {
  path: string;
  title: string;
  isDirty: boolean;
  isSaving: boolean;
  /** 'clean' if file matches disk; otherwise needs UI resolution. */
  conflictState: 'clean' | 'external-modified' | 'external-deleted';
}

/** What the user wants to do about an external-modified file. */
export type ConflictResolution = 'keep-local' | 'take-remote';

/**
 * Live editor state for one mounted workspace pane.
 *
 * Legacy top-level editor fields are still derived from the last-focused pane,
 * so existing toolbar/status/AI flows keep targeting the focused editor.
 */
export interface EditorPaneState {
  paneId: string;
  path: string | null;
  document: Document | null;
  selection: Selection;
  isReady: boolean;
  isDirty: boolean;
  isSaving: boolean;
  conflictState: 'clean' | 'external-modified' | 'external-deleted';
  aiProcessing: EditorState['aiProcessing'];
  aiInlineComposers: EditorInlineAIComposerView[];
  activeAIInlineComposerId: string | null;
}

/**
 * Editor state exposed to the UI.
 *
 * The `document`, `isDirty`, `isSaving`, and `aiProcessing` fields all
 * describe the **active tab**. `tabs` and `activePath` describe the full
 * multi-tab state. Callers that only care about the focused note can keep
 * reading the legacy single-doc fields.
 */
export interface EditorState {
  /** The currently open document (active tab), or null if none */
  document: Document | null;
  /** All open tabs in display order */
  tabs: EditorTabInfo[];
  /** Path of the active tab (matches `document?.path` when document is set) */
  activePath: string | null;
  /** ID of the last-focused mounted editor pane, if any. */
  activePaneId: string | null;
  /** Live mounted pane states keyed by paneId. */
  panes: Record<string, EditorPaneState>;
  /** Current selection state */
  selection: Selection;
  /** Whether the editor is mounted and ready */
  isReady: boolean;
  /** Whether the active document has unsaved changes */
  isDirty: boolean;
  /** Whether the active document is currently being saved */
  isSaving: boolean;
  /** Conflict state of the active session against the on-disk file */
  conflictState: 'clean' | 'external-modified' | 'external-deleted';
  /** AI processing state, or null if not processing */
  aiProcessing: {
    /** Block ID being processed */
    blockId: string;
    /** Operation being performed */
    operation: string;
  } | null;
  /** Floating inline Ask composers currently anchored in the editor */
  aiInlineComposers: EditorInlineAIComposerView[];
  /** The expanded/focused inline Ask composer, if any */
  activeAIInlineComposerId: string | null;
}

/**
 * Inbound port - main editor service API.
 *
 * This interface is implemented by application services (EditorServiceImpl)
 * and defines the API available to UI components and stores.
 */
export interface EditorService {
  /**
   * Get current editor state.
   * @returns The current editor state
   */
  getState(): EditorState;

  /**
   * Mount the active editor document into a DOM host.
   */
  mount(element: HTMLElement, document?: Document, options?: EditorMountOptions): Promise<Result<void, Error>>;

  /**
   * Mount a note document into a specific workspace pane.
   */
  mountPane(
    paneId: string,
    element: HTMLElement,
    path: string,
    document?: Document,
    options?: EditorMountOptions,
  ): Promise<Result<void, Error>>;

  /**
   * Unmount a specific workspace pane while preserving its session snapshot.
   * When `element` is passed, the pane is only unmounted if that DOM host still
   * owns the mounted editor instance.
   */
  unmountPane(paneId: string, element?: HTMLElement | null): void;

  /**
   * Make a mounted pane the focused command target.
   */
  focusPane(paneId: string): void;

  /**
   * Save a specific mounted pane/session.
   */
  savePane(paneId: string, lineage?: LineageRecordOptions): Promise<Result<void, Error>>;

  /**
   * Lookup live pane state by pane id.
   */
  getPaneState(paneId: string): EditorPaneState | null;

  /**
   * Destroy the mounted editor instance.
   */
  destroy(): void;

  /**
   * Update autosave delay for future editor changes.
   */
  setAutoSaveDelay(delayMs: number): void;

  // ========== Document operations ==========

  /**
   * Open document for editing.
   * Loads the document from storage and initializes the editor.
   * @param path - Relative path to the document
   * @returns Result containing the opened document or an error
   */
  openDocument(path: string): Promise<Result<Document, Error>>;

  /**
   * Re-read a document from storage even if it already has an open session.
   * Used when an external boundary changes representation, such as vault
   * lock/unlock or note protection.
   */
  reloadDocument(path: string, options?: { flushDirty?: boolean }): Promise<Result<Document, Error>>;

  /**
   * Flush dirty protected sessions before the vault is locked.
   */
  prepareProtectedDocumentsForLock(): Promise<Result<void, Error>>;

  /**
   * Re-read all open protected sessions after a vault state change.
   */
  reloadProtectedDocuments(options?: { flushDirty?: boolean }): Promise<Result<void, Error>>;

  /**
   * Save current document.
   * Persists the current document state to storage.
   * @returns Result indicating success or failure
   */
  saveDocument(lineage?: LineageRecordOptions): Promise<Result<void, Error>>;

  /**
   * Reveal the current document in the system file manager.
   * Opens the containing folder with the markdown file selected.
   */
  revealCurrentDocument(): Promise<Result<void, Error>>;

  /**
   * Update metadata on the open document without remounting editor content.
   * Marks the document dirty so the normal save/autosave path persists it.
   */
  updateDocumentMeta(updates: Partial<DocumentMeta>): Result<Document, Error>;

  /**
   * Close current document.
   * Clears the editor state. Does not save automatically.
   */
  closeDocument(): void;

  // ========== Multi-tab management ==========

  /**
   * Activate an already-open tab. If the path is not in the open tabs,
   * does nothing — call `openDocument(path)` to open + activate instead.
   * Captures the current editor's content into its session before swapping.
   */
  switchTab(path: string): Promise<Result<void, Error>>;

  /**
   * Close a specific tab by path. Flushes any pending save for that path
   * before unmounting. If `path` is the active tab and other tabs remain,
   * activates the next one.
   */
  closeTab(path: string): Promise<Result<void, Error>>;

  /**
   * Resolve a conflict on an open session.
   *
   * - `take-remote`: discard in-memory edits and reload from disk.
   * - `keep-local`: force-save the in-memory document, overwriting the
   *   externally-modified file.
   */
  resolveConflict(path: string, action: ConflictResolution): Promise<Result<void, Error>>;

  /**
   * Create new document.
   * Creates and opens a new document at the specified path.
   * @param path - Relative path for the new document
   * @param title - Optional title for the document
   * @returns Result containing the created document or an error
   */
  createDocument(path: string, title?: string): Promise<Result<Document, Error>>;

  // ========== Block operations ==========

  /**
   * Insert block at position.
   * @param type - The block type to insert
   * @param afterBlockId - Optional ID of block to insert after (end if not specified)
   */
  insertBlock(type: Block['type'], afterBlockId?: string): void;

  /**
   * Delete block.
   * @param blockId - ID of the block to delete
   */
  deleteBlock(blockId: string): void;

  /**
   * Move block to new position.
   * @param blockId - ID of the block to move
   * @param targetIndex - Target index in the block list
   */
  moveBlock(blockId: string, targetIndex: number): void;

  /**
   * Update block content.
   * @param blockId - ID of the block to update
   * @param updates - Partial block updates to apply
   */
  updateBlock(blockId: string, updates: Partial<Block>): void;

  /**
   * Insert markdown content at the current cursor position.
   * Parses markdown to structured blocks and inserts after the current block.
   * @param markdown - Markdown string to insert
   */
  insertContent(markdown: string): void;

  /**
   * Get current editor text content.
   */
  getTextContent(paneId?: string): string;

  /**
   * Serialize current editor content to markdown.
   */
  getMarkdown(): Result<string, Error>;

  /**
   * Read editor text between ProseMirror positions. Returns empty string when
   * the editor is not mounted or the range is invalid.
   */
  getTextBetween(from: number, to: number): string;

  /**
   * Return true when the editor range overlaps an existing protected-lines block.
   */
  rangeIntersectsProtectedBlock(from: number, to: number): boolean;

  /**
   * Re-resolve an inline AI text anchor against the mounted editor.
   */
  resolveInlineAIRangeAnchor(input: EditorInlineAIRangeAnchorInput): EditorInlineAIRangeAnchorResult | null;

  // ========== Editor commands ==========

  /**
   * Execute slash command.
   * @param commandId - ID of the command to execute
   */
  executeCommand(commandId: string): Promise<void>;

  // ========== Find / Replace ==========
  /** Open the in-document find bar. */
  openFindReplace(mode: 'find' | 'replace'): void;
  /** Close the in-document find bar. */
  closeFindReplace(): void;
  /** Update the find query and option flags. */
  setFindQuery(query: string, options?: { regex?: boolean; caseSensitive?: boolean; wholeWord?: boolean }): void;
  /** Move to the next match (wraps). */
  findNextMatch(): void;
  /** Move to the previous match (wraps). */
  findPrevMatch(): void;
  /** Replace the active match. */
  replaceCurrentMatch(replacement: string): void;
  /** Replace an explicit editor document range with markdown/text content. */
  replaceRange(from: number, to: number, markdown: string): void;

  /** Sync persisted inline AI sidecar threads into the mounted editor. */
  setInlineAIThreads(threads: InlineAIThread[]): void;

  /** Scroll to a rendered inline AI response card. */
  scrollInlineAIThreadIntoView(threadId: string): void;

  /** Wire the persisted inline AI service after bootstrap resolves services. */
  setInlineAIThreadService(service: InlineAIThreadService): void;
  /** Replace every match. */
  replaceAllMatches(replacement: string): void;
  /** Read raw plugin state — returns null if no editor is mounted. */
  getFindReplaceState(): {
    active: boolean;
    query: string;
    regex: boolean;
    caseSensitive: boolean;
    wholeWord: boolean;
    matches: { from: number; to: number }[];
    activeIndex: number;
  } | null;

  /** Activate quick-jump (AceJump-style block navigation). */
  activateQuickJump(): void;

  /**
   * Toggle the `checked` state on every selected todoItem. Returns count
   * for user feedback (e.g., "5 todos completed").
   */
  toggleSelectedTodos(): number;

  /**
   * Toggle inline mark.
   * Toggles the specified mark on the current selection.
   * @param mark - Mark type to toggle (e.g., 'bold', 'italic')
   */
  toggleMark(mark: string, attrs?: Record<string, unknown>): void;

  /**
   * Set block type of current selection.
   * Converts the selected block(s) to the specified type.
   * @param type - The block type to set
   */
  setBlockType(type: Block['type']): void;

  /**
   * Apply a link mark to the current selection.
   */
  setLink(href: string, title?: string): void;

  /**
   * Remove web link mark from the current selection.
   */
  removeLink(): void;

  /**
   * Open the note-reference picker for the current selection/cursor.
   */
  openPageLinkPicker(): void;

  /**
   * Apply a note-reference page link to selected text/cursor.
   */
  setPageLink(note: EditorPageLinkNote): void;

  /**
   * Remove a note-reference page link while keeping the visible words.
   */
  removePageLink(): void;

  /**
   * Update the note-reference picker query.
   */
  updatePageLinkQuery(query: string): void;

  /**
   * Move the note-reference picker selection.
   */
  movePageLinkSelection(direction: 'next' | 'prev'): void;

  /**
   * Insert the chosen note from the active page-link autocomplete menu.
   */
  selectPageLink(note: EditorPageLinkNote): void;

  /**
   * Close page-link autocomplete without selection.
   */
  closePageLinkMenu(): void;

  /**
   * Open AI prompt for an explicit DOM selection.
   */
  aiPromptSelectionAt(from: number, to: number, text: string): void;

  /** Update one floating inline AI composer prompt draft. */
  updateAIInlineComposerDraft(id: string, prompt: string): void;

  /** Submit one floating inline AI composer. */
  submitAIInlineComposer(id: string, prompt: string): void;

  /** Cancel one floating inline AI composer. */
  cancelAIInlineComposer(id: string): void;

  /** Focus/expand one floating inline AI composer. */
  focusAIInlineComposer(id: string): void;

  /**
   * Resolve a DOM Range to editor document positions.
   */
  resolveSelectionFromDOM(range: Range): { from: number; to: number } | null;

  /**
   * Execute a selected slash menu command.
   */
  executeSlashMenuCommand(command: RegisteredCommand): void;

  /**
   * Close the slash menu without selection.
   */
  closeSlashMenu(): void;

  // ========== Focus/selection ==========

  /**
   * Focus editor.
   * Programmatically focus the editor.
   */
  focus(): void;

  /**
   * Get current selection.
   * @returns The current selection state
   */
  getSelection(): Selection;

  // ========== Undo/redo ==========

  /**
   * Undo last change.
   */
  undo(): void;

  /**
   * Redo last undone change.
   */
  redo(): void;

  /**
   * Check if editor can undo.
   * @returns True if there are changes to undo
   */
  canUndo(): boolean;

  /**
   * Check if editor can redo.
   * @returns True if there are undone changes to redo
   */
  canRedo(): boolean;

  // ========== Block-level operations ==========

  /**
   * Select a block by ID.
   * @param blockId - ID of the block to select
   */
  selectBlock(blockId: string): void;

  /**
   * Select a range of blocks.
   * @param startBlockId - ID of the first block in the range
   * @param endBlockId - ID of the last block in the range
   */
  selectBlockRange(startBlockId: string, endBlockId: string): void;

  /**
   * Duplicate a block.
   * @param blockId - ID of the block to duplicate
   */
  duplicateBlock(blockId: string): void;

  /**
   * Convert a block to a different type, preserving content.
   * @param blockId - ID of the block to convert
   * @param targetType - The target block type
   */
  convertBlock(blockId: string, targetType: Block['type']): void;

  // ========== AI block locking ==========

  /**
   * Lock a block for AI processing.
   * @param blockId - ID of the block to lock
   * @param operationLabel - Description of the AI operation
   */
  lockBlockForAI(blockId: string, operationLabel: string): void;

  /**
   * Unlock a block after AI processing.
   * @param blockId - ID of the block to unlock
   */
  unlockBlockFromAI(blockId: string): void;

  /**
   * Replace block content (used by AI streaming).
   * @param blockId - ID of the block
   * @param markdown - New markdown content
   */
  replaceBlockContent(blockId: string, markdown: string): void;

  /**
   * Start a visible AI operation on a block.
   */
  startAIBlockOperation(blockId: string, operationLabel: string, expectedContent?: string): void;

  /**
   * Stream AI text into a block overlay without mutating document content.
   */
  streamAIBlock(blockId: string, textDelta: string): void;

  /**
   * Finalize an AI block operation by applying markdown and releasing the lock.
   */
  finishAIBlockOperation(blockId: string, finalMarkdown: string): void;

  /**
   * Mark an AI block operation as failed.
   */
  failAIBlockOperation(blockId: string, message: string): void;

  /**
   * Cancel an AI block operation.
   */
  cancelAIBlockOperation(blockId: string): void;

  /**
   * Scroll a block into view without focusing the editor.
   */
  scrollBlockIntoView(blockId: string, mode?: 'nearest' | 'center' | 'smart'): void;

  /**
   * Insert markdown blocks immediately after an existing block.
   */
  insertContentAfterBlock(blockId: string, markdown: string): void;

  /**
   * Update attrs for an image block without replacing the block.
   */
  updateImageBlockAttrs(blockId: string, attrs: EditorImageBlockAttrs): void;

  /**
   * Get all currently AI-locked block IDs.
   */
  getAILockedBlocks(): string[];

  /**
   * Get block metadata by ID.
   * @param blockId - ID of the block to query
   */
  getBlockInfo(blockId: string): BlockInfo | null;

  // ========== Subscriptions ==========

  /**
   * Subscribe to state changes.
   * @param callback - Called whenever the editor state changes
   * @returns Unsubscribe function
   */
  subscribe(callback: (state: EditorState) => void): () => void;
}
