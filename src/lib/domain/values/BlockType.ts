/**
 * BlockType value object - defines all supported block types in the editor
 *
 * This is a pure domain value with ZERO external dependencies.
 * Part of the Hexagonal Architecture domain layer.
 */

export const BLOCK_TYPES = [
  'paragraph',
  'heading1',
  'heading2',
  'heading3',
  'heading4',
  'heading5',
  'heading6',
  'bulletList',
  'numberedList',
  'todoItem',
  'blockquote',
  'codeBlock',
  'horizontalRule',
  'image',
  'callout',
  'toggle',
  'table',
] as const;

export type BlockType = (typeof BLOCK_TYPES)[number];

export const HEADING_TYPES = [
  'heading1',
  'heading2',
  'heading3',
  'heading4',
  'heading5',
  'heading6',
] as const;

export type HeadingType = (typeof HEADING_TYPES)[number];

export function isHeading(type: BlockType): type is HeadingType {
  return HEADING_TYPES.includes(type as HeadingType);
}

export function getHeadingLevel(type: HeadingType): number {
  return parseInt(type.replace('heading', ''), 10);
}
