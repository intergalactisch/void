/**
 * Block Selection Plugin (Enhanced)
 *
 * Multi-block selection support using custom plugin state rather than
 * ProseMirror's built-in NodeSelection (which only supports single nodes).
 *
 * Features:
 * - Escape: enter block selection (single block), second Escape clears
 * - Shift+Up/Down: extend selection to adjacent blocks
 * - Up/Down in block mode: move selection cursor between blocks
 * - Backspace/Delete: delete all selected blocks
 * - Enter: drop back into text editing in the anchor block
 * - Cmd+A escalation: text -> block -> all blocks
 * - Per-block decorations via DecorationSet
 * - Emits 'editor:block-selected' for EditorStore sync
 *
 * Part of the ProseMirror infrastructure adapter.
 */

import { Plugin, PluginKey, TextSelection, AllSelection } from 'prosemirror-state';
import type { EditorState, Transaction } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import type { EditorView } from 'prosemirror-view';
import { keymap } from 'prosemirror-keymap';
import type { Command } from 'prosemirror-state';
import { events } from '$lib/events';
import { generateBlockId } from '$lib/domain/entities/Block';
import {
  getVisibleBlockOrder,
  resolveVisibleBlock,
  resolveVisibleBlockRange,
  findVisibleBlock,
} from '../../commands/blockUtils';
import type { VisibleBlock } from '../../commands/blockUtils';

export const blockSelectionKey = new PluginKey('blockSelection');

/** Meta key used to update block selection state via transactions. */
const BLOCK_SELECTION_META = 'blockSelection';

// ============================================================================
// Plugin State
// ============================================================================

export interface BlockSelectionState {
  /** IDs of currently selected blocks, in document order. */
  selectedIds: string[];
  /** The anchor block ID (where selection started). Used for Shift-extend. */
  anchorId: string | null;
}

function emptyState(): BlockSelectionState {
  return { selectedIds: [], anchorId: null };
}

function stateEquals(a: BlockSelectionState, b: BlockSelectionState): boolean {
  if (a.anchorId !== b.anchorId) return false;
  if (a.selectedIds.length !== b.selectedIds.length) return false;
  for (let i = 0; i < a.selectedIds.length; i++) {
    if (a.selectedIds[i] !== b.selectedIds[i]) return false;
  }
  return true;
}

// ============================================================================
// State Helpers
// ============================================================================

/** Get the block selection state from an editor state. */
export function getBlockSelectionState(state: EditorState): BlockSelectionState {
  return blockSelectionKey.getState(state) ?? emptyState();
}

/** Check whether block selection mode is currently active. */
export function isBlockSelectionActive(state: EditorState): boolean {
  return getBlockSelectionState(state).selectedIds.length > 0;
}

/** Create a transaction that sets block selection. */
function setBlockSelection(
  tr: Transaction,
  selectedIds: string[],
  anchorId: string | null,
): Transaction {
  return tr.setMeta(BLOCK_SELECTION_META, { selectedIds, anchorId });
}

/** Create a transaction that clears block selection. */
function clearBlockSelection(tr: Transaction): Transaction {
  return tr.setMeta(BLOCK_SELECTION_META, emptyState());
}

// ============================================================================
// Commands
// ============================================================================

/**
 * Escape handler for block selection.
 *
 * - If block selection is active: clear it, place cursor in the anchor block
 * - If text cursor is in a block: enter single-block selection mode
 */
const escapeBlockSelection: Command = (state, dispatch) => {
  const bsState = getBlockSelectionState(state);

  if (bsState.selectedIds.length > 0) {
    // Block selection active -> clear it, place cursor in anchor block
    if (!dispatch) return true;

    const anchorId = bsState.anchorId ?? bsState.selectedIds[0] ?? null;
    const block = anchorId ? findVisibleBlock(state.doc, anchorId) : null;
    const tr = clearBlockSelection(state.tr);

    if (block) {
      const node = state.doc.nodeAt(block.pos);
      if (node) {
        const cursorPos = Math.min(block.pos + 1, state.doc.content.size);
        const $pos = state.doc.resolve(cursorPos);
        tr.setSelection(TextSelection.near($pos));
      }
    }
    dispatch(tr);
    return true;
  }

  // No block selection -> enter single-block mode
  const resolved = resolveVisibleBlock(state.selection.$from);
  if (!resolved) return false;

  const blockId = resolved.node.attrs.id;
  if (!blockId) return false;

  if (!dispatch) return true;

  const tr = setBlockSelection(state.tr, [blockId], blockId);
  dispatch(tr);
  return true;
};

