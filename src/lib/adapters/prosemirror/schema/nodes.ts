/**
 * ProseMirror Node Definitions
 *
 * Block node specifications for the void editor schema.
 * Each node maps to a domain BlockType and includes:
 * - data-block-id attribute for tracking
 * - Appropriate CSS classes prefixed with 'void-'
 * - parseDOM rules for deserializing HTML
 * - toDOM rules for serializing to HTML
 *
 * Part of the ProseMirror infrastructure adapter.
 */

import type { NodeSpec } from 'prosemirror-model';

/**
 * Shared attribute definition for block IDs
 * Every block node includes a unique ID for tracking and manipulation
 */
const blockIdAttr = {
  id: {
    default: null as string | null,
    parseDOM: (dom: HTMLElement) => dom.getAttribute('data-block-id'),
    toDOM: (node: { attrs: { id: string | null } }) => node.attrs.id,
  },
};

export const nodes: Record<string, NodeSpec> = {
  /**
   * Document root node
   * Contains one or more block-level nodes
   */
  doc: {
    content: 'block+',
  },

  /**
   * Paragraph block
   * Basic text container for inline content
   */
  paragraph: {
    content: 'inline*',
    group: 'block',
    attrs: { ...blockIdAttr },
    parseDOM: [{ tag: 'p' }],
    toDOM(node) {
      return ['p', { 'data-block-id': node.attrs.id, 'data-block-type': 'paragraph', class: 'void-paragraph' }, 0];
    },
  },

  /**
   * Heading block
   * Supports levels 1-6 (h1-h6)
   */
  heading: {
    content: 'inline*',
    group: 'block',
    attrs: {
      ...blockIdAttr,
      level: { default: 1 },
    },
    parseDOM: [
      { tag: 'h1', getAttrs: () => ({ level: 1 }) },
      { tag: 'h2', getAttrs: () => ({ level: 2 }) },
      { tag: 'h3', getAttrs: () => ({ level: 3 }) },
      { tag: 'h4', getAttrs: () => ({ level: 4 }) },
      { tag: 'h5', getAttrs: () => ({ level: 5 }) },
      { tag: 'h6', getAttrs: () => ({ level: 6 }) },
    ],
    toDOM(node) {
      const tag = `h${node.attrs.level}` as keyof HTMLElementTagNameMap;
      return [tag, { 'data-block-id': node.attrs.id, 'data-block-type': `heading${node.attrs.level}`, class: `void-heading void-h${node.attrs.level}` }, 0];
    },
  },

  /**
   * Bullet list container
   * Contains one or more list items
   */
  bulletList: {
    content: 'listItem+',
    group: 'block',
    attrs: { ...blockIdAttr },
    parseDOM: [{ tag: 'ul' }],
    toDOM(node) {
      return ['ul', { 'data-block-id': node.attrs.id, 'data-block-type': 'bulletList', class: 'void-bullet-list' }, 0];
    },
  },

  /**
   * Ordered list container
   * Contains one or more list items with a start number
   */
  orderedList: {
    content: 'listItem+',
    group: 'block',
    attrs: {
      ...blockIdAttr,
      start: { default: 1 },
    },
    parseDOM: [
      {
        tag: 'ol',
        getAttrs: (dom: HTMLElement) => ({
          start: parseInt(dom.getAttribute('start') || '1', 10),
        }),
      },
    ],
    toDOM(node) {
      return [
        'ol',
        {
          'data-block-id': node.attrs.id,
          'data-block-type': 'orderedList',
          start: node.attrs.start,
          class: 'void-ordered-list',
        },
        0,
      ];
    },
  },

  /**
   * List item
   * Contains a paragraph and optionally nested blocks
   */
  listItem: {
    content: 'paragraph block*',
    attrs: { ...blockIdAttr },
    parseDOM: [{ tag: 'li' }],
    toDOM(node) {
      return ['li', { 'data-block-id': node.attrs.id, 'data-block-type': 'listItem', class: 'void-list-item' }, 0];
    },
    defining: true,
  },

  /**
   * Todo item
   * Checkbox-based task item with checked state
   */
  todoItem: {
    content: 'inline*',
    group: 'block',
    attrs: {
      ...blockIdAttr,
      checked: { default: false },
    },
    parseDOM: [
      {
        tag: 'div[data-type="todo"]',
        getAttrs: (dom: HTMLElement) => ({
          checked: dom.getAttribute('data-checked') === 'true',
        }),
      },
    ],
    toDOM(node) {
      return [
        'div',
        {
          'data-block-id': node.attrs.id,
          'data-block-type': 'todoItem',
          'data-type': 'todo',
          'data-checked': String(node.attrs.checked),
          class: `void-todo ${node.attrs.checked ? 'void-todo-checked' : ''}`,
        },
        [
          'input',
          {
            type: 'checkbox',
            ...(node.attrs.checked ? { checked: 'checked' } : {}),
          },
        ],
        ['span', { class: 'void-todo-content' }, 0],
      ];
    },
  },

  /**
   * Blockquote
   * Container for quoted content, can nest other blocks
   */
  blockquote: {
    content: 'block+',
    group: 'block',
    attrs: { ...blockIdAttr },
    parseDOM: [{ tag: 'blockquote' }],
    toDOM(node) {
      return ['blockquote', { 'data-block-id': node.attrs.id, 'data-block-type': 'blockquote', class: 'void-blockquote' }, 0];
    },
    defining: true,
  },

  /**
   * Code block
   * Preformatted code with optional language highlighting
   */
  codeBlock: {
    content: 'text*',
    group: 'block',
    attrs: {
      ...blockIdAttr,
      language: { default: null as string | null },
      meta: { default: null as string | null },
    },
    code: true,
    defining: true,
    parseDOM: [
      {
        tag: 'pre',
        preserveWhitespace: 'full' as const,
        getAttrs: (dom: HTMLElement) => ({
          language: dom.getAttribute('data-language'),
          meta: dom.getAttribute('data-meta'),
        }),
      },
    ],
    toDOM(node) {
      return [
        'pre',
        {
          'data-block-id': node.attrs.id,
          'data-block-type': 'codeBlock',
          'data-language': node.attrs.language,
          'data-meta': node.attrs.meta,
          class: 'void-code-block',
        },
        ['code', 0],
      ];
    },
  },

  /**
   * Horizontal rule
   * Visual divider between sections
   */
  horizontalRule: {
    group: 'block',
    attrs: { ...blockIdAttr },
    parseDOM: [{ tag: 'hr' }],
    toDOM(node) {
      return ['hr', { 'data-block-id': node.attrs.id, 'data-block-type': 'horizontalRule', class: 'void-divider' }];
    },
  },

  /**
   * Callout block
   * Highlighted information box with variant (info, warning, error, success, note)
   */
  callout: {
    content: 'block+',
    group: 'block',
    attrs: {
      ...blockIdAttr,
      variant: { default: 'info' as 'info' | 'warning' | 'error' | 'success' | 'note' },
    },
    parseDOM: [
      {
        tag: 'div[data-type="callout"]',
        getAttrs: (dom: HTMLElement) => ({
          variant: dom.getAttribute('data-variant') || 'info',
        }),
      },
    ],
    toDOM(node) {
      return [
        'div',
        {
          'data-block-id': node.attrs.id,
          'data-block-type': 'callout',
          'data-type': 'callout',
          'data-variant': node.attrs.variant,
          class: `void-callout void-callout-${node.attrs.variant}`,
        },
        0,
      ];
    },
  },

  /**
   * Image block
   * Embedded image with optional dimensions, metadata, and caption
   */
  image: {
    group: 'block',
    attrs: {
      ...blockIdAttr,
      src: { default: '' },
      alt: { default: null as string | null },
      title: { default: null as string | null },
      caption: { default: null as string | null },
      width: { default: null as number | null },
    },
    parseDOM: [
      {
        tag: 'figure[data-type="image"]',
        getAttrs: (dom: HTMLElement) => {
          const img = dom.querySelector('img');
          const figcaption = dom.querySelector('figcaption');
          return {
            src: img?.getAttribute('src') || '',
            alt: img?.getAttribute('alt'),
            title: img?.getAttribute('title'),
            caption: figcaption?.textContent || null,
            width: img?.getAttribute('width') ? parseInt(img.getAttribute('width')!, 10) : null,
          };
        },
      },
      {
        tag: 'img[src]',
        getAttrs: (dom: HTMLElement) => ({
          src: dom.getAttribute('src'),
          alt: dom.getAttribute('alt'),
          title: dom.getAttribute('title'),
          caption: null,
          width: dom.getAttribute('width') ? parseInt(dom.getAttribute('width')!, 10) : null,
        }),
      },
    ],
    toDOM(node) {
      const imgAttrs: Record<string, string | number | null> = {
        src: node.attrs.src,
        class: 'void-image-img',
      };
      if (node.attrs.alt) imgAttrs.alt = node.attrs.alt;
      if (node.attrs.title) imgAttrs.title = node.attrs.title;
      if (node.attrs.width) imgAttrs.width = node.attrs.width;

      // If there's a caption, wrap in figure
      if (node.attrs.caption) {
        return [
          'figure',
          { 'data-block-id': node.attrs.id, 'data-block-type': 'image', 'data-type': 'image', class: 'void-image' },
          ['img', imgAttrs],
          ['figcaption', { class: 'void-image-caption' }, node.attrs.caption],
        ];
      }

      // Without caption, return simple img wrapped in figure for consistency
      return [
        'figure',
        { 'data-block-id': node.attrs.id, 'data-block-type': 'image', 'data-type': 'image', class: 'void-image' },
        ['img', imgAttrs],
      ];
    },
  },

  /**
   * Toggle/Collapsible block
   * Expandable content section with a summary header
   */
  toggle: {
    content: 'toggleSummary toggleContent',
    group: 'block',
    attrs: {
      ...blockIdAttr,
      open: { default: false },
    },
    parseDOM: [
      {
        tag: 'details',
        getAttrs: (dom: HTMLElement) => ({
          open: dom.hasAttribute('open'),
        }),
      },
    ],
    toDOM(node) {
      return [
        'details',
        {
          'data-block-id': node.attrs.id,
          'data-block-type': 'toggle',
          class: 'void-toggle',
          ...(node.attrs.open ? { open: 'open' } : {}),
        },
        0,
      ];
    },
  },

  /**
   * Toggle summary
   * The always-visible header of a toggle block
   */
  toggleSummary: {
    content: 'inline*',
    parseDOM: [{ tag: 'summary' }],
    toDOM() {
      return ['summary', { class: 'void-toggle-summary' }, 0];
    },
  },

  /**
   * Toggle content
   * The collapsible content of a toggle block
   */
  toggleContent: {
    content: 'block+',
    parseDOM: [{ tag: 'div[data-type="toggle-content"]' }],
    toDOM() {
      return ['div', { 'data-type': 'toggle-content', class: 'void-toggle-content' }, 0];
    },
  },

  /**
   * Table block
   * Container for table rows
   */
  table: {
    content: 'tableRow+',
    group: 'block',
    attrs: { ...blockIdAttr },
    tableRole: 'table',
    isolating: true,
    parseDOM: [{ tag: 'table' }],
    toDOM(node) {
      return ['table', { 'data-block-id': node.attrs.id, 'data-block-type': 'table', class: 'void-table' }, ['tbody', 0]];
    },
  },

  /**
   * Table row
   * Container for table cells
   */
  tableRow: {
    content: '(tableCell | tableHeader)+',
    attrs: { ...blockIdAttr },
    tableRole: 'row',
    parseDOM: [{ tag: 'tr' }],
    toDOM(node) {
      return ['tr', { 'data-block-id': node.attrs.id, class: 'void-table-row' }, 0];
    },
  },

  /**
   * Table cell
   * Standard table cell with optional colspan/rowspan
   */
  tableCell: {
    content: 'block+',
    attrs: {
      ...blockIdAttr,
      colspan: { default: 1 },
      rowspan: { default: 1 },
    },
    tableRole: 'cell',
    isolating: true,
    parseDOM: [
      {
        tag: 'td',
        getAttrs: (dom: HTMLElement) => ({
          colspan: parseInt(dom.getAttribute('colspan') || '1', 10),
          rowspan: parseInt(dom.getAttribute('rowspan') || '1', 10),
        }),
      },
    ],
    toDOM(node) {
      const attrs: Record<string, string | number | null> = {
        'data-block-id': node.attrs.id,
        class: 'void-table-cell',
      };
      if (node.attrs.colspan !== 1) attrs.colspan = node.attrs.colspan;
      if (node.attrs.rowspan !== 1) attrs.rowspan = node.attrs.rowspan;
      return ['td', attrs, 0];
    },
  },

  /**
   * Table header cell
   * Header cell with optional colspan/rowspan
   */
  tableHeader: {
    content: 'block+',
    attrs: {
      ...blockIdAttr,
      colspan: { default: 1 },
      rowspan: { default: 1 },
    },
    tableRole: 'header_cell',
    isolating: true,
    parseDOM: [
      {
        tag: 'th',
        getAttrs: (dom: HTMLElement) => ({
          colspan: parseInt(dom.getAttribute('colspan') || '1', 10),
          rowspan: parseInt(dom.getAttribute('rowspan') || '1', 10),
        }),
      },
    ],
    toDOM(node) {
      const attrs: Record<string, string | number | null> = {
        'data-block-id': node.attrs.id,
        class: 'void-table-header',
      };
      if (node.attrs.colspan !== 1) attrs.colspan = node.attrs.colspan;
      if (node.attrs.rowspan !== 1) attrs.rowspan = node.attrs.rowspan;
      return ['th', attrs, 0];
    },
  },

  /**
   * Text node
   * Basic inline text content
   */
  text: {
    group: 'inline',
  },

  /**
   * Hard break
   * Explicit line break within a block (Shift+Enter)
   */
  hardBreak: {
    inline: true,
    group: 'inline',
    selectable: false,
    parseDOM: [{ tag: 'br' }],
    toDOM() {
      return ['br'];
    },
  },
};
