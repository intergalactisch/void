/**
 * Document fixtures for testing
 */
import type { Document } from '$lib/domain/entities/Document';
import type { Block, BlockAttrs } from '$lib/domain/entities/Block';
import type { BlockType } from '$lib/domain/values/BlockType';
import { createDocumentMeta } from '$lib/domain/values/DocumentMeta';

function defaultAttrsForType(type: BlockType): BlockAttrs {
  switch (type) {
    case 'heading1':
      return { type: 'heading', level: 1 };
    case 'heading2':
      return { type: 'heading', level: 2 };
    case 'heading3':
      return { type: 'heading', level: 3 };
    case 'heading4':
      return { type: 'heading', level: 4 };
    case 'heading5':
      return { type: 'heading', level: 5 };
    case 'heading6':
      return { type: 'heading', level: 6 };
    case 'codeBlock':
      return { type: 'codeBlock', language: null };
    case 'image':
      return { type: 'image', src: '', alt: null, title: null, width: null };
    case 'todoItem':
      return { type: 'todoItem', checked: false };
    case 'callout':
      return { type: 'callout', variant: 'info' };
    case 'toggle':
      return { type: 'toggle', open: true };
    case 'table':
      return { type: 'table', rows: [] };
    case 'paragraph':
    default:
      return { type };
  }
}

export function createTestBlock(overrides: Partial<Block> = {}): Block {
  const type = overrides.type ?? 'paragraph';
  return {
    id: 'block-1',
    type,
    content: 'Test paragraph content',
    marks: [],
    children: [],
    attrs: overrides.attrs ?? defaultAttrsForType(type),
    ...overrides,
  };
}

export function createTestDocument(overrides: Partial<Document> = {}): Document {
  return {
    path: '/notes/test-note.md',
    meta: createDocumentMeta({
      id: 'doc-1',
      title: 'Test Note',
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01'),
    }),
    blocks: [createTestBlock()],
    isDirty: false,
    ...overrides,
  };
}

export function createEmptyDocument(): Document {
  return {
    path: '/notes/empty.md',
    meta: createDocumentMeta({
      id: 'empty-doc',
      title: 'Empty Note',
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
    blocks: [],
    isDirty: false,
  };
}

export function createDocumentWithHeadings(): Document {
  return {
    path: '/notes/headings.md',
    meta: createDocumentMeta({
      id: 'doc-headings',
      title: 'Document with Headings',
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
    blocks: [
      createTestBlock({ id: 'h1', type: 'heading1', content: 'Main Title' }),
      createTestBlock({ id: 'p1', type: 'paragraph', content: 'Intro paragraph.' }),
      createTestBlock({ id: 'h2', type: 'heading2', content: 'Section One' }),
      createTestBlock({ id: 'p2', type: 'paragraph', content: 'Section content.' }),
    ],
    isDirty: false,
  };
}

export function createDocumentWithLists(): Document {
  return {
    path: '/notes/lists.md',
    meta: createDocumentMeta({
      id: 'doc-lists',
      title: 'Document with Lists',
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
    blocks: [
      createTestBlock({ id: 'p1', type: 'paragraph', content: 'List below:' }),
      createTestBlock({
        id: 'ul',
        type: 'bulletList',
        content: '',
        children: [
          createTestBlock({ id: 'li1', type: 'paragraph', content: 'Item one' }),
          createTestBlock({ id: 'li2', type: 'paragraph', content: 'Item two' }),
          createTestBlock({ id: 'li3', type: 'paragraph', content: 'Item three' }),
        ],
      }),
    ],
    isDirty: false,
  };
}
