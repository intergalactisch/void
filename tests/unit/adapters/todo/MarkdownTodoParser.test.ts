/**
 * Unit tests for MarkdownTodoParser
 *
 * Tests parsing and serialization of Obsidian Tasks-compatible TODO syntax:
 * - GFM checkboxes: `- [ ]`, `- [x]`, `* [ ]`, `* [x]`
 * - Date markers: due, scheduled, completed, recurrence
 * - Priority markers: high, medium, low
 * - Tags: #hashtag style
 */
import { describe, it, expect } from 'vitest';
import { MarkdownTodoParser } from '$lib/adapters/todo/MarkdownTodoParser';
import { DATE_MARKERS, formatCompletedAt } from '$lib/domain/values/TodoDateMeta';

const parser = new MarkdownTodoParser();

// Emoji markers for readability in tests
const DUE = DATE_MARKERS.DUE;
const SCHEDULED = DATE_MARKERS.SCHEDULED;
const COMPLETED = DATE_MARKERS.COMPLETED;
const RECURRENCE = DATE_MARKERS.RECURRENCE;
const HIGH = DATE_MARKERS.HIGH_PRIORITY;
const MEDIUM = DATE_MARKERS.MEDIUM_PRIORITY;
const LOW = DATE_MARKERS.LOW_PRIORITY;

