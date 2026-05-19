/**
 * Task manager view and dedicated TODO.md list identifiers.
 *
 * These are domain values because settings, stores, and repositories all need
 * to agree on the same stable names without coupling to UI components.
 */

export const TODO_VIEWS = [
  'all',
  'inbox',
  'today',
  'upcoming',
  'anytime',
  'someday',
  'notes',
  'tags',
  'logbook',
] as const;

export type TodoView = (typeof TODO_VIEWS)[number];

export const TODO_LISTS = ['inbox', 'anytime', 'someday'] as const;

export type TodoList = (typeof TODO_LISTS)[number];

export const DEFAULT_TODO_VIEW: TodoView = 'all';

export function isValidTodoView(value: unknown): value is TodoView {
  return typeof value === 'string' && (TODO_VIEWS as readonly string[]).includes(value);
}

export function isValidTodoList(value: unknown): value is TodoList {
  return typeof value === 'string' && (TODO_LISTS as readonly string[]).includes(value);
}

export function getTodoViewLabel(view: TodoView): string {
  switch (view) {
    case 'all':
      return 'All';
    case 'inbox':
      return 'Inbox';
    case 'today':
      return 'Today';
    case 'upcoming':
      return 'Upcoming';
    case 'anytime':
      return 'Anytime';
    case 'someday':
      return 'Someday';
    case 'notes':
      return 'Notes';
    case 'tags':
      return 'Tags';
    case 'logbook':
      return 'Logbook';
  }
}

export function getTodoListHeading(list: TodoList): string {
  switch (list) {
    case 'inbox':
      return 'Inbox';
    case 'anytime':
      return 'Anytime';
    case 'someday':
      return 'Someday';
  }
}

export function getTodoListFromHeading(heading: string | undefined): TodoList | undefined {
  if (!heading) return undefined;
  const normalized = heading.trim().toLowerCase();
  if (normalized === 'inbox') return 'inbox';
  if (normalized === 'anytime') return 'anytime';
  if (normalized === 'someday') return 'someday';
  return undefined;
}
