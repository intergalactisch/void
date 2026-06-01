/**
 * EditorPort - Outbound port for editor rendering infrastructure
 *
 * This port defines the contract between the application and the editor
 * rendering infrastructure (e.g., ProseMirror). The application layer
 * depends on this interface, never on concrete implementations.
 *
 * Part of the Hexagonal Architecture outbound ports layer.
 */

import type { Document, Block } from '$lib/domain';
import type { DocumentMeta } from '$lib/domain/values';
import type { Selection } from '$lib/domain/values';
import type { BlockType } from '$lib/domain/values/BlockType';
import type { Result } from '$lib/core';
import type { RegisteredCommand } from './CommandRegistryPort';
import type { InlineAIThread } from '$lib/domain/entities/InlineAIThread';

export type EditorMenuStatePayload = unknown;
export type EditorBlockMenuMode = 'actions' | 'convert';

export interface EditorMenuPosition {
  top: number;
  left: number;
  openAbove?: boolean;
  maxHeight?: number;
}

export interface EditorBlockMenuRequest {
  blockId: string;
  lineIndex: number;
  position: EditorMenuPosition;
  currentType: BlockType;
  mode: EditorBlockMenuMode;
}

export interface EditorLineageInspectRequest {
  blockId: string;
  lineIndex: number;
  position: EditorMenuPosition;
  currentType: BlockType;
}

export interface EditorPageLinkNote {
  path: string;
  title: string;
  folder?: string;
  tags?: string[];
  modifiedAt?: Date;
  matchKind?: 'title' | 'path' | 'tag' | 'recent' | 'all';
  matchLabel?: string;
  score?: number;
  relation?: 'attached' | 'backlink' | 'none';
  isRecent?: boolean;
}

export interface EditorImageBlockAttrs {
  src?: string;
  alt?: string | null;
  title?: string | null;
  caption?: string | null;
  width?: number | null;
}

export interface EditorInlineGenerateCallbacks {
  onComplete: (markdown: string) => void;
  onResult?: (result: EditorInlineGenerateResult) => void;
  onError: (message: string) => void;
}

export interface EditorInlineGenerateRequest {
  prompt: string;
  selectionText: string | null;
  mode: 'generate' | 'selection';
  from: number | null;
  to: number | null;
  notePath: string | null;
  blockIds: string[];
}

export interface EditorInlineGenerateResult {
  message: string;
  didMutate: boolean;
  toolCount: number;
  conversationId?: string;
  inlineThreadId?: string;
  suppressLegacyPreview?: boolean;
}

export type EditorInlineAIComposerStatus = 'draft' | 'submitting';

export interface EditorInlineAIComposerView {
  id: string;
  from: number;
  to: number;
  selectionText: string;
  draftPrompt: string;
  status: EditorInlineAIComposerStatus;
  createdAt: string;
  updatedAt: string;
  isActive: boolean;
}

export interface EditorInlineAIComposerState {
  composers: EditorInlineAIComposerView[];
  activeComposerId: string | null;
}

export interface EditorInlineAIRangeAnchorInput {
  preferredRange: { from: number; to: number } | null;
  originalText: string;
  blockIds: string[];
  beforeText?: string;
  afterText?: string;
}

export interface EditorInlineAIRangeAnchorResult {
  from: number;
  to: number;
}

/**
 * Event types emitted by the editor.
 * These events are used to communicate state changes from the editor
 * to the application layer.
 */
