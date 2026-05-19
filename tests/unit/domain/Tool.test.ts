/**
 * Unit tests for Tool entity
 */
import { describe, it, expect } from 'vitest';
import {
  createTool,
  getRequiredParameters,
  hasRequiredParameters,
  getMissingParameters,
  validateParameter,
  validateToolArgs,
  formatToolForAI,
  matchTool,
} from '$lib/domain/entities/Tool';
import type { Tool, ParameterSchema, ToolCategory } from '$lib/domain/entities/Tool';
import { createToolId } from '$lib/domain/values/ToolId';
import type { ToolId } from '$lib/domain/values/ToolId';

// Helper to create a test tool ID
function testToolId(action: string): ToolId {
  return createToolId('note', action);
}

describe('Tool entity', () => {
  describe('createTool()', () => {
    it('creates tool with all parameters', () => {
      const tool = createTool({
        id: testToolId('create'),
        name: 'Create Note',
        description: 'Creates a new note',
        category: 'note',
        parameters: {
          title: {
            type: 'string',
            description: 'Note title',
            required: true,
          },
          content: {
            type: 'string',
            description: 'Note content',
            required: false,
          },
        },
        requiresConfirmation: true,
        keywords: ['new', 'add'],
        examples: ['create a note called Todo'],
        estimatedDuration: 100,
      });

      expect(tool.id).toBe('note:create');
      expect(tool.name).toBe('Create Note');
      expect(tool.description).toBe('Creates a new note');
      expect(tool.category).toBe('note');
      expect(tool.parameters).toHaveProperty('title');
      expect(tool.parameters).toHaveProperty('content');
      expect(tool.enabled).toBe(true);
      expect(tool.requiresConfirmation).toBe(true);
      expect(tool.keywords).toEqual(['new', 'add']);
      expect(tool.examples).toEqual(['create a note called Todo']);
      expect(tool.estimatedDuration).toBe(100);
    });

    it('creates tool with default values', () => {
      const tool = createTool({
        id: testToolId('read'),
        name: 'Read Note',
        description: 'Reads a note',
        category: 'note',
      });

      expect(tool.parameters).toEqual({});
      expect(tool.enabled).toBe(true);
      expect(tool.requiresConfirmation).toBe(false);
      expect(tool.keywords).toEqual([]);
      expect(tool.examples).toEqual([]);
      expect(tool.estimatedDuration).toBeUndefined();
    });

    it('creates tool with each category', () => {
      const categories: ToolCategory[] = ['note', 'editor', 'search', 'navigation', 'system', 'ai', 'custom'];

      for (const category of categories) {
        const namespace = category === 'ai' || category === 'custom' ? 'custom' : category as 'note' | 'editor' | 'search' | 'navigation' | 'system';
        const tool = createTool({
          id: createToolId(namespace, 'test'),
          name: `${category} Tool`,
          description: `A ${category} tool`,
          category,
        });
        expect(tool.category).toBe(category);
      }
    });
  });

  describe('getRequiredParameters()', () => {
    it('returns empty array when no parameters', () => {
      const tool = createTool({
        id: testToolId('empty'),
        name: 'Empty',
        description: 'No params',
        category: 'note',
      });

      expect(getRequiredParameters(tool)).toEqual([]);
    });

    it('returns empty array when no required parameters', () => {
      const tool = createTool({
        id: testToolId('optional'),
        name: 'Optional',
        description: 'Optional params',
        category: 'note',
        parameters: {
          optionalParam: {
            type: 'string',
            description: 'An optional param',
            required: false,
          },
        },
      });

      expect(getRequiredParameters(tool)).toEqual([]);
    });

    it('returns only required parameter names', () => {
      const tool = createTool({
        id: testToolId('mixed'),
        name: 'Mixed',
        description: 'Mixed params',
        category: 'note',
        parameters: {
          required1: {
            type: 'string',
            description: 'Required 1',
            required: true,
          },
          optional: {
            type: 'string',
            description: 'Optional',
            required: false,
          },
          required2: {
            type: 'number',
            description: 'Required 2',
            required: true,
          },
        },
      });

      const required = getRequiredParameters(tool);
      expect(required).toContain('required1');
      expect(required).toContain('required2');
      expect(required).not.toContain('optional');
      expect(required).toHaveLength(2);
    });
  });

  describe('hasRequiredParameters()', () => {
    const tool = createTool({
      id: testToolId('test'),
      name: 'Test',
      description: 'Test tool',
      category: 'note',
      parameters: {
        required: {
          type: 'string',
          description: 'Required param',
          required: true,
        },
        optional: {
          type: 'string',
          description: 'Optional param',
          required: false,
        },
      },
    });

    it('returns true when all required parameters provided', () => {
      expect(hasRequiredParameters(tool, { required: 'value' })).toBe(true);
    });

    it('returns true when extra parameters provided', () => {
      expect(hasRequiredParameters(tool, { required: 'value', extra: 'extra' })).toBe(true);
    });

    it('returns false when required parameter missing', () => {
      expect(hasRequiredParameters(tool, {})).toBe(false);
    });

    it('returns false when required parameter is undefined', () => {
      expect(hasRequiredParameters(tool, { required: undefined })).toBe(false);
    });

    it('returns true for tool with no required parameters', () => {
      const optionalTool = createTool({
        id: testToolId('optional'),
        name: 'Optional',
        description: 'Optional',
        category: 'note',
        parameters: {
          optional: {
            type: 'string',
            description: 'Optional param',
            required: false,
          },
        },
      });
      expect(hasRequiredParameters(optionalTool, {})).toBe(true);
    });
  });

  describe('getMissingParameters()', () => {
    const tool = createTool({
      id: testToolId('test'),
      name: 'Test',
      description: 'Test tool',
      category: 'note',
      parameters: {
        required1: {
          type: 'string',
          description: 'Required 1',
          required: true,
        },
        required2: {
          type: 'number',
          description: 'Required 2',
          required: true,
        },
        optional: {
          type: 'string',
          description: 'Optional',
          required: false,
        },
      },
    });

    it('returns empty array when all required provided', () => {
      expect(getMissingParameters(tool, { required1: 'a', required2: 1 })).toEqual([]);
    });

    it('returns missing required parameter names', () => {
      const missing = getMissingParameters(tool, { required1: 'a' });
      expect(missing).toEqual(['required2']);
    });

    it('returns all missing when none provided', () => {
      const missing = getMissingParameters(tool, {});
      expect(missing).toContain('required1');
      expect(missing).toContain('required2');
      expect(missing).toHaveLength(2);
    });

    it('treats undefined values as missing', () => {
      const missing = getMissingParameters(tool, { required1: 'a', required2: undefined });
      expect(missing).toEqual(['required2']);
    });
  });

  describe('validateParameter()', () => {
    describe('type validation', () => {
      it('validates string type', () => {
        const schema: ParameterSchema = { type: 'string', description: 'A string' };
        expect(validateParameter(schema, 'hello')).toBeNull();
        expect(validateParameter(schema, 123)).toBe('Expected string, got number');
        expect(validateParameter(schema, true)).toBe('Expected string, got boolean');
      });

      it('validates number type', () => {
        const schema: ParameterSchema = { type: 'number', description: 'A number' };
        expect(validateParameter(schema, 42)).toBeNull();
        expect(validateParameter(schema, 'hello')).toBe('Expected number, got string');
        expect(validateParameter(schema, true)).toBe('Expected number, got boolean');
      });

      it('validates boolean type', () => {
        const schema: ParameterSchema = { type: 'boolean', description: 'A boolean' };
        expect(validateParameter(schema, true)).toBeNull();
        expect(validateParameter(schema, false)).toBeNull();
        expect(validateParameter(schema, 'true')).toBe('Expected boolean, got string');
        expect(validateParameter(schema, 1)).toBe('Expected boolean, got number');
      });

      it('validates array type', () => {
        const schema: ParameterSchema = { type: 'array', description: 'An array' };
        expect(validateParameter(schema, [])).toBeNull();
        expect(validateParameter(schema, [1, 2, 3])).toBeNull();
        expect(validateParameter(schema, 'not array')).toBe('Expected array, got string');
        expect(validateParameter(schema, {})).toBe('Expected array, got object');
      });

      it('validates object type', () => {
        const schema: ParameterSchema = { type: 'object', description: 'An object' };
        expect(validateParameter(schema, {})).toBeNull();
        expect(validateParameter(schema, { key: 'value' })).toBeNull();
        expect(validateParameter(schema, 'not object')).toBe('Expected object, got string');
        // Arrays are detected as array, not object
        expect(validateParameter(schema, [])).toBe('Expected object, got array');
      });
    });

    describe('string constraints', () => {
      it('validates minLength', () => {
        const schema: ParameterSchema = { type: 'string', description: 'Min 3', minLength: 3 };
        expect(validateParameter(schema, 'abc')).toBeNull();
        expect(validateParameter(schema, 'abcd')).toBeNull();
        expect(validateParameter(schema, 'ab')).toBe('String too short (min: 3)');
        expect(validateParameter(schema, '')).toBe('String too short (min: 3)');
      });

      it('validates maxLength', () => {
        const schema: ParameterSchema = { type: 'string', description: 'Max 5', maxLength: 5 };
        expect(validateParameter(schema, 'abc')).toBeNull();
        expect(validateParameter(schema, 'abcde')).toBeNull();
        expect(validateParameter(schema, 'abcdef')).toBe('String too long (max: 5)');
      });

      it('validates pattern', () => {
        const schema: ParameterSchema = { type: 'string', description: 'Email', pattern: '^[a-z]+@[a-z]+\\.[a-z]+$' };
        expect(validateParameter(schema, 'test@example.com')).toBeNull();
        expect(validateParameter(schema, 'invalid')).toBe('String does not match pattern: ^[a-z]+@[a-z]+\\.[a-z]+$');
      });

      it('validates multiple string constraints', () => {
        const schema: ParameterSchema = {
          type: 'string',
          description: 'Constrained',
          minLength: 2,
          maxLength: 5,
          pattern: '^[a-z]+$',
        };
        expect(validateParameter(schema, 'abc')).toBeNull();
        expect(validateParameter(schema, 'a')).toBe('String too short (min: 2)');
        expect(validateParameter(schema, 'abcdef')).toBe('String too long (max: 5)');
        expect(validateParameter(schema, '123')).toBe('String does not match pattern: ^[a-z]+$');
      });
    });

    describe('number constraints', () => {
      it('validates minimum', () => {
        const schema: ParameterSchema = { type: 'number', description: 'Min 0', minimum: 0 };
        expect(validateParameter(schema, 0)).toBeNull();
        expect(validateParameter(schema, 100)).toBeNull();
        expect(validateParameter(schema, -1)).toBe('Number too small (min: 0)');
      });

      it('validates maximum', () => {
        const schema: ParameterSchema = { type: 'number', description: 'Max 100', maximum: 100 };
        expect(validateParameter(schema, 100)).toBeNull();
        expect(validateParameter(schema, 0)).toBeNull();
        expect(validateParameter(schema, 101)).toBe('Number too large (max: 100)');
      });

      it('validates range', () => {
        const schema: ParameterSchema = { type: 'number', description: 'Range', minimum: 1, maximum: 10 };
        expect(validateParameter(schema, 5)).toBeNull();
        expect(validateParameter(schema, 1)).toBeNull();
        expect(validateParameter(schema, 10)).toBeNull();
        expect(validateParameter(schema, 0)).toBe('Number too small (min: 1)');
        expect(validateParameter(schema, 11)).toBe('Number too large (max: 10)');
      });
    });

    describe('array constraints', () => {
      it('validates minLength', () => {
        const schema: ParameterSchema = { type: 'array', description: 'Min 2', minLength: 2 };
        expect(validateParameter(schema, [1, 2])).toBeNull();
        expect(validateParameter(schema, [1, 2, 3])).toBeNull();
        expect(validateParameter(schema, [1])).toBe('Array too short (min: 2)');
        expect(validateParameter(schema, [])).toBe('Array too short (min: 2)');
      });

      it('validates maxLength', () => {
        const schema: ParameterSchema = { type: 'array', description: 'Max 3', maxLength: 3 };
        expect(validateParameter(schema, [1, 2, 3])).toBeNull();
        expect(validateParameter(schema, [])).toBeNull();
        expect(validateParameter(schema, [1, 2, 3, 4])).toBe('Array too long (max: 3)');
      });
    });

    describe('enum constraint', () => {
      it('validates enum values', () => {
        const schema: ParameterSchema = {
          type: 'string',
          description: 'Status',
          enum: ['active', 'inactive', 'pending'],
        };
        expect(validateParameter(schema, 'active')).toBeNull();
        expect(validateParameter(schema, 'inactive')).toBeNull();
        expect(validateParameter(schema, 'pending')).toBeNull();
        expect(validateParameter(schema, 'unknown')).toBe('Value must be one of: active, inactive, pending');
      });

      it('validates numeric enum', () => {
        const schema: ParameterSchema = {
          type: 'number',
          description: 'Priority',
          enum: [1, 2, 3],
        };
        expect(validateParameter(schema, 1)).toBeNull();
        expect(validateParameter(schema, 2)).toBeNull();
        expect(validateParameter(schema, 4)).toBe('Value must be one of: 1, 2, 3');
      });
    });
  });

  describe('validateToolArgs()', () => {
    const tool = createTool({
      id: testToolId('test'),
      name: 'Test',
      description: 'Test',
      category: 'note',
      parameters: {
        title: {
          type: 'string',
          description: 'Title',
          required: true,
          minLength: 1,
          maxLength: 100,
        },
        count: {
          type: 'number',
          description: 'Count',
          required: false,
          minimum: 0,
        },
        status: {
          type: 'string',
          description: 'Status',
          required: false,
          enum: ['active', 'inactive'],
        },
      },
    });

    it('returns empty object for valid arguments', () => {
      const errors = validateToolArgs(tool, { title: 'My Note', count: 5, status: 'active' });
      expect(errors).toEqual({});
    });

    it('reports missing required parameters', () => {
      const errors = validateToolArgs(tool, {});
      expect(errors).toHaveProperty('title', 'Required parameter is missing');
    });

    it('reports type errors', () => {
      const errors = validateToolArgs(tool, { title: 123 });
      expect(errors).toHaveProperty('title', 'Expected string, got number');
    });

    it('reports constraint violations', () => {
      const errors = validateToolArgs(tool, { title: '', count: -1 });
      expect(errors).toHaveProperty('title', 'String too short (min: 1)');
      expect(errors).toHaveProperty('count', 'Number too small (min: 0)');
    });

    it('reports enum violations', () => {
      const errors = validateToolArgs(tool, { title: 'Test', status: 'unknown' });
      expect(errors).toHaveProperty('status', 'Value must be one of: active, inactive');
    });

    it('ignores unknown parameters', () => {
      const errors = validateToolArgs(tool, { title: 'Test', unknown: 'value' });
      expect(errors).toEqual({});
    });

    it('reports multiple errors', () => {
      const errors = validateToolArgs(tool, { count: -1, status: 'bad' });
      expect(Object.keys(errors)).toHaveLength(3);
      expect(errors).toHaveProperty('title');
      expect(errors).toHaveProperty('count');
      expect(errors).toHaveProperty('status');
    });
  });

  describe('formatToolForAI()', () => {
    it('formats tool without parameters', () => {
      const tool = createTool({
        id: testToolId('simple'),
        name: 'Simple Tool',
        description: 'A simple tool',
        category: 'note',
      });

      const formatted = formatToolForAI(tool);
      expect(formatted).toContain('### note:simple');
      expect(formatted).toContain('Name: Simple Tool');
      expect(formatted).toContain('Description: A simple tool');
      expect(formatted).not.toContain('Parameters:');
    });

    it('formats tool with parameters', () => {
      const tool = createTool({
        id: testToolId('params'),
        name: 'Params Tool',
        description: 'Tool with params',
        category: 'note',
        parameters: {
          title: {
            type: 'string',
            description: 'The title',
            required: true,
          },
          count: {
            type: 'number',
            description: 'The count',
            required: false,
          },
        },
      });

      const formatted = formatToolForAI(tool);
      expect(formatted).toContain('Parameters:');
      expect(formatted).toContain('- title: string (required) - The title');
      expect(formatted).toContain('- count: number - The count');
    });

    it('formats tool with examples', () => {
      const tool = createTool({
        id: testToolId('examples'),
        name: 'Examples Tool',
        description: 'Tool with examples',
        category: 'note',
        examples: ['create a new note', 'make a todo list'],
      });

      const formatted = formatToolForAI(tool);
      expect(formatted).toContain('Examples:');
      expect(formatted).toContain('- "create a new note"');
      expect(formatted).toContain('- "make a todo list"');
    });

    it('formats complete tool', () => {
      const tool = createTool({
        id: testToolId('complete'),
        name: 'Complete Tool',
        description: 'A complete tool',
        category: 'note',
        parameters: {
          input: {
            type: 'string',
            description: 'Input value',
            required: true,
          },
        },
        examples: ['use this tool'],
      });

      const formatted = formatToolForAI(tool);
      expect(formatted).toContain('### note:complete');
      expect(formatted).toContain('Name: Complete Tool');
      expect(formatted).toContain('Description: A complete tool');
      expect(formatted).toContain('Parameters:');
      expect(formatted).toContain('Examples:');
    });
  });

  describe('matchTool()', () => {
    const tool = createTool({
      id: testToolId('create'),
      name: 'Create Note',
      description: 'Creates a new note in the system',
      category: 'note',
      keywords: ['new', 'add', 'make'],
    });

    it('returns 0 for empty query', () => {
      expect(matchTool(tool, '')).toBe(0);
      expect(matchTool(tool, '   ')).toBe(0);
    });

    it('matches exact name (high score)', () => {
      const score = matchTool(tool, 'Create Note');
      expect(score).toBeGreaterThanOrEqual(0.5);
    });

    it('matches partial name', () => {
      const score = matchTool(tool, 'create');
      expect(score).toBeGreaterThan(0);
    });

    it('matches description', () => {
      const score = matchTool(tool, 'new note in the system');
      expect(score).toBeGreaterThan(0);
    });

    it('matches keywords', () => {
      const score = matchTool(tool, 'new');
      expect(score).toBeGreaterThan(0);
    });

    it('combines matches for higher score', () => {
      const singleTerm = matchTool(tool, 'system');
      const multipleTerms = matchTool(tool, 'note system');
      // Multiple matching terms should score higher than single term
      expect(multipleTerms).toBeGreaterThan(singleTerm);
    });

    it('is case insensitive', () => {
      const lower = matchTool(tool, 'create note');
      const upper = matchTool(tool, 'CREATE NOTE');
      const mixed = matchTool(tool, 'CrEaTe NoTe');
      expect(lower).toBe(upper);
      expect(lower).toBe(mixed);
    });

    it('handles multiple search terms', () => {
      const score = matchTool(tool, 'new add');
      expect(score).toBeGreaterThan(0);
    });

    it('returns score capped at 1', () => {
      // Query that matches everything
      const score = matchTool(tool, 'Create Note new note in the system new add make');
      expect(score).toBeLessThanOrEqual(1);
    });

    it('returns 0 for non-matching query', () => {
      const score = matchTool(tool, 'xyz123');
      expect(score).toBe(0);
    });

    it('partial keyword match gives lower score than exact', () => {
      const exact = matchTool(tool, 'new');
      const partial = matchTool(tool, 'ne');
      // The partial might match via includes, but exact keyword match scores higher
      expect(exact).toBeGreaterThanOrEqual(partial);
    });
  });
});
