/**
 * Unit tests for Block entity
 */
import { describe, it, expect } from 'vitest';
import {
  generateBlockId,
  createBlock,
  createEmptyParagraph,
} from '$lib/domain/entities/Block';

describe('Block entity', () => {
  describe('generateBlockId()', () => {
    it('generates unique IDs', () => {
      const id1 = generateBlockId();
      const id2 = generateBlockId();
      expect(id1).not.toBe(id2);
    });

    it('starts with "block-" prefix', () => {
      const id = generateBlockId();
      expect(id.startsWith('block-')).toBe(true);
    });

    it('contains timestamp and random part', () => {
      const id = generateBlockId();
      const parts = id.split('-');
      expect(parts.length).toBeGreaterThanOrEqual(3);
      // Second part should be numeric (timestamp)
      expect(Number.isNaN(Number(parts[1]))).toBe(false);
    });
  });

  describe('createBlock()', () => {
    it('creates block with required fields', () => {
      const block = createBlock('paragraph', 'Hello world');

      expect(block.id).toBeDefined();
      expect(block.type).toBe('paragraph');
      expect(block.content).toBe('Hello world');
      expect(block.marks).toEqual([]);
      expect(block.children).toEqual([]);
    });

    it('defaults content to empty string', () => {
      const block = createBlock('paragraph');
      expect(block.content).toBe('');
    });

    it('creates heading blocks', () => {
      const h1 = createBlock('heading1', 'Title');
      const h2 = createBlock('heading2', 'Subtitle');
      const h3 = createBlock('heading3', 'Section');

      expect(h1.type).toBe('heading1');
      expect(h2.type).toBe('heading2');
      expect(h3.type).toBe('heading3');
    });

    it('creates list blocks', () => {
      const bulletList = createBlock('bulletList');
      const orderedList = createBlock('orderedList');
      const listItem = createBlock('listItem', 'Item content');

      expect(bulletList.type).toBe('bulletList');
      expect(orderedList.type).toBe('orderedList');
      expect(listItem.type).toBe('listItem');
    });

    it('creates code block with language attribute', () => {
      const codeBlock = createBlock('codeBlock', 'const x = 1;', {
        type: 'codeBlock',
        language: 'typescript',
      });

      expect(codeBlock.type).toBe('codeBlock');
      expect(codeBlock.attrs).toEqual({
        type: 'codeBlock',
        language: 'typescript',
      });
    });

    it('creates blockquote', () => {
      const quote = createBlock('blockquote', 'Quoted text');
      expect(quote.type).toBe('blockquote');
    });

    it('generates unique id for each block', () => {
      const block1 = createBlock('paragraph', 'One');
      const block2 = createBlock('paragraph', 'Two');
      expect(block1.id).not.toBe(block2.id);
    });
  });

  describe('createEmptyParagraph()', () => {
    it('creates paragraph with empty content', () => {
      const para = createEmptyParagraph();
      expect(para.type).toBe('paragraph');
      expect(para.content).toBe('');
    });

    it('has no marks', () => {
      const para = createEmptyParagraph();
      expect(para.marks).toEqual([]);
    });

    it('has no children', () => {
      const para = createEmptyParagraph();
      expect(para.children).toEqual([]);
    });

    it('has unique id', () => {
      const para1 = createEmptyParagraph();
      const para2 = createEmptyParagraph();
      expect(para1.id).not.toBe(para2.id);
    });
  });
});
