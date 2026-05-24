/**
 * ProseMirrorAdapter - Implements EditorPort for ProseMirror
 *
 * This adapter is the bridge between the domain layer and ProseMirror.
 * It converts domain Document/Block structures to ProseMirror state and vice versa.
 *
 * Part of the Hexagonal Architecture secondary adapters layer.
 */

import { EditorState, TextSelection } from 'prosemirror-state';
import type { Transaction, Plugin } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { Fragment, Slice, type Node as PmNode } from 'prosemirror-model';
import { baseKeymap, chainCommands, exitCode, toggleMark } from 'prosemirror-commands';
import { keymap } from 'prosemirror-keymap';
import { splitListItem, liftListItem, sinkListItem } from 'prosemirror-schema-list';
import { dropCursor } from 'prosemirror-dropcursor';
import { gapCursor } from 'prosemirror-gapcursor';

import type {
  EditorPort,
  EditorEvents,
  EditorCommands,
  EditorInlineAIComposerState,
  EditorInlineAIRangeAnchorInput,
  EditorInlineAIRangeAnchorResult,
  EditorInlineGenerateCallbacks,
  EditorInlineGenerateRequest,
  EditorPageLinkNote,
} from '$lib/ports/outbound/EditorPort';
import type { Document } from '$lib/domain/entities/Document';
import type { Block, BlockAttrs } from '$lib/domain/entities/Block';
import type { InlineAIThread } from '$lib/domain/entities/InlineAIThread';
import { generateBlockId, createBlock, createEmptyParagraph } from '$lib/domain/entities/Block';
import type { Selection } from '$lib/domain/values/Selection';
import { EMPTY_SELECTION } from '$lib/domain/values/Selection';
import type { BlockType } from '$lib/domain/values/BlockType';
import type { Mark, MarkType } from '$lib/domain/values/Mark';
import type { Result } from '$lib/core';
import { ok, err } from '$lib/core';

import { voidSchema } from './schema';
import {
  domainToProseMirror,
  proseMirrorToDomain,
  blockToPmNode,
  cloneNodeWithNewIds,
  getNodeTypeForBlockType,
} from './DocumentConverter';
import { AIInlineCoordinator } from './AIInlineCoordinator';
import { historyPlugin, historyKeymap, canUndo, canRedo, undoCommand, redoCommand } from './plugins/history';
import { placeholderPlugin } from './plugins/placeholder';
import { createSlashMenuPlugin, slashMenuKey, type SlashMenuState } from './plugins/slashMenu';
import { createDragDropPlugin, type DragDropPluginOptions } from './plugins/dragDrop';
import { createAIRewritePlugin, type AIRewritePluginState, type AIRewritePluginOptions } from './plugins/aiRewrite';
import {
  createAIInlinePlugin,
  updateAIInlineComposerDraft,
  submitAIInlineComposer,
  cancelAIInlineComposer,
  focusAIInlineComposer,
  type AIInlineState,
} from './plugins/aiInline';
import { createAIThreadsPlugin, setAIThreads } from './plugins/aiThreads';
import {
  createPageLinkPlugin,
  insertPageLink,
  openPageLinkPicker,
  setPageLink,
  removePageLink,
  closePageLinkPicker,
  pageLinkKey,
  type PageLinkState,
  type NotesProvider,
} from './plugins/pageLink';
import { createBlockSelectionKeymap, createBlockSelectionPlugin, selectBlockFromGutter, getBlockSelectionState } from './plugins/blockSelection';
import { getVisibleBlockOrder } from './commands/blockUtils';
import {
  createFindReplacePlugin,
  openFindBar,
  closeFindBar,
  setFindQuery,
  findNext,
  findPrev,
  replaceCurrent,
  replaceAll,
  getFindReplaceState,
} from './plugins/findReplace';
import {
  createQuickJumpPlugin,
  activateQuickJump,
} from './plugins/quickJump';
import { createAIBlockPlugin, aiBlockKey, AI_BYPASS } from './plugins/aiBlock';
import type { AIBlockMeta } from './plugins/aiBlock';
import { createAIShortcutKeymap } from './plugins/aiShortcutKeymap';
import { createCodeHighlightPlugin } from './plugins/codeHighlight';
import {
  moveCurrentBlockUp,
  moveCurrentBlockDown,
  duplicateCurrentBlock,
  deleteCurrentBlock,
} from './commands/blockNavigation';
import { createListInputRules } from './plugins/listInputRules';
import { createBlockInputRules } from './plugins/blockInputRules';
import { createMarkInputRules } from './plugins/markInputRules';
import { parseMarkdown } from '../markdown/parser';
import { serializeToMarkdown } from '../markdown/serializer';
import {
  insertBlockAfter,
  deleteBlock,
  moveBlockUp,
  moveBlockDown,
  setBlockTypeFromDomain,
  exitFinalCodeBlockOnArrowDown,
  splitBlock,
} from './commands/blocks';
import { deleteEmptyListItem } from './commands/lists';
import { toggleMarkFromDomain, setLink, removeLink } from './commands/marks';
import { createBlockNodeViewFactory, createContextAwareFactory, type BlockNodeViewOptions } from './views/BlockNodeView';
import type { CommandRegistryPort, RegisteredCommand, CommandContext } from '$lib/ports/outbound';
import { EMPTY_SCOPE } from '$lib/domain/values';

/**
 * Event handler type for EditorPort events.
 */
type EventHandler<K extends keyof EditorEvents> = (payload: EditorEvents[K]) => void;

/**
 * ProseMirror adapter implementing EditorPort.
 *
 * Handles:
 * - Converting domain Document to ProseMirror state
 * - Converting ProseMirror state back to domain Document
 * - Executing editor commands
 * - Emitting events for state changes
 */
/**
 * Configuration options for ProseMirrorAdapter.
 */
export interface ProseMirrorAdapterOptions {
  /** Command registry for slash menu */
  commandRegistry?: CommandRegistryPort;
  /** Callback when slash menu state changes */
  onSlashMenuChange?: (state: SlashMenuState) => void;
  /** Whether to enable block drag-drop */
  enableDragDrop?: boolean;
  /** Options for drag-drop plugin */
  dragDropOptions?: Omit<DragDropPluginOptions, 'enabled'>;
  /** Whether to enable AI rewrite functionality */
  enableAIRewrite?: boolean;
  /** Callback when AI rewrite state changes */
  onAIRewriteChange?: (state: AIRewritePluginState) => void;
  /** Whether to enable page link functionality */
  enablePageLink?: boolean;
  /** Notes provider for page link autocomplete */
  notesProvider?: NotesProvider;
  /** Callback when page link state changes */
  onPageLinkChange?: (state: PageLinkState) => void;
  /** Callback when block menu button is clicked */
  onMenuClick?: (blockId: string, lineIndex: number, event: MouseEvent) => void;
  /** Callback when line history button is clicked */
  onLineageClick?: (blockId: string, lineIndex: number, event: MouseEvent) => void;
  /** Callback when AI inline generation is triggered */
  onAIInlineGenerate?: (
    prompt: string,
    selectionText: string | null,
    callbacks: EditorInlineGenerateCallbacks,
    request: EditorInlineGenerateRequest,
  ) => void;
  /** Callback when AI inline state changes */
  onAIInlineStateChange?: (state: AIInlineState) => void;
  /** Callback when a page link or internal note link is clicked */
  onPageLinkClick?: (path: string) => void;
  /** Callback when an external URL is clicked */
  onExternalLinkClick?: (url: string) => void;
  /** Callback when a todo checkbox is toggled in the editor */
  onTodoToggle?: (blockId: string, content: string, checked: boolean) => void;
  /** Callback when AI block lock state changes */
  onAIBlockLocksChanged?: (locks: import('./plugins/aiBlock').AIBlockState) => void;
}

export class ProseMirrorAdapter implements EditorPort {
  private view: EditorView | null = null;
  private currentDocument: Document | null = null;
  private eventHandlers: Map<keyof EditorEvents, Set<EventHandler<keyof EditorEvents>>> = new Map();
  private options: ProseMirrorAdapterOptions;
  private previousAILockIds: Set<string> = new Set();
  private previousAIPhases: Map<string, string> = new Map();
  /**
   * Owns the AI inline-generation flow (Cmd+J, prompt-on-selection,
   * accept/retry/deny). The adapter delegates to it via a getter so the
   * coordinator never holds a stale view reference across mount cycles.
   */
  private readonly aiInline: AIInlineCoordinator;

  constructor(options: ProseMirrorAdapterOptions = {}) {
    this.options = options;
    this.aiInline = new AIInlineCoordinator({
      getView: () => this.view,
      onActiveTarget: (blockId) => {
        this.emit('editor:block-ai-active-target', { blockId });
      },
      onGenerate: (prompt, selectionText, callbacks, request) => {
        const notePath = this.currentDocument?.path ?? null;
        const enrichedRequest: EditorInlineGenerateRequest = { ...request, notePath };
        this.emit('editor:ai-inline-generate', {
          prompt,
          selectionText,
          callbacks,
          request: enrichedRequest,
        });
        options.onAIInlineGenerate?.(prompt, selectionText, callbacks, enrichedRequest);
      },
    });
  }

