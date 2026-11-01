import MarkdownIt from 'markdown-it';

// Task discovery needs block structure only; skip inline tokenization.
const markdown = new MarkdownIt({ html: true }).disable('inline');

/** Source lines that are metadata or literal content, never live tasks/headings. */
export function literalMarkdownLines(lines: readonly string[]): Set<number> {
  const excluded = new Set<number>();
  const source = [...lines];
  if (source[0]?.replace(/^\uFEFF/, '').trim() === '---') {
    const end = source.findIndex((line, index) => index > 0 && /^(---|\.\.\.)\s*$/.test(line));
    if (end > 0) {
      for (let index = 0; index <= end; index++) {
        excluded.add(index);
        source[index] = '';
      }
    }
  }
  // Use the same Markdown grammar as the editor, including nested fences,
  // longer closing fences, tilde fences, indented code and HTML comments.
  for (const token of markdown.parse(source.join('\n'), {})) {
    if (!token.map || !['fence', 'code_block', 'html_block'].includes(token.type)) continue;
    for (let index = token.map[0]; index < token.map[1]; index++) excluded.add(index);
  }
  return excluded;
}
