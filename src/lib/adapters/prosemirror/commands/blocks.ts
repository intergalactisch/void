/**
 * Block Manipulation Commands
 *
 * ProseMirror commands for manipulating blocks in the editor.
 * These commands provide the infrastructure implementation for block operations
 * defined in the EditorPort interface.
 *
 * Part of the ProseMirror infrastructure adapter.
 */

import type { Command } from 'prosemirror-state';
import type { EditorState, Transaction } from 'prosemirror-state';
import { Selection, TextSelection } from 'prosemirror-state';
import type { Node as PmNode, NodeType, Schema } from 'prosemirror-model';
import { setBlockType as pmSetBlockType, liftEmptyBlock, wrapIn } from 'prosemirror-commands';
import { generateBlockId } from '$lib/domain/entities/Block';
import type { BlockType } from '$lib/domain/values/BlockType';
import { toggleList } from './lists';

/**
 * Insert a new block after the current block.
 *
 * @param nodeType - The ProseMirror node type to insert
 * @param attrs - Optional attributes for the new block
 * @returns ProseMirror command
 */
export function insertBlockAfter(nodeType: NodeType, attrs?: Record<string, unknown>): Command {
  return (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
    const { $from } = state.selection;

    // Find the block containing the selection
    let blockEnd = $from.after(1);

    // If we're deeper than depth 1, find the nearest block
    if ($from.depth > 1) {
      for (let d = $from.depth; d >= 1; d--) {
        const node = $from.node(d);
        if (node.type.spec.group?.includes('block')) {
          blockEnd = $from.after(d);
          break;
        }
      }
    }

    // Create the new block with a unique ID
    const newAttrs = { ...attrs, id: generateBlockId() };
    const newBlock = nodeType.create(newAttrs);

    if (dispatch) {
      const tr = state.tr.insert(blockEnd, newBlock);
      // Position cursor at the start of the new block
      const newSelection = Selection.near(tr.doc.resolve(blockEnd + 1));
      tr.setSelection(newSelection);
      dispatch(tr.scrollIntoView());
    }

    return true;
  };
}

/**
 * Delete a block by its ID.
 *
 * @param blockId - The ID of the block to delete
 * @returns ProseMirror command
 */
export function deleteBlock(blockId: string): Command {
  return (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
    let found = false;
    let deleteFrom = 0;
    let deleteTo = 0;

    // Find the block with the given ID
    state.doc.descendants((node, pos) => {
      if (found) return false;
      if (node.attrs.id === blockId) {
        found = true;
        deleteFrom = pos;
        deleteTo = pos + node.nodeSize;
        return false;
      }
      return true;
    });

    if (!found) return false;

    // Ensure we don't delete the last block
    if (state.doc.childCount === 1) {
      // Replace with empty paragraph instead of deleting
      if (dispatch) {
        const paragraphType = state.schema.nodes.paragraph;
        if (paragraphType) {
          const paragraph = paragraphType.create({ id: generateBlockId() });
          const tr = state.tr.replaceWith(deleteFrom, deleteTo, paragraph);
          dispatch(tr.scrollIntoView());
        }
      }
      return true;
    }

    if (dispatch) {
      const tr = state.tr.delete(deleteFrom, deleteTo);
      dispatch(tr.scrollIntoView());
    }

    return true;
  };
}

/**
 * Move a block up (swap with previous sibling).
 *
 * @param blockId - The ID of the block to move
 * @returns ProseMirror command
 */
export function moveBlockUp(blockId: string): Command {
  return (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
    let blockPos = -1;
    let blockIndex = -1;
    let blockNodeSize = 0;
    let foundBlock: PmNode | null = null;

    // Find the block using forEach with proper typing
    let index = 0;
    state.doc.forEach((node: PmNode, pos: number) => {
      if (node.attrs.id === blockId) {
        blockPos = pos;
        blockIndex = index;
        blockNodeSize = node.nodeSize;
        foundBlock = node;
      }
      index++;
    });

    if (blockPos === -1 || blockIndex === 0 || !foundBlock) {
      return false; // Block not found or already at top
    }

    // Find previous block
    let prevBlockPos = 0;
    let prevIndex = 0;
    state.doc.forEach((node: PmNode, pos: number) => {
      if (prevIndex === blockIndex - 1) {
        prevBlockPos = pos;
      }
      prevIndex++;
    });

    if (dispatch) {
      const tr = state.tr;
      // Delete current block
      tr.delete(blockPos, blockPos + blockNodeSize);
      // Insert before previous block (adjusted position after deletion)
      tr.insert(prevBlockPos, foundBlock);
      dispatch(tr.scrollIntoView());
    }

    return true;
  };
}

