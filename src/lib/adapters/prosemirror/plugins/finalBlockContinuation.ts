import { Fragment, type Node as PmNode } from 'prosemirror-model';
import { NodeSelection, Plugin, TextSelection, type EditorState, type Transaction } from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';

import { generateBlockId } from '$lib/domain/entities/Block';

const CONTINUATION_BLOCK_TYPES = new Set([
  'paragraph',
  'heading',
  'listItem',
  'todoItem',
  'codeBlock',
  'protectedBlock',
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

export interface FinalBlockContinuationTarget {
  blockId: string;
  nodeType: string;
  node: PmNode;
  pos: number;
  nodeSize: number;
  widgetPos: number;
  insertPos: number;
  widgetElement: 'div' | 'li';
}

export interface FinalBlockContinuationWidgetOptions {
  title?: string;
  ariaLabel?: string;
  label?: string;
}

type FinalBlockContinuationPredicate = (
  target: FinalBlockContinuationTarget,
  state: EditorState
) => boolean;

export interface FinalBlockContinuationPluginOptions {
  shouldShowWidget?: FinalBlockContinuationPredicate;
  shouldHandleKey?: (
    target: FinalBlockContinuationTarget,
    state: EditorState,
    event: KeyboardEvent
  ) => boolean;
  widget?: FinalBlockContinuationWidgetOptions;
}

export function createFinalBlockContinuationPlugin(
  options: FinalBlockContinuationPluginOptions = {}
): Plugin {
  return new Plugin({
    props: {
      decorations(state): DecorationSet {
        const target = resolveFinalBlockContinuationTargetForDocumentEnd(state);
        if (!target) return DecorationSet.empty;

        const shouldShow = options.shouldShowWidget ?? ((candidate) =>
          isDefaultFinalBlockContinuationTarget(candidate));
        if (!shouldShow(target, state)) return DecorationSet.empty;

        return DecorationSet.create(state.doc, [
          Decoration.widget(
            target.widgetPos,
            (view) => createFinalBlockContinuationWidget(view, target, options.widget),
            {
              side: 1,
              key: `final-block-continuation-${target.blockId}-${target.widgetPos}`,
            }
          ),
        ]);
      },

      handleKeyDown(view: EditorView, event: KeyboardEvent): boolean {
        if (!shouldActivateFinalBlockContinuationFromKey(event)) return false;

        const target = resolveFinalBlockContinuationTargetForSelection(view.state);
        if (!target) return false;

        const shouldHandle = options.shouldHandleKey ?? ((candidate) =>
          isDefaultFinalBlockContinuationTarget(candidate));
        if (!shouldHandle(target, view.state, event)) return false;

        if (!insertFinalBlockContinuation(view, target)) return false;

        event.preventDefault();
        return true;
      },
    },
  });
}

export function isDefaultFinalBlockContinuationTarget(
  target: FinalBlockContinuationTarget
): boolean {
  return target.node.isLeaf || target.node.isAtom;
}

export function resolveFinalBlockContinuationTargetForDocumentEnd(
  state: EditorState
): FinalBlockContinuationTarget | null {
  const blocks = collectContinuationBlocks(state.doc);
  const target = blocks.at(-1) ?? null;
  return target ? targetIfFinal(blocks, target) : null;
}

export function resolveFinalBlockContinuationTargetForBlockId(
  state: EditorState,
  blockId: string
): FinalBlockContinuationTarget | null {
  const blocks = collectContinuationBlocks(state.doc);
  const direct = blocks.find((block) => block.blockId === blockId);
  const target = direct ?? findListItemOwnerForBlockId(state.doc, blocks, blockId);
  return target ? targetIfFinal(blocks, target) : null;
}

export function resolveFinalBlockContinuationTargetForRange(
  state: EditorState,
  from: number,
  to: number
): FinalBlockContinuationTarget | null {
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

export function resolveFinalBlockContinuationTargetForSelection(
  state: EditorState
): FinalBlockContinuationTarget | null {
  const { selection } = state;

  if (selection instanceof NodeSelection) {
    const blockId = selection.node.attrs.id as string | null;
    if (blockId) {
      const target = resolveFinalBlockContinuationTargetForBlockId(state, blockId);
      if (target) return target;
    }
  }

  return resolveFinalBlockContinuationTargetForRange(
    state,
    selection.from,
    selection.to
  );
}

export function buildFinalBlockContinuationTransaction(
  state: EditorState,
  target: FinalBlockContinuationTarget
): Transaction | null {
  const current = resolveFinalBlockContinuationTargetForBlockId(state, target.blockId);
  if (!current) return null;

  const paragraphType = state.schema.nodes.paragraph;
  if (!paragraphType) return null;

  let tr = state.tr;
  let selectionPos = current.insertPos + 1;

  if (current.nodeType === 'listItem') {
    const listItemType = state.schema.nodes.listItem;
    if (!listItemType) return null;

    const paragraph = paragraphType.create({ id: generateBlockId() });
    const listItem = listItemType.create(
      { id: generateBlockId() },
      Fragment.from(paragraph)
    );
    tr = tr.insert(current.insertPos, listItem);
    selectionPos = current.insertPos + 2;
  } else if (current.nodeType === 'todoItem') {
    const todoItemType = state.schema.nodes.todoItem;
    if (!todoItemType) return null;

    const todoItem = todoItemType.create({ id: generateBlockId(), checked: false });
    tr = tr.insert(current.insertPos, todoItem);
    selectionPos = current.insertPos + 1;
  } else {
    const paragraph = paragraphType.create({ id: generateBlockId() });
    tr = tr.insert(current.insertPos, paragraph);
    selectionPos = current.insertPos + 1;
  }

  return tr.setSelection(TextSelection.near(tr.doc.resolve(selectionPos)));
}

export function insertFinalBlockContinuation(
  view: EditorView,
  target: FinalBlockContinuationTarget
): boolean {
  const tr = buildFinalBlockContinuationTransaction(view.state, target);
  if (!tr) return false;

  view.dispatch(tr.scrollIntoView());
  view.focus();
  return true;
}

export function insertFinalBlockContinuationForBlockId(
  view: EditorView,
  blockId: string
): boolean {
  const target = resolveFinalBlockContinuationTargetForBlockId(view.state, blockId);
  return target ? insertFinalBlockContinuation(view, target) : false;
}

export function shouldActivateFinalBlockContinuationFromKey(
  event: KeyboardEvent
): boolean {
  if (event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) {
    return false;
  }

  return event.key === 'Enter' || event.key === 'ArrowDown';
}

export function createFinalBlockContinuationWidget(
  view: EditorView,
  target: FinalBlockContinuationTarget,
  options: FinalBlockContinuationWidgetOptions = {}
): HTMLElement {
  const row = document.createElement(target.widgetElement);
  row.className = 'void-final-continuation-row void-ai-continuation-row';
  if (target.widgetElement === 'li') {
    row.classList.add('void-final-continuation-row--list', 'void-ai-continuation-row--list');
  }
  row.setAttribute('contenteditable', 'false');

  const button = document.createElement('button');
  button.className = 'void-final-continuation-button void-ai-continuation-button';
  button.type = 'button';
  button.title = options.title ?? 'Continue writing below this block';
  button.setAttribute('aria-label', options.ariaLabel ?? 'Continue writing below this block');

  const icon = document.createElement('span');
  icon.className = 'void-final-continuation-icon void-ai-continuation-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = '+';

  const label = document.createElement('span');
  label.textContent = options.label ?? 'Continue writing';

  button.appendChild(icon);
  button.appendChild(label);

  button.addEventListener('mousedown', (event) => {
    event.preventDefault();
    event.stopPropagation();
  });

  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    insertFinalBlockContinuation(view, target);
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
): FinalBlockContinuationTarget | null {
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
    node: target.node,
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
