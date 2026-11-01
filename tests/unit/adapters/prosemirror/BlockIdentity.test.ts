import { describe, expect, it, vi } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { voidSchema as schema } from '$lib/adapters/prosemirror/schema';
import { repairBlockIdentities } from '$lib/adapters/prosemirror/blockIdentity';

const paragraph = (id: string | null, text = 'text') => schema.node('paragraph', { id }, schema.text(text));

describe('block identity maintenance', () => {
  it('does not traverse a 10,000-block document for ordinary typing or inline formatting', () => {
    const state = EditorState.create({ schema, doc: schema.node('doc', null, Array.from({ length: 10000 }, (_, index) => paragraph(String(index)))) });
    for (const tr of [state.tr.insertText('x', 2), state.tr.addMark(1, 3, schema.marks.bold!.create())]) {
      const next = state.apply(tr);
      const traversal = vi.spyOn(next.doc, 'descendants');
      expect(repairBlockIdentities(next, [tr])).toBeNull();
      expect(traversal).not.toHaveBeenCalled();
      traversal.mockRestore();
    }
  });

  it('repairs duplicate and missing IDs after a block paste while preserving the original', () => {
    const state = EditorState.create({ schema, doc: schema.node('doc', null, paragraph('original')) });
    const tr = state.tr.insert(state.doc.content.size, [paragraph('original'), paragraph(null)]);
    const next = state.apply(tr);
    const repair = repairBlockIdentities(next, [tr]);
    expect(repair).not.toBeNull();
    const result = next.apply(repair!);
    const ids: string[] = [];
    result.doc.forEach(node => ids.push(node.attrs.id));
    expect(ids[0]).toBe('original');
    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(3);
    expect(result.doc.textContent).toBe('texttexttext');
  });

  it('also checks appended structural transactions', () => {
    const state = EditorState.create({ schema, doc: schema.node('doc', null, paragraph('original')) });
    const selectionOnly = state.tr;
    const append = state.tr.insert(state.doc.content.size, paragraph('original'));
    expect(repairBlockIdentities(state.apply(append), [selectionOnly, append])).not.toBeNull();
  });
});
