/** Task keyboard behavior, independent of editor views and persistence. */
import { TextSelection, type Command } from 'prosemirror-state';
import { setBlockType, splitBlockAs } from 'prosemirror-commands';
import { generateBlockId } from '$lib/domain/entities/Block';

export const splitTodo: Command = (state, dispatch) => {
  const { $from } = state.selection;
  const todo = state.schema.nodes.todoItem;
  const paragraph = state.schema.nodes.paragraph;
  if (!todo || !paragraph || !(state.selection instanceof TextSelection) || $from.parent.type !== todo) return false;

  if (state.selection.empty && $from.parent.content.size === 0) {
    return setBlockType(paragraph, { id: $from.parent.attrs.id })(state, dispatch);
  }

  // At the start, insert a fresh task before the existing task. Its text,
  // completion state and identity belong together.
  if (state.selection.empty && $from.parentOffset === 0) {
    if (dispatch) {
      const pos = $from.before();
      const emptyTask = todo.create({ id: generateBlockId(), checked: false });
      const tr = state.tr.insert(pos, emptyTask);
      tr.setSelection(TextSelection.create(tr.doc, pos + emptyTask.nodeSize + 1));
      dispatch(tr.scrollIntoView());
    }
    return true;
  }

  // Use the standard split command so selected text is replaced, including
  // selections spanning multiple blocks. New tasks always start unchecked.
  return splitBlockAs(() => ({
    type: todo, attrs: { id: generateBlockId(), checked: false },
  }))(state, dispatch && (tr => {
    const marks = state.storedMarks ?? ($from.parentOffset ? $from.marks() : null);
    if (marks) tr.ensureMarks(marks);
    dispatch(tr);
  }));
};

export const unwrapTodo: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  const paragraph = state.schema.nodes.paragraph;
  if (!paragraph || !empty || $from.parentOffset !== 0 || $from.parent.type.name !== 'todoItem') return false;
  // Backspace at the start removes the checkbox without joining unrelated text.
  return setBlockType(paragraph, { id: $from.parent.attrs.id })(state, dispatch);
};