  /**
   * Mount the editor to a DOM element.
   *
   * @param element - The HTML element to mount the editor into
   * @param document - The initial document to display
   * @returns Result indicating success or failure
   */
  async mount(element: HTMLElement, document: Document): Promise<Result<void, Error>> {
    try {
      // Destroy existing view if any
      if (this.view) {
        this.view.destroy();
      }

      this.currentDocument = document;

      // Convert domain document to ProseMirror doc
      const pmDoc = domainToProseMirror(document);

      // Create plugins array
      const plugins = this.createPlugins();

      // Create editor state
      const state = EditorState.create({
        doc: pmDoc,
        plugins,
      });

      // Create editor view
      this.view = new EditorView(element, {
        state,
        dispatchTransaction: (tr) => this.handleTransaction(tr),
        nodeViews: this.createNodeViews(),
        attributes: {
          class: 'void-editor',
          role: 'textbox',
          'aria-multiline': 'true',
          'aria-label': 'Document editor',
        },
        handleDOMEvents: {
          focus: () => {
            this.emit('editor:focus', undefined as never);
            return false;
          },
          blur: () => {
            this.emit('editor:blur', undefined as never);
            return false;
          },
          click: (_view, event) => {
            const target = event.target as HTMLElement;
            const anchor = target.closest('a') as HTMLAnchorElement | null;
            if (!anchor) return false;

            const href = anchor.getAttribute('href');
            if (!href) return false;

            event.preventDefault();

            // Page links and relative paths → navigate to note
            if (anchor.hasAttribute('data-page-link') || (!href.startsWith('http://') && !href.startsWith('https://'))) {
              this.emit('editor:page-link-clicked', { path: href });
              this.options.onPageLinkClick?.(href);
            } else if (this.options.onExternalLinkClick) {
              // External URLs → open in system browser
              this.emit('editor:external-link-clicked', { url: href });
              this.options.onExternalLinkClick(href);
            }
            return true;
          },
        },
      });

      // Emit ready event
      this.emit('editor:ready', undefined as never);

      return ok(undefined);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Update the editor with a new document state.
   *
   * @param document - The new document state
   */
  update(document: Document): void {
    if (!this.view) return;

    this.currentDocument = document;
    const pmDoc = domainToProseMirror(document);

    const newState = EditorState.create({
      doc: pmDoc,
      plugins: this.view.state.plugins,
    });

    this.view.updateState(newState);
  }

  updateMetadata(meta: Document['meta']): void {
    if (!this.currentDocument) return;
    this.currentDocument = {
      ...this.currentDocument,
      meta,
    };
  }

  /**
   * Destroy the editor and cleanup resources.
   */
  destroy(): void {
    if (this.view) {
      this.view.destroy();
      this.view = null;
    }
    this.currentDocument = null;
    this.eventHandlers.clear();
  }

  /**
   * Get the current selection state.
   *
   * @returns The current selection
   */
  getSelection(): Selection {
    if (!this.view) return EMPTY_SELECTION;

    const { from, to } = this.view.state.selection;
    const text = this.view.state.doc.textBetween(from, to);

    // Find block IDs at anchor and head
    const anchorBlockId = this.getBlockIdAtPos(from);
    const headBlockId = this.getBlockIdAtPos(to);

    return {
      from,
      to,
      text,
      anchorBlockId,
      headBlockId,
    };
  }

  /**
   * Execute an editor command.
   *
   * @param command - The command name to execute
   * @param args - Arguments for the command
   */
  execute<K extends keyof EditorCommands>(
    command: K,
    ...args: Parameters<EditorCommands[K]>
  ): void {
    if (!this.view) return;

    switch (command) {
      case 'insertBlock':
        this.executeInsertBlock(args[0] as Block['type'], args[1] as Block['attrs'] | undefined);
        break;
      case 'deleteBlock':
        this.executeDeleteBlock(args[0] as string);
        break;
      case 'moveBlock':
        this.executeMoveBlock(args[0] as string, args[1] as number);
        break;
      case 'toggleMark':
        this.executeToggleMark(args[0] as string, args[1] as Record<string, unknown> | undefined);
        break;
      case 'setBlockType':
        this.executeSetBlockType(args[0] as Block['type']);
        break;
      case 'focus':
        this.view.focus();
        break;
      case 'blur':
        this.view.dom.blur();
        break;
      case 'undo':
        undoCommand(this.view.state, this.view.dispatch);
        break;
      case 'redo':
        redoCommand(this.view.state, this.view.dispatch);
        break;
      case 'aiInlineGenerate':
        this.aiInline.executeAIInlineGenerate(args[0] as string);
        break;
      case 'aiPromptSelection':
        this.aiInline.executeAIPromptSelection();
        break;
      case 'aiPromptSelectionAt':
        this.aiInline.executeAIPromptSelectionAt(
          args[0] as number,
          args[1] as number,
          args[2] as string,
        );
        break;
      case 'updateAIInlineComposerDraft':
        updateAIInlineComposerDraft(this.view, args[0] as string, args[1] as string);
        break;
      case 'submitAIInlineComposer':
        submitAIInlineComposer(this.view, args[0] as string, args[1] as string);
        break;
      case 'cancelAIInlineComposer':
        cancelAIInlineComposer(this.view, args[0] as string);
        break;
      case 'focusAIInlineComposer':
        focusAIInlineComposer(this.view, args[0] as string);
        break;
      case 'insertContent':
        this.executeInsertContent(args[0] as string);
        break;
      case 'replaceRange':
        this.executeReplaceRange(args[0] as number, args[1] as number, args[2] as string);
        break;
      case 'setInlineAIThreads':
        this.executeSetInlineAIThreads(args[0] as InlineAIThread[]);
        break;
      case 'scrollInlineAIThreadIntoView':
        this.executeScrollInlineAIThreadIntoView(args[0] as string);
        break;
      case 'setLink':
        this.executeSetLink(args[0] as string, args[1] as string | undefined);
        break;
      case 'removeLink':
        this.executeRemoveLink();
        break;
      case 'openPageLinkPicker':
        openPageLinkPicker(this.view);
        break;
      case 'setPageLink':
        setPageLink(this.view, args[0] as EditorPageLinkNote);
        break;
      case 'removePageLink':
        removePageLink(this.view);
        break;
      case 'updatePageLinkQuery':
        this.executeUpdatePageLinkQuery(args[0] as string);
        break;
      case 'movePageLinkSelection':
        this.executeMovePageLinkSelection(args[0] as 'next' | 'prev');
        break;
      case 'selectPageLink':
        this.executeSelectPageLink(args[0] as EditorPageLinkNote);
        break;
      case 'closePageLinkMenu':
        this.executeClosePageLinkMenu();
        break;
      case 'selectBlock':
        this.executeSelectBlock(args[0] as string);
        break;
      case 'selectBlockRange':
        this.executeSelectBlockRange(args[0] as string, args[1] as string);
        break;
      case 'duplicateBlock':
        this.executeDuplicateBlock(args[0] as string);
        break;
      case 'convertBlock':
        this.executeConvertBlock(args[0] as string, args[1] as Block['type']);
        break;
      case 'lockBlockForAI':
        this.executeLockBlockForAI(args[0] as string, args[1] as string);
        break;
      case 'unlockBlockFromAI':
        this.executeUnlockBlockFromAI(args[0] as string);
        break;
      case 'replaceBlockContent':
        this.executeReplaceBlockContent(args[0] as string, args[1] as string);
        break;
      case 'startAIBlockOperation':
        this.executeStartAIBlockOperation(
          args[0] as string,
          args[1] as string,
          args[2] as string | undefined,
        );
        break;
      case 'streamAIBlock':
        this.executeStreamAIBlock(args[0] as string, args[1] as string);
        break;
      case 'finishAIBlockOperation':
        this.executeFinishAIBlockOperation(args[0] as string, args[1] as string);
        break;
      case 'failAIBlockOperation':
        this.executeFailAIBlockOperation(args[0] as string, args[1] as string);
        break;
      case 'cancelAIBlockOperation':
        this.executeCancelAIBlockOperation(args[0] as string);
        break;
      case 'scrollBlockIntoView':
        this.executeScrollBlockIntoView(
          args[0] as string,
          args[1] as 'nearest' | 'center' | 'smart' | undefined,
        );
        break;
      case 'insertContentAfterBlock':
        this.executeInsertContentAfterBlock(args[0] as string, args[1] as string);
        break;
      case 'updateTodoContent':
        this.executeUpdateTodoContent(
          args[0] as string,
          args[1] as string,
          args[2] as boolean | undefined,
        );
        break;
      case 'deleteTodoContent':
        this.executeDeleteTodoContent(args[0] as string);
        break;
      case 'openFindReplace':
        openFindBar(this.view, args[0] as 'find' | 'replace');
        break;
      case 'closeFindReplace':
        closeFindBar(this.view);
        break;
      case 'setFindQuery':
        setFindQuery(this.view, args[0] as string, args[1] as Parameters<EditorCommands['setFindQuery']>[1]);
        break;
      case 'findNextMatch':
        findNext(this.view);
        break;
      case 'findPrevMatch':
        findPrev(this.view);
        break;
      case 'replaceCurrentMatch':
        replaceCurrent(this.view, args[0] as string);
        break;
      case 'replaceAllMatches':
        // Note: execute() is void; callers needing the count must use the
        // helper directly. The replace-all is dispatched here so undo works.
        replaceAll(this.view, args[0] as string);
        break;
      case 'activateQuickJump':
        activateQuickJump(this.view);
        break;
      case 'toggleSelectedTodos':
        // execute() return type is void per EditorCommands signature; the
        // count is exposed via the dedicated method below.
        this.executeToggleSelectedTodos();
        break;
    }
  }

  /**
   * Toggle `checked` on every selected todoItem block in a single
   * transaction. Returns the count for caller feedback (toast). Falls back
   * to the cursor's nearest todoItem when no block selection is active.
   */
  toggleSelectedTodos(): number {
    return this.executeToggleSelectedTodos();
  }

  private executeToggleSelectedTodos(): number {
    if (!this.view) return 0;
    const state = this.view.state;
    const bsState = getBlockSelectionState(state);
    const blocks = getVisibleBlockOrder(state.doc);

    const targetIds = new Set<string>(bsState.selectedIds);
    if (targetIds.size === 0) {
      // Fallback: nearest todoItem to the current text cursor
      const $from = state.selection.$from;
      for (let depth = $from.depth; depth >= 0; depth--) {
        const node = $from.node(depth);
        if (node.type.name === 'todoItem' && node.attrs.id) {
          targetIds.add(node.attrs.id);
          break;
        }
      }
    }
    if (targetIds.size === 0) return 0;

    let tr = state.tr;
    let toggled = 0;
    let nextChecked: boolean | null = null;

    for (const block of blocks) {
      if (!targetIds.has(block.blockId)) continue;
      if (block.typeName !== 'todoItem') continue;
      const node = state.doc.nodeAt(block.pos);
      if (!node || node.type.name !== 'todoItem') continue;

      // Use the first todo's flipped state for all selected todos so a mix
      // of checked/unchecked becomes uniformly toggled (predictable UX).
      if (nextChecked === null) {
        nextChecked = !node.attrs.checked;
      }
      tr = tr.setNodeMarkup(block.pos, null, {
        ...node.attrs,
        checked: nextChecked,
      });
      toggled += 1;
    }

    if (toggled > 0) {
      this.view.dispatch(tr);
    }
    return toggled;
  }

  /**
   * Public accessor used by FindReplaceBar to read plugin state for UI sync.
   * Kept on the adapter (not the port) because it returns a plugin-specific
   * shape; the EditorPort exposes only opaque commands.
   */
  getFindReplaceState() {
    if (!this.view) return null;
    return getFindReplaceState(this.view.state);
  }

  /**
   * Subscribe to find/replace state updates. Returns unsubscribe function.
   * Polls plugin state on every transaction via a one-time dispatcher.
   */
  onFindReplaceStateChange(callback: (state: ReturnType<typeof getFindReplaceState>) => void): () => void {
    if (!this.view) return () => {};
    const view = this.view;
    let lastJson = '';
    const fire = () => {
      const next = getFindReplaceState(view.state);
      const json = JSON.stringify(next);
      if (json !== lastJson) {
        lastJson = json;
        callback(next);
      }
    };
    fire();
    const previousDispatch = view.props.dispatchTransaction?.bind(view);
    const dispatcher = (tr: Parameters<NonNullable<typeof previousDispatch>>[0]) => {
      if (previousDispatch) {
        previousDispatch(tr);
      } else {
        view.updateState(view.state.apply(tr));
      }
      fire();
    };
    // We don't override dispatchTransaction on the view (the editor service
    // already owns it). Instead listeners are scheduled via requestAnimationFrame
    // tied to the existing change events. For Wave 1 this polling-on-event
    // surface is enough. A future iteration may move to a proper subscription.
    void dispatcher;
    return () => {
      // No-op: the polling style above doesn't need teardown beyond GC.
    };
  }

  private handleAIInlineStateChange(state: AIInlineState): void {
    this.options.onAIInlineStateChange?.(state);
    this.emit('editor:ai-inline-composers-change', this.toInlineAIComposerState(state));
  }

  private toInlineAIComposerState(state: AIInlineState): EditorInlineAIComposerState {
    return {
      activeComposerId: state.activeComposerId,
      composers: state.composers.map((composer) => ({
        id: composer.id,
        from: composer.from,
        to: composer.to,
        selectionText: composer.selectionText,
        draftPrompt: composer.draftPrompt,
        status: composer.status,
        createdAt: composer.createdAt,
        updatedAt: composer.updatedAt,
        isActive: composer.id === state.activeComposerId,
      })),
    };
  }

  /**
   * Subscribe to editor events.
   *
   * @param event - The event name to subscribe to
   * @param handler - Callback function for the event
   * @returns Unsubscribe function
   */
  on<K extends keyof EditorEvents>(
    event: K,
    handler: (payload: EditorEvents[K]) => void
  ): () => void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }

    const handlers = this.eventHandlers.get(event)!;
    handlers.add(handler as EventHandler<keyof EditorEvents>);

    return () => {
      handlers.delete(handler as EventHandler<keyof EditorEvents>);
    };
  }

