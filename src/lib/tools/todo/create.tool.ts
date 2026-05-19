import { defineTool } from '../define';
import type { TodoPriority } from '$lib/domain/values/TodoPriority';

interface CreateTodoArgs {
  title: string;
  priority?: string;
  dueDate?: string;
}

export default defineTool<CreateTodoArgs, { todoId: string; title: string }>({
  id: 'todo:create',
  name: 'Create Todo',
  description: 'Create a todo with title, priority, and optional due date',
  category: 'todo',

  args: {
    title: { type: 'string', description: 'Todo title/content', required: true },
    priority: { type: 'string', description: 'Priority level', enum: ['none', 'low', 'medium', 'high', 'urgent'] },
    dueDate: { type: 'string', description: 'Due date in ISO format (YYYY-MM-DD)' },
  },

  keywords: ['task', 'todo', 'add', 'remind'],
  examples: [
    'Create a todo "Review PR"',
    'Add a high priority task',
    'Create a todo due tomorrow',
  ],
  estimatedDuration: 100,
  resourceId: () => 'todo:create:default',
  accessMode: 'create',

  summary: (_args, result) => `Added todo "${result.title}"`,

  async execute(args, { services, progress }) {
    progress(10, 'Creating todo...');

    const options: import('$lib/ports/inbound/TodoService').CreateTodoOptions = {};
    if (args.priority) options.priority = args.priority as TodoPriority;
    if (args.dueDate) options.dueDate = new Date(args.dueDate);

    const result = await services.todos.create(args.title, options);

    if (!result.ok) {
      throw new Error(`Failed to create todo: ${result.error.message}`);
    }

    progress(100, 'Todo created');
    return { todoId: result.value.id, title: result.value.content };
  },
});
