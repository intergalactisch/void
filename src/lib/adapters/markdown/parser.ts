/**
 * Markdown Parser
 *
 * Converts markdown strings to ProseMirror documents.
 * Uses markdown-it for parsing markdown syntax, then converts
 * the token stream into ProseMirror nodes.
 *
 * Part of the Markdown infrastructure adapter.
 */

import MarkdownIt from 'markdown-it';
import type { Node as ProseMirrorNode, Schema, Mark } from 'prosemirror-model';
import { voidSchema } from '$lib/adapters/prosemirror/schema';
import { generateBlockId } from '$lib/domain/entities/Block';
import { parseCodeFenceInfo, renderCodeFenceHtml } from '$lib/core/codeFence';

const PROTECTED_LINES_FENCE = 'void-protected-lines-v1';

/**
 * Configure markdown-it with appropriate options
 */
const renderMd = new MarkdownIt({
  html: false, // Disable HTML for security
  breaks: false, // Don't convert \n to <br>
  linkify: true, // Auto-detect URLs
});

renderMd.renderer.rules.fence = (tokens, idx) => {
  const token = tokens[idx];
  if (!token) return '';
  return renderCodeFenceHtml(token.content, token.info);
};

const md = new MarkdownIt({
  html: true, // Parse Markdown-compatible HTML so we can preserve/round-trip it safely.
  breaks: false,
  linkify: true,
});

/**
 * Render markdown to HTML string for preview purposes.
 * Uses the same configured markdown-it instance.
 *
 * @param markdown - The markdown string to render
 * @returns HTML string
 */
export function renderMarkdownToHtml(markdown: string): string {
  return renderMd.render(markdown);
}

/**
 * Custom markdown-it plugin for wiki-style [[links]]
 * Supports:
 * - [[note title]] - link using title as both display text and path
 * - [[path/to/note|display text]] - link with custom display text
 * - [[display text|path/to/note]] - legacy compatibility when the right side looks like a path
 */
function wikiLinkPlugin(mdInstance: MarkdownIt): void {
  // Add inline rule for [[...]]
  mdInstance.inline.ruler.push('wiki_link', (state, silent) => {
    const start = state.pos;
    const max = state.posMax;

    // Check for opening [[
    if (state.src.charCodeAt(start) !== 0x5b /* [ */ ||
        state.src.charCodeAt(start + 1) !== 0x5b /* [ */) {
      return false;
    }

    // Find closing ]]
    let end = start + 2;
    while (end < max && !(state.src.charCodeAt(end) === 0x5d /* ] */ &&
                          state.src.charCodeAt(end + 1) === 0x5d /* ] */)) {
      end++;
    }

    if (end >= max) {
      return false; // No closing ]] found
    }

    // Extract content between [[ and ]]
    const content = state.src.slice(start + 2, end);
    if (!content) {
      return false;
    }

    // Parse content: "target|alias" (Obsidian/Bear-style) or just "title".
    // Keep compatibility with the older local "display|path" interpretation
    // when the right side is obviously a path.
    let displayText: string;
    let href: string;

    const pipeIndex = content.indexOf('|');
    if (pipeIndex !== -1) {
      const left = content.slice(0, pipeIndex);
      const right = content.slice(pipeIndex + 1);
      if (looksLikePath(right) && !looksLikePath(left)) {
        displayText = left;
        href = right;
      } else {
        href = left;
        displayText = right;
      }
    } else {
      displayText = content;
      href = content; // Use the title as the path reference
    }

    if (!silent) {
      // Create opening token for page link
      let token = state.push('page_link_open', 'a', 1);
      token.attrs = [
        ['href', href],
        ['data-page-link', 'true'],
        ['class', 'void-page-link'],
      ];
      if (displayText !== href) {
        token.attrs.push(['title', displayText]);
      }

      // Create text token
      token = state.push('text', '', 0);
      token.content = displayText;

      // Create closing token
      state.push('page_link_close', 'a', -1);
    }

    state.pos = end + 2; // Move past ]]
    return true;
  });
}

// Apply wiki link plugin
wikiLinkPlugin(md);
wikiLinkPlugin(renderMd);

