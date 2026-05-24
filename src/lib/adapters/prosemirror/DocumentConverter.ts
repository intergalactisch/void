/**
 * DocumentConverter — pure translations between domain Documents and
 * ProseMirror nodes.
 *
 * Extracted from ProseMirrorAdapter so the adapter shell can focus on
 * editor lifecycle, plugins, commands, and event routing. Every helper
 * here is stateless and depends only on the void schema.
 *
 * The functions handle the entire round-trip:
 *
 *   Domain → PM:  domainToProseMirror, blockToPmNode, markToPmMark
 *   PM → Domain:  proseMirrorToDomain, pmNodeToBlock, pmMarkToMark,
 *                 nodeTypeToBlockType, buildBlockAttrs
 *
 * `cloneNodeWithNewIds` is the only mutation helper — it deep-copies a
 * PM subtree assigning fresh block IDs (used by duplicate-block).
 */

import { Fragment } from 'prosemirror-model';
import type { Node as PmNode, Mark as PmMark, NodeType } from 'prosemirror-model';

import type { Document } from '$lib/domain/entities/Document';
import type {
  Block,
  BlockAttrs,
  InlineSpan,
  TableCellData,
  TableRowData,
} from '$lib/domain/entities/Block';
import {
  generateBlockId,
  createEmptyParagraph,
} from '$lib/domain/entities/Block';
import type { BlockType } from '$lib/domain/values/BlockType';
import type { Mark, MarkType } from '$lib/domain/values/Mark';

import { voidSchema } from './schema';

// ─────────────────────────────────────────────────────────────────────
// Domain → ProseMirror
// ─────────────────────────────────────────────────────────────────────

/** Convert a domain Document to a ProseMirror document node. */
export function domainToProseMirror(document: Document): PmNode {
  const blocks = document.blocks.map((block) => blockToPmNode(block));

  const paragraphType = voidSchema.nodes.paragraph;
  const docType = voidSchema.nodes.doc;

  if (blocks.length === 0 && paragraphType) {
    blocks.push(paragraphType.create({ id: generateBlockId() }));
  }

  if (!docType) {
    throw new Error('Schema missing doc node type');
  }

  return docType.create(null, Fragment.from(blocks));
}

/** Convert a domain Block to a ProseMirror node. */
export function blockToPmNode(block: Block): PmNode {
  if (block.type === 'toggle') {
    return toggleBlockToPmNode(block);
  }
  if (block.type === 'table') {
    return tableBlockToPmNode(block);
  }

  const nodeType = getNodeTypeForBlockType(block.type);
  const paragraphType = voidSchema.nodes.paragraph;

  if (!nodeType) {
    if (!paragraphType) {
      throw new Error('Schema missing paragraph node type');
    }
    return paragraphType.create(
      { id: block.id },
      block.content ? voidSchema.text(block.content) : null
    );
  }

  const attrs: Record<string, unknown> = { id: block.id };

  if (block.type.startsWith('heading')) {
    attrs.level = parseInt(block.type.replace('heading', ''), 10);
  } else if (block.type === 'codeBlock' && block.attrs.type === 'codeBlock') {
    attrs.language = (block.attrs as { language?: string | null }).language ?? null;
    attrs.meta = (block.attrs as { meta?: string | null }).meta ?? null;
  } else if (block.type === 'todoItem' && block.attrs.type === 'todoItem') {
    attrs.checked = (block.attrs as { checked?: boolean }).checked;
  } else if (block.type === 'callout' && block.attrs.type === 'callout') {
    attrs.variant = (block.attrs as { variant?: string }).variant;
  } else if (block.type === 'image' && block.attrs.type === 'image') {
    const imageAttrs = block.attrs as {
      src?: string;
      alt?: string;
      title?: string;
      caption?: string;
      width?: number;
    };
    attrs.src = imageAttrs.src;
    attrs.alt = imageAttrs.alt;
    attrs.title = imageAttrs.title;
    attrs.caption = imageAttrs.caption;
    attrs.width = imageAttrs.width;
  }

  let content: PmNode | PmNode[] | null = null;

  if (block.type === 'codeBlock') {
    content = block.content ? [voidSchema.text(block.content)] : null;
  } else if (nodeType.spec.content?.includes('inline')) {
    const inlineContent = blockToInlinePmContent(block);
    content = inlineContent.length > 0 ? inlineContent : null;
  } else if (block.children.length > 0) {
    if (block.type === 'bulletList' || block.type === 'numberedList') {
      const listItemType = voidSchema.nodes.listItem;
      if (listItemType) {
        // Each list child is rendered as a listItem. If the child is a
        // paragraph block carrying its own `children` (continuation
        // paragraphs or nested lists captured by pmListItemNodeToBlock),
        // render the paragraph PLUS those children inside the same
        // listItem so the nested structure survives round-tripping.
        content = block.children.map((child) =>
          listItemFromListChild(child, listItemType),
        );
      } else {
        content = block.children.map((child) => blockToPmNode(child));
      }
    } else {
      content = block.children.map((child) => blockToPmNode(child));
    }
  } else if (block.type === 'blockquote' || block.type === 'callout') {
    content = paragraphType ? [paragraphType.create({ id: generateBlockId() })] : null;
  } else if (block.type === 'bulletList' || block.type === 'numberedList') {
    const listItemType = voidSchema.nodes.listItem;
    content = paragraphType && listItemType
      ? [listItemType.create(
          { id: generateBlockId() },
          Fragment.from([paragraphType.create({ id: generateBlockId() })]),
        )]
      : null;
  }

  return nodeType.create(attrs, content ? Fragment.from(content) : null);
}