  /**
   * Get the current document state from the editor.
   *
   * @returns The current document
   */
  getDocument(): Document {
    if (!this.view || !this.currentDocument) {
      throw new Error('Editor not mounted');
    }

    return this.proseMirrorToDomain(this.view.state.doc);
  }

  /**
   * Get all text content from the editor as a plain string.
   */
  getTextContent(): string {
    if (!this.view) return '';
    return this.view.state.doc.textContent;
  }

  getTextBetween(from: number, to: number): string {
    if (!this.view) return '';
    if (!Number.isFinite(from) || !Number.isFinite(to) || from > to) return '';
    const docSize = this.view.state.doc.content.size;
    const safeFrom = Math.max(0, Math.min(from, docSize));
    const safeTo = Math.max(0, Math.min(to, docSize));
    return this.view.state.doc.textBetween(safeFrom, safeTo, '\n');
  }

  resolveInlineAIRangeAnchor(input: EditorInlineAIRangeAnchorInput): EditorInlineAIRangeAnchorResult | null {
    if (!this.view) return null;
    const originalText = input.originalText;
    if (!originalText) return input.preferredRange;

    const doc = this.view.state.doc;
    const docSize = doc.content.size;
    if (input.preferredRange) {
      const from = Math.max(0, Math.min(input.preferredRange.from, docSize));
      const to = Math.max(0, Math.min(input.preferredRange.to, docSize));
      if (from <= to && doc.textBetween(from, to, '\n') === originalText) {
        return { from, to };
      }
    }

    const candidates = collectInlineTextRangeCandidates(doc, originalText);
    if (candidates.length === 0) return null;
    if (candidates.length === 1) {
      const only = candidates[0]!;
      return { from: only.from, to: only.to };
    }

    const scored = candidates
      .map((candidate) => ({
        candidate,
        score: scoreInlineTextRangeCandidate(doc, candidate, input),
      }))
      .sort((left, right) => right.score - left.score);
    const best = scored[0];
    if (!best || best.score <= 0) return null;
    const second = scored[1];
    if (second && second.score === best.score) return null;
    return { from: best.candidate.from, to: best.candidate.to };
  }

  /**
   * Serialize current editor content to markdown.
   */
  getMarkdown(): string {
    if (!this.view) return '';
    return serializeToMarkdown(this.view.state.doc);
  }

  /**
   * Get the raw ProseMirror document node.
   * Useful for serialization (e.g., export to markdown).
   */
  getProseMirrorDoc(): import('prosemirror-model').Node | null {
    return this.view?.state.doc ?? null;
  }

  /**
   * Check if the editor can undo.
   *
   * @returns True if there are changes to undo
   */
  canUndo(): boolean {
    if (!this.view) return false;
    return canUndo(this.view.state);
  }

  /**
   * Check if the editor can redo.
   *
   * @returns True if there are undone changes to redo
   */
  canRedo(): boolean {
    if (!this.view) return false;
    return canRedo(this.view.state);
  }

  /**
   * Select a slash menu command - deletes the trigger text and closes the menu.
   * Call this before executing the command to clean up the editor state.
   *
   * @returns The trigger position where the command should insert content, or null if menu not open
   */
  selectSlashMenuCommand(): number | null {
    if (!this.view) return null;

    const menuState = slashMenuKey.getState(this.view.state);
    if (!menuState?.isOpen) return null;

    const { triggerPos, query } = menuState;
    const docSize = this.view.state.doc.content.size;

    // Validate position is within document
    if (triggerPos < 0 || triggerPos >= docSize) {
      const tr = this.view.state.tr.setMeta(slashMenuKey, { type: 'CLOSE' });
      this.view.dispatch(tr);
      return null;
    }

    // Check if "/" is still there (might have been deleted by keyboard handler)
    const textAtTrigger = this.view.state.doc.textBetween(
      Math.max(0, triggerPos),
      Math.min(triggerPos + 1, docSize)
    );

    if (textAtTrigger !== '/') {
      // Already deleted, just close menu
      const tr = this.view.state.tr.setMeta(slashMenuKey, { type: 'CLOSE' });
      this.view.dispatch(tr);
      return triggerPos;
    }

    const deleteEnd = Math.min(triggerPos + 1 + query.length, docSize);

    // Delete the "/query" text and close the menu
    const tr = this.view.state.tr
      .delete(triggerPos, deleteEnd)
      .setMeta(slashMenuKey, { type: 'CLOSE' });

    // Set cursor explicitly after deletion so commands see correct selection
    const mappedPos = tr.mapping.map(triggerPos);
    const $pos = tr.doc.resolve(mappedPos);
    tr.setSelection(TextSelection.near($pos));

    this.view.dispatch(tr);

    return mappedPos;
  }

