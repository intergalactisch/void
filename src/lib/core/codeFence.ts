import type { Block, CodeBlockAttrs } from '$lib/domain/entities/Block';

export interface CodeFenceInfo {
  language: string | null;
  meta: string | null;
}

export interface CodeBlockDisplayOptions {
  title: string | null;
  lineNumbers: boolean;
  wrap: boolean;
  highlightLines: Set<number>;
  focusLines: Set<number>;
}

export interface CodeFenceBuildInput {
  code: string;
  language?: string | null;
  meta?: string | null;
  title?: string | null;
  lineNumbers?: boolean;
  wrap?: boolean;
  highlightLines?: string | null;
  focusLines?: string | null;
}

export interface CodeFenceMetaUpdates {
  title?: string | null;
  lineNumbers?: boolean;
  wrap?: boolean;
  highlightLines?: string | null;
  focusLines?: string | null;
}

export interface CodeBlockMarkdownInput {
  code: string;
  language?: string | null;
  meta?: string | null;
  title?: string | null;
}

export interface CodeBlockUpdateInput {
  code?: string;
  language?: string | null;
  meta?: string | null;
  title?: string | null;
  lineNumbers?: boolean;
  wrap?: boolean;
  highlightLines?: string | null;
  focusLines?: string | null;
  mode?: 'replace' | 'append' | 'prepend';
}

const LANGUAGE_ALIASES = new Map<string, string>([
  ['c++', 'cpp'],
  ['c#', 'csharp'],
  ['cs', 'csharp'],
  ['docker', 'dockerfile'],
  ['docker-compose', 'yaml'],
  ['html', 'html'],
  ['js', 'javascript'],
  ['jsx', 'jsx'],
  ['md', 'markdown'],
  ['py', 'python'],
  ['rb', 'ruby'],
  ['rs', 'rust'],
  ['sh', 'bash'],
  ['shell', 'bash'],
  ['tsx', 'tsx'],
  ['ts', 'typescript'],
  ['txt', 'text'],
  ['yml', 'yaml'],
  ['zsh', 'bash'],
]);

export function parseCodeFenceInfo(info: string | null | undefined): CodeFenceInfo {
  const trimmed = (info ?? '').trim();
  if (!trimmed) return { language: null, meta: null };

  const match = trimmed.match(/^(\S+)(?:\s+([\s\S]*))?$/);
  if (!match) return { language: null, meta: trimmed };

  const first = match[1] ?? '';
  const rest = (match[2] ?? '').trim();
  const firstLooksLikeMeta =
    first.startsWith('{') ||
    first.includes('=') ||
    first === 'lineNumbers' ||
    first === 'wrap';

  if (firstLooksLikeMeta) {
    return { language: null, meta: trimmed };
  }

  return {
    language: first || null,
    meta: rest || null,
  };
}

export function buildCodeFence(input: CodeFenceBuildInput): string {
  const code = normalizeCodeContent(input.code);
  const language = normalizeLanguageInput(input.language);
  const meta = updateCodeFenceMeta(input.meta ?? null, buildMetaUpdates(input));
  const info = [language, meta].filter(Boolean).join(' ');
  const fence = '`'.repeat(Math.max(3, longestBacktickRun(code) + 1));

  return `${fence}${info ? info : ''}\n${code}${code.endsWith('\n') ? '' : '\n'}${fence}`;
}

export function buildCodeBlockMarkdown(input: CodeBlockMarkdownInput): string {
  return buildCodeFence({
    code: input.code,
    ...(input.language !== undefined ? { language: input.language } : {}),
    ...(input.meta !== undefined ? { meta: input.meta } : {}),
    ...(input.title !== undefined ? { title: input.title } : {}),
  });
}

export function buildUpdatedCodeBlockMarkdown(
  current: Block,
  input: CodeBlockUpdateInput
): string {
  if (current.type !== 'codeBlock') {
    throw new Error(`Block ${current.id} is a ${current.type}, not a code block`);
  }

  const attrs = current.attrs as CodeBlockAttrs;
  const mode = input.mode ?? 'replace';
  const code =
    input.code === undefined
      ? current.content
      : mode === 'append'
        ? joinCodeParts(current.content, input.code)
        : mode === 'prepend'
          ? joinCodeParts(input.code, current.content)
          : input.code;
  const language =
    input.language === undefined
      ? attrs.language
      : normalizeLanguageInput(input.language);
  const baseMeta =
    input.meta === undefined
      ? attrs.meta ?? null
      : normalizeNullableText(input.meta);
  const meta = updateCodeFenceMeta(baseMeta, buildMetaUpdates(input));

  return buildCodeFence({ code, language, meta });
}