/**
 * Wrap a single child of a bulletList/numberedList block in a ProseMirror
 * `listItem`. If the child is a paragraph block carrying its own children
 * (continuation paragraphs or nested lists, captured during the
 * pm→domain flatten), render those children alongside the paragraph
 * inside the same listItem so `- a\n  - nested` round-trips correctly.
 *
 * Schema reminder: `listItem: 'paragraph block*'` — first child must be
 * a paragraph, then zero or more block children.
 */
function listItemFromListChild(child: Block, listItemType: NodeType): PmNode {
  // Paragraph child: render the paragraph itself, then any post-paragraph
  // children (continuation paragraphs, nested lists) inside the same
  // listItem so the structure round-trips.
  if (child.type === 'paragraph') {
    const paragraphPm = blockToPmNode({ ...child, children: [] });
    if (child.children.length === 0) {
      return listItemType.create(
        { id: child.id || generateBlockId() },
        Fragment.from([paragraphPm]),
      );
    }
    const nestedPm = child.children
      .map((nested) => blockToPmNode(nested))
      .filter((n): n is PmNode => n !== null);
    return listItemType.create(
      { id: child.id || generateBlockId() },
      Fragment.from([paragraphPm, ...nestedPm]),
    );
  }

  const childPm = blockToPmNode(child);
  if (childPm.type.name === 'listItem') return childPm;

  // Schema requires `paragraph block*`; if the child is itself a block,
  // prefix with an empty paragraph so validation succeeds.
  const paragraphType = voidSchema.nodes.paragraph;
  if (paragraphType && childPm.type.spec.group?.includes('block')) {
    return listItemType.create(
      { id: generateBlockId() },
      Fragment.from([paragraphType.create({ id: generateBlockId() }), childPm]),
    );
  }
  return listItemType.create(
    { id: generateBlockId() },
    Fragment.from([childPm]),
  );
}

/** Convert a domain Mark to a ProseMirror mark. */
export function markToPmMark(mark: Mark): PmMark | null {
  const markType = voidSchema.marks[mark.type];
  if (!markType) return null;
  return markType.create(mark.attrs || {});
}