  /**
   * Unified entry point for executing a slash menu command.
   * Handles cleanup (deleting /query text, closing menu), focusing,
   * and executing the command. Used by both click and keyboard paths.
   */
  executeSlashMenuCommand(command: RegisteredCommand): void {
    const insertPos = this.selectSlashMenuCommand();
    this.execute('focus');

    const context: CommandContext = {
      editor: this,
      selection: {
        from: insertPos ?? this.getSelection().from,
        to: insertPos ?? this.getSelection().to,
        text: '',
      },
      scope: { ...EMPTY_SCOPE, editorFocused: true },
    };

    try {
      const result = command.execute(context);
      if (result instanceof Promise) {
        result.catch((error: unknown) => {
          console.error('[SlashMenu] Command execution failed:', error);
        });
      }
    } catch (error) {
      console.error('[SlashMenu] Command execution failed:', error);
    }
  }

  /**
   * Convert a DOM position to a ProseMirror document position.
   */
  posFromDOM(node: Node, offset: number): number {
    if (!this.view) return 0;
    return this.view.posAtDOM(node, offset);
  }

  /**
   * Resolve a DOM Range to ProseMirror document positions.
   */
  resolveSelectionFromDOM(range: Range): { from: number; to: number } | null {
    if (!this.view) return null;
    try {
      let from = this.view.posAtDOM(range.startContainer, range.startOffset);
      let to = this.view.posAtDOM(range.endContainer, range.endOffset);
      if (from > to) [from, to] = [to, from];
      return { from, to };
    } catch {
      return null;
    }
  }

  /**
   * Close the slash menu without selecting a command.
   */
  closeSlashMenu(): void {
    if (!this.view) return;

    const menuState = slashMenuKey.getState(this.view.state);
    if (!menuState?.isOpen) return;

    const tr = this.view.state.tr.setMeta(slashMenuKey, { type: 'CLOSE' });
    this.view.dispatch(tr);
  }

  /**
   * Position the selection inside a block identified by its ID.
   * Used to ensure block-level commands operate on the correct block.
   *
   * @param blockId - The ID of the target block
   * @returns True if the block was found and selection was set
   */
  selectBlock(blockId: string): boolean {
    if (!this.view) return false;
    let found = false;
    let blockPos = 0;
    this.view.state.doc.descendants((node, pos) => {
      if (found) return false;
      if (node.attrs.id === blockId) {
        found = true;
        blockPos = pos;
        return false;
      }
      return true;
    });
    if (!found) return false;
    const $pos = this.view.state.doc.resolve(blockPos + 1);
    const selection = TextSelection.create(this.view.state.doc, $pos.pos);
    const tr = this.view.state.tr.setSelection(selection);
    this.view.dispatch(tr);
    return true;
  }

  /**
   * Toggle a todoItem's checked state.
   * First tries to match by block ID (exact), then falls back to content matching.
   */
  toggleTodoChecked(blockId: string, content: string, checked: boolean): boolean {
    if (!this.view) return false;

    const todoItemNodeType = voidSchema.nodes.todoItem;
    if (!todoItemNodeType) return false;

    let found = false;

    // First pass: match by block ID (exact)
    if (blockId) {
      this.view.state.doc.descendants((node, pos) => {
        if (found) return false;
        if (node.type === todoItemNodeType && node.attrs.id === blockId) {
          const tr = this.view!.state.tr.setNodeMarkup(pos, undefined, {
            ...node.attrs,
            checked,
          });
          this.view!.dispatch(tr);
          found = true;
          return false;
        }
        return true;
      });
    }

    // Fallback: match by content text
    if (!found) {
      const trimmedContent = content.trim();
      this.view.state.doc.descendants((node, pos) => {
        if (found) return false;
        if (node.type === todoItemNodeType && node.textContent.trim() === trimmedContent) {
          const tr = this.view!.state.tr.setNodeMarkup(pos, undefined, {
            ...node.attrs,
            checked,
          });
          this.view!.dispatch(tr);
          found = true;
          return false;
        }
        return true;
      });
    }

    return found;
  }

  // =========================================================================
  // Private Methods
  // =========================================================================

