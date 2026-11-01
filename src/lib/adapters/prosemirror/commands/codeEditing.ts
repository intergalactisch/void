import { TextSelection, type Command } from 'prosemirror-state';

/** Two-space indentation, restricted to a selection within one code block. */
export function indentCode(outdent = false): Command {
  return (state, dispatch) => {
    const { selection } = state;
    const { $from, $to, empty } = selection;
    if (!(selection instanceof TextSelection) || !$from.sameParent($to) || !$from.parent.type.spec.code) return false;
    if (!dispatch) return true;
    const tr = state.tr;
    if (empty && !outdent) {
      dispatch(tr.insertText('  ').scrollIntoView());
      return true;
    }
    const text = $from.parent.textContent;
    const start = $from.parentOffset === 0 ? 0 : text.lastIndexOf('\n', $from.parentOffset - 1) + 1;
    // A selection ending at the next line's start does not include that line.
    const end = !empty && $to.parentOffset > start && text[$to.parentOffset - 1] === '\n'
      ? $to.parentOffset - 1 : $to.parentOffset;
    const lines: number[] = [];
    for (let offset = start; offset <= end;) {
      lines.push(offset);
      const next = text.indexOf('\n', offset);
      if (next < 0) break;
      offset = next + 1;
    }
    for (const offset of lines.reverse()) {
      const pos = $from.start() + offset;
      if (outdent) {
        const indentation = /^(?: {1,2}|\t)/.exec(text.slice(offset))?.[0].length ?? 0;
        if (indentation) tr.delete(pos, pos + indentation);
      } else {
        tr.insertText('  ', pos);
      }
    }
    tr.setSelection(TextSelection.create(tr.doc,
      tr.mapping.map(selection.anchor), tr.mapping.map(selection.head)));
    dispatch(tr.scrollIntoView());
    return true;
  };
}