/**
 * Extend block selection upward (Shift+ArrowUp).
 * Only active when block selection is already engaged.
 */
const extendSelectionUp: Command = (state, dispatch) => {
  const bsState = getBlockSelectionState(state);
  if (bsState.selectedIds.length === 0) return false;

  const blocks = getVisibleBlockOrder(state.doc);
  const anchorId = bsState.anchorId ?? bsState.selectedIds[0] ?? null;
  if (!anchorId) return false;

  // Find the topmost selected block
  const selectedSet = new Set(bsState.selectedIds);
  let topIdx = -1;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b && selectedSet.has(b.blockId)) {
      topIdx = i;
      break;
    }
  }

  // Can't extend above first block
  if (topIdx <= 0) return false;

  if (!dispatch) return true;

  const newTopBlock = blocks[topIdx - 1];
  if (!newTopBlock) return false;
  const newTopId = newTopBlock.blockId;

  const anchorIdx = blocks.findIndex(b => b.blockId === anchorId);
  const bottomIdx = Math.max(
    ...bsState.selectedIds.map(id => blocks.findIndex(b => b.blockId === id)),
  );
  const bottomBlock = blocks[bottomIdx];

  let newIds: string[];
  if (anchorIdx <= bottomIdx && bottomBlock) {
    // Anchor is at or above bottom: extend up from anchor
    const rangeAbove = resolveVisibleBlockRange(state.doc, newTopId, anchorId);
    const rangeBelow = resolveVisibleBlockRange(state.doc, anchorId, bottomBlock.blockId);
    const allIds = new Set([...rangeAbove.map(b => b.blockId), ...rangeBelow.map(b => b.blockId)]);
    newIds = blocks.filter(b => allIds.has(b.blockId)).map(b => b.blockId);
  } else {
    // Selection was extending down from anchor, now contracting
    newIds = resolveVisibleBlockRange(state.doc, anchorId, newTopId).map(b => b.blockId);
  }

  const tr = setBlockSelection(state.tr, newIds, anchorId);
  dispatch(tr);
  return true;
};

/**
 * Extend block selection downward (Shift+ArrowDown).
 * Only active when block selection is already engaged.
 */
const extendSelectionDown: Command = (state, dispatch) => {
  const bsState = getBlockSelectionState(state);
  if (bsState.selectedIds.length === 0) return false;

  const blocks = getVisibleBlockOrder(state.doc);
  const anchorId = bsState.anchorId ?? bsState.selectedIds[0] ?? null;
  if (!anchorId) return false;

  // Find the bottommost selected block
  const selectedSet = new Set(bsState.selectedIds);
  let bottomIdx = -1;
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    if (b && selectedSet.has(b.blockId)) {
      bottomIdx = i;
      break;
    }
  }

  // Can't extend below last block
  if (bottomIdx < 0 || bottomIdx >= blocks.length - 1) return false;

  if (!dispatch) return true;

  const newBottomBlock = blocks[bottomIdx + 1];
  if (!newBottomBlock) return false;
  const newBottomId = newBottomBlock.blockId;

  const anchorIdx = blocks.findIndex(b => b.blockId === anchorId);
  const topIdx = Math.min(
    ...bsState.selectedIds.map(id => blocks.findIndex(b => b.blockId === id)),
  );
  const topBlock = blocks[topIdx];

  let newIds: string[];
  if (anchorIdx >= topIdx && topBlock) {
    // Anchor is at or below top: extend down from anchor
    const rangeAbove = resolveVisibleBlockRange(state.doc, topBlock.blockId, anchorId);
    const rangeBelow = resolveVisibleBlockRange(state.doc, anchorId, newBottomId);
    const allIds = new Set([...rangeAbove.map(b => b.blockId), ...rangeBelow.map(b => b.blockId)]);
    newIds = blocks.filter(b => allIds.has(b.blockId)).map(b => b.blockId);
  } else {
    // Selection was extending up from anchor, now contracting
    newIds = resolveVisibleBlockRange(state.doc, anchorId, newBottomId).map(b => b.blockId);
  }

  const tr = setBlockSelection(state.tr, newIds, anchorId);
  dispatch(tr);
  return true;
};

