/**
 * Page Link Event Handlers
 *
 * Handles text input to detect "[[" trigger and keyboard
 * navigation within the page link autocomplete menu.
 *
 * Part of the ProseMirror infrastructure adapter.
 */

import { TextSelection, type EditorState, type Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type { Mark, Node as ProseMirrorNode } from 'prosemirror-model';
import {
  pageLinkKey,
  type PageLinkState,
  type PageLinkNote,
  type PageLinkMode,
  type PageLinkSelectionRange,
  INITIAL_STATE,
} from './state';
import { voidSchema } from '../../schema';
import { clampToViewport } from '../positioning';

const MENU_WIDTH = 380;
const MENU_HEIGHT = 430;

export interface PageLinkSearchContext {
  mode: PageLinkMode;
  activePath?: string | null;
}

/**
 * Provider interface for searching notes.
 */
export interface NotesProvider {
  /**
   * Search notes by query.
   * @param query - Search query
   * @returns Array of matching notes
   */
  searchNotes(query: string, context?: PageLinkSearchContext): PageLinkNote[];

  /**
   * Get all notes.
   * @returns Array of all notes
   */
  getAllNotes(context?: PageLinkSearchContext): PageLinkNote[];
}

/**
 * Meta action types for page link state updates.
 */
export type PageLinkAction =
  | {
      type: 'OPEN';
      mode?: PageLinkMode;
      triggerPos: number;
      coords: { top: number; left: number };
      openAbove: boolean;
      selectionRange?: PageLinkSelectionRange | null;
      query?: string;
    }
  | { type: 'CLOSE' }
  | { type: 'UPDATE_QUERY'; query: string }
  | { type: 'NEXT' }
  | { type: 'PREV' }
  | { type: 'SELECT'; index: number };

/**
 * Create page link event handlers.
 *
 * @param notesProvider - Provider for searching notes
 * @returns Object with handleTextInput and handleKeyDown functions
 */
export function createPageLinkHandlers(notesProvider: NotesProvider) {
  // Track if we just typed '[' to detect '[['
  let lastBracketPos: number | null = null;

  return {
    /**
     * Handle text input - detect "[[" trigger.
     *
     * The menu is triggered when:
     * - User types "[" after a previous "["
     */
    handleTextInput(
      view: EditorView,
      from: number,
      to: number,
      text: string
    ): boolean {
      const { state } = view;

      // Check for second '[' to complete '[['
      if (text === '[') {
        // Check if previous character is also '['
        if (from > 0) {
          const charBefore = state.doc.textBetween(from - 1, from);
          if (charBefore === '[') {
            // We have '[[' - open the menu
            const rawCoords = view.coordsAtPos(from);
            const { top, left, openAbove } = clampToViewport(rawCoords, {
              menuWidth: MENU_WIDTH,
              menuHeight: MENU_HEIGHT,
            });

            const tr = state.tr.setMeta(pageLinkKey, {
              type: 'OPEN',
              mode: 'typed',
              triggerPos: from - 1, // Position of first '['
              coords: { top, left },
              openAbove,
              selectionRange: null,
            } as PageLinkAction);

            view.dispatch(tr);

            // Let ProseMirror handle the actual "[" character insertion
            return false;
          }
        }

        // Track this bracket for potential [[
        lastBracketPos = from;
      } else {
        // Reset bracket tracking on other characters
        lastBracketPos = null;
      }

      return false;
    },

    /**
     * Handle keyboard navigation within the menu.
     *
     * Handles:
     * - ArrowDown: Select next note
     * - ArrowUp: Select previous note
     * - Enter/Tab: Insert selected note link
     * - Escape: Close menu
     * - Backspace: Close if deleting the "[["
     * - ]]: Complete link with current selection
     */
    handleKeyDown(view: EditorView, event: KeyboardEvent): boolean {
      const menuState = pageLinkKey.getState(view.state);
      if (!menuState?.isOpen) return false;

      switch (event.key) {
        case 'ArrowDown': {
          event.preventDefault();
          view.dispatch(
            view.state.tr.setMeta(pageLinkKey, { type: 'NEXT' } as PageLinkAction)
          );
          return true;
        }

        case 'ArrowUp': {
          event.preventDefault();
          view.dispatch(
            view.state.tr.setMeta(pageLinkKey, { type: 'PREV' } as PageLinkAction)
          );
          return true;
        }

        case 'Enter':
        case 'Tab': {
          event.preventDefault();
          insertPageLink(view, menuState);
          return true;
        }

        case 'Escape': {
          event.preventDefault();
          view.dispatch(
            view.state.tr.setMeta(pageLinkKey, { type: 'CLOSE' } as PageLinkAction)
          );
          return true;
        }

        case 'Backspace': {
          if (menuState.mode !== 'typed') return false;
          // Close if we're about to delete into the "[["
          if (menuState.query.length === 0) {
            // Check if cursor is right after [[
            const { from } = view.state.selection;
            if (from === menuState.triggerPos + 2) {
              // Let ProseMirror handle the backspace, but close the menu
              view.dispatch(
                view.state.tr.setMeta(pageLinkKey, { type: 'CLOSE' } as PageLinkAction)
              );
            }
          }
          return false;
        }

        case ']': {
          if (menuState.mode !== 'typed') return false;
          // Check if next char would complete ]]
          const { from } = view.state.selection;
          const charBefore = from > 0 ? view.state.doc.textBetween(from - 1, from) : '';

          if (charBefore === ']') {
            // User typed ']]' - complete the link
            event.preventDefault();
            insertPageLink(view, menuState, true);
            return true;
          }
          return false;
        }

        default:
          return false;
      }
    },
  };
}

/**
 * Insert a page link at the current position.
 *
 * @param view - The editor view
 * @param menuState - Current menu state
 * @param fromDoubleBracket - Whether triggered by typing ]]
 */
export function insertPageLink(
  view: EditorView,
  menuState: PageLinkState,
  fromDoubleBracket = false,
  selectedNote?: PageLinkNote,
): void {
  const note = selectedNote ?? menuState.filteredNotes[menuState.selectedIndex];
  if (!note) {
    // No note selected - just close
    view.dispatch(
      view.state.tr.setMeta(pageLinkKey, { type: 'CLOSE' } as PageLinkAction)
    );
    return;
  }

  if (menuState.mode === 'selection') {
    setPageLink(view, note, menuState.selectionRange ?? undefined);
    return;
  }

  const { triggerPos, query } = menuState;
  let deleteEnd = triggerPos + 2 + query.length;
  if (fromDoubleBracket) deleteEnd += 1;

  setPageLink(view, note, {
    from: triggerPos,
    to: deleteEnd,
    text: note.title,
  });
}

/**
 * Open the same note picker used by typed `[[` for the current selection.
 */
export function openPageLinkPicker(view: EditorView): void {
  const { from, to } = view.state.selection;
  const selectedText = view.state.doc.textBetween(from, to, ' ', ' ').trim();
  const rawCoords = view.coordsAtPos(to);
  const { top, left, openAbove } = clampToViewport(rawCoords, {
    menuWidth: MENU_WIDTH,
    menuHeight: MENU_HEIGHT,
  });

  view.dispatch(
    view.state.tr.setMeta(pageLinkKey, {
      type: 'OPEN',
      mode: 'selection',
      triggerPos: from,
      coords: { top, left },
      openAbove,
      selectionRange: { from, to, text: selectedText },
      query: '',
    } as PageLinkAction)
  );
}

/**
 * Apply a page-link mark to a range, existing page link, or empty cursor.
 */
export function setPageLink(
  view: EditorView,
  note: PageLinkNote,
  explicitRange?: PageLinkSelectionRange,
): void {
  const pageLinkMarkType = voidSchema.marks.pageLink;
  if (!pageLinkMarkType) {
    console.error('pageLink mark not found in schema');
    closePageLinkPicker(view);
    return;
  }

  const current = view.state.selection;
  const existingRange = explicitRange
    ? null
    : findMarkRange(view.state, current.from, pageLinkMarkType);
  const from = explicitRange?.from ?? existingRange?.from ?? current.from;
  const to = explicitRange?.to ?? existingRange?.to ?? current.to;
  const rangeText = view.state.doc.textBetween(from, to, ' ', ' ').trim();
  const selectedText = explicitRange?.text ?? rangeText;
  const displayText = selectedText || note.title;
  const shouldReplaceText = !!explicitRange && from !== to && !!displayText && rangeText !== displayText;
  const mark = pageLinkMarkType.create({ href: note.path, title: note.title });

  let tr = view.state.tr;
  if (from === to) {
    const linkText = voidSchema.text(displayText, [mark]);
    tr = tr.insert(from, linkText);
    tr = tr.setSelection(TextSelection.create(tr.doc, from + displayText.length));
  } else if (shouldReplaceText) {
    const linkText = voidSchema.text(displayText, [mark]);
    tr = tr.replaceWith(from, to, linkText);
    tr = tr.setSelection(TextSelection.create(tr.doc, from + displayText.length));
  } else {
    tr = tr.removeMark(from, to, pageLinkMarkType).addMark(from, to, mark);
    tr = tr.setSelection(TextSelection.create(tr.doc, to));
  }

  view.dispatch(tr.setMeta(pageLinkKey, { type: 'CLOSE' } as PageLinkAction));
}

/**
 * Remove page-link marks while leaving the visible text intact.
 */
export function removePageLink(view: EditorView): void {
  const pageLinkMarkType = voidSchema.marks.pageLink;
  if (!pageLinkMarkType) return;

  const { from, to, empty } = view.state.selection;
  const range = empty ? findMarkRange(view.state, from, pageLinkMarkType) : { from, to };
  if (!range) return;

  view.dispatch(view.state.tr.removeMark(range.from, range.to, pageLinkMarkType));
}

export function closePageLinkPicker(view: EditorView): void {
  view.dispatch(view.state.tr.setMeta(pageLinkKey, { type: 'CLOSE' } as PageLinkAction));
}

function findMarkRange(
  state: EditorState,
  pos: number,
  markType: NonNullable<typeof voidSchema.marks.pageLink>,
): { from: number; to: number; mark: Mark } | null {
  const $pos = state.doc.resolve(pos);
  const parent = $pos.parent;
  const offset = $pos.parentOffset;

  const children: Array<{ node: ProseMirrorNode; offset: number }> = [];
  parent.forEach((node, nodeOffset) => {
    children.push({ node, offset: nodeOffset });
  });

  let index = children.findIndex(({ node, offset: nodeOffset }) =>
    nodeOffset <= offset && offset <= nodeOffset + node.nodeSize
  );
  if (index < 0 && offset > 0) {
    index = children.findIndex(({ node, offset: nodeOffset }) =>
      nodeOffset < offset && offset <= nodeOffset + node.nodeSize
    );
  }
  if (index < 0) return null;

  let mark = children[index]?.node.marks.find((m) => m.type === markType);
  if (!mark && offset === children[index]?.offset) {
    mark = children[index - 1]?.node.marks.find((m) => m.type === markType);
    if (mark) index -= 1;
  }
  if (!mark) return null;

  let startIndex = index;
  let endIndex = index;
  while (startIndex > 0 && children[startIndex - 1]?.node.marks.some((m) => m.eq(mark))) {
    startIndex -= 1;
  }
  while (
    endIndex < children.length - 1 &&
    children[endIndex + 1]?.node.marks.some((m) => m.eq(mark))
  ) {
    endIndex += 1;
  }

  const base = $pos.start();
  const start = children[startIndex]?.offset ?? offset;
  const endChild = children[endIndex];
  const end = endChild ? endChild.offset + endChild.node.nodeSize : offset;
  return { from: base + start, to: base + end, mark };
}

/**
 * Create the state reducer for page link.
 *
 * This reducer handles:
 * - Meta actions (OPEN, CLOSE, UPDATE_QUERY, NEXT, PREV, SELECT)
 * - Document changes (to update query as user types)
 *
 * @param notesProvider - The notes provider for searching notes
 * @returns Reducer function for processing transactions
 */
export function createPageLinkReducer(notesProvider: NotesProvider) {
  return function reducer(
    state: PageLinkState,
    tr: Transaction,
    editorState: EditorState
  ): PageLinkState {
    const meta = tr.getMeta(pageLinkKey) as PageLinkAction | undefined;

    if (meta) {
      switch (meta.type) {
        case 'OPEN': {
          const mode = meta.mode ?? 'typed';
          const query = meta.query ?? '';
          const context = { mode };
          return {
            ...INITIAL_STATE,
            isOpen: true,
            mode,
            query,
            triggerPos: meta.triggerPos,
            selectionRange: meta.selectionRange ?? null,
            coords: meta.coords,
            openAbove: meta.openAbove,
            filteredNotes: query
              ? notesProvider.searchNotes(query, context)
              : notesProvider.getAllNotes(context),
          };
        }

        case 'CLOSE':
          return INITIAL_STATE;

        case 'UPDATE_QUERY': {
          const filtered = notesProvider.searchNotes(meta.query, { mode: state.mode });
          return {
            ...state,
            query: meta.query,
            filteredNotes: filtered,
            selectedIndex: Math.min(
              state.selectedIndex,
              Math.max(0, filtered.length - 1)
            ),
          };
        }

        case 'NEXT':
          return {
            ...state,
            selectedIndex: Math.min(
              state.selectedIndex + 1,
              state.filteredNotes.length - 1
            ),
          };

        case 'PREV':
          return {
            ...state,
            selectedIndex: Math.max(state.selectedIndex - 1, 0),
          };

        case 'SELECT':
          return {
            ...state,
            selectedIndex: Math.min(
              Math.max(0, meta.index),
              state.filteredNotes.length - 1
            ),
          };
      }
    }

    // Update query based on document changes when menu is open
    if (state.isOpen && state.mode === 'typed' && tr.docChanged) {
      try {
        // Resolve the position after the [[
        const doc = tr.doc;
        const mappedTriggerPos = tr.mapping.map(state.triggerPos);
        const $pos = doc.resolve(mappedTriggerPos);

        // Calculate positions relative to parent
        const startOffset = mappedTriggerPos - $pos.start();
        const currentOffset = $pos.parentOffset;

        // Get text after the [[ up to cursor
        if (startOffset >= 0 && currentOffset >= startOffset) {
          const textAfterBrackets = $pos.parent.textBetween(
            startOffset + 2, // +2 to skip the "[["
            $pos.parent.content.size,
            null,
            '\ufffc'
          );

          // Extract query (text after [[ until ]] or end of line)
          // Stop at first ] or newline
          const match = textAfterBrackets.match(/^([^\]\n]*)/);
          const query = match?.[1] ?? '';

          // Only update if query changed
          if (query !== state.query) {
            const filtered = notesProvider.searchNotes(query, { mode: state.mode });
            return {
              ...state,
              triggerPos: mappedTriggerPos,
              query,
              filteredNotes: filtered,
              selectedIndex: 0,
            };
          }

          // Update trigger position even if query unchanged
          return {
            ...state,
            triggerPos: mappedTriggerPos,
          };
        }
      } catch {
        // Position resolution failed, close menu
        return INITIAL_STATE;
      }
    }

    return state;
  };
}