function buildMetaUpdates(input: CodeFenceMetaUpdates): CodeFenceMetaUpdates {
  const updates: CodeFenceMetaUpdates = {};
  if (input.title !== undefined) updates.title = input.title;
  if (input.lineNumbers !== undefined) updates.lineNumbers = input.lineNumbers;
  if (input.wrap !== undefined) updates.wrap = input.wrap;
  if (input.highlightLines !== undefined) updates.highlightLines = input.highlightLines;
  if (input.focusLines !== undefined) updates.focusLines = input.focusLines;
  return updates;
}

export function updateCodeFenceMeta(
  current: string | null | undefined,
  updates: CodeFenceMetaUpdates
): string | null {
  const tokens = splitMetaTokens(current ?? '').filter((token) => {
    if (isTitleToken(token) && updates.title !== undefined) return false;
    if (isLineNumbersToken(token) && updates.lineNumbers !== undefined) return false;
    if (isWrapToken(token) && updates.wrap !== undefined) return false;
    if (isHighlightRangeToken(token) && updates.highlightLines !== undefined) return false;
    if (isFocusRangeToken(token) && updates.focusLines !== undefined) return false;
    return true;
  });

  if (updates.title !== undefined && updates.title !== null && updates.title.trim()) {
    tokens.push(`title=${quoteMetaValue(updates.title.trim())}`);
  }
  if (updates.lineNumbers === true) tokens.push('lineNumbers');
  if (updates.wrap === true) tokens.push('wrap');
  if (updates.highlightLines !== undefined && updates.highlightLines !== null && updates.highlightLines.trim()) {
    tokens.push(`{${stripRangeBraces(updates.highlightLines)}}`);
  }
  if (updates.focusLines !== undefined && updates.focusLines !== null && updates.focusLines.trim()) {
    tokens.push(`focus={${stripRangeBraces(updates.focusLines)}}`);
  }

  const meta = tokens.join(' ').trim();
  return meta || null;
}

export function parseCodeBlockDisplayOptions(
  meta: string | null | undefined,
  code = ''
): CodeBlockDisplayOptions {
  const tokens = splitMetaTokens(meta ?? '');
  const title = readMetaValue(tokens, 'title') ?? readMetaValue(tokens, 'filename') ?? null;
  const lineNumbers = readBooleanMeta(tokens, 'lineNumbers') ?? readBooleanMeta(tokens, 'lines') ?? false;
  const wrap = readBooleanMeta(tokens, 'wrap') ?? false;
  const highlightLines = parseLineRangeSet(readHighlightRange(tokens));
  const focusLines = parseLineRangeSet(readFocusRange(tokens));

  for (const annotation of readCodeLineAnnotations(code)) {
    if (annotation.kind === 'highlight') highlightLines.add(annotation.line);
    if (annotation.kind === 'focus') focusLines.add(annotation.line);
  }

  return { title, lineNumbers, wrap, highlightLines, focusLines };
}

export function normalizeCodeLanguageForHighlighter(language: string | null | undefined): string {
  const normalized = normalizeLanguageInput(language);
  if (!normalized) return 'text';
  return LANGUAGE_ALIASES.get(normalized) ?? normalized;
}