export interface EditorEvents {
  /** Emitted when the document content changes */
  'editor:change': { document: Document };
  /** Emitted when the selection changes */
  'editor:selection': { selection: Selection };
  /** Emitted when the editor gains focus */
  'editor:focus': void;
  /** Emitted when the editor loses focus */
  'editor:blur': void;
  /** Emitted when the editor is mounted and ready */
  'editor:ready': void;
  /** Emitted when the slash command menu state changes */
  'editor:slash-menu-change': { state: EditorMenuStatePayload };
  /** Emitted when the page-link autocomplete state changes */
  'editor:page-link-menu-change': { state: EditorMenuStatePayload };
  /** Emitted when the block menu should open */
  'editor:block-menu-request': EditorBlockMenuRequest;
  /** Emitted when the lineage inspector should open for a visible line */
  'editor:lineage-inspect-request': EditorLineageInspectRequest;
  /** Emitted when a page/internal link is clicked */
  'editor:page-link-clicked': { path: string };
  /** Emitted when an external URL is clicked */
  'editor:external-link-clicked': { url: string };
  /** Emitted when a todo checkbox is toggled inside the editor */
  'editor:todo-toggled': { blockId: string; content: string; checked: boolean };
  /** Emitted when inline AI generation needs application services */
  'editor:ai-inline-generate': {
    prompt: string;
    selectionText: string | null;
    request: EditorInlineGenerateRequest;
    callbacks: EditorInlineGenerateCallbacks;
  };
  /** Emitted when inline AI draft composers change */
  'editor:ai-inline-composers-change': EditorInlineAIComposerState;
  /** Emitted when block-level selection changes (gutter click, shift-click) */
  'editor:block-selected': { blockIds: string[] };
  /** Emitted when a block is moved (drag-drop or keyboard) */
  'editor:block-moved': { blockId: string; fromIndex: number; toIndex: number };
  /** Emitted when a block type is converted */
  'editor:block-converted': { blockId: string; fromType: string; toType: string };
  /** Emitted when AI locks a block */
  'editor:block-ai-locked': { blockId: string; operation: string };
  /** Emitted when AI unlocks a block */
  'editor:block-ai-unlocked': { blockId: string };
  /** Emitted when an AI block operation changes phase */
  'editor:block-ai-phase': { blockId: string; operation: string; phase: string };
  /** Emitted when the editor should consider a block the active AI target */
  'editor:block-ai-active-target': { blockId: string | null };
  /** Emitted after the editor scrolls a block into view */
  'editor:block-scrolled-into-view': { blockId: string; mode: 'nearest' | 'center' | 'smart' };
}

/**
 * Commands that can be executed on the editor.
 * These represent the atomic operations the editor can perform.
 */
