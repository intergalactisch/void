import { defineTool } from '../define';
import { normalizeTodoId } from './refs';

interface DeleteTodoArgs {
  todoId: string;
}

export default defineTool<DeleteTodoArgs, { success: boolean }>({
  id: 'todo:delete',
  name: 'Delete Todo',
  description: 'Permanently delete a todo from its source file',
  category: 'todo',

  args: {
    todoId: { type: 'string', description: 'ID of the todo to delete', required: true },
  },

  keywords: ['remove', 'delete', 'discard', 'trash'],
  examples: [
    'Delete the todo about groceries',
    'Remove that task',
    'Get rid of that todo',
  ],
  estimatedDuration: 100,
  resourceId: (args) => `todo:item:${args.todoId}`,
  accessMode: 'write',
  requiresConfirmation: true,

  summary: () => 'Todo deleted',

  async execute(args, { services, progress }) {
    progress(10, 'Deleting todo...');

    const todoId = normalizeTodoId(args.todoId);
    const result = await services.todos.delete(todoId);
    if (!result.ok) {
      throw new Error(`Failed to delete todo: ${result.error.message}`);
    }

    progress(100, 'Todo deleted');
    return { success: true };
  },
});
