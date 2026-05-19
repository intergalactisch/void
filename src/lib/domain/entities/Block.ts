/**
 * Block entity - represents a content block in the editor
 *
 * This is a pure domain entity with ZERO external dependencies.
 * Part of the Hexagonal Architecture domain layer.
 */

import type { BlockType } from '../values/BlockType';
import type { Mark } from '../values/Mark';

export interface InlineSpan {
  /** Plain text for this inline segment */
  text: string;
  /** Marks that apply only to this segment */
  marks: Mark[];
}

export interface Block {
  /** Unique block identifier */
  id: string;
  /** Block type */
  type: BlockType;
  /** Text content (for inline content blocks) */
  content: string;
  /** Active marks on the content */
  marks: Mark[];
  /**
   * Optional segmented inline content. When present, this preserves mixed
   * formatting ranges during markdown/editor round-trips; `content` remains
   * the plain-text projection for search, counts, and legacy callers.
   */
  spans?: InlineSpan[];
  /** Child blocks (for lists, etc.) */
  children: Block[];
  /** Type-specific attributes */
  attrs: BlockAttrs;
}

export type BlockAttrs =
  | ParagraphAttrs
  | HeadingAttrs
  | CodeBlockAttrs
  | ImageAttrs
  | TodoAttrs
  | CalloutAttrs
  | ToggleAttrs
  | TableAttrs
  | LinkAttrs
  | BaseAttrs;

export interface BaseAttrs {
  type: string;
}

export interface ParagraphAttrs {
  type: 'paragraph';
}

export interface HeadingAttrs {
  type: 'heading';
  level: 1 | 2 | 3 | 4 | 5 | 6;
}

export interface CodeBlockAttrs {
  type: 'codeBlock';
  language: string | null;
}

export interface ImageAttrs {
  type: 'image';
  src: string;
  alt: string | null;
  title: string | null;
  caption?: string | null;
  width: number | null;
}

export interface TodoAttrs {
  type: 'todoItem';
  checked: boolean;
}

export interface CalloutAttrs {
  type: 'callout';
  variant: 'info' | 'warning' | 'error' | 'success' | 'note';
}

export interface ToggleAttrs {
  type: 'toggle';
  open: boolean;
}

export interface TableCellData {
  content: string;
  spans?: InlineSpan[];
  header?: boolean;
  colspan?: number;
  rowspan?: number;
}

export interface TableRowData {
  cells: TableCellData[];
}

export interface TableAttrs {
  type: 'table';
  rows: TableRowData[];
}

export interface LinkAttrs {
  type: 'link';
  href: string;
  title: string | null;
}

/** Generate unique block ID */
export function generateBlockId(): string {
  return `block-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** Create a new block with defaults */
export function createBlock(
  type: BlockType,
  content = '',
  attrs?: Partial<BlockAttrs>
): Block {
  return {
    id: generateBlockId(),
    type,
    content,
    marks: [],
    children: [],
    attrs: { type: type as string, ...attrs } as BlockAttrs,
  };
}

/** Create an empty paragraph block */
export function createEmptyParagraph(): Block {
  return createBlock('paragraph', '');
}
