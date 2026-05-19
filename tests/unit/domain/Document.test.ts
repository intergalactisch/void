/**
 * Unit tests for Document entity
 */
import { describe, it, expect } from 'vitest';
import {
  createDocument,
  extractTitle,
  countWords,
  findBlock,
} from '$lib/domain/entities/Document';
import type { Document } from '$lib/domain/entities/Document';
import { createBlock } from '$lib/domain/entities/Block';

describe('Document entity', () => {
  describe('createDocument()', () => {
    it('creates document with default title', () => {
      const doc = createDocument('/notes/test.md');
      expect(doc.path).toBe('/notes/test.md');
      expect(doc.meta.title).toBe('Untitled');
      expect(doc.isDirty).toBe(false);
    });

    it('creates document with custom title', () => {
      const doc = createDocument('/notes/test.md', 'My Note');
      expect(doc.meta.title).toBe('My Note');
    });

    it('initializes with empty paragraph block', () => {
      const doc = createDocument('/notes/test.md');
      expect(doc.blocks).toHaveLength(1);
      expect(doc.blocks[0]?.type).toBe('paragraph');
      expect(doc.blocks[0]?.content).toBe('');
    });

    it('generates unique document meta id', () => {
      const doc1 = createDocument('/notes/a.md');
      const doc2 = createDocument('/notes/b.md');
      expect(doc1.meta.id).not.toBe(doc2.meta.id);
    });
  });

  describe('extractTitle()', () => {
    it('returns meta title for document without headings', () => {
      const doc: Document = {
        path: '/test.md',
        meta: {
          id: 'doc-1',
          title: 'Meta Title',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        blocks: [createBlock('paragraph', 'Some text')],
        isDirty: false,
      };
      expect(extractTitle(doc)).toBe('Meta Title');
    });

    it('returns first heading content if present', () => {
      const doc: Document = {
        path: '/test.md',
        meta: {
          id: 'doc-1',
          title: 'Meta Title',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        blocks: [
          createBlock('heading1', 'Heading Title'),
          createBlock('paragraph', 'Some text'),
        ],
        isDirty: false,
      };
      expect(extractTitle(doc)).toBe('Heading Title');
    });

    it('prioritizes any heading type', () => {
      const doc: Document = {
        path: '/test.md',
        meta: {
          id: 'doc-1',
          title: 'Meta Title',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        blocks: [
          createBlock('paragraph', 'Intro'),
          createBlock('heading2', 'H2 Title'),
        ],
        isDirty: false,
      };
      expect(extractTitle(doc)).toBe('H2 Title');
    });
  });

  describe('countWords()', () => {
    it('counts words across all blocks', () => {
      const doc: Document = {
        path: '/test.md',
        meta: {
          id: 'doc-1',
          title: 'Test',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        blocks: [
          createBlock('heading1', 'Three Word Title'),
          createBlock('paragraph', 'This paragraph has five words.'),
        ],
        isDirty: false,
      };
      expect(countWords(doc)).toBe(8);
    });

    it('returns 0 for empty document', () => {
      const doc: Document = {
        path: '/test.md',
        meta: {
          id: 'doc-1',
          title: 'Test',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        blocks: [],
        isDirty: false,
      };
      expect(countWords(doc)).toBe(0);
    });

    it('handles multiple spaces correctly', () => {
      const doc: Document = {
        path: '/test.md',
        meta: {
          id: 'doc-1',
          title: 'Test',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        blocks: [createBlock('paragraph', 'word1  word2   word3')],
        isDirty: false,
      };
      expect(countWords(doc)).toBe(3);
    });
  });

  describe('findBlock()', () => {
    it('finds block at root level', () => {
      const targetBlock = createBlock('paragraph', 'Target');
      const doc: Document = {
        path: '/test.md',
        meta: {
          id: 'doc-1',
          title: 'Test',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        blocks: [
          createBlock('heading1', 'Title'),
          targetBlock,
        ],
        isDirty: false,
      };

      const found = findBlock(doc, targetBlock.id);
      expect(found).toBe(targetBlock);
    });

    it('finds nested block in children', () => {
      const nestedBlock = createBlock('listItem', 'Nested item');
      const listBlock = createBlock('bulletList', '');
      listBlock.children = [nestedBlock];

      const doc: Document = {
        path: '/test.md',
        meta: {
          id: 'doc-1',
          title: 'Test',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        blocks: [listBlock],
        isDirty: false,
      };

      const found = findBlock(doc, nestedBlock.id);
      expect(found).toBe(nestedBlock);
    });

    it('returns null for non-existent block', () => {
      const doc: Document = {
        path: '/test.md',
        meta: {
          id: 'doc-1',
          title: 'Test',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        blocks: [createBlock('paragraph', 'Content')],
        isDirty: false,
      };

      const found = findBlock(doc, 'non-existent-id');
      expect(found).toBeNull();
    });

    it('finds deeply nested blocks', () => {
      const deepBlock = createBlock('paragraph', 'Deep');
      const level2 = createBlock('blockquote', '');
      level2.children = [deepBlock];
      const level1 = createBlock('listItem', '');
      level1.children = [level2];
      const rootList = createBlock('bulletList', '');
      rootList.children = [level1];

      const doc: Document = {
        path: '/test.md',
        meta: {
          id: 'doc-1',
          title: 'Test',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        blocks: [rootList],
        isDirty: false,
      };

      const found = findBlock(doc, deepBlock.id);
      expect(found).toBe(deepBlock);
    });
  });
});
