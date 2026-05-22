import { Fragment, type Node as PmNode } from 'prosemirror-model';
import { TextSelection, type EditorState } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

import { generateBlockId } from '$lib/domain/entities/Block';

const CONTINUATION_BLOCK_TYPES = new Set([
  'paragraph',
  'heading',
  'listItem',
  'todoItem',
  'codeBlock',
  'horizontalRule',
  'image',
]);

interface ContinuationAncestor {
  node: PmNode;
  pos: number;
  depth: number;
}

interface ContinuationBlock {
  blockId: string;
  node: PmNode;
  pos: number;
  depth: number;
  ancestors: ContinuationAncestor[];
}

export interface AIContinuationTarget {
  blockId: string;
  nodeType: string;
  pos: number;
  nodeSize: number;
  widgetPos: number;
  insertPos: number;
  widgetElement: 'div' | 'li';
}

export function resolveAIContinuationTargetForBlockId(
  state: EditorState,
  blockId: string
): AIContinuationTarget | null {
  const blocks = collectContinuationBlocks(state.doc);
  const direct = blocks.find((block) => block.blockId === blockId);
  const target = direct ?? findListItemOwnerForBlockId(state.doc, blocks, blockId);
  return target ? targetIfFinal(blocks, target) : null;
}

export function resolveAIContinuationTargetForRange(
  state: EditorState,
  from: number,
  to: number
): AIContinuationTarget | null {
  const blocks = collectContinuationBlocks(state.doc);
  const rangeFrom = Math.max(0, Math.min(from, to));
  const rangeTo = Math.min(state.doc.content.size, Math.max(from, to));

  const touched = blocks.filter((block) => {
    const blockFrom = block.pos;
    const blockTo = block.pos + block.node.nodeSize;
    if (rangeFrom === rangeTo) {
      return rangeFrom >= blockFrom && rangeFrom <= blockTo;
    }
    return blockFrom < rangeTo && blockTo > rangeFrom;
  });

  const target = touched.at(-1) ?? null;
  return target ? targetIfFinal(blocks, target) : null;
}

export function insertAIContinuation(view: EditorView, target: AIContinuationTarget): boolean {
  const current = resolveAIContinuationTargetForBlockId(view.state, target.blockId);
  if (!current) return false;

  const { state } = view;
  const paragraphType = state.schema.nodes.paragraph;
  if (!paragraphType) return false;

  let tr = state.tr;
  let selectionPos = current.insertPos + 1;

  if (current.nodeType === 'listItem') {
    const listItemType = state.schema.nodes.listItem;
    if (!listItemType) return false;

    const paragraph = paragraphType.create({ id: generateBlockId() });
    const listItem = listItemType.create(
      { id: generateBlockId() },
      Fragment.from(paragraph)
    );
    tr = tr.insert(current.insertPos, listItem);
    selectionPos = current.insertPos + 2;
  } else if (current.nodeType === 'todoItem') {
    const todoItemType = state.schema.nodes.todoItem;
    if (!todoItemType) return false;

    const todoItem = todoItemType.create({ id: generateBlockId(), checked: false });
    tr = tr.insert(current.insertPos, todoItem);
    selectionPos = current.insertPos + 1;
  } else {
    const paragraph = paragraphType.create({ id: generateBlockId() });
    tr = tr.insert(current.insertPos, paragraph);
    selectionPos = current.insertPos + 1;
  }

  tr = tr.setSelection(TextSelection.near(tr.doc.resolve(selectionPos)));
  view.dispatch(tr.scrollIntoView());
  view.focus();
  return true;
}

export function shouldActivateAIContinuationFromKey(
  view: EditorView,
  event: KeyboardEvent
): boolean {
  if (event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) {
    return false;
  }

  if (event.key === 'Enter') {
    return true;
  }

  if (event.key !== 'ArrowDown') {
    return false;
  }

  // A hard-locked AI block is not a normal text surface. The caret often
  // remains at the start of the protected text, so Down should express
  // "continue below" whenever the protected target is the final block.
  return true;
}

