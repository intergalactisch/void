/**
 * Verify the Phase 1 consolidation — MarkdownAdapter's exported
 * converter functions delegate to DocumentConverter and surface
 * schema-validation failures as a typed BlockSerializationError
 * instead of silently substituting an empty paragraph.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  prosemirrorDocToBlocks,
  blocksToProsemirrorDoc,
} from '$lib/adapters/markdown/MarkdownAdapter';
import { voidSchema } from '$lib/adapters/prosemirror/schema';
import { BlockSerializationError } from '$lib/domain/errors';
import * as DocumentConverter from '$lib/adapters/prosemirror/DocumentConverter';
import type { Block } from '$lib/domain/entities/Block';

describe('MarkdownAdapter — converter wrappers', () => {
  it('round-trips a simple bullet list through both wrappers', () => {
    const blocks: Block[] = [
      {
        id: 'list',
        type: 'bulletList',
        content: '',
        marks: [],
        attrs: { type: 'bulletList' },
        children: [
          {
            id: 'p1', type: 'paragraph', content: 'a',
            marks: [], children: [], attrs: { type: 'paragraph' },
          },
          {
            id: 'p2', type: 'paragraph', content: 'b',
            marks: [], children: [], attrs: { type: 'paragraph' },
          },
        ],
      },
    ];

    const pmDoc = blocksToProsemirrorDoc(blocks);
    expect(pmDoc.type.name).toBe('doc');

    const out = prosemirrorDocToBlocks(pmDoc);
    expect(out[0]?.type).toBe('bulletList');
    expect(out[0]?.children.map((c) => c.content)).toEqual(['a', 'b']);
  });

  it('wraps converter throws as BlockSerializationError instead of swallowing them', () => {
    // ProseMirror's permissive `nodeType.create()` rarely throws on
    // invalid content, but if the underlying converter ever does throw,
    // the wrapper must surface a typed error pointing at the offending
    // block — never the silent empty-paragraph fallback that was
    // masking the listItem bug pre-Phase-1.
    const spy = vi
      .spyOn(DocumentConverter, 'blockToPmNode')
      .mockImplementation(() => {
        throw new Error('schema rejected');
      });

    const block: Block = {
      id: 'bad-block',
      type: 'paragraph',
      content: '',
      marks: [],
      children: [],
      attrs: { type: 'paragraph' },
    };

    let caught: unknown;
    try {
      blocksToProsemirrorDoc([block]);
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(BlockSerializationError);
    if (caught instanceof BlockSerializationError) {
      expect(caught.blockId).toBe('bad-block');
      expect(caught.blockType).toBe('paragraph');
      expect(caught.message).toContain('schema rejected');
      expect((caught as { cause?: unknown }).cause).toBeInstanceOf(Error);
    }

    spy.mockRestore();
  });

  it('produces a non-empty doc node even from an empty block list', () => {
    const pmDoc = blocksToProsemirrorDoc([]);
    expect(pmDoc.type.name).toBe('doc');
    expect(pmDoc.childCount).toBe(1);
    expect(pmDoc.firstChild?.type.name).toBe('paragraph');
  });

  it('uses the void schema (consistent with DocumentConverter)', () => {
    const blocks: Block[] = [
      { id: 'h', type: 'heading2', content: 'Hi', marks: [], children: [],
        attrs: { type: 'heading', level: 2 } },
    ];
    const pmDoc = blocksToProsemirrorDoc(blocks);
    expect(pmDoc.firstChild?.type.name).toBe('heading');
    expect(pmDoc.firstChild?.attrs.level).toBe(2);
    expect(voidSchema.nodes.heading).toBeDefined();
  });
});
