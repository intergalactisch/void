/**
 * Mark value object - defines inline formatting marks
 *
 * This is a pure domain value with ZERO external dependencies.
 * Part of the Hexagonal Architecture domain layer.
 */

export const MARK_TYPES = [
  'bold',
  'italic',
  'underline',
  'strikethrough',
  'code',
  'link',
  'pageLink',
  'highlight',
] as const;

export type MarkType = (typeof MARK_TYPES)[number];

export interface Mark {
  type: MarkType;
  attrs?: Record<string, unknown>;
}

export interface LinkMark extends Mark {
  type: 'link';
  attrs: { href: string; title?: string };
}

export interface PageLinkMark extends Mark {
  type: 'pageLink';
  attrs: { href: string; title?: string };
}

export interface HighlightMark extends Mark {
  type: 'highlight';
  attrs: { color: string };
}

export function createMark(type: MarkType, attrs?: Record<string, unknown>): Mark {
  if (attrs !== undefined) {
    return { type, attrs };
  }
  return { type };
}

export function createLinkMark(href: string, title?: string): LinkMark {
  if (title !== undefined) {
    return { type: 'link', attrs: { href, title } };
  }
  return { type: 'link', attrs: { href } };
}

export function createPageLinkMark(href: string, title?: string): PageLinkMark {
  if (title !== undefined) {
    return { type: 'pageLink', attrs: { href, title } };
  }
  return { type: 'pageLink', attrs: { href } };
}

export function createHighlightMark(color = 'yellow'): HighlightMark {
  return { type: 'highlight', attrs: { color } };
}