/** Map a domain BlockType to its ProseMirror NodeType (or null). */
export function getNodeTypeForBlockType(type: BlockType) {
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

// ─────────────────────────────────────────────────────────────────────
// ProseMirror → Domain
// ─────────────────────────────────────────────────────────────────────

/**
 * Convert a ProseMirror document to a domain Document. The caller
 * passes the existing Document so we preserve metadata; only the
 * blocks array and `isDirty` flag come from the editor state.
 */
export function proseMirrorToDomain(pmDoc: PmNode, base: Document): Document {
  const blocks: Block[] = [];

  pmDoc.forEach((node) => {
    const block = pmNodeToBlock(node);
    if (block) {
      blocks.push(block);
    }
  });

  return {
    ...base,
    blocks: blocks.length > 0 ? blocks : [createEmptyParagraph()],
    isDirty: true,
  };
}

/** Convert a ProseMirror node to a domain Block (or null). */
export function pmNodeToBlock(node: PmNode): Block | null {
  if (node.type.name === 'toggle') {
    return pmToggleNodeToBlock(node);
  }
  if (node.type.name === 'table') {
    return pmTableNodeToBlock(node);
  }
  if (node.type.name === 'listItem') {
    return pmListItemNodeToBlock(node);
  }

  const blockType = nodeTypeToBlockType(node);
  if (!blockType) return null;

  const id = (node.attrs.id as string) || generateBlockId();

  let content = '';
  const marks: Mark[] = [];
  let spans: InlineSpan[] | undefined;

  if (node.isTextblock) {
    const inline = pmTextblockToInlineData(node);
    content = inline.content;
    spans = inline.spans;
    marks.push(...inline.marks);
  }

  const children: Block[] = [];
  if (!node.isTextblock && node.childCount > 0) {
    node.forEach((child) => {
      const childBlock = pmNodeToBlock(child);
      if (childBlock) {
        children.push(childBlock);
      }
    });
  }

  const attrs = buildBlockAttrs(node, blockType);

  const block: Block = {
    id,
    type: blockType,
    content,
    marks,
    children,
    attrs,
  };
  if (spans && spans.length > 0) {
    block.spans = spans;
  }
  return block;
}

/** Map a ProseMirror node to a domain BlockType (or null). */
export function nodeTypeToBlockType(node: PmNode): BlockType | null {
  switch (node.type.name) {
    case 'paragraph':
      return 'paragraph';
    case 'heading':
      return `heading${node.attrs.level}` as BlockType;
    case 'bulletList':
      return 'bulletList';
    case 'orderedList':
      return 'numberedList';
    case 'listItem':
      // List items flatten into paragraph blocks; the parent bulletList /
      // orderedList carries the list structure. The actual flattening
      // (extract text from the listItem's first paragraph child) lives in
      // pmListItemNodeToBlock — pmNodeToBlock dispatches there before
      // falling through to this mapping, but we keep the case for any
      // caller that walks raw nodes.
      return 'paragraph';
    case 'todoItem':
      return 'todoItem';
    case 'blockquote':
      return 'blockquote';
    case 'codeBlock':
      return 'codeBlock';
    case 'horizontalRule':
      return 'horizontalRule';
    case 'callout':
      return 'callout';
    case 'image':
      return 'image';
    case 'toggle':
      return 'toggle';
    case 'table':
      return 'table';
    default:
      return null;
  }
}

/** Convert a ProseMirror mark to a domain Mark, ignoring unknown ones. */
export function pmMarkToMark(pmMark: PmMark): Mark | null {
  const type = pmMark.type.name as MarkType;

  const knownMarks: MarkType[] = [
    'bold',
    'italic',
    'underline',
    'strikethrough',
    'code',
    'link',
    'pageLink',
    'highlight',
  ];
  if (!knownMarks.includes(type)) return null;

  const mark: Mark = { type };
  if (Object.keys(pmMark.attrs).length > 0) {
    mark.attrs = { ...pmMark.attrs };
  }
  return mark;
}

/** Reconstruct the strongly-typed BlockAttrs union from a PM node. */
export function buildBlockAttrs(node: PmNode, blockType: BlockType): BlockAttrs {
  switch (blockType) {
    case 'heading1':
    case 'heading2':
    case 'heading3':
    case 'heading4':
    case 'heading5':
    case 'heading6':
      return {
        type: 'heading',
        level: node.attrs.level as 1 | 2 | 3 | 4 | 5 | 6,
      };
    case 'codeBlock':
      return {
        type: 'codeBlock',
        language: node.attrs.language as string | null,
        meta: node.attrs.meta as string | null,
      };
    case 'todoItem':
      return {
        type: 'todoItem',
        checked: node.attrs.checked as boolean,
      };
    case 'callout':
      return {
        type: 'callout',
        variant: node.attrs.variant as 'info' | 'warning' | 'error' | 'success',
      };
    case 'image':
      return {
        type: 'image',
        src: node.attrs.src as string,
        alt: node.attrs.alt as string | null,
        title: node.attrs.title as string | null,
        caption: node.attrs.caption as string | null,
        width: node.attrs.width as number | null,
      };
    case 'toggle':
      return {
        type: 'toggle',
        open: Boolean(node.attrs.open),
      };
    case 'table':
      return {
        type: 'table',
        rows: [],
      };
    default:
      return { type: blockType };
  }
}

// ─────────────────────────────────────────────────────────────────────
// Mutation helpers
// ─────────────────────────────────────────────────────────────────────

/**
 * Deep-clone a PM subtree, assigning a fresh block ID to every node
 * that carries one. Used by the duplicate-block command.
 */
export function cloneNodeWithNewIds(node: PmNode): PmNode {
  if (node.isText) return node;

  const attrs = node.attrs?.id
    ? { ...node.attrs, id: generateBlockId() }
    : node.attrs;

  const children: PmNode[] = [];
  node.forEach((child) => {
    children.push(cloneNodeWithNewIds(child));
  });

  return node.type.create(attrs, Fragment.from(children), node.marks);
}

function blockToInlinePmContent(block: Block): PmNode[] {
  if (block.spans && block.spans.length > 0) {
    return block.spans
      .map((span) => inlineSpanToPmNodes(span))
      .flat();
  }

  if (!block.content) return [];

  const marks = block.marks
    .map((m) => markToPmMark(m))
    .filter(Boolean) as PmMark[];
  return [voidSchema.text(block.content, marks)];
}

function inlineDataToPmNodes(
  content: string,
  spans: InlineSpan[] | undefined,
  marks: Mark[] = [],
): PmNode[] {
  if (spans && spans.length > 0) {
    return spans.map((span) => inlineSpanToPmNodes(span)).flat();
  }

  if (!content) return [];

  const pmMarks = marks
    .map((mark) => markToPmMark(mark))
    .filter(Boolean) as PmMark[];
  return [voidSchema.text(content, pmMarks)];
}

function inlineSpanToPmNodes(span: InlineSpan): PmNode[] {
  const hardBreakType = voidSchema.nodes.hardBreak;
  const marks = span.marks
    .map((m) => markToPmMark(m))
    .filter(Boolean) as PmMark[];

  const parts = span.text.split('\n');
  const nodes: PmNode[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part) {
      nodes.push(voidSchema.text(part, marks));
    }
    if (i < parts.length - 1 && hardBreakType) {
      nodes.push(hardBreakType.create());
    }
  }
  return nodes;
}