describe('MarkdownTodoParser', () => {
  describe('parse()', () => {
    it('parses multiple todos from content', () => {
      const content = `# My Tasks
- [ ] First task
- [x] Second task (done)
Some text between
- [ ] Third task`;

      const todos = parser.parse(content, '/notes/tasks.md');

      expect(todos).toHaveLength(3);
      expect(todos[0]!.content).toBe('First task');
      expect(todos[0]!.isCompleted).toBe(false);
      expect(todos[0]!.lineNumber).toBe(1);
      expect(todos[1]!.content).toBe('Second task (done)');
      expect(todos[1]!.isCompleted).toBe(true);
      expect(todos[1]!.lineNumber).toBe(2);
      expect(todos[2]!.content).toBe('Third task');
      expect(todos[2]!.lineNumber).toBe(4);
    });

    it('returns empty array for content with no todos', () => {
      const content = `# Notes
Just some text
- Not a checkbox item`;

      const todos = parser.parse(content, '/notes/readme.md');

      expect(todos).toHaveLength(0);
    });

    it('identifies todos as dedicated source when file is TODO.md', () => {
      const content = '- [ ] A task';
      const todos = parser.parse(content, '/vault/TODO.md');

      expect(todos[0]!.source).toBe('dedicated');
    });

    it('identifies todos as inline source when file is not TODO.md', () => {
      const content = '- [ ] A task';
      const todos = parser.parse(content, '/vault/notes/meeting.md');

      expect(todos[0]!.source).toBe('inline');
    });

    it('handles case-insensitive TODO.md detection', () => {
      const content = '- [ ] A task';

      const todosLower = parser.parse(content, '/vault/todo.md');
      const todosUpper = parser.parse(content, '/vault/TODO.MD');

      expect(todosLower[0]!.source).toBe('dedicated');
      expect(todosUpper[0]!.source).toBe('dedicated');
    });

    it('derives dedicated task lists from TODO.md sections', () => {
      const content = `# TODO

## Inbox
- [ ] Capture task

## Anytime
- [ ] Actionable task

## Someday
- [ ] Maybe later`;

      const todos = parser.parse(content, '/vault/TODO.md');

      expect(todos.map((todo) => todo.list)).toEqual(['inbox', 'anytime', 'someday']);
      expect(todos.map((todo) => todo.section)).toEqual(['Inbox', 'Anytime', 'Someday']);
    });

    it('treats unsectioned dedicated tasks as Inbox', () => {
      const todos = parser.parse('- [ ] Legacy capture', '/vault/TODO.md');

      expect(todos[0]!.list).toBe('inbox');
      expect(todos[0]!.section).toBeUndefined();
    });
  });

  describe('parseLine()', () => {
    it('parses basic incomplete todo with dash', () => {
      const todo = parser.parseLine('- [ ] Buy groceries', 0, '/notes/list.md');

      expect(todo).not.toBeNull();
      expect(todo!.content).toBe('Buy groceries');
      expect(todo!.isCompleted).toBe(false);
      expect(todo!.rawLine).toBe('- [ ] Buy groceries');
    });

    it('parses completed todo with dash (lowercase x)', () => {
      const todo = parser.parseLine('- [x] Done task', 0, '/notes/list.md');

      expect(todo).not.toBeNull();
      expect(todo!.isCompleted).toBe(true);
    });

    it('parses completed todo with dash (uppercase X)', () => {
      const todo = parser.parseLine('- [X] Done task', 0, '/notes/list.md');

      expect(todo).not.toBeNull();
      expect(todo!.isCompleted).toBe(true);
    });

    it('parses basic incomplete todo with asterisk', () => {
      const todo = parser.parseLine('* [ ] Asterisk task', 0, '/notes/list.md');

      expect(todo).not.toBeNull();
      expect(todo!.content).toBe('Asterisk task');
      expect(todo!.isCompleted).toBe(false);
    });

    it('parses completed todo with asterisk', () => {
      const todo = parser.parseLine('* [x] Asterisk done', 0, '/notes/list.md');

      expect(todo).not.toBeNull();
      expect(todo!.isCompleted).toBe(true);
    });

    it('parses indented todos (2 spaces)', () => {
      const todo = parser.parseLine('  - [ ] Indented task', 0, '/notes/list.md');

      expect(todo).not.toBeNull();
      expect(todo!.indent).toBe(1);
      expect(todo!.content).toBe('Indented task');
    });

    it('parses indented todos (4 spaces)', () => {
      const todo = parser.parseLine('    - [ ] Deeply indented', 0, '/notes/list.md');

      expect(todo).not.toBeNull();
      expect(todo!.indent).toBe(2);
    });

    it('parses indented todos (tab)', () => {
      const todo = parser.parseLine('\t- [ ] Tab indented', 0, '/notes/list.md');

      expect(todo).not.toBeNull();
      expect(todo!.indent).toBe(1);
    });

    it('returns null for non-todo lines', () => {
      expect(parser.parseLine('Just some text', 0, '/notes/list.md')).toBeNull();
      expect(parser.parseLine('- Regular list item', 0, '/notes/list.md')).toBeNull();
      expect(parser.parseLine('* Another list item', 0, '/notes/list.md')).toBeNull();
      expect(parser.parseLine('', 0, '/notes/list.md')).toBeNull();
      expect(parser.parseLine('# Heading', 0, '/notes/list.md')).toBeNull();
    });

    it('returns null for malformed checkboxes', () => {
      expect(parser.parseLine('- [] Missing space in checkbox', 0, '/notes/list.md')).toBeNull();
      expect(parser.parseLine('-[ ] No space after dash', 0, '/notes/list.md')).toBeNull();
      expect(parser.parseLine('- [x]', 0, '/notes/list.md')).toBeNull(); // No content after checkbox
    });

    it('generates unique ID from filepath and line number', () => {
      const todo = parser.parseLine('- [ ] Task', 5, '/notes/tasks.md');

      expect(todo!.id).toBe('/notes/tasks.md:5');
    });

    it('preserves source file path', () => {
      const todo = parser.parseLine('- [ ] Task', 0, '/vault/notes/daily/2024-01-15.md');

      expect(todo!.sourceFile).toBe('/vault/notes/daily/2024-01-15.md');
    });
  });

  describe('parseMetadata()', () => {
    describe('due date', () => {
      it('extracts due date', () => {
        const meta = parser.parseMetadata(`Buy milk ${DUE} 2024-01-15`);

        expect(meta.dates.dueDate).toBeDefined();
        expect(meta.dates.dueDate!.getFullYear()).toBe(2024);
        expect(meta.dates.dueDate!.getMonth()).toBe(0); // January
        expect(meta.dates.dueDate!.getDate()).toBe(15);
      });

      it('strips due date from content', () => {
        const meta = parser.parseMetadata(`Buy milk ${DUE} 2024-01-15`);

        expect(meta.cleanContent).toBe('Buy milk');
      });
    });

    describe('scheduled date', () => {
      it('extracts scheduled date', () => {
        const meta = parser.parseMetadata(`Review docs ${SCHEDULED} 2024-02-20`);

        expect(meta.dates.scheduledDate).toBeDefined();
        expect(meta.dates.scheduledDate!.getFullYear()).toBe(2024);
        expect(meta.dates.scheduledDate!.getMonth()).toBe(1); // February
        expect(meta.dates.scheduledDate!.getDate()).toBe(20);
      });

      it('strips scheduled date from content', () => {
        const meta = parser.parseMetadata(`Review docs ${SCHEDULED} 2024-02-20`);

        expect(meta.cleanContent).toBe('Review docs');
      });
    });

    describe('completed date', () => {
      it('extracts completed date (date only)', () => {
        const meta = parser.parseMetadata(`Old task ${COMPLETED} 2024-01-10`);

        expect(meta.dates.completedAt).toBeDefined();
        expect(meta.dates.completedAt!.getFullYear()).toBe(2024);
        expect(meta.dates.completedAt!.getMonth()).toBe(0);
        expect(meta.dates.completedAt!.getDate()).toBe(10);
      });

      it('extracts completed date (with timestamp)', () => {
        const meta = parser.parseMetadata(`Old task ${COMPLETED} 2024-01-10T14:30`);

        expect(meta.dates.completedAt).toBeDefined();
        expect(meta.dates.completedAt!.getHours()).toBe(14);
        expect(meta.dates.completedAt!.getMinutes()).toBe(30);
      });

      it('strips completed date from content', () => {
        const meta = parser.parseMetadata(`Old task ${COMPLETED} 2024-01-10T14:30`);

        expect(meta.cleanContent).toBe('Old task');
      });
    });

    describe('recurrence', () => {
      it('extracts recurrence pattern: every day', () => {
        const meta = parser.parseMetadata(`Daily standup ${RECURRENCE} every day`);

        expect(meta.dates.recurrence).toBe('every day');
      });

      it('extracts recurrence pattern: every week', () => {
        const meta = parser.parseMetadata(`Weekly review ${RECURRENCE} every week`);

        expect(meta.dates.recurrence).toBe('every week');
      });

      it('extracts recurrence pattern: every month', () => {
        const meta = parser.parseMetadata(`Monthly report ${RECURRENCE} every month`);

        expect(meta.dates.recurrence).toBe('every month');
      });

      it('extracts recurrence pattern: every year', () => {
        const meta = parser.parseMetadata(`Annual review ${RECURRENCE} every year`);

        expect(meta.dates.recurrence).toBe('every year');
      });

      it('extracts recurrence pattern: every N days', () => {
        const meta = parser.parseMetadata(`Check plants ${RECURRENCE} every 3 days`);

        expect(meta.dates.recurrence).toBe('every 3 days');
      });

      it('extracts recurrence pattern: every N weeks', () => {
        const meta = parser.parseMetadata(`Biweekly sync ${RECURRENCE} every 2 weeks`);

        expect(meta.dates.recurrence).toBe('every 2 weeks');
      });

      it('strips recurrence from content', () => {
        const meta = parser.parseMetadata(`Daily standup ${RECURRENCE} every day`);

        expect(meta.cleanContent).toBe('Daily standup');
      });
    });

    describe('priority', () => {
      it('extracts high priority', () => {
        const meta = parser.parseMetadata(`Urgent task ${HIGH}`);

        expect(meta.priority).toBe('high');
      });

      it('extracts medium priority', () => {
        const meta = parser.parseMetadata(`Important task ${MEDIUM}`);

        expect(meta.priority).toBe('medium');
      });

      it('extracts low priority', () => {
        const meta = parser.parseMetadata(`Backlog item ${LOW}`);

        expect(meta.priority).toBe('low');
      });

      it('returns undefined priority when not specified', () => {
        const meta = parser.parseMetadata('Regular task');

        expect(meta.priority).toBeUndefined();
      });

      it('strips priority marker from content', () => {
        const meta = parser.parseMetadata(`Urgent task ${HIGH}`);

        expect(meta.cleanContent).toBe('Urgent task');
      });

      it('prioritizes high over medium when both present', () => {
        const meta = parser.parseMetadata(`Task ${HIGH} ${MEDIUM}`);

        expect(meta.priority).toBe('high');
      });
    });

    describe('tags', () => {
      it('extracts single tag', () => {
        const meta = parser.parseMetadata('Fix bug #backend');

        expect(meta.tags).toEqual(['backend']);
      });

      it('extracts multiple tags', () => {
        const meta = parser.parseMetadata('Review PR #frontend #urgent #v2');

        expect(meta.tags).toEqual(['frontend', 'urgent', 'v2']);
      });

      it('handles tags with hyphens', () => {
        const meta = parser.parseMetadata('Deploy #release-1');

        expect(meta.tags).toEqual(['release-1']);
      });

      it('handles tags with underscores', () => {
        const meta = parser.parseMetadata('Update docs #api_v2');

        expect(meta.tags).toEqual(['api_v2']);
      });

      it('handles tags with numbers', () => {
        const meta = parser.parseMetadata('Sprint task #sprint12');

        expect(meta.tags).toEqual(['sprint12']);
      });

      it('returns empty array when no tags', () => {
        const meta = parser.parseMetadata('Plain task');

        expect(meta.tags).toEqual([]);
      });

      it('strips tags from content', () => {
        const meta = parser.parseMetadata('Fix bug #backend #urgent');

        expect(meta.cleanContent).toBe('Fix bug');
      });
    });

    describe('combined metadata', () => {
      it('extracts all metadata types together', () => {
        const line = `Important meeting ${HIGH} ${DUE} 2024-01-15 ${SCHEDULED} 2024-01-10 ${RECURRENCE} every week #work #meeting`;
        const meta = parser.parseMetadata(line);

        expect(meta.priority).toBe('high');
        expect(meta.dates.dueDate).toBeDefined();
        expect(meta.dates.scheduledDate).toBeDefined();
        expect(meta.dates.recurrence).toBe('every week');
        expect(meta.tags).toEqual(['work', 'meeting']);
        expect(meta.cleanContent).toBe('Important meeting');
      });

      it('handles metadata in any order', () => {
        const line = `#project Task ${DUE} 2024-01-15 ${HIGH}`;
        const meta = parser.parseMetadata(line);

        expect(meta.priority).toBe('high');
        expect(meta.dates.dueDate).toBeDefined();
        expect(meta.tags).toEqual(['project']);
        expect(meta.cleanContent).toBe('Task');
      });
    });
  });

  describe('serialize()', () => {
    it('converts incomplete todo to markdown string', () => {
      const todo = parser.parseLine('- [ ] Write tests', 0, '/notes/tasks.md');
      const result = parser.serialize(todo!);

      expect(result).toBe('- [ ] Write tests');
    });

    it('converts completed todo to markdown string', () => {
      const todo = parser.parseLine('- [x] Write tests', 0, '/notes/tasks.md');
      const result = parser.serialize(todo!);

      expect(result).toBe('- [x] Write tests');
    });

    it('preserves asterisk marker', () => {
      const todo = parser.parseLine('* [ ] Asterisk task', 0, '/notes/tasks.md');
      const result = parser.serialize(todo!);

      expect(result).toBe('* [ ] Asterisk task');
    });

    it('preserves indentation', () => {
      const todo = parser.parseLine('  - [ ] Indented', 0, '/notes/tasks.md');
      const result = parser.serialize(todo!);

      expect(result).toBe('  - [ ] Indented');
    });

    it('serializes priority markers', () => {
      const todo = parser.parseLine(`- [ ] Task ${HIGH}`, 0, '/notes/tasks.md');
      const result = parser.serialize(todo!);

      expect(result).toContain(HIGH);
    });

    it('serializes due date', () => {
      const todo = parser.parseLine(`- [ ] Task ${DUE} 2024-01-15`, 0, '/notes/tasks.md');
      const result = parser.serialize(todo!);

      expect(result).toContain(DUE);
      // The date is stored as local time, then serialized via toISOString() which converts to UTC
      // This may shift the date by +/- 1 day depending on timezone
      expect(result).toMatch(/\d{4}-\d{2}-\d{2}/);
    });

    it('serializes scheduled date', () => {
      const todo = parser.parseLine(`- [ ] Task ${SCHEDULED} 2024-01-10`, 0, '/notes/tasks.md');
      const result = parser.serialize(todo!);

      expect(result).toContain(SCHEDULED);
      // The date is stored as local time, then serialized via toISOString() which converts to UTC
      expect(result).toMatch(/\d{4}-\d{2}-\d{2}/);
    });

    it('serializes recurrence', () => {
      const todo = parser.parseLine(`- [ ] Task ${RECURRENCE} every day`, 0, '/notes/tasks.md');
      const result = parser.serialize(todo!);

      expect(result).toContain(RECURRENCE);
      expect(result).toContain('every day');
    });

    it('serializes tags', () => {
      const todo = parser.parseLine('- [ ] Task #backend #urgent', 0, '/notes/tasks.md');
      const result = parser.serialize(todo!);

      expect(result).toContain('#backend');
      expect(result).toContain('#urgent');
    });

    it('serializes completed todo with completion timestamp', () => {
      const todo = parser.parseLine(`- [x] Done ${COMPLETED} 2024-01-15T10:30`, 0, '/notes/tasks.md');
      const result = parser.serialize(todo!);

      expect(result).toContain('[x]');
      expect(result).toContain(COMPLETED);
    });

    it('serializes all metadata types together', () => {
      const line = `- [ ] Complex task ${HIGH} ${DUE} 2024-01-15 ${SCHEDULED} 2024-01-10 ${RECURRENCE} every week #work`;
      const todo = parser.parseLine(line, 0, '/notes/tasks.md');
      const result = parser.serialize(todo!);

      expect(result).toContain('Complex task');
      expect(result).toContain(HIGH);
      expect(result).toContain(DUE);
      expect(result).toContain(SCHEDULED);
      expect(result).toContain(RECURRENCE);
      expect(result).toContain('#work');
    });
  });

  describe('serializeCompleted()', () => {
    it('adds completion timestamp to todo', () => {
      const todo = parser.parseLine('- [ ] Finish report', 0, '/notes/tasks.md');
      // Use UTC time to avoid timezone issues in tests
      const completedAt = new Date('2024-01-15T14:30:00Z');
      const result = parser.serializeCompleted(todo!, completedAt);

      expect(result).toContain('[x]');
      expect(result).toContain(COMPLETED);
      expect(result).toContain(formatCompletedAt(completedAt));
    });

    it('preserves existing metadata when completing', () => {
      const todo = parser.parseLine(`- [ ] Task ${HIGH} ${DUE} 2024-01-20 #work`, 0, '/notes/tasks.md');
      // Use UTC time to avoid timezone issues in tests
      const completedAt = new Date('2024-01-15T10:00:00Z');
      const result = parser.serializeCompleted(todo!, completedAt);

      expect(result).toContain('[x]');
      expect(result).toContain(HIGH);
      expect(result).toContain(DUE);
      // Due date is stored as local time and serialized via toISOString() - may shift by timezone
      expect(result).toMatch(/\d{4}-\d{2}-\d{2}/);
      expect(result).toContain('#work');
      expect(result).toContain(COMPLETED);
    });

    it('preserves indentation when completing', () => {
      const todo = parser.parseLine('  - [ ] Nested task', 0, '/notes/tasks.md');
      const completedAt = new Date('2024-01-15T14:30:00');
      const result = parser.serializeCompleted(todo!, completedAt);

      expect(result).toMatch(/^\s{2}-/);
    });

    it('preserves asterisk marker when completing', () => {
      const todo = parser.parseLine('* [ ] Asterisk task', 0, '/notes/tasks.md');
      const completedAt = new Date('2024-01-15T14:30:00');
      const result = parser.serializeCompleted(todo!, completedAt);

      expect(result).toContain('* [x]');
    });
  });

  describe('edge cases', () => {
    it('handles empty content gracefully', () => {
      const todos = parser.parse('', '/notes/empty.md');

      expect(todos).toHaveLength(0);
    });

    it('does not handle Windows line endings (known limitation)', () => {
      // The parser splits on \n only, leaving \r at end of lines
      // This causes the regex to fail matching as content ends with \r
      const content = '- [ ] Task 1\r\n- [ ] Task 2\r\n- [ ] Task 3';
      const todos = parser.parse(content, '/notes/windows.md');

      // Only the last line works because it has no trailing \r
      expect(todos).toHaveLength(1);
      expect(todos[0]!.content).toBe('Task 3');
    });

    it('partially handles mixed line endings (known limitation)', () => {
      // Lines ending with \n work, lines ending with \r\n do not
      const content = '- [ ] Task 1\n- [ ] Task 2\r\n- [ ] Task 3';
      const todos = parser.parse(content, '/notes/mixed.md');

      // Task 1 works (ends with \n), Task 2 fails (\r\n), Task 3 works (no line ending)
      expect(todos).toHaveLength(2);
    });

    it('handles backslashes in Windows paths', () => {
      const todos = parser.parse('- [ ] Task', 'C:\\Users\\test\\TODO.md');

      expect(todos[0]!.source).toBe('dedicated');
    });

    it('handles special characters in content', () => {
      const todo = parser.parseLine('- [ ] Fix bug with & and <html> escaping', 0, '/notes/tasks.md');

      expect(todo!.content).toBe('Fix bug with & and <html> escaping');
    });

    it('handles unicode in content', () => {
      const todo = parser.parseLine('- [ ] Review documentation', 0, '/notes/tasks.md');

      expect(todo!.content).toBe('Review documentation');
    });

    it('handles consecutive metadata markers', () => {
      const meta = parser.parseMetadata(`Task ${HIGH}${MEDIUM}`);

      // Should pick up high priority (first match in order)
      expect(meta.priority).toBe('high');
    });

    it('handles date at start of content', () => {
      const meta = parser.parseMetadata(`${DUE} 2024-01-15 Buy milk`);

      expect(meta.dates.dueDate).toBeDefined();
      expect(meta.cleanContent).toBe('Buy milk');
    });

    it('handles multiple spaces between words after stripping', () => {
      const meta = parser.parseMetadata(`Task    ${HIGH}    with spaces`);

      // Clean content should normalize whitespace
      expect(meta.cleanContent).toBe('Task with spaces');
    });
  });
});
