import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { history, undo, redo } from 'prosemirror-history';
import { parseMarkdown } from '$lib/adapters/markdown/parser';
import { serializeToMarkdown } from '$lib/adapters/markdown/serializer';
import { proseMirrorToDomain } from '$lib/adapters/prosemirror/DocumentConverter';
import { createTestDocument } from '../fixtures/documents';
import { splitTodo } from '$lib/adapters/prosemirror/commands/todos';
import { performance } from 'node:perf_hooks';

export function complexNote(sections = 100): string {
  return Array.from({ length: sections }, (_, i) => `## Section ${i}\n\n` +
    'Text with **bold**, *italic*, [a link](https://example.com), \\*literal\\* and `inline code`.\n\n' +
    Array.from({ length: 10 }, (_, j) => `- [${j % 3 === 0 ? 'x' : ' '}] Task ${i}.${j}`).join('\n') +
    '\n\n- Parent\n  - Child\n    - Grandchild\n\n> First line\n>\n> Second paragraph\n\n' +
    '| Name | Value |\n| --- | --- |\n| Item | **strong** |\n\n' +
    '```ts title="example.ts"\nconst text = "- [ ] not a task";\nconsole.log(text);\n```\n').join('\n');
}

function withoutIds(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutIds);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'id').map(([key, child]) => [key, withoutIds(child)]));
  return value;
}

describe('large mixed Markdown notes', () => {
  it('preserves 1,000 tasks, nested lists, quotes, tables and formatting on repeated save round-trips', () => {
    const markdown = complexNote();
    const start = performance.now();
    const first = parseMarkdown(markdown);
    let doc = first;
    for (let pass = 0; pass < 3; pass++) doc = parseMarkdown(serializeToMarkdown(doc));
    let tasks = 0;
    doc.descendants(node => { if (node.type.name === 'todoItem') tasks++; });
    expect(tasks).toBe(1000);
    expect(withoutIds(doc.toJSON())).toEqual(withoutIds(first.toJSON()));
    const base = createTestDocument();
    const conversionStart = performance.now();
    for (let i = 0; i < 30; i++) proseMirrorToDomain(doc, base);
    const serializationStart = performance.now();
    for (let i = 0; i < 30; i++) serializeToMarkdown(doc);
    const serializationMs = performance.now() - serializationStart;
    process.stdout.write(JSON.stringify({ fixtureBytes: markdown.length, topLevelBlocks: doc.childCount, roundTripMs: +(conversionStart - start).toFixed(1), thirtyProjectionsMs: +(serializationStart - conversionStart).toFixed(1), thirtySerializationsMs: +serializationMs.toFixed(1) }) + '\n');
  });

  it('edits a task in the middle of a long note without changing other content, including undo and redo', () => {
    const doc = parseMarkdown(complexNote());
    let position = 0;
    doc.descendants((node, pos) => { if (node.type.name === 'todoItem' && node.textContent === 'Task 50.5') position = pos + 1; });
    expect(position).toBeGreaterThan(0);
    let state = EditorState.create({ doc, selection: TextSelection.create(doc, position + 5, position + 9), plugins: [history()] });
    const dispatch = (tr: Parameters<typeof state.apply>[0]) => { state = state.apply(tr); state.doc.check(); };
    splitTodo(state, dispatch);
    const edited = state.doc;
    expect(edited.textContent).not.toContain('Task 50.5');
    expect(undo(state, dispatch)).toBe(true);
    expect(state.doc.eq(doc)).toBe(true);
    expect(redo(state, dispatch)).toBe(true);
    expect(state.doc.eq(edited)).toBe(true);
  });
});