function pmTextblockToInlineData(node: PmNode): {
  content: string;
  marks: Mark[];
  spans: InlineSpan[];
} {
  const spans: InlineSpan[] = [];
  const marks: Mark[] = [];

  node.forEach((child) => {
    if (child.isText) {
      const childMarks = child.marks
        .map((pmMark) => pmMarkToMark(pmMark))
        .filter(Boolean) as Mark[];
      const text = child.text ?? '';
      if (text) {
        spans.push({ text, marks: childMarks });
      }
      for (const mark of childMarks) {
        if (!marks.some((m) => marksEqual(m, mark))) {
          marks.push(mark);
        }
      }
    } else if (child.type.name === 'hardBreak') {
      spans.push({ text: '\n', marks: [] });
    }
  });

  return {
    content: spans.map((span) => span.text).join(''),
    marks,
    spans,
  };
}

function marksEqual(a: Mark, b: Mark): boolean {
  return a.type === b.type && JSON.stringify(a.attrs ?? {}) === JSON.stringify(b.attrs ?? {});
}

function toggleBlockToPmNode(block: Block): PmNode {
  const toggleType = voidSchema.nodes.toggle;
  const summaryType = voidSchema.nodes.toggleSummary;
  const contentType = voidSchema.nodes.toggleContent;
  const paragraphType = voidSchema.nodes.paragraph;

  if (!toggleType || !summaryType || !contentType || !paragraphType) {
    throw new Error('Schema missing toggle node types');
  }

  const summaryContent = blockToInlinePmContent(block);
  const summary = summaryType.create(
    null,
    summaryContent.length > 0 ? Fragment.from(summaryContent) : null,
  );

  const children = block.children.length > 0
    ? block.children.map((child) => blockToPmNode(child))
    : [paragraphType.create({ id: generateBlockId() })];
  const body = contentType.create(null, Fragment.from(children));

  return toggleType.create(
    {
      id: block.id,
      open: block.attrs.type === 'toggle'
        ? Boolean((block.attrs as { open?: boolean }).open)
        : false,
    },
    Fragment.from([summary, body]),
  );
}

function tableBlockToPmNode(block: Block): PmNode {
  const tableType = voidSchema.nodes.table;
  const rowType = voidSchema.nodes.tableRow;
  const cellType = voidSchema.nodes.tableCell;
  const headerType = voidSchema.nodes.tableHeader;
  const paragraphType = voidSchema.nodes.paragraph;

  if (!tableType || !rowType || !cellType || !headerType || !paragraphType) {
    throw new Error('Schema missing table node types');
  }

  const tableRows = block.attrs.type === 'table'
    ? (block.attrs as { rows?: TableRowData[] }).rows
    : undefined;
  const rows: TableRowData[] = tableRows && tableRows.length > 0
    ? tableRows
    : createDefaultTableRows();

  const rowNodes = rows.map((row) => {
    const cells = row.cells.length > 0 ? row.cells : [{ content: '' }];
    const cellNodes = cells.map((cell) => {
      const nodeType = cell.header ? headerType : cellType;
      const paragraph = paragraphType.create(
        { id: generateBlockId() },
        Fragment.from(inlineDataToPmNodes(cell.content, cell.spans)),
      );

      return nodeType.create(
        {
          id: generateBlockId(),
          colspan: cell.colspan ?? 1,
          rowspan: cell.rowspan ?? 1,
        },
        Fragment.from([paragraph]),
      );
    });

    return rowType.create({ id: generateBlockId() }, Fragment.from(cellNodes));
  });

  return tableType.create({ id: block.id }, Fragment.from(rowNodes));
}

