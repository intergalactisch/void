import { defineTool } from '../define';
import { normalizeTodoId } from './refs';

interface UpdateTodoArgs {
  todoId: string;
  content: string;
}

export default defineTool<UpdateTodoArgs, { success: boolean; content: string }>({
  id: 'todo:update',
  name: 'Update Todo',
  description: 'Update the content of a todo',
  category: 'todo',

  args: {
    todoId: { type: 'string', description: 'ID of the todo to update', required: true },
    content: { type: 'string', description: 'New content for the todo', required: true },
  },

  keywords: ['edit', 'change', 'rename', 'modify'],
  examples: [
    'Rename this task',
    'Update the todo text',
    'Change the task description',
  ],
  estimatedDuration: 100,
  resourceId: (args) => `todo:item:${args.todoId}`,
  accessMode: 'write',

  summary: (_args, result) => `Updated to "${result.content}"`,

  async execute(args, { services, progress }) {
    progress(10, 'Updating todo...');

    const todoId = normalizeTodoId(args.todoId);
    const result = await services.todos.update(todoId, args.content);
    if (!result.ok) {
      throw new Error(`Failed to update todo: ${result.error.message}`);
    }

    progress(100, 'Todo updated');
    return { success: true, content: result.value.content };
  },
});
