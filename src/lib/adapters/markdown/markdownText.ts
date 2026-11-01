/** Escape prose, while leaving actual Markdown markup to the serializer. */
export function escapeMarkdownText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/[\\`*_[\]<]/g, '\\$&')
    .replace(/^(\s*)([#>+~-])(?=\s|$)/gm, '$1\\$2')
    .replace(/^(\s*\d+)([.)])(?=\s)/gm, '$1\\$2');
}

export function serializeCodeSpan(text: string): string {
  const longest = (text.match(/`+/g) ?? []).reduce((max, run) => Math.max(max, run.length), 0);
  const fence = '`'.repeat(longest + 1);
  const padding = text.startsWith('`') || text.endsWith('`') || (text.startsWith(' ') && text.endsWith(' ') && /\S/.test(text)) ? ' ' : '';
  return `${fence}${padding}${text}${padding}${fence}`;
}

/** Normalize block separators without changing whitespace inside fenced code. */
export function normalizeBlockSpacing(markdown: string): string {
  let fence: { character: string; length: number } | null = null;
  let emptyLines = 0;
  const lines: string[] = [];
  for (const line of markdown.split('\n')) {
    const marker = /^(?:[ \t]*>[ \t]?)*[ \t]*(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      lines.push(line);
      if (marker && marker[1]![0] === fence.character && marker[1]!.length >= fence.length && !marker[2]!.trim()) fence = null;
      emptyLines = 0;
      continue;
    }
    if (marker) fence = { character: marker[1]![0]!, length: marker[1]!.length };
    emptyLines = line === '' ? emptyLines + 1 : 0;
    if (emptyLines <= 1) lines.push(line);
  }
  return lines.join('\n').trim();
}