function createDefaultTableRows(): TableRowData[] {
  return [
    {
      cells: [
        { content: '', header: true },
        { content: '', header: true },
      ],
    },
    {
      cells: [
        { content: '' },
        { content: '' },
      ],
    },
  ];
}

/**
 * Convert a ProseMirror `listItem` to a domain paragraph block.
 *
 * Schema: `listItem: 'paragraph block*'`. The first paragraph holds the
 * inline text shown next to the bullet/number. Flatten that into the
 * paragraph block's `content`/`spans`. Trailing children (continuation
 * paragraphs, nested lists) are kept in `children` so they survive a
 * load round-trip — note that `blockToPmNode` does not yet rebuild
 * those from a paragraph's children, so editor-side editing of nested
 * lists is still lossy. Out of scope for the current bug fix.
 */
function pmListItemNodeToBlock(node: PmNode): Block {
  const id = (node.attrs.id as string) || generateBlockId();
  const firstChild = node.firstChild;

  let content = '';
  const marks: Mark[] = [];
  let spans: InlineSpan[] | undefined;

  if (firstChild && firstChild.isTextblock) {
    const inline = pmTextblockToInlineData(firstChild);
    content = inline.content;
    spans = inline.spans;
    marks.push(...inline.marks);
  }

  const children: Block[] = [];
  for (let i = 1; i < node.childCount; i++) {
    const childBlock = pmNodeToBlock(node.child(i));
    if (childBlock) children.push(childBlock);
  }

  const block: Block = {
    id,
    type: 'paragraph',
    content,
    marks,
    children,
    attrs: { type: 'paragraph' },
  };
  if (spans && spans.length > 0) block.spans = spans;
  return block;
}

function pmToggleNodeToBlock(node: PmNode): Block {
  const id = (node.attrs.id as string) || generateBlockId();
  const summaryNode = node.childCount > 0 ? node.child(0) : null;
  const contentNode = node.childCount > 1 ? node.child(1) : null;
  const inline = summaryNode ? pmTextblockToInlineData(summaryNode) : { content: '', marks: [], spans: [] };

  const children: Block[] = [];
  contentNode?.forEach((child) => {
    const childBlock = pmNodeToBlock(child);
    if (childBlock) children.push(childBlock);
  });

  const block: Block = {
    id,
    type: 'toggle',
    content: inline.content,
    marks: inline.marks,
    children,
    attrs: {
      type: 'toggle',
      open: Boolean(node.attrs.open),
    },
  };
  if (inline.spans.length > 0) {
    block.spans = inline.spans;
  }
  return block;
}

function pmTableNodeToBlock(node: PmNode): Block {
  const rows: TableRowData[] = [];

  node.forEach((rowNode) => {
    const cells: TableCellData[] = [];
    rowNode.forEach((cellNode) => {
      const paragraph = cellNode.firstChild;
      const inline = paragraph
        ? pmTextblockToInlineData(paragraph)
        : { content: cellNode.textContent, marks: [], spans: [] };

      const cell: TableCellData = {
        content: inline.content,
      };
      if (inline.spans.length > 0) cell.spans = inline.spans;
      if (cellNode.type.name === 'tableHeader') cell.header = true;
      if (cellNode.attrs.colspan && cellNode.attrs.colspan !== 1) {
        cell.colspan = cellNode.attrs.colspan as number;
      }
      if (cellNode.attrs.rowspan && cellNode.attrs.rowspan !== 1) {
        cell.rowspan = cellNode.attrs.rowspan as number;
      }
      cells.push(cell);
    });
    rows.push({ cells });
  });

  return {
    id: (node.attrs.id as string) || generateBlockId(),
    type: 'table',
    content: rows.map((row) => row.cells.map((cell) => cell.content).join('\t')).join('\n'),
    marks: [],
    children: [],
    attrs: {
      type: 'table',
      rows,
    },
  };
}