export interface EditorCommands {
  /** Insert a block at current position */
  insertBlock(type: Block['type'], attrs?: Block['attrs']): void;
  /** Delete block by ID */
  deleteBlock(blockId: string): void;
  /** Move block to new position */
  moveBlock(blockId: string, targetIndex: number): void;
  /** Toggle mark on selection */
  toggleMark(mark: string, attrs?: Record<string, unknown>): void;
  /** Set block type of current selection */
  setBlockType(type: Block['type']): void;
  /** Focus the editor */
  focus(): void;
  /** Blur the editor */
  blur(): void;
  /** Undo last change */
  undo(): void;
  /** Redo last undone change */
  redo(): void;
  /** Start inline AI generation with a prompt */
  aiInlineGenerate(prompt: string): void;
  /** Open AI prompt input for the current selection (Cmd+J equivalent) */
  aiPromptSelection(): void;
  /** Open AI prompt input at explicit positions (toolbar click path) */
  aiPromptSelectionAt(from: number, to: number, text: string): void;
  /** Update one floating inline AI composer draft. */
  updateAIInlineComposerDraft(id: string, prompt: string): void;
  /** Submit one floating inline AI composer. */
  submitAIInlineComposer(id: string, prompt: string): void;
  /** Cancel one floating inline AI composer. */
  cancelAIInlineComposer(id: string): void;
  /** Focus/expand one floating inline AI composer. */
  focusAIInlineComposer(id: string): void;
  /** Insert markdown content at current cursor position */
  insertContent(markdown: string): void;
  /** Apply a link mark to the current selection */
  setLink(href: string, title?: string): void;
  /** Remove link mark from the current selection */
  removeLink(): void;
  /** Open note-reference picker for selected text or the cursor */
  openPageLinkPicker(): void;
  /** Apply a note-reference page link to selected text or the cursor */
  setPageLink(note: EditorPageLinkNote): void;
  /** Remove page-link mark from selected text or the current page-link */
  removePageLink(): void;
  /** Update the note-reference picker query */
  updatePageLinkQuery(query: string): void;
  /** Move the selected note-reference picker row */
  movePageLinkSelection(direction: 'next' | 'prev'): void;
  /** Insert the selected note from the active page-link autocomplete menu */
  selectPageLink(note: EditorPageLinkNote): void;
  /** Close the page-link autocomplete menu */
  closePageLinkMenu(): void;
  /** Select a block by ID (adds block selection decoration) */
  selectBlock(blockId: string): void;
  /** Select a range of blocks by ID */
  selectBlockRange(startBlockId: string, endBlockId: string): void;
  /** Duplicate a block */
  duplicateBlock(blockId: string): void;
  /** Convert block type in-place, preserving content */
  convertBlock(blockId: string, targetType: Block['type']): void;
  /** Lock a block for AI processing */
  lockBlockForAI(blockId: string, operationLabel: string): void;
  /** Unlock a block after AI processing */
  unlockBlockFromAI(blockId: string): void;
  /** Replace block content (used by AI streaming with AI_BYPASS meta) */
  replaceBlockContent(blockId: string, markdown: string): void;
  /** Start a block AI lifecycle operation */
  startAIBlockOperation(blockId: string, operationLabel: string, expectedContent?: string): void;
  /** Append streamed AI text to the block overlay */
  streamAIBlock(blockId: string, textDelta: string): void;
  /** Finalize an AI block operation and auto-unlock after the completion flash */
  finishAIBlockOperation(blockId: string, finalMarkdown: string): void;
  /** Mark an AI block operation failed */
  failAIBlockOperation(blockId: string, message: string): void;
  /** Cancel an AI block operation */
  cancelAIBlockOperation(blockId: string): void;
  /** Scroll a block into the editor viewport without stealing focus */
  scrollBlockIntoView(blockId: string, mode?: 'nearest' | 'center' | 'smart'): void;
  /** Insert markdown blocks immediately after a block */
  insertContentAfterBlock(blockId: string, markdown: string): void;
  /** Update attrs for an image block without replacing the block. */
  updateImageBlockAttrs(blockId: string, attrs: EditorImageBlockAttrs): void;
  /** Update a todo item by matching its current text content */
  updateTodoContent(previousContent: string, nextContent: string, checked?: boolean): void;
  /** Delete a todo item by matching its current text content */
  deleteTodoContent(content: string): void;
  // ─── Find / Replace ───
  /** Open the find/replace bar in the requested mode. */
  openFindReplace(mode: 'find' | 'replace'): void;
  /** Close the find/replace bar and clear matches. */
  closeFindReplace(): void;
  /** Update the active find query and option flags. */
  setFindQuery(query: string, options?: { regex?: boolean; caseSensitive?: boolean; wholeWord?: boolean }): void;
  /** Move to the next find match (wraps). */
  findNextMatch(): void;
  /** Move to the previous find match (wraps). */
  findPrevMatch(): void;
  /** Replace the currently active match with the given text. */
  replaceCurrentMatch(replacement: string): void;
  /** Replace an explicit document range with markdown/text content. */
  replaceRange(from: number, to: number, markdown: string): void;
  /** Sync persisted inline AI sidecar threads into editor decorations. */
  setInlineAIThreads(threads: InlineAIThread[]): void;
  /** Scroll a rendered inline AI sidecar thread into view. */
  scrollInlineAIThreadIntoView(threadId: string): void;
  /** Replace every match in the document atomically. Returns the number replaced. */
  replaceAllMatches(replacement: string): number;
  /** Activate quick-jump: label every visible block with a 2-letter code. */
  activateQuickJump(): void;
  /**
   * Toggle the `checked` attribute on every selected todoItem block in a
   * single transaction (atomic undo). No-op for blocks that aren't todos.
   * Returns the count of toggled todos for caller feedback.
   */
  toggleSelectedTodos(): number;
}

/**
 * Outbound port for editor rendering infrastructure.
 *
 * This interface is implemented by secondary adapters (e.g., ProseMirrorAdapter)
 * and defines how the application interacts with the editor rendering layer.
 */
export interface EditorPort {
  /**
   * Mount editor to DOM element.
   * @param element - The HTML element to mount the editor into
   * @param document - The initial document to display
   * @returns Result indicating success or failure
   */
  mount(element: HTMLElement, document: Document): Promise<Result<void, Error>>;

  /**
   * Update editor with new document state.
   * Called when the document is modified externally (e.g., from undo/redo).
   * @param document - The new document state
   */
  update(document: Document): void;

