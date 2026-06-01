/**
 * Markdown Serializer
 *
 * Converts ProseMirror documents to markdown strings.
 * Handles all node types from the void editor schema with proper
 * indentation for nested structures like lists.
 *
 * Part of the Markdown infrastructure adapter.
 */

import type { Node as ProseMirrorNode, Mark } from 'prosemirror-model';
import { buildCodeFence } from '$lib/core/codeFence';

const PROTECTED_LINES_FENCE = 'void-protected-lines-v1';

/**
 * Internal placeholder for a user-inserted empty top-level paragraph (a blank line).
 * NUL bytes never appear in editor-produced text, so this can't collide with content.
 * It survives the collapse/trim in serializeToMarkdown and is converted into exactly
 * one extra newline as the final step, so an empty paragraph round-trips as a blank line.
 */
const NUL = String.fromCharCode(0);
const EMPTY_PARAGRAPH_SENTINEL = `${NUL}void-empty-paragraph${NUL}`;

/**
 * Serializer state for tracking context during serialization
 */
interface SerializerState {
  /** The accumulated output string */
  output: string;
  /** Current list nesting depth */
  listDepth: number;
  /** Whether we're inside a tight list (no blank lines between items) */
  tightList: boolean;
  /** Nested-block depth; >0 means we're inside a container (e.g. a toggle body),
   *  where empty paragraphs are NOT turned into round-tripped blank lines. */
  blockDepth: number;
}

/**
 * Serialize a ProseMirror document to markdown
 * @param doc - The ProseMirror document node to serialize
 * @returns Markdown string representation
 */
export function serializeToMarkdown(doc: ProseMirrorNode): string {
  const state: SerializerState = {
    output: '',
    listDepth: 0,
    tightList: false,
    blockDepth: 0,
  };

  serializeNode(doc, state);

  // Normalize the inconsistent trailing-newline artifacts the block handlers emit.
  let out = state.output.replace(/\n{3,}/g, '\n\n').trim();

  // Leading/trailing empty paragraphs can't round-trip through markdown (markdown-it
  // emits no token for edge blank lines and the loader trims the body), so drop them
  // rather than leave a phantom blank line that silently vanishes on the next reload.
  while (out.startsWith(EMPTY_PARAGRAPH_SENTINEL)) {
    out = out.slice(EMPTY_PARAGRAPH_SENTINEL.length).replace(/^\s+/, '');
  }
  while (out.endsWith(EMPTY_PARAGRAPH_SENTINEL)) {
    out = out.slice(0, -EMPTY_PARAGRAPH_SENTINEL.length).replace(/\s+$/, '');
  }

  // Each remaining sentinel marks one interior empty paragraph the user inserted;
  // expand it into exactly one extra newline so it becomes a real blank line.
  return out.split(EMPTY_PARAGRAPH_SENTINEL).join('\n');
}

/**
 * Serialize a single node to markdown
 */
function serializeNode(node: ProseMirrorNode, state: SerializerState): void {
  const nodeHandlers: Record<string, (n: ProseMirrorNode, s: SerializerState) => void> = {
    doc: serializeDoc,
    paragraph: serializeParagraph,
    heading: serializeHeading,
    bulletList: serializeBulletList,
    orderedList: serializeOrderedList,
    listItem: serializeListItem,
    todoItem: serializeTodoItem,
    blockquote: serializeBlockquote,
    codeBlock: serializeCodeBlock,
    protectedBlock: serializeProtectedBlock,
    horizontalRule: serializeHorizontalRule,
    image: serializeImage,
    callout: serializeCallout,
    toggle: serializeToggle,
    table: serializeTable,
    text: serializeText,
    hardBreak: serializeHardBreak,
  };

  const handler = nodeHandlers[node.type.name];
  if (handler) {
    handler(node, state);
  }
}

/**
 * Serialize document root.
 * Tracks previous node type to insert blank line separators after todo sequences.
 */
function serializeDoc(node: ProseMirrorNode, state: SerializerState): void {
  let prevType: string | null = null;
  node.forEach((child) => {
    // Add blank line after a todo sequence when followed by a non-todo block
    if (prevType === 'todoItem' && child.type.name !== 'todoItem') {
      state.output += '\n';
    }
    serializeNode(child, state);
    prevType = child.type.name;
  });
}

/**
 * Serialize a paragraph
 */
