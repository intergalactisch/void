import { describe, expect, it } from 'vitest';
import { parseQuickTodoInput } from '$lib/application/services/TodoQuickAddParser';
import { formatDateOnly } from '$lib/domain/values/TodoDateMeta';

describe('TodoQuickAddParser', () => {
  it('parses natural language date, priority, and tags', () => {
    const result = parseQuickTodoInput(
      'Review launch notes tomorrow p1 #work @follow-up',
      {},
      new Date('2026-05-04T09:00:00'),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const parsed = result.value;

    expect(parsed.content).toBe('Review launch notes');
    expect(parsed.options.priority).toBe('high');
    expect(parsed.options.tags).toEqual(['work', 'follow-up']);
    expect(parsed.options.dueDate ? formatDateOnly(parsed.options.dueDate) : '').toBe('2026-05-05');
  });

  it('parses explicit due dates, recurrence, and target lists', () => {
    const result = parseQuickTodoInput(
      'Pay rent due:next friday every month +anytime',
      {},
      new Date('2026-05-04T09:00:00'),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const parsed = result.value;

    expect(parsed.content).toBe('Pay rent');
    expect(parsed.options.targetList).toBe('anytime');
    expect(parsed.options.recurrence).toBe('every month');
    expect(parsed.options.dueDate ? formatDateOnly(parsed.options.dueDate) : '').toBe('2026-05-15');
  });

  it('preserves defaults when the input does not override them', () => {
    const defaultDue = new Date('2026-05-10');
    const result = parseQuickTodoInput('Draft agenda #team', {
      dueDate: defaultDue,
      priority: 'medium',
      tags: ['work'],
      targetList: 'inbox',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const parsed = result.value;

    expect(parsed.content).toBe('Draft agenda');
    expect(parsed.options.dueDate).toBe(defaultDue);
    expect(parsed.options.priority).toBe('medium');
    expect(parsed.options.tags).toEqual(['work', 'team']);
    expect(parsed.options.targetList).toBe('inbox');
  });

  it('returns Result.err when title is empty', () => {
    const result = parseQuickTodoInput('   ', {});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('Task title is required');
  });
});