/**
 * Move block selection cursor up (ArrowUp in block mode).
 * Selects only the block above the current single selection.
 */
const moveSelectionUp: Command = (state, dispatch) => {
  const bsState = getBlockSelectionState(state);
  if (bsState.selectedIds.length === 0) return false;

  const blocks = getVisibleBlockOrder(state.doc);
  const topId = bsState.selectedIds[0];
  if (!topId) return false;
  const topIdx = blocks.findIndex(b => b.blockId === topId);
  if (topIdx <= 0) return false;

  const newBlock = blocks[topIdx - 1];
  if (!newBlock) return false;

  if (!dispatch) return true;

  const tr = setBlockSelection(state.tr, [newBlock.blockId], newBlock.blockId);
  dispatch(tr);
  return true;
};

/**
 * Move block selection cursor down (ArrowDown in block mode).
 * Selects only the block below the current single selection.
 */
const moveSelectionDown: Command = (state, dispatch) => {
  const bsState = getBlockSelectionState(state);
  if (bsState.selectedIds.length === 0) return false;

  const blocks = getVisibleBlockOrder(state.doc);
  const bottomId = bsState.selectedIds[bsState.selectedIds.length - 1];
  if (!bottomId) return false;
  const bottomIdx = blocks.findIndex(b => b.blockId === bottomId);
  if (bottomIdx < 0 || bottomIdx >= blocks.length - 1) return false;

  const newBlock = blocks[bottomIdx + 1];
  if (!newBlock) return false;

  if (!dispatch) return true;

  const tr = setBlockSelection(state.tr, [newBlock.blockId], newBlock.blockId);
  dispatch(tr);
  return true;
};

/**
 * Delete all selected blocks (Backspace/Delete in block mode).
 * If all blocks would be deleted, replaces with an empty paragraph.
 */
const deleteSelectedBlocks: Command = (state, dispatch) => {
  const bsState = getBlockSelectionState(state);
  if (bsState.selectedIds.length === 0) return false;

  if (!dispatch) return true;

  const blocks = getVisibleBlockOrder(state.doc);
  const selectedSet = new Set(bsState.selectedIds);
  const remainingBlocks = blocks.filter(b => !selectedSet.has(b.blockId));

  let tr = state.tr;

  // Delete selected blocks from bottom to top to preserve positions
  const toDelete = blocks
    .filter(b => selectedSet.has(b.blockId))
    .reverse();

  if (remainingBlocks.length === 0) {
    // All blocks selected: replace entire doc content with empty paragraph
    const paragraphType = state.schema.nodes.paragraph;
    if (!paragraphType) return false;

    const emptyPara = paragraphType.create({ id: generateBlockId() });
    tr.replaceWith(0, state.doc.content.size, emptyPara);
    const $pos = tr.doc.resolve(1);
    tr.setSelection(TextSelection.near($pos));
  } else {
    for (const block of toDelete) {
      const mapped = tr.mapping.map(block.pos);
      const mappedEnd = tr.mapping.map(block.pos + block.nodeSize);
      tr.delete(mapped, mappedEnd);
    }

    // Place cursor in the block nearest to the first deleted block
    const firstDeletedIdx = blocks.findIndex(b => selectedSet.has(b.blockId));
    const targetBlock = firstDeletedIdx > 0
      ? blocks[firstDeletedIdx - 1]
      : remainingBlocks[0];

    if (targetBlock) {
      const mappedPos = tr.mapping.map(targetBlock.pos);
      const $pos = tr.doc.resolve(Math.min(mappedPos + 1, tr.doc.content.size));
      tr.setSelection(TextSelection.near($pos));
    }
  }

  tr = clearBlockSelection(tr);
  dispatch(tr);
  return true;
};

