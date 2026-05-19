import * as chrono from 'chrono-node';
import type { CreateTodoOptions } from '$lib/ports/inbound/TodoService';
import type { TodoPriority } from '$lib/domain/values/TodoPriority';
import type { TodoList } from '$lib/domain/values/TodoView';
import { ok, err, type Result } from '$lib/core';

export interface ParsedQuickTodo {
  content: string;
  options: CreateTodoOptions;
}

const PRIORITY_BY_TOKEN: Record<string, TodoPriority> = {
  p1: 'high',
  p2: 'medium',
  p3: 'low',
};

/**
 * Parse Todoist-style quick capture text into clean task content and metadata.
 *
 * Supported examples:
 * - "Review PR tomorrow p1 #work"
 * - "Pay rent {next friday} every month"
 * - "Clean inbox due:today @admin +anytime"
 */
export function parseQuickTodoInput(
  input: string,
  defaults: CreateTodoOptions = {},
  now: Date = new Date(),
): Result<ParsedQuickTodo, Error> {
  let working = input.trim();
  const options: CreateTodoOptions = copyCreateOptions(defaults);

  working = extractTargetList(working, options);
  working = extractPriority(working, options);
  working = extractTags(working, options);
  working = extractRecurrence(working, options);
  working = extractExplicitDueDate(working, options, now);

  if (!options.dueDate && !options.scheduledDate) {
    working = extractNaturalDate(working, options, now);
  }

  const content = normalizeWhitespace(working);
  if (!content) {
    return err(new Error('Task title is required'));
  }

  return ok({ content, options });
}

function copyCreateOptions(options: CreateTodoOptions): CreateTodoOptions {
  const copy: CreateTodoOptions = {};
  if (options.dueDate !== undefined) copy.dueDate = options.dueDate;
  if (options.scheduledDate !== undefined) copy.scheduledDate = options.scheduledDate;
  if (options.recurrence !== undefined) copy.recurrence = options.recurrence;
  if (options.priority !== undefined) copy.priority = options.priority;
  if (options.tags !== undefined) copy.tags = [...options.tags];
  if (options.targetFile !== undefined) copy.targetFile = options.targetFile;
  if (options.targetList !== undefined) copy.targetList = options.targetList;
  return copy;
}

function extractTargetList(input: string, options: CreateTodoOptions): string {
  return input.replace(/(?:^|\s)(?:list:|\+)(inbox|anytime|someday)\b/gi, (_match, list: string) => {
    options.targetList = list.toLowerCase() as TodoList;
    return ' ';
  });
}

function extractPriority(input: string, options: CreateTodoOptions): string {
  return input.replace(/(?:^|\s)(p[123])\b/gi, (_match, token: string) => {
    options.priority = PRIORITY_BY_TOKEN[token.toLowerCase()]!;
    return ' ';
  });
}

function extractTags(input: string, options: CreateTodoOptions): string {
  const tags = new Set(options.tags ?? []);
  const stripped = input.replace(/(?:^|\s)([#@])([\p{L}\p{N}_/-]+)/gu, (_match, _prefix: string, tag: string) => {
    tags.add(tag.replace(/^[/_-]+|[/_-]+$/g, ''));
    return ' ';
  });

  const cleanTags = Array.from(tags).filter(Boolean);
  if (cleanTags.length > 0) {
    options.tags = cleanTags;
  }

  return stripped;
}

function extractRecurrence(input: string, options: CreateTodoOptions): string {
  return input.replace(
    /\bevery\s+(?:\d+\s+)?(?:day|days|weekday|weekdays|week|weeks|month|months|year|years)(?:\s+on\s+[a-z]+)?\b/gi,
    (match) => {
      options.recurrence = normalizeWhitespace(match.toLowerCase());
      return ' ';
    },
  );
}

function extractExplicitDueDate(input: string, options: CreateTodoOptions, now: Date): string {
  let working = input.replace(/\{([^}]+)\}/g, (match, expression: string) => {
    const date = parseDateExpression(expression, now);
    if (!date) return match;
    options.dueDate = date;
    return ' ';
  });

  working = working.replace(
    /\bdue:?\s*([^#@{}]+?)(?=\s+(?:[#@]\S+|p[123]\b|every\b|list:|\+(?:inbox|anytime|someday)\b)|$)/gi,
    (match, expression: string) => {
      const date = parseDateExpression(expression, now);
      if (!date) return match;
      options.dueDate = date;
      return ' ';
    },
  );

  return working;
}

function extractNaturalDate(input: string, options: CreateTodoOptions, now: Date): string {
  const results = chrono.parse(input, now, { forwardDate: true });
  const first = results[0];
  const date = first?.start.date();
  if (!first || !date) return input;

  options.dueDate = startOfDay(date);
  return removeRange(input, first.index, first.index + first.text.length);
}

function parseDateExpression(expression: string, now: Date): Date | null {
  const date = chrono.parseDate(expression.trim(), now, { forwardDate: true });
  return date ? startOfDay(date) : null;
}

function removeRange(input: string, start: number, end: number): string {
  return `${input.slice(0, start)} ${input.slice(end)}`;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}