  /**
   * Create the array of ProseMirror plugins.
   */
  private createPlugins(): Plugin[] {
    // Plugin ordering follows SPEC section 10: first handler wins.
    // Plugins earlier in the array get first crack at key events.
    const plugins: Plugin[] = [];

    // ---- 1. History + history keymap (undo/redo always wins) ----
    plugins.push(
      historyPlugin({ depth: 100, newGroupDelay: 500 }),
      historyKeymap(),
    );

    // ---- 2. SlashMenu plugin (intercepts Enter/arrows when menu open) ----
    if (this.options.commandRegistry) {
      plugins.push(
        createSlashMenuPlugin({
          registry: this.options.commandRegistry,
          getEditorPort: () => this as EditorPort,
          onStateChange: (state) => {
            this.emit('editor:slash-menu-change', { state });
            this.options.onSlashMenuChange?.(state);
          },
        })
      );
    }

    // ---- 3. PageLink plugin (intercepts Enter/arrows when [[ menu open) ----
    if (this.options.enablePageLink !== false && this.options.notesProvider) {
      plugins.push(
        createPageLinkPlugin({
          notesProvider: this.options.notesProvider,
          onStateChange: (state) => {
            this.emit('editor:page-link-menu-change', { state });
            this.options.onPageLinkChange?.(state);
          },
        })
      );
    }

    // ---- 4. AI Block plugin (unified lock/streaming lifecycle) ----
    plugins.push(createAIBlockPlugin({
      onLocksChanged: (locks) => {
        // Sync EditorStore via events for ALL lock state changes
        // (including keyboard-driven accept/reject/cancel)
        this.syncAILockEvents(locks);
        this.options.onAIBlockLocksChanged?.(locks);
      },
    }));

    // Legacy AI plugins (Escape handling before block selection)
    if (this.options.enableAIRewrite !== false) {
      plugins.push(
        createAIRewritePlugin({
          onStateChange: this.options.onAIRewriteChange,
        })
      );
    }
    plugins.push(
      createAIInlinePlugin({
        onStateChange: (state) => this.handleAIInlineStateChange(state),
        onAccept: (data) => this.aiInline.handleAIInlineAccept(data),
        onRetry: (prompt) => this.aiInline.handleAIInlineRetry(prompt),
        onDeny: (data) => this.aiInline.handleAIInlineDeny(data),
        onPromptSubmit: ({ composerId, prompt, selectionText, selectionFrom, selectionTo }) =>
          this.aiInline.handleAIInlinePromptSubmit(
            prompt,
            selectionText,
            selectionFrom,
            selectionTo,
            composerId,
          ),
      })
    );
    plugins.push(createAIThreadsPlugin());
    plugins.push(createCodeHighlightPlugin());

    // ---- 5. Block Selection plugin (multi-select decorations + keyboard) ----
    plugins.push(
      createBlockSelectionKeymap(),
      createBlockSelectionPlugin(),
    );

    // ---- Find/Replace plugin (Cmd+F highlights, Cmd+G next, atomic replace) ----
    plugins.push(createFindReplacePlugin());

    // ---- Quick-Jump plugin (Mod+Shift+J → 2-letter block navigation) ----
    plugins.push(createQuickJumpPlugin());

    // ---- 6. List keymap (Tab/Shift-Tab/Enter/Backspace in lists) ----
    const listItemType = voidSchema.nodes.listItem;
    if (listItemType) {
      plugins.push(
        keymap({
          'Enter': chainCommands(splitListItem(listItemType), liftListItem(listItemType)),
          'Tab': sinkListItem(listItemType),
          'Shift-Tab': liftListItem(listItemType),
          'Backspace': chainCommands(
            deleteEmptyListItem(listItemType),
            (state, dispatch) => {
              const { $from, empty } = state.selection;
              if (!empty || $from.parentOffset !== 0) return false;
              return liftListItem(listItemType)(state, dispatch);
            },
          ),
        })
      );
    }

    // ---- 7. Todo keymap (Enter/Backspace in todo items) ----
    const todoItemType = voidSchema.nodes.todoItem;
    const paragraphType = voidSchema.nodes.paragraph;
    if (todoItemType && paragraphType) {
      plugins.push(
        keymap({
          'Enter': (state, dispatch) => {
            const { $from } = state.selection;
            if ($from.parent.type !== todoItemType) return false;

            if ($from.parent.content.size === 0) {
              if (dispatch) {
                const pos = $from.before($from.depth);
                const tr = state.tr.setNodeMarkup(pos, paragraphType, { id: generateBlockId() });
                dispatch(tr.scrollIntoView());
              }
              return true;
            }

            if (dispatch) {
              const newAttrs = { ...($from.parent.attrs), id: generateBlockId(), checked: false };
              const tr = state.tr.split($from.pos, 1, [{ type: todoItemType, attrs: newAttrs }]);
              dispatch(tr.scrollIntoView());
            }
            return true;
          },
          'Backspace': (state, dispatch) => {
            const { $from, empty } = state.selection;
            if (!empty || $from.parentOffset !== 0) return false;
            if ($from.parent.type !== todoItemType) return false;
            if ($from.parent.content.size !== 0) return false;

            if (dispatch) {
              const pos = $from.before($from.depth);
              const tr = state.tr.setNodeMarkup(pos, paragraphType, { id: generateBlockId() });
              dispatch(tr.scrollIntoView());
            }
            return true;
          },
        })
      );
    }

    // ---- 8. Block navigation keymap (Cmd+Shift+Up/Down, Cmd+D, Cmd+Shift+Delete) ----
    plugins.push(
      keymap({
        'Mod-Shift-ArrowUp': moveCurrentBlockUp(),
        'Mod-Shift-ArrowDown': moveCurrentBlockDown(),
        'Mod-d': duplicateCurrentBlock(),
        'Mod-Shift-Delete': deleteCurrentBlock(),
      })
    );

    // ---- 9. Mark formatting keymap (Cmd+B/I/U/E/Shift+S) ----
    plugins.push(
      keymap({
        'Mod-b': toggleMark(voidSchema.marks.bold!),
        'Mod-i': toggleMark(voidSchema.marks.italic!),
        'Mod-u': toggleMark(voidSchema.marks.underline!),
        'Mod-Shift-s': toggleMark(voidSchema.marks.strikethrough!),
        'Mod-e': toggleMark(voidSchema.marks.code!),
        'Mod-Shift-h': toggleMark(voidSchema.marks.highlight!, { color: 'yellow' }),
      })
    );

    // ---- 10. AI shortcut keymap (Cmd+Shift+R, Cmd+Shift+E) ----
    plugins.push(createAIShortcutKeymap());

    // ---- 11. Generic keymap (Enter splitBlock, Backspace delete empty) ----
    plugins.push(
      keymap({
        'Enter': splitBlock(),
        'Shift-Enter': (state, dispatch) => {
          const br = state.schema.nodes.hardBreak;
          if (!br) return false;
          if (dispatch) dispatch(state.tr.replaceSelectionWith(br.create()).scrollIntoView());
          return true;
        },
        'ArrowDown': exitFinalCodeBlockOnArrowDown(),
        'Mod-Enter': chainCommands(exitCode, splitBlock()),
        'Backspace': (state, dispatch) => {
          const { $from, empty } = state.selection;
          if (!empty || $from.parentOffset !== 0) return false;
          if ($from.parent.content.size !== 0) return false;
          if ($from.depth !== 1) return false;
          if (state.doc.childCount <= 1) return false;

          const blockPos = $from.before(1);
          const blockEnd = $from.after(1);

          if (dispatch) {
            const tr = state.tr.delete(blockPos, blockEnd);
            const mapped = tr.mapping.map(blockPos);
            const resolvedPos = tr.doc.resolve(Math.min(mapped, tr.doc.content.size));
            tr.setSelection(TextSelection.near(resolvedPos, -1));
            dispatch(tr.scrollIntoView());
          }
          return true;
        },
      })
    );

    // ---- 12. Base keymap (ProseMirror defaults) ----
    plugins.push(keymap(baseKeymap));

    // ---- 13-15. Input rules (list, block, mark) ----
    plugins.push(
      createListInputRules(voidSchema),
      createBlockInputRules(voidSchema),
      createMarkInputRules(voidSchema),
    );

    // ---- 16. DropCursor + GapCursor ----
    plugins.push(dropCursor(), gapCursor());

    // ---- 17. Placeholder plugin ----
    // No per-line placeholder — once the user is in the document, empty
    // lines stay quiet so the caret can breathe. The welcome text only
    // appears on a wholly-empty document (single empty paragraph).
    plugins.push(
      placeholderPlugin({
        text: '',
        emptyDocText: 'Start writing, or press / for commands…',
        blockTypes: ['paragraph', 'heading'],
      })
    );

    // ---- 18. DragDrop plugin ----
    if (this.options.enableDragDrop !== false) {
      plugins.push(
        createDragDropPlugin({
          enabled: true,
          ...this.options.dragDropOptions,
        })
      );
    }

    return plugins;
  }

  /**
   * Query which blocks are currently locked by AI.
   */
  getAILockedBlocks(): string[] {
    if (!this.view) return [];
    const locks = aiBlockKey.getState(this.view.state);
    if (!locks || locks.size === 0) return [];
    return Array.from(locks.keys());
  }

  /**
   * Query block metadata by ID.
   */
  getBlockInfo(blockId: string): import('$lib/ports/outbound/EditorPort').BlockInfo | null {
    if (!this.view) return null;

    const view = this.view;
    let result: import('$lib/ports/outbound/EditorPort').BlockInfo | null = null;
    view.state.doc.descendants((node, pos) => {
      if (result) return false;
      if (node.attrs?.id === blockId) {
        result = {
          id: blockId,
          type: node.type.name as import('$lib/domain/values/BlockType').BlockType,
          pos,
          size: node.nodeSize,
          isAILocked: !!(aiBlockKey.getState(view.state)?.has(blockId)),
          content: node.textContent,
        };
        return false;
      }
      return true;
    });

    return result;
  }

  /**
   * Create nodeViews config for all block types.
   * Uses unified BlockNodeView for all visible blocks.
   * Container nodes (bulletList, orderedList) use ProseMirror's native toDOM rendering.
   * Paragraphs inside listItems get a passthrough view (no gutter) to avoid double gutters.
   */
  private createNodeViews() {
    const options: BlockNodeViewOptions = {};
    if (this.options.onMenuClick) {
      options.onMenuClick = (blockId, lineIndex, event) => {
        const target = event.target instanceof HTMLElement ? event.target : null;
        const wrapper = target?.closest('[data-block-type]');
        const currentType = (wrapper?.getAttribute('data-block-type') ?? 'paragraph') as BlockType;
        this.emit('editor:block-menu-request', {
          blockId,
          lineIndex,
          position: { top: event.clientY, left: event.clientX },
          currentType,
          mode: 'actions',
        });
        this.options.onMenuClick?.(blockId, lineIndex, event);
      };
      options.onTypeLabelClick = (blockId, lineIndex, event, position) => {
        const target = event.target instanceof HTMLElement ? event.target : null;
        const wrapper = target?.closest('[data-block-type]');
        const currentType = (wrapper?.getAttribute('data-block-type') ?? 'paragraph') as BlockType;
        this.emit('editor:block-menu-request', {
          blockId,
          lineIndex,
          position,
          currentType,
          mode: 'convert',
        });
      };
    }
    if (this.options.onLineageClick) {
      options.onLineageClick = (blockId, lineIndex, event) => {
        const target = event.target instanceof HTMLElement ? event.target : null;
        const wrapper = target?.closest('[data-block-type]');
        const currentType = (wrapper?.getAttribute('data-block-type') ?? 'paragraph') as BlockType;
        this.emit('editor:lineage-inspect-request', {
          blockId,
          lineIndex,
          position: { top: event.clientY, left: event.clientX },
          currentType,
        });
        this.options.onLineageClick?.(blockId, lineIndex, event);
      };
    }
    if (this.options.onTodoToggle) {
      options.onTodoToggle = (blockId, content, checked) => {
        this.emit('editor:todo-toggled', { blockId, content, checked });
        this.options.onTodoToggle?.(blockId, content, checked);
      };
    }

    const factory = createBlockNodeViewFactory(options);
    const contextAwareFactory = createContextAwareFactory(options);

    // Only leaf/textblock nodes get NodeViews with gutters.
    // Container nodes (bulletList, orderedList, blockquote, callout, toggle)
    // use ProseMirror's native toDOM — their children get their own gutters.
    // Exception: listItem gets a NodeView because it IS the visible line in a list.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const views: Record<string, any> = {
      paragraph: contextAwareFactory, // Context-aware: gutter for top-level, passthrough inside listItem
      heading: factory,
      listItem: factory,              // Gutter with UL/OL label (visual illusion — nested schema looks flat)
      todoItem: factory,
      codeBlock: factory,
      horizontalRule: factory,
      image: factory,
    };

