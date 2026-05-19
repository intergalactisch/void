import { defineTool } from '../define';
import type { TodoId } from '$lib/domain/values/TodoId';
import type { TodoPriority } from '$lib/domain/values/TodoPriority';

interface ListTodosArgs {
  status?: string;
  priority?: string;
}

interface ListResult {
  todos: Array<{ id: TodoId; content: string; isCompleted: boolean; priority: TodoPriority | undefined }>;
  count: number;
}

export default defineTool<ListTodosArgs, ListResult>({
  id: 'todo:list',
  name: 'List Todos',
  description: 'List todos filtered by status or priority',
  category: 'todo',

  args: {
    status: { type: 'string', description: 'Filter by status', enum: ['all', 'open', 'completed'] },
    priority: { type: 'string', description: 'Filter by priority', enum: ['none', 'low', 'medium', 'high', 'urgent'] },
  },

  keywords: ['tasks', 'todos', 'show', 'pending'],
  examples: [
    'Show all my todos',
    'List open tasks',
    'Show high priority todos',
  ],
  estimatedDuration: 100,
  accessMode: 'read',

  summary: (_args, result) => `Found ${result.count} todo${result.count !== 1 ? 's' : ''}`,

  async execute(args, { services, progress }) {
    progress(10, 'Loading todos...');

    const status = args.status === 'completed' ? 'completed' as const
      : args.status === 'open' ? 'open' as const
      : 'all' as const;

    const result = await services.todos.getAll({ status });
    if (!result.ok) {
      throw new Error(`Failed to list todos: ${result.error.message}`);
    }

    const todos = result.value.map((t) => ({
      id: t.id,
      content: t.content,
      isCompleted: t.isCompleted,
      priority: t.priority,
    }));

    progress(100, 'Todos loaded');
    return { todos, count: todos.length };
  },
});