function looksLikePath(value: string): boolean {
  return /[/.#^]/.test(value) || value.endsWith('.md');
}

/**
 * Token type from markdown-it
 */
interface Token {
  type: string;
  tag: string;
  nesting: number;
  level: number;
  children: Token[] | null;
  content: string;
  markup: string;
  info: string;
  meta: unknown;
  block: boolean;
  hidden: boolean;
  attrs: [string, string][] | null;
  /** Source line range [startLine, endLine) for block tokens; null for inline/closing tokens. */
  map: [number, number] | null;
}

/**
 * Parse a markdown string into a ProseMirror document
 * @param markdown - The markdown string to parse
 * @param schema - Optional custom schema (defaults to voidSchema)
 * @returns A ProseMirror document node
 */
export function parseMarkdown(markdown: string, schema: Schema = voidSchema): ProseMirrorNode {
  const normalizedMarkdown = normalizeProtectedLineCapsules(markdown);

  // Parse markdown into tokens
  const tokens = md.parse(normalizedMarkdown, {});

  // Convert tokens to ProseMirror nodes
  const blocks = parseTokens(tokens, schema);

  // Ensure at least one block
  if (blocks.length === 0) {
    const paragraphType = schema.nodes['paragraph'];
    if (paragraphType) {
      // Create empty paragraph without content (empty text nodes are not allowed)
      blocks.push(paragraphType.create({ id: generateBlockId() }));
    }
  }

  // Create and return the document
  const docType = schema.nodes['doc'];
  if (!docType) {
    throw new Error('Schema must have a doc node type');
  }
  return docType.create(null, blocks);
}

function normalizeProtectedLineCapsules(markdown: string): string {
  return markdown.replace(
    new RegExp(`(^|\\n)> Locked encrypted lines[^\\n]*\\s*\\\`\\\`\\\`${PROTECTED_LINES_FENCE}\\s*\\n?([\\s\\S]*?)\\n?\\\`\\\`\\\`(?=\\n|$)`, 'g'),
    (_match, prefix: string, envelope: string) =>
      `${prefix}\`\`\`${PROTECTED_LINES_FENCE}\n${envelope.trim()}\n\`\`\``,
  );
}

/**
 * Parse markdown-it tokens into ProseMirror nodes
 */
function parseTokens(tokens: Token[], schema: Schema): ProseMirrorNode[] {
  const blocks: ProseMirrorNode[] = [];
  const paragraphType = schema.nodes['paragraph'];
  let i = 0;
  let prevEndLine: number | null = null; // .map[1] (end line, exclusive) of the previous top-level block

  while (i < tokens.length) {
    const token = tokens[i];
    if (!token) {
      i++;
      continue;
    }

    // Reconstruct empty paragraphs the user inserted as blank lines. markdown-it emits
    // no token for a blank line, but block tokens carry a source line range, so the gap
    // to the previous block reveals them: adjacent blocks are 1 line apart (the single
    // separating blank line), and each extra blank line is one empty paragraph. The first
    // block's reference is its own start, so no leading empties are invented (the loader
    // trims the body anyway). Top-level only — nested gaps are ambiguous and out of scope.
    if (paragraphType && token.map) {
      const reference = prevEndLine ?? token.map[0];
      const emptyCount = Math.max(0, token.map[0] - reference - 1);
      for (let k = 0; k < emptyCount; k++) {
        blocks.push(paragraphType.create({ id: generateBlockId() }));
      }
    }

    const result = parseBlock(tokens, i, schema);
    if (result.nodes) {
      blocks.push(...result.nodes);
    } else if (result.node) {
      blocks.push(result.node);
    }

    if (token.map) {
      prevEndLine = token.map[1];
    }
    i = result.nextIndex;
  }

  return blocks;
}

/**
 * Parse a single block starting at the given index
 */
function parseBlock(
  tokens: Token[],
  index: number,
  schema: Schema
): { node: ProseMirrorNode | null; nodes?: ProseMirrorNode[]; nextIndex: number } {
  const token = tokens[index];
  if (!token) {
    return { node: null, nextIndex: index + 1 };
  }

  switch (token.type) {
    case 'paragraph_open':
      return parseParagraph(tokens, index, schema);

    case 'heading_open':
      return parseHeading(tokens, index, schema);

    case 'bullet_list_open':
      return parseBulletList(tokens, index, schema);

    case 'ordered_list_open':
      return parseOrderedList(tokens, index, schema);

    case 'blockquote_open':
      return parseBlockquote(tokens, index, schema);

    case 'fence':
      return parseCodeBlock(tokens, index, schema);

    case 'code_block':
      return parseCodeBlock(tokens, index, schema);

    case 'hr':
      return parseHorizontalRule(tokens, index, schema);

    case 'table_open':
      return parseTable(tokens, index, schema);

    case 'image':
      return parseImage(tokens, index, schema);

    case 'html_block':
      if (/^\s*<details\b/i.test(token.content)) {
        return parseToggle(tokens, index, schema);
      }
      return parseHtmlBlock(tokens, index, schema);

    default:
      // Skip unknown tokens
      return { node: null, nextIndex: index + 1 };
  }
}

/**
 * Parse a GitHub-style pipe table.
 */
function parseTable(
  tokens: Token[],
  index: number,
  schema: Schema
): { node: ProseMirrorNode; nextIndex: number } {
  const tableType = schema.nodes['table'];
  const rowType = schema.nodes['tableRow'];
  const cellType = schema.nodes['tableCell'];
  const headerType = schema.nodes['tableHeader'];
  const paragraphType = schema.nodes['paragraph'];

  if (!tableType || !rowType || !cellType || !headerType || !paragraphType) {
    throw new Error('Schema must have table node types');
  }

  const closeIndex = findClosingToken(tokens, index, 'table_close');
  const rows: ProseMirrorNode[] = [];
  let i = index + 1;

  while (i < closeIndex) {
    const token = tokens[i];
    if (token?.type !== 'tr_open') {
      i++;
      continue;
    }

    const rowCloseIndex = findClosingToken(tokens, i, 'tr_close');
    const cells: ProseMirrorNode[] = [];
    let j = i + 1;

    while (j < rowCloseIndex) {
      const cellOpen = tokens[j];
      if (cellOpen?.type !== 'th_open' && cellOpen?.type !== 'td_open') {
        j++;
        continue;
      }

      const isHeader = cellOpen.type === 'th_open';
      const cellCloseType = isHeader ? 'th_close' : 'td_close';
      const cellCloseIndex = findClosingToken(tokens, j, cellCloseType);
      const inlineToken = tokens[j + 1];
      const inlineContent = inlineToken?.type === 'inline' && inlineToken.children
        ? parseInlineContent(inlineToken.children, schema)
        : [];

      const paragraph = paragraphType.create(
        { id: generateBlockId() },
        inlineContent.length > 0 ? inlineContent : undefined,
      );

      cells.push((isHeader ? headerType : cellType).create(
        { id: generateBlockId(), colspan: 1, rowspan: 1 },
        [paragraph],
      ));

      j = cellCloseIndex + 1;
    }

    if (cells.length > 0) {
      rows.push(rowType.create({ id: generateBlockId() }, cells));
    }

    i = rowCloseIndex + 1;
  }

  if (rows.length === 0) {
    rows.push(rowType.create(
      { id: generateBlockId() },
      [cellType.create(
        { id: generateBlockId(), colspan: 1, rowspan: 1 },
        [paragraphType.create({ id: generateBlockId() })],
      )],
    ));
  }

  return {
    node: tableType.create({ id: generateBlockId() }, rows),
    nextIndex: closeIndex + 1,
  };
}

/**
 * Parse a paragraph block
 */
function parseParagraph(
  tokens: Token[],
  index: number,
  schema: Schema
): { node: ProseMirrorNode | null; nodes?: ProseMirrorNode[]; nextIndex: number } {
  const paragraphType = schema.nodes['paragraph'];
  const todoItemType = schema.nodes['todoItem'];

  // Find the inline content and closing tag
  const inlineToken = tokens[index + 1];
  const closeIndex = findClosingToken(tokens, index, 'paragraph_close');
  const inlineChildren = inlineToken?.children ?? [];
  const imageTokens = inlineChildren.filter((child) => child.type === 'image');
  const nonImageChildren = inlineChildren.filter((child) => child.type !== 'image');

  const content = nonImageChildren.length > 0
    ? parseInlineContent(nonImageChildren, schema)
    : [];

  // Check for todo item pattern: "[ ] " or "[x] "
  if (inlineToken?.content) {
    const todoMatch = inlineToken.content.match(/^\[([ xX])\]\s*/);
    if (todoMatch && todoItemType) {
      const checked = (todoMatch[1] ?? '').toLowerCase() === 'x';
      const textContent = inlineToken.content.slice(todoMatch[0]?.length ?? 0);
      const textNode = textContent ? schema.text(textContent) : null;

      return {
        node: todoItemType.create(
          { id: generateBlockId(), checked },
          textNode ? [textNode] : []
        ),
        nextIndex: closeIndex + 1,
      };
    }
  }

  if (!paragraphType) {
    throw new Error('Schema must have a paragraph node type');
  }

  if (imageTokens.length > 0) {
    const nodes: ProseMirrorNode[] = [];
    if (content.length > 0) {
      nodes.push(paragraphType.create({ id: generateBlockId() }, content));
    }
    for (const imageToken of imageTokens) {
      nodes.push(createImageNodeFromToken(imageToken, schema));
    }

    if (nodes.length === 1) {
      return { node: nodes[0]!, nextIndex: closeIndex + 1 };
    }
    return { node: null, nodes, nextIndex: closeIndex + 1 };
  }

  return {
    node: paragraphType.create({ id: generateBlockId() }, content),
    nextIndex: closeIndex + 1,
  };
}

/**
 * Parse a heading block
 */
function parseHeading(
  tokens: Token[],
  index: number,
  schema: Schema
): { node: ProseMirrorNode; nextIndex: number } {
  const headingType = schema.nodes['heading'];
  if (!headingType) {
    throw new Error('Schema must have a heading node type');
  }

  const openToken = tokens[index];
  const inlineToken = tokens[index + 1];
  const closeIndex = findClosingToken(tokens, index, 'heading_close');

  // Extract heading level from tag (h1-h6)
  const level = openToken ? parseInt(openToken.tag.slice(1), 10) : 1;

  const content = inlineToken?.children
    ? parseInlineContent(inlineToken.children, schema)
    : [];

  return {
    node: headingType.create({ id: generateBlockId(), level }, content),
    nextIndex: closeIndex + 1,
  };
}

/**
 * Parse a bullet list.
 * Handles mixed lists: iterates per-item, emitting todoItem nodes for todo items
 * and grouping regular items into bulletList nodes.
 */
function parseBulletList(
  tokens: Token[],
  index: number,
  schema: Schema
): { node: ProseMirrorNode | null; nodes?: ProseMirrorNode[]; nextIndex: number } {
  const bulletListType = schema.nodes['bulletList'];
  const todoItemType = schema.nodes['todoItem'];
  const listItemType = schema.nodes['listItem'];
  if (!bulletListType) {
    throw new Error('Schema must have a bulletList node type');
  }

  const closeIndex = findClosingToken(tokens, index, 'bullet_list_close');

  // Per-item classification: collect contiguous runs of same-type items
  const outputNodes: ProseMirrorNode[] = [];
  let pendingBulletItems: ProseMirrorNode[] = [];

  const flushBulletItems = () => {
    if (pendingBulletItems.length > 0) {
      outputNodes.push(bulletListType.create({ id: generateBlockId() }, pendingBulletItems));
      pendingBulletItems = [];
    }
  };

  let i = index + 1;
  while (i < closeIndex) {
    const token = tokens[i];
    if (token?.type !== 'list_item_open') {
      i++;
      continue;
    }

    const itemCloseIndex = findClosingToken(tokens, i, 'list_item_close');

    // Check if this item is a todo
    const paraOpen = tokens[i + 1];
    const inlineToken = tokens[i + 2];
    const isTodo = paraOpen?.type === 'paragraph_open' &&
      inlineToken?.type === 'inline' &&
      /^\[([ xX])\]\s/.test(inlineToken.content ?? '');

    if (isTodo && todoItemType) {
      // Flush any pending bullet items first
      flushBulletItems();

      const todoMatch = inlineToken!.content?.match(/^\[([ xX])\]\s*/);
      const checked = (todoMatch?.[1] ?? '').toLowerCase() === 'x';
      const textContent = inlineToken!.content?.slice(todoMatch?.[0]?.length ?? 0) ?? '';

      // Parse inline content for marks
      const filteredChildren = (inlineToken!.children ?? []).filter(t => {
        if (!t.content && t.type === 'text') return false;
        return true;
      });

      // Strip checkbox prefix from first text token
      if (filteredChildren.length > 0 && filteredChildren[0]!.type === 'text') {
        const first = filteredChildren[0]!;
        const prefixMatch = first.content?.match(/^\[([ xX])\]\s*/);
        if (prefixMatch) {
          first.content = first.content.slice(prefixMatch[0].length);
          if (!first.content) filteredChildren.shift();
        }
      }

      const contentNodes = filteredChildren.length > 0
        ? parseInlineContent(filteredChildren, schema)
        : [];

      const nodes = contentNodes.length > 0
        ? contentNodes
        : textContent ? [schema.text(textContent)] : [];

      outputNodes.push(todoItemType.create({ id: generateBlockId(), checked }, nodes));
    } else if (listItemType) {
      // Regular bullet item
      const itemContent = parseListItemContent(tokens, i + 1, itemCloseIndex, schema);
      pendingBulletItems.push(listItemType.create({ id: generateBlockId() }, itemContent));
    }

    i = itemCloseIndex + 1;
  }

  // Flush remaining bullet items
  flushBulletItems();

  if (outputNodes.length === 0) {
    return { node: null, nextIndex: closeIndex + 1 };
  }

  if (outputNodes.length === 1 && outputNodes[0]!.type.name === 'bulletList') {
    return { node: outputNodes[0]!, nextIndex: closeIndex + 1 };
  }

  return {
    node: null,
    nodes: outputNodes,
    nextIndex: closeIndex + 1,
  };
}

/**
 * Parse an ordered list
 */
function parseOrderedList(
  tokens: Token[],
  index: number,
  schema: Schema
): { node: ProseMirrorNode; nextIndex: number } {
  const orderedListType = schema.nodes['orderedList'];
  if (!orderedListType) {
    throw new Error('Schema must have an orderedList node type');
  }

  const openToken = tokens[index];
  const closeIndex = findClosingToken(tokens, index, 'ordered_list_close');
  const items = parseListItems(tokens, index + 1, closeIndex, schema);

  // Get start number from token attrs
  const startAttr = openToken?.attrs?.find(([key]) => key === 'start');
  const start = startAttr ? parseInt(startAttr[1], 10) : 1;

  return {
    node: orderedListType.create({ id: generateBlockId(), start }, items),
    nextIndex: closeIndex + 1,
  };
}

/**
 * Parse list items between start and end indices
 */
function parseListItems(
  tokens: Token[],
  startIndex: number,
  endIndex: number,
  schema: Schema
): ProseMirrorNode[] {
  const listItemType = schema.nodes['listItem'];
  if (!listItemType) {
    throw new Error('Schema must have a listItem node type');
  }

  const items: ProseMirrorNode[] = [];
  let i = startIndex;

  while (i < endIndex) {
    const token = tokens[i];

    if (token?.type === 'list_item_open') {
      const itemCloseIndex = findClosingToken(tokens, i, 'list_item_close');
      const itemContent = parseListItemContent(tokens, i + 1, itemCloseIndex, schema);

      items.push(listItemType.create({ id: generateBlockId() }, itemContent));
      i = itemCloseIndex + 1;
    } else {
      i++;
    }
  }

  return items;
}

/**
 * Parse the content within a list item
 */
function parseListItemContent(
  tokens: Token[],
  startIndex: number,
  endIndex: number,
  schema: Schema
): ProseMirrorNode[] {
  const paragraphType = schema.nodes['paragraph'];
  const content: ProseMirrorNode[] = [];
  let i = startIndex;

  while (i < endIndex) {
    const result = parseBlock(tokens, i, schema);
    if (result.node) {
      content.push(result.node);
    } else if (result.nodes) {
      content.push(...result.nodes);
    }
    i = result.nextIndex;
  }

  // Ensure list item has at least a paragraph
  if (content.length === 0 && paragraphType) {
    content.push(paragraphType.create({ id: generateBlockId() }));
  }

  return content;
}

/**
 * Parse a blockquote
 */
function parseBlockquote(
  tokens: Token[],
  index: number,
  schema: Schema
): { node: ProseMirrorNode; nextIndex: number } {
  const blockquoteType = schema.nodes['blockquote'];
  const calloutType = schema.nodes['callout'];
  const paragraphType = schema.nodes['paragraph'];

  if (!blockquoteType) {
    throw new Error('Schema must have a blockquote node type');
  }

  const closeIndex = findClosingToken(tokens, index, 'blockquote_close');
  const content: ProseMirrorNode[] = [];
  let i = index + 1;

  // Check for callout syntax: > [!type]
  const firstToken = tokens[i];
  let isCallout = false;
  let calloutVariant: 'info' | 'warning' | 'error' | 'success' = 'info';

  if (firstToken?.type === 'paragraph_open') {
    const inlineToken = tokens[i + 1];
    if (inlineToken?.content) {
      const calloutMatch = inlineToken.content.match(/^\[!(info|warning|error|success)\]\s*/i);
      if (calloutMatch && calloutMatch[1]) {
        isCallout = true;
        calloutVariant = calloutMatch[1].toLowerCase() as typeof calloutVariant;
        // Modify the content to remove the callout marker
        inlineToken.content = inlineToken.content.slice(calloutMatch[0]?.length ?? 0);
      }
    }
  }

  while (i < closeIndex) {
    const result = parseBlock(tokens, i, schema);
    if (result.node) {
      content.push(result.node);
    } else if (result.nodes) {
      content.push(...result.nodes);
    }
    i = result.nextIndex;
  }

  // Ensure blockquote has at least a paragraph
  if (content.length === 0 && paragraphType) {
    content.push(paragraphType.create({ id: generateBlockId() }));
  }

  if (isCallout && calloutType) {
    return {
      node: calloutType.create(
        { id: generateBlockId(), variant: calloutVariant },
        content
      ),
      nextIndex: closeIndex + 1,
    };
  }

  return {
    node: blockquoteType.create({ id: generateBlockId() }, content),
    nextIndex: closeIndex + 1,
  };
}

/**
 * Parse a code block (fenced or indented)
 */
function parseCodeBlock(
  tokens: Token[],
  index: number,
  schema: Schema
): { node: ProseMirrorNode; nextIndex: number } {
  const token = tokens[index];
  if (token) {
    const info = parseCodeFenceInfo(token.info);
    if (info.language === PROTECTED_LINES_FENCE) {
      return parseProtectedBlock(token, schema, index);
    }
  }

  const codeBlockType = schema.nodes['codeBlock'];
  if (!codeBlockType) {
    throw new Error('Schema must have a codeBlock node type');
  }

  if (!token) {
    return { node: codeBlockType.create({ id: generateBlockId(), language: null, meta: null }), nextIndex: index + 1 };
  }

  // Extract language and metadata from fence info
  // (e.g. "```typescript title=\"api.ts\" lineNumbers").
  const info = parseCodeFenceInfo(token.info);

  // Get the code content
  const content = token.content || '';

  // Create text node if there's content
  const textNode = content ? schema.text(content) : null;

  return {
    node: codeBlockType.create(
      { id: generateBlockId(), language: info.language, meta: info.meta },
      textNode ? [textNode] : []
    ),
    nextIndex: index + 1,
  };
}

function parseProtectedBlock(
  token: Token,
  schema: Schema,
  index: number,
): { node: ProseMirrorNode; nextIndex: number } {
  const protectedBlockType = schema.nodes['protectedBlock'];
  if (!protectedBlockType) {
    throw new Error('Schema must have a protectedBlock node type');
  }

  const parsed = parseProtectedLinesEnvelope(token.content || '');
  const runtime = parsed.__void && typeof parsed.__void === 'object'
    ? parsed.__void as { lockState?: unknown; plaintext?: unknown; error?: unknown }
    : {};
  const lockState = runtime.lockState === 'unlocked' ? 'unlocked' : 'locked';
  const plaintext = lockState === 'unlocked' && typeof runtime.plaintext === 'string'
    ? runtime.plaintext
    : '';
  const children: ProseMirrorNode[] = [];
  if (plaintext.trim()) {
    const doc = parseMarkdown(plaintext, schema);
    doc.forEach((child) => children.push(child));
  }

  const cleanEnvelope = { ...parsed };
  delete cleanEnvelope.__void;

  return {
    node: protectedBlockType.create(
      {
        id: generateBlockId(),
        protectionId: parsed.id ?? '',
        keyId: parsed.keyId ?? '',
        algorithm: parsed.algorithm ?? 'AES-256-GCM',
        envelopeVersion: parsed.version ?? 1,
        protectedAt: parsed.protectedAt ?? '',
        titleVisible: parsed.titleVisible !== false,
        lineCount: Number(parsed.lineCount) || 1,
        lockState,
        envelope: JSON.stringify(cleanEnvelope),
      },
      children,
    ),
    nextIndex: index + 1,
  };
}

function parseProtectedLinesEnvelope(content: string): Record<string, unknown> & { __void?: unknown } {
  try {
    const parsed = JSON.parse(content) as Record<string, unknown> & { __void?: unknown };
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Parse a horizontal rule
 */
function parseHorizontalRule(
  tokens: Token[],
  index: number,
  schema: Schema
): { node: ProseMirrorNode; nextIndex: number } {
  const horizontalRuleType = schema.nodes['horizontalRule'];
  if (!horizontalRuleType) {
    throw new Error('Schema must have a horizontalRule node type');
  }

  return {
    node: horizontalRuleType.create({ id: generateBlockId() }),
    nextIndex: index + 1,
  };
}

/**
 * Parse an image
 */
function parseImage(
  tokens: Token[],
  index: number,
  schema: Schema
): { node: ProseMirrorNode; nextIndex: number } {
  const imageType = schema.nodes['image'];
  if (!imageType) {
    throw new Error('Schema must have an image node type');
  }

  const token = tokens[index];
  if (!token) {
    return { node: imageType.create({ id: generateBlockId(), src: '', alt: null, title: null, width: null }), nextIndex: index + 1 };
  }

  const src = token.attrs?.find(([key]) => key === 'src')?.[1] || '';
  const alt = token.attrs?.find(([key]) => key === 'alt')?.[1] || token.content || null;
  const title = token.attrs?.find(([key]) => key === 'title')?.[1] || null;

  return {
    node: imageType.create({
      id: generateBlockId(),
      src,
      alt,
      title,
      width: null,
    }),
    nextIndex: index + 1,
  };
}

function createImageNodeFromToken(token: Token, schema: Schema): ProseMirrorNode {
  const imageType = schema.nodes['image'];
  if (!imageType) {
    throw new Error('Schema must have an image node type');
  }

  const src = token.attrs?.find(([key]) => key === 'src')?.[1] || '';
  const alt = token.attrs?.find(([key]) => key === 'alt')?.[1] || token.content || null;
  const title = token.attrs?.find(([key]) => key === 'title')?.[1] || null;

  return imageType.create({
    id: generateBlockId(),
    src,
    alt,
    title,
    width: null,
  });
}

/**
 * Parse a Markdown-compatible <details><summary>...</summary> block.
 */
function parseToggle(
  tokens: Token[],
  index: number,
  schema: Schema
): { node: ProseMirrorNode; nextIndex: number } {
  const toggleType = schema.nodes['toggle'];
  const summaryType = schema.nodes['toggleSummary'];
  const contentType = schema.nodes['toggleContent'];
  const paragraphType = schema.nodes['paragraph'];

  if (!toggleType || !summaryType || !contentType || !paragraphType) {
    throw new Error('Schema must have toggle node types');
  }

  const openToken = tokens[index];
  const openHtml = openToken?.content ?? '';
  const closeIndex = findDetailsClose(tokens, index);

  if (closeIndex === -1) {
    return parseHtmlBlock(tokens, index, schema);
  }

  const summaryMatch = openHtml.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i);
  const summaryMarkdown = summaryMatch?.[1]?.trim() ?? '';
  const open = /<details\b[^>]*\bopen(?:\s|>|=)/i.test(openHtml);

  const summaryInline = parseInlineMarkdown(summaryMarkdown, schema);
  const summaryNode = summaryType.create(
    null,
    summaryInline.length > 0 ? summaryInline : undefined,
  );

  const body: ProseMirrorNode[] = [];
  let i = index + 1;
  while (i < closeIndex) {
    const result = parseBlock(tokens, i, schema);
    if (result.node) {
      body.push(result.node);
    } else if (result.nodes) {
      body.push(...result.nodes);
    }
    i = result.nextIndex;
  }

  if (body.length === 0) {
    body.push(paragraphType.create({ id: generateBlockId() }));
  }

  return {
    node: toggleType.create(
      { id: generateBlockId(), open },
      [
        summaryNode,
        contentType.create(null, body),
      ],
    ),
    nextIndex: closeIndex + 1,
  };
}

/**
 * Preserve unsupported HTML as raw paragraph text instead of dropping it.
 */
function parseHtmlBlock(
  tokens: Token[],
  index: number,
  schema: Schema
): { node: ProseMirrorNode; nextIndex: number } {
  const paragraphType = schema.nodes['paragraph'];
  if (!paragraphType) {
    throw new Error('Schema must have a paragraph node type');
  }

  const content = tokens[index]?.content ?? '';
  return {
    node: paragraphType.create(
      { id: generateBlockId() },
      content ? [schema.text(content.trimEnd())] : undefined,
    ),
    nextIndex: index + 1,
  };
}

function findDetailsClose(tokens: Token[], index: number): number {
  for (let i = index + 1; i < tokens.length; i++) {
    const token = tokens[i];
    if (token?.type === 'html_block' && /<\/details>/i.test(token.content)) {
      return i;
    }
  }
  return -1;
}

function parseInlineMarkdown(markdown: string, schema: Schema): ProseMirrorNode[] {
  if (!markdown) return [];
  const tokens = md.parseInline(markdown, {});
  const inline = tokens.find((token) => token.type === 'inline');
  return inline?.children ? parseInlineContent(inline.children, schema) : [];
}

/**
 * Parse inline content tokens into ProseMirror content
 */
function parseInlineContent(tokens: Token[], schema: Schema): ProseMirrorNode[] {
  const nodes: ProseMirrorNode[] = [];
  let currentMarks: Mark[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token) continue;

    switch (token.type) {
      case 'text':
        if (token.content) {
          nodes.push(schema.text(token.content, currentMarks));
        }
        break;

      case 'code_inline': {
        if (token.content) {
          const codeMarkType = schema.marks['code'];
          if (codeMarkType) {
            const codeMark = codeMarkType.create();
            const codeMarks = [...currentMarks, codeMark];
            nodes.push(schema.text(token.content, codeMarks));
          } else {
            nodes.push(schema.text(token.content, currentMarks));
          }
        }
        break;
      }

      case 'strong_open': {
        const boldMarkType = schema.marks['bold'];
        if (boldMarkType) {
          currentMarks = [...currentMarks, boldMarkType.create()];
        }
        break;
      }

      case 'strong_close': {
        currentMarks = currentMarks.filter((m) => m.type.name !== 'bold');
        break;
      }

      case 'em_open': {
        const italicMarkType = schema.marks['italic'];
        if (italicMarkType) {
          currentMarks = [...currentMarks, italicMarkType.create()];
        }
        break;
      }

      case 'em_close': {
        currentMarks = currentMarks.filter((m) => m.type.name !== 'italic');
        break;
      }

      case 's_open': {
        const strikethroughMarkType = schema.marks['strikethrough'];
        if (strikethroughMarkType) {
          currentMarks = [...currentMarks, strikethroughMarkType.create()];
        }
        break;
      }

      case 's_close': {
        currentMarks = currentMarks.filter((m) => m.type.name !== 'strikethrough');
        break;
      }

      case 'link_open': {
        const linkMarkType = schema.marks['link'];
        if (linkMarkType) {
          const href = token.attrs?.find(([key]) => key === 'href')?.[1] || '';
          const title = token.attrs?.find(([key]) => key === 'title')?.[1] || null;
          currentMarks = [...currentMarks, linkMarkType.create({ href, title })];
        }
        break;
      }

      case 'link_close': {
        currentMarks = currentMarks.filter((m) => m.type.name !== 'link');
        break;
      }

      case 'page_link_open': {
        const pageLinkMarkType = schema.marks['pageLink'];
        if (pageLinkMarkType) {
          const href = token.attrs?.find(([key]) => key === 'href')?.[1] || '';
          const title = token.attrs?.find(([key]) => key === 'title')?.[1] || null;
          currentMarks = [...currentMarks, pageLinkMarkType.create({ href, title })];
        }
        break;
      }

      case 'page_link_close': {
        currentMarks = currentMarks.filter((m) => m.type.name !== 'pageLink');
        break;
      }

      case 'html_inline': {
        const html = token.content.trim();

        if (/^<mark\b/i.test(html)) {
          const highlightMarkType = schema.marks['highlight'];
          if (highlightMarkType) {
            const color =
              html.match(/\bdata-color=(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i)?.slice(1).find(Boolean) ||
              html.match(/\bdata-highlight=(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i)?.slice(1).find(Boolean) ||
              'yellow';
            currentMarks = [...currentMarks, highlightMarkType.create({ color })];
          }
        } else if (/^<\/mark>/i.test(html)) {
          currentMarks = currentMarks.filter((m) => m.type.name !== 'highlight');
        } else if (/^<u\b/i.test(html)) {
          const underlineMarkType = schema.marks['underline'];
          if (underlineMarkType) {
            currentMarks = [...currentMarks, underlineMarkType.create()];
          }
        } else if (/^<\/u>/i.test(html)) {
          currentMarks = currentMarks.filter((m) => m.type.name !== 'underline');
        } else if (/^<br\s*\/?>/i.test(html)) {
          const hardBreakType = schema.nodes['hardBreak'];
          if (hardBreakType) nodes.push(hardBreakType.create());
        } else if (token.content) {
          nodes.push(schema.text(token.content, currentMarks));
        }
        break;
      }

      case 'softbreak':
        // Soft breaks become spaces
        nodes.push(schema.text(' ', currentMarks));
        break;

      case 'hardbreak': {
        const hardBreakType = schema.nodes['hardBreak'];
        if (hardBreakType) {
          nodes.push(hardBreakType.create());
        }
        break;
      }

      case 'image': {
        // The schema models images as blocks. Standalone paragraph images are
        // lifted by parseParagraph(); inline/mixed images degrade to alt text.
        const alt = token.attrs?.find(([key]) => key === 'alt')?.[1] || token.content || '';
        if (alt) {
          nodes.push(schema.text(alt, currentMarks));
        }
        break;
      }
    }
  }

  return nodes;
}

/**
 * Find the index of the closing token matching an opening token
 */
function findClosingToken(
  tokens: Token[],
  openIndex: number,
  closeType: string
): number {
  const openToken = tokens[openIndex];
  if (!openToken) {
    return tokens.length - 1;
  }

  let depth = 1;
  const openType = openToken.type;

  for (let i = openIndex + 1; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token) continue;

    if (token.type === openType) {
      depth++;
    } else if (token.type === closeType) {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
  }

  // If no closing token found, return end of tokens
  return tokens.length - 1;
}
