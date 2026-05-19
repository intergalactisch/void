import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TODO_VIEW,
  TODO_VIEWS,
  getTodoViewLabel,
  isValidTodoView,
} from '$lib/domain/values/TodoView';

describe('TodoView', () => {
  it('starts with the combined All view', () => {
    expect(TODO_VIEWS[0]).toBe('all');
    expect(DEFAULT_TODO_VIEW).toBe('all');
  });

  it('validates and labels the All view', () => {
    expect(isValidTodoView('all')).toBe(true);
    expect(getTodoViewLabel('all')).toBe('All');
  });
});