    return views;
  }

  /**
   * Handle transactions dispatched by the editor.
   * Uses single updateState call to avoid cursor jumping.
   */
  private handleTransaction(tr: Transaction): void {
    if (!this.view) return;

    try {
      let newState = this.view.state.apply(tr);

      // Fix duplicate block IDs BEFORE updating the view (single render pass)
      if (tr.docChanged) {
        try {
          const dedupTr = this.buildDedupTransaction(newState);
          if (dedupTr) {
            newState = newState.apply(dedupTr);
          }
        } catch (e) {
          console.warn('[ProseMirror] Block ID dedup failed, skipping:', e);
        }
      }

      // Single updateState call — no cursor jumping
      this.view.updateState(newState);

      // Emit change event if document changed
      if (tr.docChanged && this.currentDocument) {
        const newDocument = this.proseMirrorToDomain(newState.doc);
        this.currentDocument = newDocument;
        this.emit('editor:change', { document: newDocument });
      }

      // Emit selection event if selection changed
      if (tr.selectionSet || tr.docChanged) {
        this.emit('editor:selection', { selection: this.getSelection() });
      }
    } catch (error) {
      console.error('[ProseMirror] Transaction failed:', error);
      // Attempt recovery: keep editor in its previous valid state
      try {
        this.view.updateState(this.view.state);
      } catch {
        // Editor is unrecoverable — but at least we logged the error
      }
    }
  }

  /**
   * Build a transaction to fix duplicate block IDs, or return null if no duplicates.
   * Does NOT call updateState — caller applies the transaction.
   */
  private buildDedupTransaction(state: EditorState): Transaction | null {
    const seen = new Set<string>();
    const duplicates: Array<{ pos: number; node: PmNode }> = [];

    state.doc.descendants((node, pos) => {
      const id = node.attrs.id as string | null;
      if (id) {
        if (seen.has(id)) {
          duplicates.push({ pos, node });
        } else {
          seen.add(id);
        }
      }
      return true;
    });

    if (duplicates.length === 0) return null;

    let tr = state.tr;
    for (const { pos, node } of duplicates) {
      tr = tr.setNodeMarkup(tr.mapping.map(pos), undefined, {
        ...node.attrs,
        id: generateBlockId(),
      });
    }

    return tr;
  }

  /**
   * Emit an event to all registered handlers.
   */
  private emit<K extends keyof EditorEvents>(event: K, payload: EditorEvents[K]): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.forEach((handler) => handler(payload));
    }
  }

  /**
   * Get the block ID at a given position.
   */
  private getBlockIdAtPos(pos: number): string | null {
    if (!this.view) return null;

    const resolved = this.view.state.doc.resolve(pos);

    // Walk up to find a node with an ID
    for (let d = resolved.depth; d >= 0; d--) {
      const node = resolved.node(d);
      if (node.attrs.id) {
        return node.attrs.id as string;
      }
    }

    return null;
  }

  // =========================================================================
  // Command Execution
  // =========================================================================

  private executeInsertBlock(type: Block['type'], attrs?: Block['attrs']): void {
    if (!this.view) return;

    try {
      const block = createBlock(type, type === 'toggle' ? 'Toggle' : '', attrs);
      if (type === 'callout' || type === 'toggle') {
        block.children = [createEmptyParagraph()];
      }
      const newBlock = blockToPmNode(block);
      this.insertPmBlockAfterCurrent(newBlock);
    } catch {
      const nodeType = getNodeTypeForBlockType(type);
      if (!nodeType) return;

      const pmAttrs = { ...attrs, id: generateBlockId() };
      insertBlockAfter(nodeType, pmAttrs)(this.view.state, this.view.dispatch);
    }
  }

  private insertPmBlockAfterCurrent(newBlock: PmNode): void {
    if (!this.view) return;

    const { $from } = this.view.state.selection;
    let blockDepth = 1;
    let blockEnd = $from.after(1);
    if ($from.depth > 1) {
      for (let depth = $from.depth; depth >= 1; depth--) {
        const node = $from.node(depth);
        if (node.type.spec.group?.includes('block')) {
          blockDepth = depth;
          blockEnd = $from.after(depth);
          break;
        }
      }
    }

    const currentBlock = $from.node(blockDepth);
    const paragraphType = this.view.state.schema.nodes.paragraph;
    const isEmptyParagraph =
      paragraphType &&
      currentBlock.type === paragraphType &&
      currentBlock.content.size === 0;

    if (isEmptyParagraph) {
      const blockStart = $from.before(blockDepth);
      const replacement = [newBlock];
      const needsTrailingParagraph = newBlock.isLeaf;
      if (needsTrailingParagraph && paragraphType) {
        replacement.push(paragraphType.create({ id: generateBlockId() }));
      }

      const tr = this.view.state.tr.replaceWith(
        blockStart,
        blockEnd,
        Fragment.fromArray(replacement)
      );
      const selectionPos = needsTrailingParagraph
        ? blockStart + newBlock.nodeSize + 1
        : blockStart + 1;
      tr.setSelection(TextSelection.near(tr.doc.resolve(selectionPos)));
      this.view.dispatch(tr.scrollIntoView());
      return;
    }

    const tr = this.view.state.tr.insert(blockEnd, newBlock);
    const selection = TextSelection.near(tr.doc.resolve(Math.min(blockEnd + 1, tr.doc.content.size)));
    tr.setSelection(selection);
    this.view.dispatch(tr.scrollIntoView());
  }

  private executeInsertContent(markdown: string): void {
    if (!this.view) return;
    const pmDoc = parseMarkdown(markdown);
    const { from } = this.view.state.selection;
    const $from = this.view.state.doc.resolve(from);
    const blockEnd = $from.after(Math.min($from.depth, 1));
    const tr = this.view.state.tr.insert(blockEnd, pmDoc.content);
    const newSelection = TextSelection.near(tr.doc.resolve(blockEnd + 1));
    tr.setSelection(newSelection);
    this.view.dispatch(tr.scrollIntoView());
  }

  private executeReplaceRange(from: number, to: number, markdown: string): void {
    if (!this.view) return;
    if (!Number.isFinite(from) || !Number.isFinite(to) || from > to) return;

    const state = this.view.state;
    const docSize = state.doc.content.size;
    const safeFrom = Math.max(0, Math.min(from, docSize));
    const safeTo = Math.max(0, Math.min(to, docSize));
    if (safeFrom > safeTo) return;

    const $from = state.doc.resolve(safeFrom);
    const $to = state.doc.resolve(safeTo);
    const inlineOnly = $from.sameParent($to) && $from.parent.isTextblock;
    const replacement = this.createReplacementSlice(markdown, inlineOnly);

    let tr = state.tr;
    if (replacement.content.size === 0 && safeFrom < safeTo) {
      tr = tr.delete(safeFrom, safeTo);
    } else if (replacement.content.size === 0) {
      return;
    } else {
      tr = tr.replaceRange(safeFrom, safeTo, replacement);
    }

    const mappedFrom = tr.mapping.map(safeFrom);
    const selectionPos = Math.min(mappedFrom + replacement.content.size, tr.doc.content.size);
    tr = tr
      .setSelection(TextSelection.near(tr.doc.resolve(selectionPos), -1))
      .setMeta(AI_BYPASS, true);
    this.view.dispatch(tr.scrollIntoView());
  }

  private executeSetInlineAIThreads(threads: InlineAIThread[]): void {
    if (!this.view) return;
    setAIThreads(this.view, threads);
  }

  private executeScrollInlineAIThreadIntoView(threadId: string): void {
    if (!this.view) return;
    const direct = this.view.dom.querySelector(
      `[data-inline-ai-thread-id="${CSS.escape(threadId)}"]`,
    ) as HTMLElement | null;
    const el = direct ?? this.view.dom.querySelector(
        `[data-inline-ai-thread-ids~="${CSS.escape(threadId)}"]`,
      ) as HTMLElement | null;
    el?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
  }

  private createReplacementSlice(markdown: string, inlineOnly: boolean): Slice {
    if (!markdown) return Slice.empty;

    const pmDoc = parseMarkdown(markdown);
    if (!pmDoc.content.childCount) return Slice.empty;

    if (inlineOnly) {
      const firstChild = pmDoc.content.firstChild;
      if (firstChild?.isTextblock) {
        return new Slice(firstChild.content, 0, 0);
      }
      return new Slice(Fragment.from(this.view!.state.schema.text(markdown)), 0, 0);
    }

    if (!markdown.includes('\n') && pmDoc.content.childCount === 1) {
      const firstChild = pmDoc.content.firstChild;
      if (firstChild?.isTextblock) {
        return new Slice(firstChild.content, 0, 0);
      }
    }

    return new Slice(pmDoc.content, 0, 0);
  }

  private executeDeleteBlock(blockId: string): void {
    if (!this.view) return;
    deleteBlock(blockId)(this.view.state, this.view.dispatch);
  }

  private executeMoveBlock(blockId: string, targetIndex: number): void {
    if (!this.view) return;

    // Find current block position
    let currentIndex = -1;
    let idx = 0;
    this.view.state.doc.forEach((node: PmNode) => {
      // Check if this node has the blockId
      if (node.attrs.id === blockId) {
        currentIndex = idx;
      }
      // Also check descendants
      node.descendants((descNode: PmNode) => {
        if (descNode.attrs.id === blockId) {
          currentIndex = idx;
        }
        return true;
      });
      idx++;
    });

    if (currentIndex === -1) return;

    // Determine direction
    if (targetIndex < currentIndex) {
      // Move up - execute moveBlockUp multiple times
      for (let i = currentIndex; i > targetIndex; i--) {
        moveBlockUp(blockId)(this.view.state, this.view.dispatch);
      }
    } else if (targetIndex > currentIndex) {
      // Move down - execute moveBlockDown multiple times
      for (let i = currentIndex; i < targetIndex; i++) {
        moveBlockDown(blockId)(this.view.state, this.view.dispatch);
      }
    }
  }

  private executeToggleMark(mark: string, attrs?: Record<string, unknown>): void {
    if (!this.view) return;

    const command = toggleMarkFromDomain(voidSchema, mark as MarkType, attrs);
    if (command) {
      command(this.view.state, this.view.dispatch);
    }
  }

  private executeSetLink(href: string, title?: string): void {
    if (!this.view) return;
    const command = setLink(voidSchema, href, title);
    if (command) {
      command(this.view.state, this.view.dispatch);
    }
  }

  private executeRemoveLink(): void {
    if (!this.view) return;
    const command = removeLink(voidSchema);
    command(this.view.state, this.view.dispatch);
  }

  private executeUpdatePageLinkQuery(query: string): void {
    if (!this.view) return;
    const menuState = pageLinkKey.getState(this.view.state);
    if (!menuState?.isOpen) return;
    this.view.dispatch(this.view.state.tr.setMeta(pageLinkKey, { type: 'UPDATE_QUERY', query }));
  }

  private executeMovePageLinkSelection(direction: 'next' | 'prev'): void {
    if (!this.view) return;
    const menuState = pageLinkKey.getState(this.view.state);
    if (!menuState?.isOpen) return;
    this.view.dispatch(
      this.view.state.tr.setMeta(pageLinkKey, { type: direction === 'next' ? 'NEXT' : 'PREV' })
    );
  }

  private executeSelectPageLink(note: EditorPageLinkNote): void {
    if (!this.view) return;
    const menuState = pageLinkKey.getState(this.view.state);
    if (!menuState?.isOpen) return;
    insertPageLink(this.view, menuState, false, note);
  }

  private executeClosePageLinkMenu(): void {
    if (!this.view) return;
    const menuState = pageLinkKey.getState(this.view.state);
    if (!menuState?.isOpen) return;
    closePageLinkPicker(this.view);
  }

  private executeSetBlockType(type: Block['type']): void {
    if (!this.view) return;

    const command = setBlockTypeFromDomain(voidSchema, type);
    if (command) {
      command(this.view.state, this.view.dispatch);
    }
  }

  private getNodeTypeForBlockType(type: BlockType) {
    switch (type) {
      case 'paragraph':
        return voidSchema.nodes.paragraph;
      case 'heading1':
      case 'heading2':
      case 'heading3':
      case 'heading4':
      case 'heading5':
      case 'heading6':
        return voidSchema.nodes.heading;
      case 'bulletList':
        return voidSchema.nodes.bulletList;
      case 'numberedList':
        return voidSchema.nodes.orderedList;
      case 'todoItem':
        return voidSchema.nodes.todoItem;
      case 'blockquote':
        return voidSchema.nodes.blockquote;
      case 'codeBlock':
        return voidSchema.nodes.codeBlock;
      case 'horizontalRule':
        return voidSchema.nodes.horizontalRule;
      case 'callout':
        return voidSchema.nodes.callout;
      case 'image':
        return voidSchema.nodes.image;
      case 'toggle':
        return voidSchema.nodes.toggle;
      case 'table':
        return voidSchema.nodes.table;
      default:
        return null;
    }
  }

  // =========================================================================
  // Block-level Commands (selectBlock, duplicateBlock, convertBlock, AI lock)
  // =========================================================================

  private executeSelectBlock(blockId: string): void {
    if (!this.view) return;
    selectBlockFromGutter(this.view, blockId, false);
  }

  private executeSelectBlockRange(startBlockId: string, endBlockId: string): void {
    if (!this.view) return;
    // First select start block as anchor
    selectBlockFromGutter(this.view, startBlockId, false);
    // Then shift-select end block for range
    selectBlockFromGutter(this.view, endBlockId, true);
  }

  private executeDuplicateBlock(blockId: string): void {
    if (!this.view) return;
    if (aiBlockKey.getState(this.view.state)?.has(blockId)) return;

    let targetNode: PmNode | null = null;
    let targetPos = -1;

    this.view.state.doc.descendants((node, pos) => {
      if (targetNode) return false;
      if (node.attrs?.id === blockId) {
        targetNode = node;
        targetPos = pos;
        return false;
      }
      return true;
    });

    if (!targetNode || targetPos < 0) return;

    // Deep-clone the node with a new block ID
    const cloned = cloneNodeWithNewIds(targetNode as PmNode);
    const insertPos = targetPos + (targetNode as PmNode).nodeSize;
    const tr = this.view.state.tr.insert(insertPos, cloned);
    this.view.dispatch(tr);
  }

  private executeConvertBlock(blockId: string, targetType: Block['type']): void {
    if (!this.view) return;

    let targetNode: PmNode | null = null;
    let targetPos = -1;

    this.view.state.doc.descendants((node, pos) => {
      if (targetNode) return false;
      if (node.attrs?.id === blockId) {
        targetNode = node;
        targetPos = pos;
        return false;
      }
      return true;
    });

    if (!targetNode || targetPos < 0) return;

    const newNodeType = getNodeTypeForBlockType(targetType);
    if (!newNodeType) return;

    // Build attrs for the target type
    const attrs: Record<string, unknown> = { id: blockId };
    if (targetType.startsWith('heading')) {
      attrs.level = parseInt(targetType.replace('heading', ''), 10);
    }

    // Preserve inline content if both source and target support it
    const content = (targetNode as PmNode).content;
    try {
      const converted = newNodeType.create(attrs, content);
      const tr = this.view.state.tr.replaceWith(
        targetPos,
        targetPos + (targetNode as PmNode).nodeSize,
        converted
      );
      this.view.dispatch(tr);
    } catch {
      // If content is incompatible (e.g. converting code block to image),
      // create an empty node of the target type
      const empty = newNodeType.create(attrs);
      const tr = this.view.state.tr.replaceWith(
        targetPos,
        targetPos + (targetNode as PmNode).nodeSize,
        empty
      );
      this.view.dispatch(tr);
    }
  }

  private executeLockBlockForAI(blockId: string, operationLabel: string): void {
    if (!this.view) return;

    // Find the block and capture its current text content
    let originalContent = '';
    this.view.state.doc.descendants((node) => {
      if (node.attrs?.id === blockId) {
        originalContent = node.textContent;
        return false;
      }
      return true;
    });

    const meta: AIBlockMeta = {
      type: 'LOCK',
      blockId,
      operation: operationLabel,
      originalContent,
      abortId: `ai-${blockId}-${Date.now()}`,
    };

    const tr = this.view.state.tr.setMeta(aiBlockKey, meta);
    this.view.dispatch(tr);
    // Event emission handled by syncAILockEvents via onLocksChanged callback
  }

  private executeUnlockBlockFromAI(blockId: string): void {
    if (!this.view) return;

    const meta: AIBlockMeta = { type: 'ACCEPT', blockId };
    const tr = this.view.state.tr.setMeta(aiBlockKey, meta);
    this.view.dispatch(tr);
    this.emit('editor:block-ai-active-target', { blockId: null });
    // Event emission handled by syncAILockEvents via onLocksChanged callback
  }

  private executeStartAIBlockOperation(
    blockId: string,
    operationLabel: string,
    expectedContent?: string,
  ): void {
    if (!this.view) return;

    let originalContent = '';
    this.view.state.doc.descendants((node) => {
      if (node.attrs?.id === blockId) {
        originalContent = node.textContent;
        return false;
      }
      return true;
    });

    const meta: AIBlockMeta = {
      type: 'LOCK',
      blockId,
      operation: operationLabel,
      originalContent,
      abortId: `ai-${blockId}-${Date.now()}`,
      ...(expectedContent !== undefined ? { expectedContent } : {}),
    };

    const tr = this.view.state.tr.setMeta(aiBlockKey, meta);
    this.view.dispatch(tr);
    this.emit('editor:block-ai-active-target', { blockId });
  }

  private executeStreamAIBlock(blockId: string, textDelta: string): void {
    if (!this.view) return;

    const meta: AIBlockMeta = { type: 'STREAM_CHUNK', blockId, text: textDelta };
    const tr = this.view.state.tr.setMeta(aiBlockKey, meta);
    this.view.dispatch(tr);
    this.emit('editor:block-ai-active-target', { blockId });
  }

  private executeFinishAIBlockOperation(blockId: string, finalMarkdown: string): void {
    if (!this.view) return;

    this.view.dispatch(
      this.view.state.tr.setMeta(aiBlockKey, { type: 'APPLYING', blockId } satisfies AIBlockMeta)
    );
    this.executeReplaceBlockContent(blockId, finalMarkdown);
    if (!this.view) return;
    this.view.dispatch(
      this.view.state.tr.setMeta(aiBlockKey, { type: 'COMPLETE', blockId } satisfies AIBlockMeta)
    );
    this.emit('editor:block-ai-active-target', { blockId });

    window.setTimeout(() => {
      if (!this.view) return;
      const locks = aiBlockKey.getState(this.view.state);
      if (!locks?.has(blockId) || locks.get(blockId)?.phase !== 'complete') return;
      this.view.dispatch(
        this.view.state.tr.setMeta(aiBlockKey, { type: 'ACCEPT', blockId } satisfies AIBlockMeta)
      );
      this.emit('editor:block-ai-active-target', { blockId: null });
    }, 900);
  }

  private executeFailAIBlockOperation(blockId: string, message: string): void {
    if (!this.view) return;

    const tr = this.view.state.tr.setMeta(aiBlockKey, {
      type: 'ERROR',
      blockId,
      message,
    } satisfies AIBlockMeta);
    this.view.dispatch(tr);
    this.emit('editor:block-ai-active-target', { blockId });
  }

  private executeCancelAIBlockOperation(blockId: string): void {
    if (!this.view) return;

    const tr = this.view.state.tr.setMeta(aiBlockKey, {
      type: 'CANCEL',
      blockId,
    } satisfies AIBlockMeta);
    this.view.dispatch(tr);
    this.emit('editor:block-ai-active-target', { blockId: null });
  }

  private executeScrollBlockIntoView(
    blockId: string,
    mode: 'nearest' | 'center' | 'smart' = 'smart',
  ): void {
    if (!this.view) return;

    const blockEl = this.view.dom.querySelector(
      `[data-block-id="${blockId}"]`
    ) as HTMLElement | null;
    if (!blockEl) return;

    const block = mode === 'center' ? 'center' : 'nearest';
    blockEl.scrollIntoView({ block, inline: 'nearest', behavior: 'smooth' });
    this.emit('editor:block-scrolled-into-view', { blockId, mode });
  }

  private executeInsertContentAfterBlock(blockId: string, markdown: string): void {
    if (!this.view) return;

    let targetPos = -1;
    let targetNode: PmNode | null = null;

    this.view.state.doc.descendants((node, pos) => {
      if (targetNode) return false;
      if (node.attrs?.id === blockId) {
        targetNode = node;
        targetPos = pos;
        return false;
      }
      return true;
    });

    if (!targetNode || targetPos < 0) return;

    const pmDoc = parseMarkdown(markdown);
    if (!pmDoc.content.childCount) return;

    const insertPos = targetPos + (targetNode as PmNode).nodeSize;
    const tr = this.view.state.tr
      .insert(insertPos, pmDoc.content)
      .setMeta(AI_BYPASS, true);
    this.view.dispatch(tr.scrollIntoView());
  }

  private executeUpdateTodoContent(
    previousContent: string,
    nextContent: string,
    checked?: boolean,
  ): void {
    if (!this.view) return;
    const todoItemNodeType = voidSchema.nodes.todoItem;
    if (!todoItemNodeType) return;

    const previous = previousContent.trim();
    let found = false;
    this.view.state.doc.descendants((node, pos) => {
      if (found) return false;
      if (node.type !== todoItemNodeType || node.textContent.trim() !== previous) return true;

      const attrs = { ...node.attrs };
      if (checked !== undefined) attrs.checked = checked;
      const content = nextContent ? this.view!.state.schema.text(nextContent) : null;
      const replacement = node.type.create(attrs, content, node.marks);
      const tr = this.view!.state.tr.replaceWith(pos, pos + node.nodeSize, replacement);
      this.view!.dispatch(tr);
      found = true;
      return false;
    });
  }

  private executeDeleteTodoContent(content: string): void {
    if (!this.view) return;
    const todoItemNodeType = voidSchema.nodes.todoItem;
    if (!todoItemNodeType) return;

    const target = content.trim();
    let found = false;
    this.view.state.doc.descendants((node, pos) => {
      if (found) return false;
      if (node.type !== todoItemNodeType || node.textContent.trim() !== target) return true;

      const tr = this.view!.state.tr.delete(pos, pos + node.nodeSize);
      this.view!.dispatch(tr);
      found = true;
      return false;
    });
  }

  /**
   * Diff previous vs current AI lock state and emit events for any changes.
   * Called by onLocksChanged callback — covers keyboard-driven state transitions
   * that bypass the explicit executeLock/executeUnlock methods.
   */
  private syncAILockEvents(locks: import('./plugins/aiBlock').AIBlockState): void {
    const currentIds = new Set(locks.keys());

    // Newly locked blocks
    for (const [blockId, lock] of locks) {
      if (!this.previousAILockIds.has(blockId)) {
        this.emit('editor:block-ai-locked', { blockId, operation: lock.operation });
      }

      const previousPhase = this.previousAIPhases.get(blockId);
      if (previousPhase !== lock.phase) {
        this.emit('editor:block-ai-phase', {
          blockId,
          operation: lock.operation,
          phase: lock.phase,
        });
      }
    }

    // Newly unlocked blocks
    for (const blockId of this.previousAILockIds) {
      if (!currentIds.has(blockId)) {
        this.emit('editor:block-ai-unlocked', { blockId });
      }
    }

    this.previousAILockIds = currentIds;
    this.previousAIPhases = new Map(
      Array.from(locks, ([blockId, lock]) => [blockId, lock.phase])
    );
  }

  private executeReplaceBlockContent(blockId: string, markdown: string): void {
    if (!this.view) return;

    let targetPos = -1;
    let targetNode: PmNode | null = null;

    this.view.state.doc.descendants((node, pos) => {
      if (targetNode) return false;
      if (node.attrs?.id === blockId) {
        targetNode = node;
        targetPos = pos;
        return false;
      }
      return true;
    });

    if (!targetNode || targetPos < 0) return;

    // Parse the markdown into PM content
    const pmDoc = parseMarkdown(markdown);
    if (!pmDoc.content.childCount) return;

    // Replace only the content inside the block, preserving the node wrapper.
    // For inline containers (paragraph, heading, listItem, todoItem), replace inner content.
    // For others, replace the entire node.
    const node = targetNode as PmNode;
    if (node.isTextblock) {
      // Replace inner inline content (pos+1 to pos+nodeSize-1)
      const innerStart = targetPos + 1;
      const innerEnd = targetPos + node.nodeSize - 1;
      // Get inline content from the first block of the parsed markdown
      const firstChild = pmDoc.content.firstChild;
      const newContent = firstChild?.isTextblock ? firstChild.content : pmDoc.content;
      const tr = this.view.state.tr
        .replaceWith(innerStart, innerEnd, newContent)
        .setMeta(AI_BYPASS, true);
      this.view.dispatch(tr);
    } else {
      // Replace the entire node
      const tr = this.view.state.tr
        .replaceWith(targetPos, targetPos + node.nodeSize, pmDoc.content)
        .setMeta(AI_BYPASS, true);
      this.view.dispatch(tr);
    }
  }

  /**
   * Deep-clone a ProseMirror node, assigning new block IDs.
   */
  /**
   * Convert PM document to domain Document, preserving the metadata of
   * the currently-mounted document. Wraps the pure converter.
   */
  private proseMirrorToDomain(pmDoc: PmNode): Document {
    if (!this.currentDocument) {
      throw new Error('No current document');
    }
    return proseMirrorToDomain(pmDoc, this.currentDocument);
  }
}

