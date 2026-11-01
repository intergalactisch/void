import { Fragment, Slice } from 'prosemirror-model';
import { isolateHistory } from './history';
import { Plugin } from 'prosemirror-state';
import { parseMarkdown } from '../../markdown/parser';
import { generateBlockId } from '$lib/domain/entities/Block';

/** Text clipboard handling; HTML clipboard data keeps ProseMirror's native path. */
export function createMarkdownPastePlugin(): Plugin {
  // Native clipboard normalization opens block edges, which would turn a
  // pasted heading into the receiving paragraph. Restore our deliberate slice
  // at the final paste hook. Parsing and this hook run synchronously.
  let markdownSlice: Slice | null = null;
  return new Plugin({
    props: {
      handlePaste(view, _event, slice) {
        if (!slice.size) return false;
        const tr = isolateHistory(view.state.tr.replaceSelection(slice));
        view.dispatch(tr.setMeta('paste', true).setMeta('uiEvent', 'paste').scrollIntoView());
        return true;
      },
      clipboardTextParser(text, context, plain, view) {
        markdownSlice = null;
        const { schema } = view.state;
        const normalized = text.replace(/\r\n?/g, '\n');
        if (context.parent.type.spec.code) {
          return new Slice(normalized ? Fragment.from(schema.text(normalized)) : Fragment.empty, 0, 0);
        }
        const hasMarkdown = /^(?: {0,3}(?:#{1,6} |>|[-+*] |\d+[.)] |`{3,}|~{3,}|---\s*$)|\|.+\|)/m.test(normalized)
          || /(?:\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`\n]+`|~~[^~]+~~|\[[^\]]+\]\([^)]+\)|\[\[[^\]]+\]\])/.test(normalized);
        if (!plain && hasMarkdown) {
          const doc = parseMarkdown(normalized, schema);
          // A paragraph pasted into a sentence should stay in that sentence.
          const first = doc.firstChild;
          if (doc.childCount === 1 && first && first.type === schema.nodes.paragraph) {
            return markdownSlice = new Slice(first.content, 0, 0);
          }
          return markdownSlice = new Slice(doc.content, 0, 0);
        }
        const marks = view.state.storedMarks ?? context.marks();
        const paragraphs = normalized.split('\n').map(line => schema.nodes.paragraph!.create(
          { id: generateBlockId() }, line ? schema.text(line, marks) : null,
        ));
        return Slice.maxOpen(Fragment.fromArray(paragraphs));
      },
      transformPasted(slice, _view, asText) {
        const parsed = markdownSlice;
        markdownSlice = null;
        return asText && parsed ? parsed : slice;
      },
    },
  });
}
