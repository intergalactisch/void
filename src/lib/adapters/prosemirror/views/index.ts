/**
 * ProseMirror Views barrel export
 *
 * Custom NodeViews for the editor.
 */

export {
  BlockNodeView,
  createBlockNodeViewFactory,
  createContextAwareFactory,
  type BlockNodeViewOptions,
  type TodoToggleCallback,
} from './BlockNodeView';

// Legacy exports — kept for backward compatibility during migration
export { BlockView, createBlockViewFactory, type BlockViewOptions } from './BlockView';
export { TodoItemView, createTodoItemView } from './TodoItemView';
export { CodeBlockView, createCodeBlockViewFactory } from './CodeBlockView';