export function normalizeCodeLanguageLabel(language: string | null | undefined): string {
  return normalizeLanguageInput(language) ?? 'plain text';
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderCodeFenceHtml(code: string, info: string | null | undefined): string {
  const parsed = parseCodeFenceInfo(info);
  const display = parseCodeBlockDisplayOptions(parsed.meta, code);
  const languageLabel = normalizeCodeLanguageLabel(parsed.language);
  const visibleMeta = parsed.meta
    ? parsed.meta.replace(/(?:^|\s)title=(?:"[^"]*"|'[^']*'|\S+)/i, '').trim()
    : '';
  const lineClasses = [
    'void-code-block',
    'void-block-content',
    display.wrap ? 'is-wrapped' : '',
    display.lineNumbers ? 'has-line-numbers' : '',
  ].filter(Boolean).join(' ');
  const lineNumbers = display.lineNumbers
    ? `<div class="void-code-line-numbers" aria-hidden="true">${renderLineNumberHtml(
        code,
        display.highlightLines,
        display.focusLines,
      )}</div>`
    : '';

  return `<div class="void-code-block-rendered"><div class="void-code-block-header"><div class="void-code-block-info"><span class="void-code-block-lang">${escapeHtml(languageLabel)}</span>${display.title ? `<span class="void-code-block-title">${escapeHtml(display.title)}</span>` : ''}${visibleMeta ? `<span class="void-code-block-meta">${escapeHtml(visibleMeta)}</span>` : ''}</div></div><pre class="${lineClasses}">${lineNumbers}<code>${escapeHtml(code)}</code></pre></div>`;
}

function normalizeLanguageInput(language: string | null | undefined): string | null {
  const normalized = (language ?? '').trim().toLowerCase();
  return normalized || null;
}

function normalizeNullableText(value: string | null | undefined): string | null {
  const normalized = (value ?? '').trim();
  return normalized || null;
}

function joinCodeParts(first: string, second: string): string {
  if (!first) return second;
  if (!second) return first;
  return `${first.replace(/\s+$/g, '')}\n${second.replace(/^\s+/g, '')}`;
}

function renderLineNumberHtml(
  code: string,
  highlightLines: Set<number>,
  focusLines: Set<number>
): string {
  const lines = normalizeCodeContent(code).split('\n');
  const lineCount = Math.max(1, lines.length);
  let html = '';
  for (let line = 1; line <= lineCount; line++) {
    const classes: string[] = [];
    if (highlightLines.has(line)) classes.push('is-highlighted');
    if (focusLines.has(line)) classes.push('is-focused');
    if (/^\+/.test(lines[line - 1] ?? '')) classes.push('is-added');
    if (/^-/.test(lines[line - 1] ?? '')) classes.push('is-removed');
    html += `<span${classes.length > 0 ? ` class="${classes.join(' ')}"` : ''}>${line}</span>`;
  }
  return html;
}

function normalizeCodeContent(code: string): string {
  return code.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function longestBacktickRun(value: string): number {
  let longest = 0;
  for (const match of value.matchAll(/`+/g)) {
    longest = Math.max(longest, match[0].length);
  }
  return longest;
}

function splitMetaTokens(value: string): string[] {
  const tokens: string[] = [];
  const pattern = /"[^"]*"|'[^']*'|\S+/g;
  for (const match of value.matchAll(pattern)) {
    tokens.push(match[0]);
  }
  return tokens;
}

function quoteMetaValue(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function readMetaValue(tokens: string[], key: string): string | null {
  const token = tokens.find((item) => item.toLowerCase().startsWith(`${key.toLowerCase()}=`));
  if (!token) return null;
  const raw = token.slice(token.indexOf('=') + 1);
  return unquoteMetaValue(raw);
}

function readBooleanMeta(tokens: string[], key: string): boolean | null {
  const normalizedKey = key.toLowerCase();
  const token = tokens.find((item) => {
    const normalized = item.toLowerCase();
    return normalized === normalizedKey || normalized.startsWith(`${normalizedKey}=`);
  });
  if (!token) return null;
  if (!token.includes('=')) return true;
  const raw = token.slice(token.indexOf('=') + 1).toLowerCase();
  return raw !== 'false' && raw !== '0' && raw !== 'off';
}

function unquoteMetaValue(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  return trimmed;
}

function isTitleToken(token: string): boolean {
  return /^(title|filename)=/i.test(token);
}

function isLineNumbersToken(token: string): boolean {
  return /^(lineNumbers|lines)(?:=|$)/i.test(token);
}

function isWrapToken(token: string): boolean {
  return /^wrap(?:=|$)/i.test(token);
}

function isHighlightRangeToken(token: string): boolean {
  return /^\{[\d,\s-]+\}$/.test(token);
}

function isFocusRangeToken(token: string): boolean {
  return /^focus=\{[\d,\s-]+\}$/i.test(token);
}

function readHighlightRange(tokens: string[]): string | null {
  const token = tokens.find(isHighlightRangeToken);
  return token ? stripRangeBraces(token) : null;
}

function readFocusRange(tokens: string[]): string | null {
  const token = tokens.find(isFocusRangeToken);
  if (!token) return null;
  return stripRangeBraces(token.slice(token.indexOf('=') + 1));
}

function stripRangeBraces(value: string): string {
  return value.trim().replace(/^\{/, '').replace(/\}$/, '').trim();
}

function parseLineRangeSet(value: string | null): Set<number> {
  const lines = new Set<number>();
  if (!value) return lines;

  for (const part of value.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const [startRaw, endRaw] = trimmed.split('-');
    const start = Number.parseInt(startRaw ?? '', 10);
    const end = Number.parseInt(endRaw ?? startRaw ?? '', 10);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 1 || end < 1) continue;
    for (let line = Math.min(start, end); line <= Math.max(start, end); line++) {
      lines.add(line);
    }
  }

  return lines;
}

function readCodeLineAnnotations(code: string): Array<{ line: number; kind: 'highlight' | 'focus' }> {
  const annotations: Array<{ line: number; kind: 'highlight' | 'focus' }> = [];
  const lines = normalizeCodeContent(code).split('\n');
  lines.forEach((line, index) => {
    if (/\[!code\s+highlight(?::\d+)?\]/.test(line)) {
      annotations.push({ line: index + 1, kind: 'highlight' });
    }
    if (/\[!code\s+focus(?::\d+)?\]/.test(line)) {
      annotations.push({ line: index + 1, kind: 'focus' });
    }
  });
  return annotations;
}