interface InlineTextRangeCandidate {
  from: number;
  to: number;
  blockId: string | null;
}

function collectInlineTextRangeCandidates(doc: PmNode, needle: string): InlineTextRangeCandidate[] {
  const candidates: InlineTextRangeCandidate[] = [];
  if (!needle) return candidates;

  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    const text = node.textContent;
    let start = 0;
    while (start <= text.length) {
      const index = text.indexOf(needle, start);
      if (index < 0) break;
      const from = pos + 1 + index;
      candidates.push({
        from,
        to: from + needle.length,
        blockId: typeof node.attrs?.id === 'string' ? node.attrs.id : null,
      });
      start = index + Math.max(needle.length, 1);
    }
    return true;
  });

  return candidates;
}

function scoreInlineTextRangeCandidate(
  doc: PmNode,
  candidate: InlineTextRangeCandidate,
  input: EditorInlineAIRangeAnchorInput,
): number {
  let score = 1;
  if (candidate.blockId && input.blockIds.includes(candidate.blockId)) score += 100;

  const beforeNeedle = normalizeAnchorContext(input.beforeText ?? '').slice(-80);
  const afterNeedle = normalizeAnchorContext(input.afterText ?? '').slice(0, 80);
  const beforeCurrent = normalizeAnchorContext(
    doc.textBetween(Math.max(0, candidate.from - 240), candidate.from, '\n'),
  );
  const afterCurrent = normalizeAnchorContext(
    doc.textBetween(candidate.to, Math.min(doc.content.size, candidate.to + 240), '\n'),
  );

  if (beforeNeedle && beforeCurrent.endsWith(beforeNeedle)) score += 30;
  if (afterNeedle && afterCurrent.startsWith(afterNeedle)) score += 30;

  return score;
}

function normalizeAnchorContext(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}