function serializeParagraph(node: ProseMirrorNode, state: SerializerState): void {
  // A truly-empty top-level paragraph is a blank line the user inserted with Enter.
  // Emit a sentinel so the collapse/trim in serializeToMarkdown can't erase it; it is
  // expanded back into a blank line at the end. content.size === 0 excludes paragraphs
  // that hold a hardBreak or any text. Nested empty paragraphs (blockDepth > 0) keep
  // the old behavior — round-tripped blank lines are a top-level-only contract.
  if (node.content.size === 0 && state.blockDepth === 0) {
    state.output += EMPTY_PARAGRAPH_SENTINEL;
    return;
  }
  serializeInlineContent(node, state);
  state.output += '\n\n';
}

/**
 * Serialize a heading
 */
function serializeHeading(node: ProseMirrorNode, state: SerializerState): void {
  const level = (node.attrs.level as number) || 1;
  state.output += '#'.repeat(level) + ' ';
  serializeInlineContent(node, state);
  state.output += '\n\n';
}

/**
 * Serialize a bullet list
 */
function serializeBulletList(node: ProseMirrorNode, state: SerializerState): void {
  const wasInList = state.listDepth > 0;
  state.listDepth++;

  node.forEach((child) => serializeNode(child, state));

  state.listDepth--;

  // Add extra newline after top-level lists
  if (!wasInList) {
    state.output += '\n';
  }
}

/**
 * Serialize an ordered list
 */
function serializeOrderedList(node: ProseMirrorNode, state: SerializerState): void {
  const wasInList = state.listDepth > 0;
  const start = (node.attrs.start as number) || 1;
  state.listDepth++;

  let index = start;
  node.forEach((child) => {
    serializeOrderedListItem(child, state, index);
    index++;
  });

  state.listDepth--;

  // Add extra newline after top-level lists
  if (!wasInList) {
    state.output += '\n';
  }
}

/**
 * Serialize a list item with bullet prefix
 */
function serializeListItem(node: ProseMirrorNode, state: SerializerState): void {
  const indent = '  '.repeat(state.listDepth - 1);
  state.output += indent + '- ';

  serializeListItemContent(node, state);
}

/**
 * Serialize an ordered list item with number prefix
 */
function serializeOrderedListItem(
  node: ProseMirrorNode,
  state: SerializerState,
  index: number
): void {
  const indent = '  '.repeat(state.listDepth - 1);
  state.output += indent + `${index}. `;

  serializeListItemContent(node, state);
}

/**
 * Serialize the content of a list item
 */
function serializeListItemContent(node: ProseMirrorNode, state: SerializerState): void {
  let first = true;
  const baseIndent = '  '.repeat(state.listDepth);

  node.forEach((child) => {
    if (child.type.name === 'paragraph') {
      if (!first) {
        // Continuation paragraphs in list items need indentation
        state.output += baseIndent;
      }
      serializeInlineContent(child, state);
      state.output += '\n';
    } else if (child.type.name === 'bulletList' || child.type.name === 'orderedList') {
      // Nested lists
      serializeNode(child, state);
    } else {
      // Other block content
      if (!first) {
        state.output += baseIndent;
      }
      serializeNode(child, state);
    }
    first = false;
  });
}

/**
 * Serialize a todo/task item
 */
function serializeTodoItem(node: ProseMirrorNode, state: SerializerState): void {
  const checked = node.attrs.checked as boolean;
  const checkbox = checked ? '[x]' : '[ ]';

  const indent = state.listDepth > 0 ? '  '.repeat(state.listDepth - 1) : '';
  state.output += indent + `- ${checkbox} `;
  serializeInlineContent(node, state);
  state.output += '\n';
}

/**
 * Serialize a blockquote
 */
function serializeBlockquote(node: ProseMirrorNode, state: SerializerState): void {
  const lines = serializeBlockquoteContent(node);
  for (const line of lines) {
    state.output += `> ${line}\n`;
  }
  state.output += '\n';
}

/**
 * Serialize blockquote content, returning lines
 */
function serializeBlockquoteContent(node: ProseMirrorNode): string[] {
  const lines: string[] = [];

  node.forEach((child) => {
    if (child.type.name === 'paragraph') {
      let line = '';
      child.forEach((inline) => {
        if (inline.isText) {
          line += serializeMarkedText(inline.text || '', inline.marks);
        } else if (inline.type.name === 'hardBreak') {
          lines.push(line);
          line = '';
        }
      });
      if (line || lines.length === 0) {
        lines.push(line);
      }
    } else if (child.type.name === 'blockquote') {
      // Nested blockquote
      const nestedLines = serializeBlockquoteContent(child);
      for (const nestedLine of nestedLines) {
        lines.push(`> ${nestedLine}`);
      }
    }
  });

  return lines;
}

/**
 * Serialize a code block
 */
