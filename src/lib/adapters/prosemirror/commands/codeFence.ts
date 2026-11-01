import { TextSelection, type Command } from 'prosemirror-state';
import { parseCodeFenceInfo } from '$lib/core/codeFence';
import { generateBlockId } from '$lib/domain/entities/Block';

/** Wait for Enter so the writer can finish the language and fence metadata. */
export const createCodeBlockFromFence: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  const codeBlock = state.schema.nodes.codeBlock;
  if (!codeBlock || !empty || $from.parent.type.name !== 'paragraph' || $from.parentOffset !== $from.parent.content.size) return false;
  const match = /^```([^\n`]*)$/.exec($from.parent.textContent);
  if (!match) return false;
  const parent = $from.node(-1);
  if (!parent.canReplaceWith($from.index(-1), $from.indexAfter(-1), codeBlock)) return false;
  if (dispatch) {
    const info = parseCodeFenceInfo(match[1]);
    const start = $from.before();
    const tr = state.tr.replaceWith(start, $from.after(), codeBlock.create({
      id: $from.parent.attrs.id ?? generateBlockId(), language: info.language, meta: info.meta,
    }));
    tr.setSelection(TextSelection.create(tr.doc, start + 1));
    dispatch(tr.scrollIntoView());
  }
  return true;
};
