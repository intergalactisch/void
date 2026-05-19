import { defineTool } from '../define';
import { normalizeTodoId } from './refs';

interface ToggleTodoArgs {
  todoId: string;
}

export default defineTool<ToggleTodoArgs, { success: boolean; completed: boolean }>({
  id: 'todo:toggle',
  name: 'Toggle Todo',
  description: 'Toggle a todo between completed and open. Can check or uncheck.',
  category: 'todo',

  args: {
    todoId: { type: 'string', description: 'ID of the todo to toggle', required: true },
  },

  keywords: ['done', 'finish', 'check', 'complete', 'uncheck', 'reopen', 'undo'],
  examples: [
    'Mark this todo as done',
    'Complete the review task',
    'Check off "Buy groceries"',
    'Reopen that task',
    'Uncheck the meeting prep',
  ],
  estimatedDuration: 100,
  resourceId: (args) => `todo:item:${args.todoId}`,
  accessMode: 'write',

  summary: (_args, result) => result.completed ? 'Marked as done' : 'Marked as open',

  async execute(args, { services, progress }) {
    progress(10, 'Toggling todo...');

    const todoId = normalizeTodoId(args.todoId);
    const result = await services.todos.toggle(todoId);
    if (!result.ok) {
      throw new Error(`Failed to toggle todo: ${result.error.message}`);
    }

    progress(100, result.value.isCompleted ? 'Todo completed' : 'Todo reopened');
    return { success: true, completed: result.value.isCompleted };
  },
});