/**
 * Enter key in block mode: exit block selection, place cursor in the
 * anchor block for text editing.
 */
const enterFromBlockSelection: Command = (state, dispatch) => {
  const bsState = getBlockSelectionState(state);
  if (bsState.selectedIds.length === 0) return false;

  if (!dispatch) return true;

  const anchorId = bsState.anchorId ?? bsState.selectedIds[0] ?? null;
  const block = anchorId ? findVisibleBlock(state.doc, anchorId) : null;
  const tr = clearBlockSelection(state.tr);

  if (block) {
    const cursorPos = Math.min(block.pos + 1, state.doc.content.size);
    const $pos = state.doc.resolve(cursorPos);
    tr.setSelection(TextSelection.near($pos));
  }

  dispatch(tr);
  return true;
};

/**
 * Cmd+A escalation: text -> single block -> all blocks.
 *
 * 1st press: select all text in the current block
 * 2nd press: enter block selection for that block
 * 3rd press: select all blocks in the document
 */
const selectAllEscalation: Command = (state, dispatch) => {
  const bsState = getBlockSelectionState(state);

  // If already all blocks selected, let default (or do nothing)
  if (bsState.selectedIds.length > 0) {
    const blocks = getVisibleBlockOrder(state.doc);
    if (bsState.selectedIds.length >= blocks.length) {
      // Already all selected
      return false;
    }

    // Block selection active but not all: select all blocks
    if (!dispatch) return true;
    const allIds = blocks.map(b => b.blockId);
    const tr = setBlockSelection(state.tr, allIds, bsState.anchorId);
    dispatch(tr);
    return true;
  }

  // No block selection active
  if (state.selection instanceof AllSelection) {
    return false;
  }

  const { $from, $to } = state.selection;

  // Check if text already spans the whole inline content of the textblock.
  // Use $from.start()/$from.end() which correctly resolve to the textblock
  // boundaries even inside nested containers (e.g., paragraph inside listItem).
  const resolved = resolveVisibleBlock($from);
  if (!resolved) return false;

  const textblockStart = $from.start($from.depth);
  const textblockEnd = $from.end($from.depth);

  if ($from.pos <= textblockStart && $to.pos >= textblockEnd) {
    // Already selected whole block text: enter block selection mode
    const blockId = resolved.node.attrs.id;
    if (!blockId) return false;

    if (!dispatch) return true;
    const tr = setBlockSelection(state.tr, [blockId], blockId);
    dispatch(tr);
    return true;
  }

  // Select all text in the current textblock
  if (!dispatch) return true;
  const $start = state.doc.resolve(textblockStart);
  const $end = state.doc.resolve(textblockEnd);
  const tr = state.tr.setSelection(TextSelection.between($start, $end));
  dispatch(tr);
  return true;
};

// ============================================================================
// Gutter Click API
// ============================================================================

/**
 * Select a block by clicking its gutter. Called from BlockNodeView.
 *
 * @param view - The EditorView
 * @param blockId - The block ID to select
 * @param shiftKey - Whether Shift was held (range selection)
 */
export function selectBlockFromGutter(
  view: EditorView,
  blockId: string,
  shiftKey: boolean,
): void {
  const { state } = view;
  const bsState = getBlockSelectionState(state);

  if (shiftKey && bsState.anchorId) {
    // Shift+click: range selection from anchor to clicked block
    const range = resolveVisibleBlockRange(state.doc, bsState.anchorId, blockId);
    if (range.length > 0) {
      const ids = range.map(b => b.blockId);
      const tr = setBlockSelection(state.tr, ids, bsState.anchorId);
      view.dispatch(tr);
    }
  } else {
    // Plain click: single block selection
    const tr = setBlockSelection(state.tr, [blockId], blockId);
    view.dispatch(tr);
  }
}

