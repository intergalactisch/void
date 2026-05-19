/**
 * ProseMirror Mark Definitions
 *
 * Inline mark specifications for the void editor schema.
 * Marks are applied to text ranges to add formatting:
   * - bold, italic, underline, strikethrough
   * - code (inline code), highlight
 * - link (hyperlinks)
 * - aiProcessing (AI rewrite indicator)
 *
 * Part of the ProseMirror infrastructure adapter.
 */

import type { MarkSpec, Mark } from 'prosemirror-model';

export const marks: Record<string, MarkSpec> = {
  /**
   * Bold mark
   * Rendered as <strong>, parses from <b>, <strong>, or font-weight styles
   */
  bold: {
    parseDOM: [
      { tag: 'strong' },
      {
        tag: 'b',
        getAttrs: (node: HTMLElement) => (node.style.fontWeight !== 'normal' ? null : false),
      },
      {
        style: 'font-weight=400',
        clearMark: (m: Mark) => m.type.name === 'bold',
      },
      {
        style: 'font-weight',
        getAttrs: (value: string) => (/^(bold(er)?|[5-9]\d{2,})$/.test(value) ? null : false),
      },
    ],
    toDOM() {
      return ['strong', 0];
    },
  },

  /**
   * Italic mark
   * Rendered as <em>, parses from <i>, <em>, or font-style: italic
   */
  italic: {
    parseDOM: [{ tag: 'i' }, { tag: 'em' }, { style: 'font-style=italic' }],
    toDOM() {
      return ['em', 0];
    },
  },

  /**
   * Underline mark
   * Rendered as <u>, parses from <u> or text-decoration: underline
   */
  underline: {
    parseDOM: [{ tag: 'u' }, { style: 'text-decoration=underline' }],
    toDOM() {
      return ['u', 0];
    },
  },

  /**
   * Strikethrough mark
   * Rendered as <s>, parses from <s>, <strike>, <del>, or text-decoration: line-through
   */
  strikethrough: {
    parseDOM: [
      { tag: 's' },
      { tag: 'strike' },
      { tag: 'del' },
      { style: 'text-decoration=line-through' },
    ],
    toDOM() {
      return ['s', 0];
    },
  },

  /**
   * Inline code mark
   * Rendered as <code> with void-inline-code class
   */
  code: {
    parseDOM: [{ tag: 'code' }],
    toDOM() {
      return ['code', { class: 'void-inline-code' }, 0];
    },
  },

  /**
   * Highlight mark
   * Rendered as portable <mark>; colored highlights carry a data-color attr.
   */
  highlight: {
    attrs: {
      color: { default: 'yellow' },
    },
    parseDOM: [
      {
        tag: 'mark',
        getAttrs: (dom: HTMLElement) => ({
          color: dom.getAttribute('data-color') || 'yellow',
        }),
      },
      {
        tag: 'span[data-highlight]',
        getAttrs: (dom: HTMLElement) => ({
          color: dom.getAttribute('data-highlight') || 'yellow',
        }),
      },
      {
        style: 'background-color',
        getAttrs: (value: string) => ({ color: value || 'yellow' }),
      },
    ],
    toDOM(node) {
      const color = (node.attrs.color as string) || 'yellow';
      return [
        'mark',
        {
          'data-color': color,
          class: `void-highlight void-highlight-${color}`,
        },
        0,
      ];
    },
  },

  /**
   * Link mark
   * Hyperlink with href and optional title
   * Non-inclusive: typing at the end of a link does not extend it
   */
  link: {
    attrs: {
      href: { default: '' },
      title: { default: null as string | null },
    },
    inclusive: false,
    parseDOM: [
      {
        tag: 'a[href]',
        getAttrs: (dom: HTMLElement) => ({
          href: dom.getAttribute('href'),
          title: dom.getAttribute('title'),
        }),
      },
    ],
    toDOM(node) {
      const attrs: Record<string, string | null> = {
        href: node.attrs.href,
        class: 'void-link',
      };
      if (node.attrs.title) attrs.title = node.attrs.title;
      return ['a', attrs, 0];
    },
  },

  /**
   * AI Processing mark
   * Used to highlight text being processed by AI operations
   * Non-inclusive: AI processing markers don't extend to new text
   */
  aiProcessing: {
    attrs: {
      operation: { default: 'rewrite' as 'rewrite' | 'expand' | 'summarize' | 'fix-grammar' },
    },
    inclusive: false,
    parseDOM: [
      {
        tag: 'span[data-ai-processing]',
        getAttrs: (dom: HTMLElement) => ({
          operation: dom.getAttribute('data-ai-operation') || 'rewrite',
        }),
      },
    ],
    toDOM(node) {
      return [
        'span',
        {
          'data-ai-processing': 'true',
          'data-ai-operation': node.attrs.operation,
          class: 'void-ai-processing',
        },
        0,
      ];
    },
  },

  /**
   * Page Link mark
   * Internal wiki-style link to another note
   * Non-inclusive: typing at the end of a link does not extend it
   */
  pageLink: {
    attrs: {
      href: { default: '' },
      title: { default: null as string | null },
    },
    inclusive: false,
    parseDOM: [
      {
        tag: 'a[data-page-link]',
        getAttrs: (dom: HTMLElement) => ({
          href: dom.getAttribute('href'),
          title: dom.getAttribute('title') || dom.textContent,
        }),
      },
    ],
    toDOM(node) {
      const attrs: Record<string, string | null> = {
        href: node.attrs.href,
        'data-page-link': 'true',
        class: 'void-page-link',
      };
      if (node.attrs.title) attrs.title = node.attrs.title;
      return ['a', attrs, 0];
    },
  },
};
