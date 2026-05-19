/**
 * TodoListFile - dedicated markdown files for user-managed todo lists.
 *
 * Custom todo lists are normal portable markdown files, marked with
 * `void_type: todo-list` in frontmatter. The built-in TODO.md file remains
 * protected and is intentionally not user-managed through this API.
 */

import { TODO_FILENAME } from './TodoConstants';

export const TODO_LIST_FILE_PREFIX = 'todo-';
export const TODO_LIST_FILE_EXTENSION = '.md';
export const TODO_LIST_FRONTMATTER_KEY = 'void_type';
export const TODO_LIST_FRONTMATTER_TYPE = 'todo-list';

export interface TodoListFile {
  /** Absolute path to the markdown file */
  path: string;
  /** Display name */
  title: string;
  /** Free-form markdown note shown for this list */
  note: string;
  /** Creation timestamp from frontmatter or fallback metadata */
  createdAt: Date;
  /** Last modification timestamp from frontmatter or fallback metadata */
  updatedAt: Date;
  /** Whether this file is protected from list-file management */
  protected: boolean;
}

export interface CreateTodoListFileParams {
  title: string;
  note?: string;
}

export interface UpdateTodoListFileParams {
  title?: string;
  note?: string;
}

export interface ParsedTodoListMarkdown {
  title: string;
  note: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const TODO_LIST_SECTION_CONTENT = `## Inbox

## Anytime

## Someday`;

export function getTodoListFileName(title: string): string {
  const slug = slugifyTodoListTitle(title);
  if (!slug) return '';
  return `${TODO_LIST_FILE_PREFIX}${slug}${TODO_LIST_FILE_EXTENSION}`;
}

export function slugifyTodoListTitle(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function validateTodoListTitle(title: string): string | null {
  const trimmed = title.trim();
  if (!trimmed) return 'Todo list name cannot be empty';
  if (/[\\/]/.test(trimmed)) return 'Todo list name cannot contain slashes';
  if (trimmed === '.' || trimmed === '..' || trimmed.startsWith('.')) {
    return 'Todo list name cannot start with a dot';
  }

  const normalized = trimmed.toLowerCase();
  if (normalized === 'todo' || normalized === 'todo.md' || normalized === TODO_FILENAME.toLowerCase()) {
    return `${TODO_FILENAME} is protected`;
  }

  if (!slugifyTodoListTitle(trimmed)) {
    return 'Todo list name must contain at least one letter or number';
  }

  return null;
}

export function isDefaultTodoFilePath(filePath: string): boolean {
  const filename = getFileName(filePath).toLowerCase();
  return filename === TODO_FILENAME.toLowerCase();
}

export function isTodoListMarkdown(content: string): boolean {
  const { data } = parseFrontmatter(content);
  return data[TODO_LIST_FRONTMATTER_KEY] === TODO_LIST_FRONTMATTER_TYPE;
}

export function parseTodoListMarkdown(
  filePath: string,
  content: string,
  fallbackDate: Date = new Date(),
): TodoListFile | null {
  if (!isTodoListMarkdown(content)) return null;

  const parsed = parseTodoListMarkdownContent(content);
  const createdAt = parsed.createdAt ?? fallbackDate;
  const updatedAt = parsed.updatedAt ?? fallbackDate;
  return {
    path: filePath,
    title: parsed.title || filenameToTitle(getFileName(filePath)),
    note: parsed.note,
    createdAt,
    updatedAt,
    protected: false,
  };
}

export function createTodoListMarkdown(params: CreateTodoListFileParams, now: Date = new Date()): string {
  const title = params.title.trim();
  const note = normalizeTodoListNote(params.note ?? '');
  return buildTodoListMarkdown({
    title,
    note,
    sections: TODO_LIST_SECTION_CONTENT,
    createdAt: now,
    updatedAt: now,
  });
}

export function updateTodoListMarkdown(
  content: string,
  updates: UpdateTodoListFileParams,
  now: Date = new Date(),
): { content: string; title: string; note: string; createdAt: Date; updatedAt: Date } {
  const parsed = parseTodoListMarkdownContent(content);
  const title = updates.title !== undefined ? updates.title.trim() : parsed.title;
  const note = updates.note !== undefined ? normalizeTodoListNote(updates.note) : parsed.note;
  const createdAt = parsed.createdAt ?? now;
  const updatedAt = now;
  const sections = extractTodoListSections(stripFrontmatter(content).content);

  return {
    content: buildTodoListMarkdown({
      title,
      note,
      sections: sections || TODO_LIST_SECTION_CONTENT,
      createdAt,
      updatedAt,
    }),
    title,
    note,
    createdAt,
    updatedAt,
  };
}

export function parseTodoListMarkdownContent(content: string): ParsedTodoListMarkdown {
  const { content: body, data } = parseFrontmatter(content);
  const strippedBody = body.trim();
  const lines = strippedBody ? strippedBody.split('\n') : [];
  const titleFromBody = lines.find((line) => /^#\s+/.test(line))?.replace(/^#\s+/, '').trim();
  const title = typeof data.title === 'string' && data.title.trim()
    ? data.title.trim()
    : titleFromBody ?? '';

  const createdAt = parseDate(data.createdAt);
  const updatedAt = parseDate(data.updatedAt);
  const note = extractTodoListNote(strippedBody);

  const result: ParsedTodoListMarkdown = { title, note };
  if (createdAt) result.createdAt = createdAt;
  if (updatedAt) result.updatedAt = updatedAt;
  return result;
}

function buildTodoListMarkdown(params: {
  title: string;
  note: string;
  sections: string;
  createdAt: Date;
  updatedAt: Date;
}): string {
  const frontmatter = [
    '---',
    `title: ${serializeYamlString(params.title)}`,
    `${TODO_LIST_FRONTMATTER_KEY}: ${TODO_LIST_FRONTMATTER_TYPE}`,
    `createdAt: ${params.createdAt.toISOString()}`,
    `updatedAt: ${params.updatedAt.toISOString()}`,
    '---',
    '',
  ].join('\n');

  const title = `# ${params.title}`;
  const note = normalizeTodoListNote(params.note);
  const noteBlock = note ? `\n\n${note}` : '';
  const sections = params.sections.trim() || TODO_LIST_SECTION_CONTENT;

  return `${frontmatter}${title}${noteBlock}\n\n${sections}\n`;
}

function extractTodoListNote(body: string): string {
  if (!body.trim()) return '';
  const lines = body.split('\n');
  const h1Index = lines.findIndex((line) => /^#\s+/.test(line));
  const start = h1Index === -1 ? 0 : h1Index + 1;
  const sectionIndex = lines.findIndex((line, index) => index >= start && /^##\s+/.test(line));
  const end = sectionIndex === -1 ? lines.length : sectionIndex;
  return lines.slice(start, end).join('\n').trim();
}

function extractTodoListSections(body: string): string {
  const lines = body.trim().split('\n');
  const h1Index = lines.findIndex((line) => /^#\s+/.test(line));
  const start = h1Index === -1 ? 0 : h1Index + 1;
  const sectionIndex = lines.findIndex((line, index) => index >= start && /^##\s+/.test(line));
  if (sectionIndex === -1) return TODO_LIST_SECTION_CONTENT;
  return lines.slice(sectionIndex).join('\n').trim();
}

function normalizeTodoListNote(note: string): string {
  return note.trim();
}

function filenameToTitle(filename: string): string {
  return filename
    .replace(/\.md$/i, '')
    .replace(/^todo-/i, '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function getFileName(filePath: string): string {
  const parts = filePath.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] ?? filePath;
}

function parseFrontmatter(input: string): { content: string; data: Record<string, unknown> } {
  const trimmed = input.trim();
  if (!trimmed.startsWith('---')) return { content: input, data: {} };

  const endIndex = trimmed.indexOf('\n---', 3);
  if (endIndex === -1) return { content: input, data: {} };

  const yaml = trimmed.substring(4, endIndex).trim();
  const content = trimmed.substring(endIndex + 4).trim();
  return { content, data: parseSimpleYaml(yaml) };
}

function stripFrontmatter(input: string): { content: string } {
  return parseFrontmatter(input);
}

function parseSimpleYaml(yaml: string): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const line of yaml.split('\n')) {
    const match = line.match(/^([^:]+):\s*(.*)$/);
    if (!match?.[1]) continue;
    const key = match[1].trim();
    const rawValue = (match[2] ?? '').trim();
    data[key] = parseYamlValue(rawValue);
  }
  return data;
}

function parseYamlValue(value: string): unknown {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1).replace(/\\"/g, '"');
  }
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null' || value === '~') return null;
  return value;
}

function serializeYamlString(value: string): string {
  if (
    value.includes(':') ||
    value.includes('#') ||
    value.includes('"') ||
    value.includes("'") ||
    value === 'true' ||
    value === 'false' ||
    value === 'null' ||
    /^-?\d+(\.\d+)?$/.test(value)
  ) {
    return `"${value.replace(/"/g, '\\"')}"`;
  }
  return value;
}

function parseDate(value: unknown): Date | undefined {
  if (typeof value !== 'string') return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}