function serializeCodeBlock(node: ProseMirrorNode, state: SerializerState): void {
  const language = (node.attrs.language as string) || '';
  const meta = (node.attrs.meta as string | null) || null;
  state.output += buildCodeFence({ code: node.textContent, language, meta });
  state.output += '\n\n';
}

function serializeProtectedBlock(node: ProseMirrorNode, state: SerializerState): void {
  const lineCount = Number(node.attrs.lineCount) || 1;
  const envelope = parseProtectedBlockEnvelope(String(node.attrs.envelope ?? '{}'));
  const unlocked = node.attrs.lockState === 'unlocked';
  if (unlocked) {
    const childState: SerializerState = {
      output: '',
      listDepth: 0,
      tightList: false,
      // blockDepth 1: this is a nested serialization context (encrypted envelope),
      // so empty paragraphs must not emit the sentinel and leak into the plaintext.
      blockDepth: 1,
    };
    node.forEach((child) => serializeNode(child, childState));
    const plaintext = childState.output.trim();
    envelope.__void = {
      lockState: 'unlocked',
      plaintext,
    };
    envelope.lineCount = Math.max(1, plaintext.split(/\r?\n/).filter(Boolean).length || lineCount);
  } else {
    delete envelope.__void;
  }

  state.output += `> Locked encrypted lines · ${lineCount} line${lineCount === 1 ? '' : 's'} · Open in Void to unlock.\n\n`;
  state.output += `\`\`\`${PROTECTED_LINES_FENCE}\n`;
  state.output += `${JSON.stringify(envelope, null, 2)}\n`;
  state.output += '```\n\n';
}

function parseProtectedBlockEnvelope(value: string): Record<string, unknown> & { __void?: unknown; lineCount?: unknown } {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown> & { __void?: unknown; lineCount?: unknown };
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Serialize a horizontal rule
 */
function serializeHorizontalRule(_node: ProseMirrorNode, state: SerializerState): void {
  state.output += '---\n\n';
}

/**
 * Serialize an image
 */
function serializeImage(node: ProseMirrorNode, state: SerializerState): void {
  const alt = (node.attrs.alt as string) || '';
  const src = node.attrs.src as string;
  const title = node.attrs.title as string | null;

  let imageMarkdown = `![${alt}](${src}`;
  if (title) {
    imageMarkdown += ` "${escapeTitle(title)}"`;
  }
  imageMarkdown += ')';

  state.output += imageMarkdown + '\n\n';
}

/**
 * Serialize a callout block (using GitHub-style syntax)
 */
function serializeCallout(node: ProseMirrorNode, state: SerializerState): void {
  const variant = (node.attrs.variant as string) || 'info';
  state.output += `> [!${variant.toUpperCase()}]\n`;

  node.forEach((child) => {
    if (child.type.name === 'paragraph') {
      state.output += '> ';
      serializeInlineContent(child, state);
      state.output += '\n';
    }
  });

  state.output += '\n';
}

/**
 * Serialize a toggle block as Markdown-compatible details/summary HTML.
 */
function serializeToggle(node: ProseMirrorNode, state: SerializerState): void {
  const open = node.attrs.open ? ' open' : '';
  const summary = node.childCount > 0 ? node.child(0) : null;
  const body = node.childCount > 1 ? node.child(1) : null;

  state.output += `<details${open}>\n`;
  state.output += `<summary>${summary ? serializeInlineNodeToString(summary) : ''}</summary>\n\n`;

  // Serialize the body as nested content so empty paragraphs inside the toggle don't
  // emit a top-level sentinel (which would land inside the <details> HTML).
  state.blockDepth++;
  body?.forEach((child) => serializeNode(child, state));
  state.blockDepth--;

  state.output = state.output.replace(/\n*$/, '\n\n');
  state.output += '</details>\n\n';
}

/**
 * Serialize a table block to GitHub-flavored pipe table markdown.
 */
function serializeTable(node: ProseMirrorNode, state: SerializerState): void {
  const rows = collectTableRows(node);
  if (rows.length === 0) return;

  const columnCount = Math.max(...rows.map((row) => row.length));
  const normalized = rows.map((row) => {
    const cells = [...row];
    while (cells.length < columnCount) cells.push('');
    return cells;
  });

  const header = normalized[0] ?? [];
  state.output += renderTableRow(header);
  state.output += renderTableRow(header.map(() => '---'));

  for (const row of normalized.slice(1)) {
    state.output += renderTableRow(row);
  }

  state.output += '\n';
}

/**
 * Serialize inline/text content within a block
 */
function serializeInlineContent(node: ProseMirrorNode, state: SerializerState): void {
  node.forEach((child) => {
    if (child.isText) {
      state.output += serializeMarkedText(child.text || '', child.marks);
    } else if (child.type.name === 'hardBreak') {
      state.output += '  \n';
    } else if (child.type.name === 'image') {
      // Inline image
      const alt = (child.attrs.alt as string) || '';
      const src = child.attrs.src as string;
      const title = child.attrs.title as string | null;

      let imageMarkdown = `![${alt}](${src}`;
      if (title) {
        imageMarkdown += ` "${escapeTitle(title)}"`;
      }
      imageMarkdown += ')';
      state.output += imageMarkdown;
    }
  });
}

function serializeInlineNodeToString(node: ProseMirrorNode): string {
  let output = '';
  node.forEach((child) => {
    if (child.isText) {
      output += serializeMarkedText(child.text || '', child.marks);
    } else if (child.type.name === 'hardBreak') {
      output += '<br>';
    }
  });
  return output;
}

function collectTableRows(table: ProseMirrorNode): string[][] {
  const rows: string[][] = [];
  table.forEach((row) => {
    const cells: string[] = [];
    row.forEach((cell) => {
      const parts: string[] = [];
      cell.forEach((child) => {
        if (child.type.name === 'paragraph') {
          parts.push(serializeInlineNodeToString(child));
        } else {
          parts.push(child.textContent);
        }
      });
      cells.push(escapeTableCell(parts.join('<br>')));
    });
    rows.push(cells);
  });
  return rows;
}

function renderTableRow(cells: string[]): string {
  return `| ${cells.join(' | ')} |\n`;
}

function escapeTableCell(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\n/g, '<br>');
}

