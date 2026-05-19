/**
 * Unit tests for TodoId value object
 */
import { describe, it, expect } from 'vitest';
import {
  generateTodoId,
  parseTodoId,
  isValidTodoId,
  getTodoFilePath,
  getTodoLineNumber,
} from '$lib/domain/values/TodoId';
import type { TodoId } from '$lib/domain/values/TodoId';

describe('TodoId value object', () => {
  describe('generateTodoId()', () => {
    it('generates ID in filepath:linenumber format', () => {
      const id = generateTodoId('notes/project.md', 42);
      expect(id).toBe('notes/project.md:42');
    });

    it('handles root-level files', () => {
      const id = generateTodoId('TODO.md', 5);
      expect(id).toBe('TODO.md:5');
    });

    it('handles deeply nested paths', () => {
      const id = generateTodoId('/Users/dev/projects/app/src/notes/todo.md', 100);
      expect(id).toBe('/Users/dev/projects/app/src/notes/todo.md:100');
    });

    it('handles line number 0', () => {
      const id = generateTodoId('file.md', 0);
      expect(id).toBe('file.md:0');
    });

    it('throws error for empty file path', () => {
      expect(() => generateTodoId('', 10)).toThrow('File path cannot be empty');
    });

    it('throws error for negative line number', () => {
      expect(() => generateTodoId('file.md', -1)).toThrow('Line number cannot be negative');
    });

    it('throws error for negative line number -100', () => {
      expect(() => generateTodoId('file.md', -100)).toThrow('Line number cannot be negative');
    });
  });

  describe('parseTodoId()', () => {
    it('parses valid ID into file path and line number', () => {
      const id = 'notes/project.md:42' as TodoId;
      const result = parseTodoId(id);
      expect(result.filePath).toBe('notes/project.md');
      expect(result.lineNumber).toBe(42);
    });

    it('parses ID with absolute path', () => {
      const id = '/Users/dev/notes/todo.md:100' as TodoId;
      const result = parseTodoId(id);
      expect(result.filePath).toBe('/Users/dev/notes/todo.md');
      expect(result.lineNumber).toBe(100);
    });

    it('parses ID with line number 0', () => {
      const id = 'file.md:0' as TodoId;
      const result = parseTodoId(id);
      expect(result.filePath).toBe('file.md');
      expect(result.lineNumber).toBe(0);
    });

    it('handles Windows-style paths with drive letter (colon in path)', () => {
      // Windows paths like "C:/path/file.md:42" have multiple colons
      // parseTodoId uses lastIndexOf(':') to handle this
      const id = 'C:/Users/dev/notes/todo.md:42' as TodoId;
      const result = parseTodoId(id);
      expect(result.filePath).toBe('C:/Users/dev/notes/todo.md');
      expect(result.lineNumber).toBe(42);
    });

    it('handles paths with multiple colons', () => {
      // Edge case: path contains colons (e.g., "file:name.md")
      const id = 'weird:path:file.md:99' as TodoId;
      const result = parseTodoId(id);
      expect(result.filePath).toBe('weird:path:file.md');
      expect(result.lineNumber).toBe(99);
    });

    it('throws error for ID without colon separator', () => {
      const id = 'notes/project.md42' as TodoId;
      expect(() => parseTodoId(id)).toThrow('Invalid TodoId: "notes/project.md42" - missing colon separator');
    });

    it('throws error for empty string', () => {
      const id = '' as TodoId;
      expect(() => parseTodoId(id)).toThrow('Invalid TodoId: "" - missing colon separator');
    });
  });

  describe('isValidTodoId()', () => {
    it('returns true for valid ID', () => {
      expect(isValidTodoId('notes/project.md:42')).toBe(true);
    });

    it('returns true for ID with absolute path', () => {
      expect(isValidTodoId('/Users/dev/notes/todo.md:100')).toBe(true);
    });

    it('returns true for ID with line number 0', () => {
      expect(isValidTodoId('file.md:0')).toBe(true);
    });

    it('returns true for Windows-style path', () => {
      expect(isValidTodoId('C:/Users/dev/notes/todo.md:42')).toBe(true);
    });

    it('returns false for ID without colon', () => {
      expect(isValidTodoId('notes/project.md42')).toBe(false);
    });

    it('returns false for ID with non-numeric line number', () => {
      expect(isValidTodoId('file.md:abc')).toBe(false);
    });

    it('returns false for ID with negative line number', () => {
      expect(isValidTodoId('file.md:-1')).toBe(false);
    });

    it('returns false for ID with empty file path', () => {
      expect(isValidTodoId(':42')).toBe(false);
    });

    it('returns false for empty string', () => {
      expect(isValidTodoId('')).toBe(false);
    });

    it('returns false for just a colon', () => {
      expect(isValidTodoId(':')).toBe(false);
    });

    it('returns false for ID ending with colon (no line number)', () => {
      expect(isValidTodoId('file.md:')).toBe(false);
    });

    it('works as type guard', () => {
      const maybeId = 'notes/project.md:42';
      if (isValidTodoId(maybeId)) {
        // TypeScript should recognize maybeId as TodoId here
        const result = parseTodoId(maybeId);
        expect(result.lineNumber).toBe(42);
      }
    });
  });

  describe('getTodoFilePath()', () => {
    it('extracts file path from ID', () => {
      const id = 'notes/project.md:42' as TodoId;
      expect(getTodoFilePath(id)).toBe('notes/project.md');
    });

    it('extracts absolute file path', () => {
      const id = '/Users/dev/notes/todo.md:100' as TodoId;
      expect(getTodoFilePath(id)).toBe('/Users/dev/notes/todo.md');
    });

    it('extracts Windows-style path', () => {
      const id = 'C:/Users/dev/notes/todo.md:42' as TodoId;
      expect(getTodoFilePath(id)).toBe('C:/Users/dev/notes/todo.md');
    });

    it('extracts path with multiple colons', () => {
      const id = 'weird:path:file.md:99' as TodoId;
      expect(getTodoFilePath(id)).toBe('weird:path:file.md');
    });
  });

  describe('getTodoLineNumber()', () => {
    it('extracts line number from ID', () => {
      const id = 'notes/project.md:42' as TodoId;
      expect(getTodoLineNumber(id)).toBe(42);
    });

    it('extracts line number 0', () => {
      const id = 'file.md:0' as TodoId;
      expect(getTodoLineNumber(id)).toBe(0);
    });

    it('extracts large line number', () => {
      const id = 'file.md:99999' as TodoId;
      expect(getTodoLineNumber(id)).toBe(99999);
    });

    it('extracts line number from Windows-style path', () => {
      const id = 'C:/Users/dev/notes/todo.md:42' as TodoId;
      expect(getTodoLineNumber(id)).toBe(42);
    });
  });

  describe('roundtrip: generate and parse', () => {
    it('generates and parses back correctly', () => {
      const originalPath = '/Users/dev/notes/project.md';
      const originalLine = 42;

      const id = generateTodoId(originalPath, originalLine);
      const parsed = parseTodoId(id);

      expect(parsed.filePath).toBe(originalPath);
      expect(parsed.lineNumber).toBe(originalLine);
    });

    it('validates generated IDs', () => {
      const id = generateTodoId('notes/todo.md', 10);
      expect(isValidTodoId(id)).toBe(true);
    });
  });
});