/**
 * Move a block down (swap with next sibling).
 *
 * @param blockId - The ID of the block to move
 * @returns ProseMirror command
 */
export function moveBlockDown(blockId: string): Command {
  return (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
    let blockPos = -1;
    let blockIndex = -1;
    let blockNodeSize = 0;
    let foundBlock: PmNode | null = null;
    const totalBlocks = state.doc.childCount;

    // Find the block using forEach with proper typing
    let index = 0;
    state.doc.forEach((node: PmNode, pos: number) => {
      if (node.attrs.id === blockId) {
        blockPos = pos;
        blockIndex = index;
        blockNodeSize = node.nodeSize;
        foundBlock = node;
      }
      index++;
    });

    if (blockPos === -1 || blockIndex === totalBlocks - 1 || !foundBlock) {
      return false; // Block not found or already at bottom
    }

    // Find next block
    let nextBlockPos = 0;
    let nextBlockNodeSize = 0;
    let nextIndex = 0;
    state.doc.forEach((node: PmNode, pos: number) => {
      if (nextIndex === blockIndex + 1) {
        nextBlockPos = pos;
        nextBlockNodeSize = node.nodeSize;
      }
      nextIndex++;
    });

    if (nextBlockNodeSize === 0) return false;

    if (dispatch) {
      const tr = state.tr;
      // Insert current block after next block
      const insertPos = nextBlockPos + nextBlockNodeSize;
      tr.insert(insertPos, foundBlock);
      // Delete original block
      tr.delete(blockPos, blockPos + blockNodeSize);
      dispatch(tr.scrollIntoView());
    }

    return true;
  };
}

/**
 * Set the block type of the block containing the selection.
 *
 * @param nodeType - The target ProseMirror node type
 * @param attrs - Optional attributes for the new block type
 * @returns ProseMirror command
 */
export function setBlockType(nodeType: NodeType, attrs?: Record<string, unknown>): Command {
  return pmSetBlockType(nodeType, attrs);
}

/**
 * Convert domain BlockType to ProseMirror setBlockType command.
 * This maps our domain block types to ProseMirror commands.
 *
 * @param schema - The ProseMirror schema
 * @param blockType - The domain block type
 * @returns ProseMirror command or null if type not supported
 */
export function setBlockTypeFromDomain(
  schema: Schema,
  blockType: BlockType
): Command | null {
  const paragraph = schema.nodes.paragraph;
  const heading = schema.nodes.heading;
  const codeBlock = schema.nodes.codeBlock;

  switch (blockType) {
    case 'paragraph':
      return paragraph ? setBlockType(paragraph) : null;
    case 'heading1':
      return heading ? setBlockType(heading, { level: 1 }) : null;
    case 'heading2':
      return heading ? setBlockType(heading, { level: 2 }) : null;
    case 'heading3':
      return heading ? setBlockType(heading, { level: 3 }) : null;
    case 'heading4':
      return heading ? setBlockType(heading, { level: 4 }) : null;
    case 'heading5':
      return heading ? setBlockType(heading, { level: 5 }) : null;
    case 'heading6':
      return heading ? setBlockType(heading, { level: 6 }) : null;
    case 'codeBlock':
      return codeBlock ? setBlockType(codeBlock) : null;
    case 'bulletList':
      return toggleList(schema, 'bulletList');
    case 'numberedList':
      return toggleList(schema, 'orderedList');
    case 'todoItem': {
      const todoItem = schema.nodes.todoItem;
      return todoItem ? setBlockType(todoItem, { checked: false }) : null;
    }
    case 'blockquote': {
      const blockquote = schema.nodes.blockquote;
      return blockquote ? wrapIn(blockquote) : null;
    }
    case 'callout': {
      const callout = schema.nodes.callout;
      return callout ? wrapIn(callout, { variant: 'info' }) : null;
    }
    default:
      return null;
  }
}

/**
 * Lift an empty block out of its parent (e.g., list item).
 * Useful for exiting nested structures.
 */
export const liftBlock: Command = liftEmptyBlock;

/**
 * Insert a horizontal rule at the current position.
 */
