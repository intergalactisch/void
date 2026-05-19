/**
 * Document entity - represents a note/document in the editor
 *
 * This is a pure domain entity with ZERO external dependencies.
 * Part of the Hexagonal Architecture domain layer.
 */

import type { Block } from './Block';
import type { DocumentMeta } from '../values/DocumentMeta';
import { createEmptyParagraph } from './Block';
import { createDocumentMeta } from '../values/DocumentMeta';

export interface Document {
  /** Document metadata */
  meta: DocumentMeta;
  /** File path (relative to notes folder) */
  path: string;
  /** Root-level blocks */
  blocks: Block[];
  /** Whether document has unsaved changes */
  isDirty: boolean;
}

/** Create a new empty document */
export function createDocument(path: string, title?: string): Document {
  const id = `doc-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  return {
    meta: createDocumentMeta({ id, title: title ?? 'Untitled' }),
    path,
    blocks: [createEmptyParagraph()],
    isDirty: false,
  };
}

/** Extract title from document (first heading or meta title) */
export function extractTitle(doc: Document): string {
  const firstHeading = doc.blocks.find((b) => b.type.startsWith('heading'));
  return firstHeading?.content || doc.meta.title;
}

/** Count words in document */
export function countWords(doc: Document): number {
  return doc.blocks
    .map((b) => b.content)
    .join(' ')
    .split(/\s+/)
    .filter((w) => w.length > 0).length;
}

/** Find block by ID (searches recursively through children) */
export function findBlock(doc: Document, blockId: string): Block | null {
  function search(blocks: Block[]): Block | null {
    for (const block of blocks) {
      if (block.id === blockId) return block;
      const found = search(block.children);
      if (found) return found;
    }
    return null;
  }
  return search(doc.blocks);
}
