/** Pure Markdown section editing; filesystem access belongs to the repository. */
import { ok, err, type Result } from '$lib/core';
import type { TodoSection } from '$lib/domain/entities/Todo';
import type { TodoSource } from '$lib/domain/values/TodoSource';
import type { TodoParserPort } from '$lib/ports/outbound/TodoParserPort';
import { literalMarkdownLines } from './markdownStructure';

export interface TodoPlacement {
  content: string;
  lineNumber: number;
  section?: string;
}

interface TodoSectionRange {
  title: string;
  lineNumber: number;
  endLineNumber: number;
}

export function parseTodoSections(
  content: string,
  filePath: string,
  parser: TodoParserPort,
  source: TodoSource,
): TodoSection[] {
  const lines = content.split('\n');
  const sections: TodoSection[] = [];
  const excluded = literalMarkdownLines(lines);
  let current: TodoSection | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    if (excluded.has(index)) continue;
    const line = lines[index]!;
    const h2 = parseSectionHeading(line);
    if (h2) {
      current = {
        filePath,
        title: h2,
        lineNumber: index,
        todoCount: 0,
      };
      sections.push(current);
      continue;
    }

    if (/^#\s+/.test(line.trim())) {
      current = null;
      continue;
    }

    if (current && parser.parseLine(line, index, filePath, current.title, { source })) {
      current.todoCount += 1;
    }
  }

  return sections;
}

export function parseTodoSectionRanges(lines: string[]): TodoSectionRange[] {
  const ranges: TodoSectionRange[] = [];
  const excluded = literalMarkdownLines(lines);
  let current: TodoSectionRange | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    if (excluded.has(index)) continue;
    const line = lines[index]!;
    const h2 = parseSectionHeading(line);
    if (h2) {
      if (current) current.endLineNumber = index;
      current = {
        title: h2,
        lineNumber: index,
        endLineNumber: lines.length,
      };
      ranges.push(current);
      continue;
    }

    if (current && /^#\s+/.test(line.trim())) {
      current.endLineNumber = index;
      current = null;
    }
  }

  return ranges;
}

export function ensureUniqueSectionTitles(ranges: TodoSectionRange[]): Result<void, Error> {
  const seen = new Set<string>();
  for (const range of ranges) {
    const key = normalizeSectionTitleKey(range.title);
    if (seen.has(key)) {
      return err(new Error(`Duplicate section title: ${range.title}`));
    }
    seen.add(key);
  }
  return ok(undefined);
}

export function findSectionRange(ranges: TodoSectionRange[], title: string): Result<TodoSectionRange, Error> {
  const matches = ranges.filter((range) => sameSectionTitle(range.title, title));
  if (matches.length === 0) return err(new Error(`Section not found: ${title}`));
  if (matches.length > 1) return err(new Error(`Section title is ambiguous: ${title}`));
  return ok(matches[0]!);
}

function parseSectionHeading(line: string): string | null {
  const match = /^##(?!#)\s+(.+?)\s*$/.exec(line.trim());
  if (!match?.[1]) return null;
  const title = match[1].replace(/\s+#+\s*$/, '').trim();
  return title || null;
}

export function validateSectionTitle(title: string): Result<string, Error> {
  const normalized = title.trim();
  if (!normalized) return err(new Error('Section title cannot be empty'));
  if (/[\r\n]/.test(normalized)) return err(new Error('Section title cannot contain newlines'));
  if (/^#+\s*$/.test(normalized)) return err(new Error('Section title must contain text'));
  return ok(normalized.replace(/\s+/g, ' '));
}

export function sameSectionTitle(a: string, b: string): boolean {
  return normalizeSectionTitleKey(a) === normalizeSectionTitleKey(b);
}

function normalizeSectionTitleKey(title: string): string {
  return title.trim().toLocaleLowerCase();
}

export function findSectionTitleForLine(lines: string[], lineNumber: number): string | null {
  const excluded = literalMarkdownLines(lines);
  for (let index = Math.min(lineNumber, lines.length - 1); index >= 0; index -= 1) {
    if (excluded.has(index)) continue;
    const line = lines[index]!;
    const section = parseSectionHeading(line);
    if (section) return section;
    if (/^#\s+/.test(line.trim())) return null;
  }
  return null;
}

export function appendTodoToContent(content: string, newLine: string): TodoPlacement {
  const trimmedContent = content.trimEnd();
  if (trimmedContent.length === 0) {
    return { content: newLine, lineNumber: 0 };
  }

  const next = `${trimmedContent}\n${newLine}`;
  return { content: next, lineNumber: next.split('\n').length - 1 };
}

export function insertTodoIntoNamedSection(
  content: string,
  newLine: string,
  section: string,
  options: { createIfMissing: boolean },
): Result<TodoPlacement, Error> {
  const lines = content.trimEnd().length > 0 ? content.trimEnd().split('\n') : ['# TODO'];
  const inserted = insertTodoLineIntoSectionLines(lines, newLine, section, options);
  if (!inserted.ok) return inserted;
  return ok({
    content: inserted.value.lines.join('\n'),
    lineNumber: inserted.value.lineNumber,
    section,
  });
}

export function insertTodoLineIntoSectionLines(
  lines: string[],
  newLine: string,
  section: string,
  options: { createIfMissing: boolean },
): Result<{ lines: string[]; lineNumber: number }, Error> {
  const next = [...lines];
  const excluded = literalMarkdownLines(next);
  let headingIndex = next.findIndex((line, index) => {
    if (excluded.has(index)) return false;
    const heading = parseSectionHeading(line);
    return heading ? sameSectionTitle(heading, section) : false;
  });

  if (headingIndex === -1) {
    if (!options.createIfMissing) return err(new Error(`Section not found: ${section}`));
    if (next.length > 0 && next[next.length - 1]!.trim() !== '') next.push('');
    headingIndex = next.length;
    next.push(`## ${section}`, '');
  }

  const nextSectionIndex = next.findIndex((line, index) => (
    index > headingIndex && !excluded.has(index) && (/^#{1,2}\s+/.test(line.trim()))
  ));
  let insertAt = nextSectionIndex === -1 ? next.length : nextSectionIndex;

  while (insertAt > headingIndex + 1 && next[insertAt - 1]!.trim() === '') {
    insertAt -= 1;
  }

  const insertion = insertAt === headingIndex + 1 ? ['', newLine] : [newLine];
  if (nextSectionIndex !== -1) insertion.push('');

  next.splice(insertAt, 0, ...insertion);
  return ok({ lines: next, lineNumber: insertAt + insertion.indexOf(newLine) });
}