// ============================================================================
// Keymap Plugin
// ============================================================================

/**
 * Create the block selection keymap plugin.
 * Position 5 in the plugin stack (after AI Block, before list keymap).
 */
export function createBlockSelectionKeymap(): Plugin {
  return keymap({
    'Escape': escapeBlockSelection,
    'Mod-a': selectAllEscalation,
    'Shift-ArrowUp': extendSelectionUp,
    'Shift-ArrowDown': extendSelectionDown,
    'ArrowUp': moveSelectionUp,
    'ArrowDown': moveSelectionDown,
    'Backspace': deleteSelectedBlocks,
    'Delete': deleteSelectedBlocks,
    'Enter': enterFromBlockSelection,
  });
}

// ============================================================================
// Decoration + State Plugin
// ============================================================================

/**
 * Create the block selection plugin.
 * Manages plugin state and per-block decorations.
 */
export function createBlockSelectionPlugin(): Plugin<BlockSelectionState> {
  return new Plugin<BlockSelectionState>({
    key: blockSelectionKey,

    state: {
      init(): BlockSelectionState {
        return emptyState();
      },

      apply(tr, prev, _oldState, newState): BlockSelectionState {
        const meta = tr.getMeta(BLOCK_SELECTION_META) as BlockSelectionState | undefined;
        if (meta) return meta;

        // If the document changed (typing, etc.), clear block selection
        // unless the transaction itself set block selection meta
        if (tr.docChanged && prev.selectedIds.length > 0) {
          return emptyState();
        }

        // If the user clicks or moves cursor (non-block-selection transaction),
        // clear block selection
        if (
          prev.selectedIds.length > 0 &&
          tr.selectionSet &&
          !tr.getMeta(BLOCK_SELECTION_META)
        ) {
          return emptyState();
        }

        return prev;
      },
    },

    props: {
      decorations(state): DecorationSet {
        const bsState = blockSelectionKey.getState(state) as BlockSelectionState | undefined;
        if (!bsState || bsState.selectedIds.length === 0) {
          return DecorationSet.empty;
        }

        const decorations: Decoration[] = [];
        const selectedSet = new Set(bsState.selectedIds);
        const isMulti = bsState.selectedIds.length > 1;
        const className = isMulti ? 'void-block--multi-selected' : 'void-block--selected';

        // Walk the doc to find matching blocks and create node decorations
        state.doc.descendants((node, pos) => {
          const blockId = node.attrs?.id;
          if (blockId && selectedSet.has(blockId)) {
            decorations.push(
              Decoration.node(pos, pos + node.nodeSize, {
                class: className,
              }),
            );
            selectedSet.delete(blockId);
            if (selectedSet.size === 0) return false;
          }
          return undefined;
        });

        return DecorationSet.create(state.doc, decorations);
      },

      // Block all typing when in block selection mode
      handleKeyDown(view, event) {
        const bsState = blockSelectionKey.getState(view.state) as BlockSelectionState | undefined;
        if (!bsState || bsState.selectedIds.length === 0) return false;

        // Allow modifier combos through (Cmd+C for copy, etc.)
        // Escape, arrows, Enter, Backspace, Delete are handled by the keymap
        if (event.metaKey || event.ctrlKey) return false;

        // Block printable character input in block selection mode
        if (event.key.length === 1 && !event.metaKey && !event.ctrlKey) {
          return true;
        }

        return false;
      },
    },

    view() {
      let lastEmittedIds: string[] = [];

      return {
        update(view) {
          const bsState = blockSelectionKey.getState(view.state) as BlockSelectionState | undefined;
          const currentIds = bsState?.selectedIds ?? [];

          // Emit event only when selection actually changed
          if (
            currentIds.length !== lastEmittedIds.length ||
            currentIds.some((id, i) => id !== lastEmittedIds[i])
          ) {
            lastEmittedIds = currentIds;
            events.emit('editor:block-selected', { blockIds: currentIds });
          }
        },
      };
    },
  });
}