/**
 * Serialize text content (not used directly for inline, kept for compatibility)
 */
function serializeText(node: ProseMirrorNode, state: SerializerState): void {
  state.output += serializeMarkedText(node.text || '', node.marks);
}

/**
 * Serialize a hard break
 */
function serializeHardBreak(_node: ProseMirrorNode, state: SerializerState): void {
  state.output += '  \n';
}

/**
 * Serialize text with marks (bold, italic, etc.)
 */
function serializeMarkedText(text: string, marks: readonly Mark[]): string {
  if (marks.length === 0) {
    return text;
  }

  let result = text;

  // Apply marks in a specific order to ensure proper nesting
  // Links should be outermost, then bold/italic, then code
  const markOrder = ['link', 'pageLink', 'highlight', 'bold', 'italic', 'strikethrough', 'underline', 'code'];

  // Sort marks by order
  const sortedMarks = [...marks].sort((a, b) => {
    const aIndex = markOrder.indexOf(a.type.name);
    const bIndex = markOrder.indexOf(b.type.name);
    return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
  });

  // Apply marks from innermost to outermost
  for (const mark of sortedMarks.reverse()) {
    switch (mark.type.name) {
      case 'bold':
        result = `**${result}**`;
        break;
      case 'italic':
        result = `*${result}*`;
        break;
      case 'code':
        result = `\`${result}\``;
        break;
      case 'strikethrough':
        result = `~~${result}~~`;
        break;
      case 'underline':
        // Markdown doesn't have native underline, use HTML
        result = `<u>${result}</u>`;
        break;
      case 'highlight': {
        const color = (mark.attrs.color as string | null) || 'yellow';
        if (color === 'yellow') {
          result = `<mark>${result}</mark>`;
        } else {
          result = `<mark data-color="${escapeHtmlAttr(color)}">${result}</mark>`;
        }
        break;
      }
      case 'link': {
        const href = mark.attrs.href as string;
        const title = mark.attrs.title as string | null;
        if (title) {
          result = `[${result}](${href} "${escapeTitle(title)}")`;
        } else {
          result = `[${result}](${href})`;
        }
        break;
      }
      case 'pageLink': {
        // Serialize wiki-style page links as [[target|alias]] or [[target]]
        // to match Obsidian/Bear-compatible wikilink aliases.
        const href = mark.attrs.href as string;
        // If the displayed text matches the link target or its filename stem,
        // use the compact form. Otherwise keep the explicit target.
        const pathStem = href.replace(/\.md$/, '').split('/').pop() || '';
        if (result === href || result === pathStem) {
          result = `[[${result}]]`;
        } else {
          result = `[[${href}|${result}]]`;
        }
        break;
      }
      // Skip AI processing marks - they're not persisted to markdown
      case 'aiProcessing':
        break;
    }
  }

  return result;
}

/**
 * Escape title text for markdown (escape quotes)
 */
function escapeTitle(title: string): string {
  return title.replace(/"/g, '\\"');
}

function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