export function insertHorizontalRule(): Command {
  return (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
    const { $from } = state.selection;
    const hrType = state.schema.nodes.horizontalRule;

    if (!hrType) return false;

    const blockEnd = $from.after(1);
    const hr = hrType.create({ id: generateBlockId() });

    if (dispatch) {
      const tr = state.tr.insert(blockEnd, hr);
      dispatch(tr.scrollIntoView());
    }

    return true;
  };
}

/**
 * Split the current block at the cursor position.
 * Creates a new block of the same type with the content after the cursor.
 */
export function splitBlock(): Command {
  return (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
    const { $from, $to } = state.selection;

    // Don't split if there's a selection
    if ($from.pos !== $to.pos) return false;

    const paragraphType = state.schema.nodes.paragraph;
    if (paragraphType) {
      const exitedContainer = exitContainerAtEnd(state, dispatch, paragraphType);
      if (exitedContainer) return true;

      const splitSpecial = splitTextblockToParagraph(state, dispatch, paragraphType);
      if (splitSpecial) return true;
    }

    const parentNode = $from.parent;

    // Create new block ID for the split block
    const newAttrs = { ...parentNode.attrs, id: generateBlockId() };

    if (dispatch) {
      const tr = state.tr.split($from.pos, 1, [{ type: parentNode.type, attrs: newAttrs }]);
      dispatch(tr.scrollIntoView());
    }

    return true;
  };
}

/**
 * Headings should create a normal paragraph on Enter. Empty headings are
 * converted in-place so the editor does not leave a blank heading behind.
 */
function splitTextblockToParagraph(
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
  paragraphType: NodeType
): boolean {
  const { $from } = state.selection;
  const parentNode = $from.parent;
  if (parentNode.type.name !== 'heading') return false;

  if (dispatch) {
    if (parentNode.content.size === 0) {
      const blockStart = $from.before($from.depth);
      const tr = state.tr
        .setNodeMarkup(blockStart, paragraphType, { id: generateBlockId() });
      tr.setSelection(TextSelection.create(tr.doc, $from.pos));
      dispatch(tr.scrollIntoView());
      return true;
    }

    const tr = state.tr.split($from.pos, 1, [
      { type: paragraphType, attrs: { id: generateBlockId() } },
    ]);
    dispatch(tr.scrollIntoView());
  }

  return true;
}

/**
 * Pressing Enter at the end of a callout or quote exits the container and
 * creates a regular paragraph after it. Empty trailing paragraphs are removed
 * as part of the exit, matching the "break out" behavior users expect.
 */
function exitContainerAtEnd(
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
  paragraphType: NodeType
): boolean {
  const { $from } = state.selection;
  const parentNode = $from.parent;
  if (parentNode.type.name !== 'paragraph') return false;
  if ($from.parentOffset !== parentNode.content.size) return false;

  let containerDepth = -1;
  for (let depth = $from.depth - 1; depth >= 1; depth--) {
    const nodeName = $from.node(depth).type.name;
    if (nodeName === 'callout' || nodeName === 'blockquote') {
      containerDepth = depth;
      break;
    }
  }
  if (containerDepth === -1) return false;

  const container = $from.node(containerDepth);
  const childIndex = $from.index(containerDepth);
  if (childIndex !== container.childCount - 1) return false;

  if (dispatch) {
    const newParagraph = paragraphType.create({ id: generateBlockId() });
    const tr = state.tr;

    if (parentNode.content.size === 0) {
      if (container.childCount === 1) {
        const containerStart = $from.before(containerDepth);
        const containerEnd = $from.after(containerDepth);
        tr.replaceWith(containerStart, containerEnd, newParagraph);
        tr.setSelection(TextSelection.create(tr.doc, containerStart + 1));
      } else {
        const paragraphStart = $from.before($from.depth);
        const paragraphEnd = $from.after($from.depth);
        const containerEnd = $from.after(containerDepth);
        tr.delete(paragraphStart, paragraphEnd);
        const insertPos = tr.mapping.map(containerEnd);
        tr.insert(insertPos, newParagraph);
        tr.setSelection(TextSelection.create(tr.doc, insertPos + 1));
      }
    } else {
      const insertPos = $from.after(containerDepth);
      tr.insert(insertPos, newParagraph);
      tr.setSelection(TextSelection.create(tr.doc, insertPos + 1));
    }

    dispatch(tr.scrollIntoView());
  }

  return true;
}