  /**
   * Update metadata used for subsequent serialization without changing the
   * rendered editor document.
   */
  updateMetadata(meta: DocumentMeta): void;

  /**
   * Destroy editor and cleanup resources.
   * Should be called when the editor is unmounted.
   */
  destroy(): void;

  /**
   * Get current selection state.
   * @returns The current selection
   */
  getSelection(): Selection;

  /**
   * Execute an editor command.
   * @param command - The command name to execute
   * @param args - Arguments for the command
   */
  execute<K extends keyof EditorCommands>(
    command: K,
    ...args: Parameters<EditorCommands[K]>
  ): void;

  /**
   * Subscribe to editor events.
   * @param event - The event name to subscribe to
   * @param handler - Callback function for the event
   * @returns Unsubscribe function
   */
  on<K extends keyof EditorEvents>(
    event: K,
    handler: (payload: EditorEvents[K]) => void
  ): () => void;

  /**
   * Get current document state from editor.
   * Converts the editor's internal representation to a domain Document.
   * @returns The current document
   */
  getDocument(): Document;

  /**
   * Get all text content from the editor.
   * @returns Plain text content, or an empty string when unmounted
   */
  getTextContent(): string;

  /**
   * Get text in a document range.
   * @returns Plain text for the requested range, or empty string when invalid.
   */
  getTextBetween(from: number, to: number): string;

  /**
   * Check whether a document range overlaps an existing protected-lines block.
   */
  rangeIntersectsProtectedBlock(from: number, to: number): boolean;

  /**
   * Replace an unlocked protected-lines block with its plaintext child blocks.
   * Returns false when the block cannot be found or is still locked.
   */
  unprotectProtectedBlock(protectionId: string): boolean;

  /**
   * Re-resolve an inline AI text anchor against the current editor document.
   * Returns null when the original text is gone or the match is ambiguous.
   */
  resolveInlineAIRangeAnchor(input: EditorInlineAIRangeAnchorInput): EditorInlineAIRangeAnchorResult | null;

  /**
   * Serialize current editor content to markdown.
   * @returns Markdown representation of the mounted editor document
   */
  getMarkdown(): string;

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

   /**
   * Toggle a todoItem's checked state.
   * Matches by block ID first (exact), falls back to content matching.
   * Used to sync task workspace changes into the editor when a note is open.
   * @param blockId - The block ID to match (preferred, exact match)
   * @param content - The text content to match as fallback
   * @param checked - The new checked state to set
   * @returns True if a matching todoItem was found and toggled
   */
  toggleTodoChecked(blockId: string, content: string, checked: boolean): boolean;

  /**
   * Select a slash menu command - deletes the trigger text ("/" + query) and closes the menu.
   * Call this before executing a slash menu command to clean up the editor state.
   * @returns The trigger position where the command should insert content, or null if menu not open
   */
  selectSlashMenuCommand(): number | null;

  /**
   * Close the slash menu without selecting a command.
   */
  closeSlashMenu(): void;

  /**
   * Execute a slash menu command after cleaning up the trigger text.
   */
  executeSlashMenuCommand(command: RegisteredCommand): void;

  /**
   * Convert a DOM position to a ProseMirror document position.
   * @param node - The DOM node
   * @param offset - The offset within the node
   * @returns The ProseMirror document position
   */
  posFromDOM(node: Node, offset: number): number;

  /**
   * Resolve a DOM Range to ProseMirror document positions.
   * @param range - The DOM Range to resolve
   * @returns Object with from/to positions, or null if resolution fails
   */
  resolveSelectionFromDOM(range: Range): { from: number; to: number } | null;

  /**
   * Query which blocks are currently locked by AI.
   * @returns Array of block IDs that are AI-locked
   */
  getAILockedBlocks(): string[];

  /**
   * Query block metadata by ID.
   * @param blockId - The block ID to query
   * @returns Block metadata or null if not found
   */
  getBlockInfo(blockId: string): BlockInfo | null;
}

/**
 * Lightweight block metadata returned by getBlockInfo.
 */
export interface BlockInfo {
  id: string;
  type: BlockType;
  pos: number;
  size: number;
  isAILocked: boolean;
  content: string;
}