export function createAIContinuationWidget(
  view: EditorView,
  target: AIContinuationTarget
): HTMLElement {
  const row = document.createElement(target.widgetElement);
  row.className = 'void-ai-continuation-row';
  if (target.widgetElement === 'li') {
    row.classList.add('void-ai-continuation-row--list');
  }
  row.setAttribute('contenteditable', 'false');

  const button = document.createElement('button');
  button.className = 'void-ai-continuation-button';
  button.type = 'button';
  button.title = 'Continue writing below AI text';
  button.setAttribute('aria-label', 'Continue writing below AI text');

  const icon = document.createElement('span');
  icon.className = 'void-ai-continuation-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = '+';

  const label = document.createElement('span');
  label.textContent = 'Continue writing';

  button.appendChild(icon);
  button.appendChild(label);

  button.addEventListener('mousedown', (event) => {
    event.preventDefault();
    event.stopPropagation();
  });

  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    insertAIContinuation(view, target);
  });

  row.appendChild(button);
  return row;
}

function collectContinuationBlocks(doc: PmNode): ContinuationBlock[] {
  const result: ContinuationBlock[] = [];

  function walk(
    node: PmNode,
    pos: number,
    depth: number,
    ancestors: ContinuationAncestor[]
  ): void {
    const parent = ancestors.at(-1)?.node ?? null;
    const isListItemChildParagraph =
      node.type.name === 'paragraph' && parent?.type.name === 'listItem';
    const blockId = node.attrs.id as string | null;

    if (
      blockId &&
      CONTINUATION_BLOCK_TYPES.has(node.type.name) &&
      !isListItemChildParagraph
    ) {
      result.push({ blockId, node, pos, depth, ancestors });
    }

    const nextAncestors = [...ancestors, { node, pos, depth }];
    node.forEach((child, offset) => {
      walk(child, pos + 1 + offset, depth + 1, nextAncestors);
    });
  }

  doc.forEach((child, offset) => {
    walk(child, offset, 0, []);
  });

  return result;
}

function findListItemOwnerForBlockId(
  doc: PmNode,
  blocks: ContinuationBlock[],
  blockId: string
): ContinuationBlock | null {
  let ownerId: string | null = null;

  function walk(node: PmNode, ancestors: ContinuationAncestor[]): boolean {
    const parent = ancestors.at(-1)?.node ?? null;
    if (
      node.attrs.id === blockId &&
      node.type.name === 'paragraph' &&
      parent?.type.name === 'listItem'
    ) {
      ownerId = (parent.attrs.id as string | null) ?? null;
      return false;
    }

    const nextAncestors = [...ancestors, { node, pos: 0, depth: ancestors.length }];
    let keepGoing = true;
    node.forEach((child) => {
      if (!keepGoing) return;
      keepGoing = walk(child, nextAncestors);
    });
    return keepGoing;
  }

  walk(doc, []);
  return ownerId ? blocks.find((block) => block.blockId === ownerId) ?? null : null;
}

function targetIfFinal(
  blocks: ContinuationBlock[],
  target: ContinuationBlock
): AIContinuationTarget | null {
  const last = blocks.at(-1);
  if (!last || last.blockId !== target.blockId || last.pos !== target.pos) {
    return null;
  }

  const exitContainer = findExitContainer(target.ancestors);
  const insertPos = exitContainer && target.node.type.name !== 'listItem' && target.node.type.name !== 'todoItem'
    ? exitContainer.pos + exitContainer.node.nodeSize
    : target.pos + target.node.nodeSize;

  return {
    blockId: target.blockId,
    nodeType: target.node.type.name,
    pos: target.pos,
    nodeSize: target.node.nodeSize,
    widgetPos: insertPos,
    insertPos,
    widgetElement: target.node.type.name === 'listItem' ? 'li' : 'div',
  };
}

function findExitContainer(ancestors: ContinuationAncestor[]): ContinuationAncestor | null {
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const ancestor = ancestors[i]!;
    if (ancestor.node.type.name === 'blockquote' || ancestor.node.type.name === 'callout') {
      return ancestor;
    }
  }
  return null;
}
