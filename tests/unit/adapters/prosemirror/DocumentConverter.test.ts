/**
 * Unit tests for DocumentConverter — PM ↔ Domain conversion.
 *
 * Regression coverage for the listItem-flattening bug: editing list items
 * and round-tripping through proseMirrorToDomain → blockToPmNode used to
 * lose item text because pmNodeToBlock returned a paragraph block with
 * empty content and the real text trapped one level deeper. The fix
 * extracts inline text from the listItem's first paragraph child.
 */
import { describe, it, expect } from 'vitest';
import {
  domainToProseMirror,
  proseMirrorToDomain,
  pmNodeToBlock,
} from '$lib/adapters/prosemirror/DocumentConverter';
import { voidSchema } from '$lib/adapters/prosemirror/schema';
import type { Document } from '$lib/domain/entities/Document';
import { createDocumentMeta } from '$lib/domain/values/DocumentMeta';

function makeDoc(blocks: Document['blocks']): Document {
  return {
    meta: createDocumentMeta({ id: 'doc-test' }),
    path: 'test.md',
    blocks,
    isDirty: false,
  };
}

describe('DocumentConverter — listItem flattening', () => {
  it('extracts inline text from a listItem instead of nesting it', () => {
    const pm = voidSchema.nodes.bulletList.create({ id: 'list-1' }, [
      voidSchema.nodes.listItem.create({ id: 'li-1' }, [
        voidSchema.nodes.paragraph.create({ id: 'p-1' }, voidSchema.text('hello')),
      ]),
    ]);

    const block = pmNodeToBlock(pm);

    expect(block?.type).toBe('bulletList');
    expect(block?.children).toHaveLength(1);

    const item = block?.children[0];
    expect(item?.type).toBe('paragraph');
    expect(item?.content).toBe('hello');
    expect(item?.children).toEqual([]);
  });

  it('handles ordered lists the same way', () => {
    const pm = voidSchema.nodes.orderedList.create({ id: 'ol-1', start: 1 }, [
      voidSchema.nodes.listItem.create({ id: 'li-a' }, [
        voidSchema.nodes.paragraph.create({ id: 'p-a' }, voidSchema.text('first')),
      ]),
      voidSchema.nodes.listItem.create({ id: 'li-b' }, [
        voidSchema.nodes.paragraph.create({ id: 'p-b' }, voidSchema.text('second')),
      ]),
    ]);

    const block = pmNodeToBlock(pm);

    expect(block?.type).toBe('numberedList');
    expect(block?.children.map((c) => c.content)).toEqual(['first', 'second']);
    expect(block?.children.every((c) => c.children.length === 0)).toBe(true);
  });

  it('round-trips a bullet list without losing item text', () => {
    const base = makeDoc([
      {
        id: 'list-1',
        type: 'bulletList',
        content: '',
        marks: [],
        attrs: { type: 'bulletList' },
        children: [
          {
            id: 'p-a',
            type: 'paragraph',
            content: 'a',
            marks: [],
            children: [],
            attrs: { type: 'paragraph' },
          },
          {
            id: 'p-b',
            type: 'paragraph',
            content: 'b',
            marks: [],
            children: [],
            attrs: { type: 'paragraph' },
          },
        ],
      },
    ]);

    const pmDoc = domainToProseMirror(base);
    const out = proseMirrorToDomain(pmDoc, base);

    expect(out.blocks[0]?.type).toBe('bulletList');
    expect(out.blocks[0]?.children.map((c) => c.content)).toEqual(['a', 'b']);
    expect(
      out.blocks[0]?.children.every(
        (c) => c.type === 'paragraph' && c.children.length === 0,
      ),
    ).toBe(true);
  });

  it('preserves inline marks on list items through the round-trip', () => {
    const bold = voidSchema.marks.bold.create();
    const pm = voidSchema.nodes.bulletList.create({ id: 'l1' }, [
      voidSchema.nodes.listItem.create({ id: 'i1' }, [
        voidSchema.nodes.paragraph.create({ id: 'p1' }, voidSchema.text('hi', [bold])),
      ]),
    ]);

    const block = pmNodeToBlock(pm);
    const item = block?.children[0];

    expect(item?.content).toBe('hi');
    expect(item?.marks?.some((m) => m.type === 'bold')).toBe(true);
    expect(item?.spans?.[0]?.marks.some((m) => m.type === 'bold')).toBe(true);
  });

  it('handles an empty list item without throwing', () => {
    const pm = voidSchema.nodes.bulletList.create({ id: 'l1' }, [
      voidSchema.nodes.listItem.create({ id: 'i1' }, [
        voidSchema.nodes.paragraph.create({ id: 'p1' }),
      ]),
    ]);

    const block = pmNodeToBlock(pm);
    const item = block?.children[0];

    expect(item?.type).toBe('paragraph');
    expect(item?.content).toBe('');
    expect(item?.spans).toBeUndefined();
  });

  it('round-trips a nested (sub-level) list item without losing it', () => {
    // bulletList
    //   listItem
    //     paragraph "outer"
    //     bulletList
    //       listItem
    //         paragraph "nested"
    const inner = voidSchema.nodes.bulletList.create({ id: 'inner' }, [
      voidSchema.nodes.listItem.create({ id: 'inner-li' }, [
        voidSchema.nodes.paragraph.create({ id: 'inner-p' }, voidSchema.text('nested')),
      ]),
    ]);
    const outer = voidSchema.nodes.bulletList.create({ id: 'outer' }, [
      voidSchema.nodes.listItem.create({ id: 'outer-li' }, [
        voidSchema.nodes.paragraph.create({ id: 'outer-p' }, voidSchema.text('outer')),
        inner,
      ]),
    ]);

    // Pretend this came from the editor — convert PM → domain and back.
    const block = pmNodeToBlock(outer);
    expect(block?.type).toBe('bulletList');
    const outerPara = block?.children[0];
    expect(outerPara?.content).toBe('outer');
    expect(outerPara?.children).toHaveLength(1);
    expect(outerPara?.children[0]?.type).toBe('bulletList');
    expect(outerPara?.children[0]?.children[0]?.content).toBe('nested');

    // Round-trip back to PM and assert the nested list survives.
    const base: Document = {
      meta: createDocumentMeta({ id: 'doc-test' }),
      path: 'test.md',
      blocks: [block!],
      isDirty: false,
    };
    const docPm = domainToProseMirror(base);
    expect(docPm.type.name).toBe('doc');
    const outerListPm = docPm.firstChild!;
    expect(outerListPm.type.name).toBe('bulletList');
    const outerLiPm = outerListPm.firstChild!;
    expect(outerLiPm.type.name).toBe('listItem');
    expect(outerLiPm.firstChild?.type.name).toBe('paragraph');
    expect(outerLiPm.firstChild?.textContent).toBe('outer');
    expect(outerLiPm.childCount).toBe(2);
    const innerListPm = outerLiPm.child(1);
    expect(innerListPm.type.name).toBe('bulletList');
    expect(innerListPm.firstChild?.type.name).toBe('listItem');
    expect(innerListPm.firstChild?.textContent).toBe('nested');

    // And one more PM → domain to confirm stability across cycles.
    const reDomain = proseMirrorToDomain(docPm, base);
    const reOuter = reDomain.blocks[0]?.children[0];
    expect(reOuter?.content).toBe('outer');
    expect(reOuter?.children[0]?.children[0]?.content).toBe('nested');
  });
});
