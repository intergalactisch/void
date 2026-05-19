import type { TodoId } from '$lib/domain/values/TodoId';
import { parseRefId } from '$lib/domain/values/RefId';

export function normalizeTodoId(todoId: string): TodoId {
  const ref = parseRefId(todoId.trim());
  return ((ref?.kind === 'todo' ? ref.todoId : todoId.trim()) as TodoId);
}
