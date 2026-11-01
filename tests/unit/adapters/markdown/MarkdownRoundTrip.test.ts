import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '$lib/adapters/markdown/parser';
import { serializeToMarkdown } from '$lib/adapters/markdown/serializer';
import { voidSchema as schema } from '$lib/adapters/prosemirror/schema';

const roundTrip = (doc: ReturnType<typeof parseMarkdown>) => parseMarkdown(serializeToMarkdown(doc));

describe('lossless Markdown text', () => {
  it.each(['*literal*', '**literal**', '_literal_', '[label](target)', '<b>literal</b>', '&copy;', '# a literal heading', '1. a literal list', '- a literal bullet', 'a \\ backslash'])('preserves literal prose: %s', text => {
    const original = schema.node('doc', null, schema.node('paragraph', null, schema.text(text)));
    const result = roundTrip(original);
    expect(result.firstChild?.type.name).toBe('paragraph');
    expect(result.textContent).toBe(text);
    expect(result.firstChild?.firstChild?.marks).toEqual([]);
  });
  it.each(['a`b', '`edge`', ' padded ', 'a``b', '   '])('preserves backticks and significant spaces in inline code: %s', text => {
    const original = schema.node('doc', null, schema.node('paragraph', null, schema.text(text, [schema.marks.code!.create()])));
    const result = roundTrip(original);
    expect(result.textContent).toBe(text);
    expect(result.firstChild?.firstChild?.marks[0]?.type.name).toBe('code');
  });
  it('preserves consecutive blank lines inside fenced code', () => {
    const code = 'first\n\n\nsecond\n\n\n\nlast\n';
    const original = schema.node('doc', null, schema.node('codeBlock', { language: 'text' }, schema.text(code)));
    expect(roundTrip(original).firstChild?.textContent).toBe(code);
  });
  it('preserves paragraphs, lists and code inside a quote', () => {
    const original = parseMarkdown('> Paragraph one\n>\n> Paragraph two\n>\n> - First\n> - Second\n>\n> ```txt\n> a\n>\n>\n> b\n> ```');
    const result = roundTrip(original);
    expect(result.firstChild?.content.childCount).toBe(4);
    expect(result.firstChild?.lastChild?.textContent).toBe('a\n\n\nb\n');
    expect(result.textContent).toBe(original.textContent);
  });
  it('preserves literal markup and pipes inside table cells', () => {
    const original = parseMarkdown('| A | B |\n| --- | --- |\n| \\*literal\\* | a\\|b |');
    const result = roundTrip(original);
    expect(result.textContent).toBe(original.textContent);
    expect(result.lastChild?.lastChild?.firstChild?.firstChild?.firstChild?.marks).toEqual([]);
  });
});
