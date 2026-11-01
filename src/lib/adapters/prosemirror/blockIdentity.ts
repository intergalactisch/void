/** Repair block identities only when a transaction could introduce duplicates. */
import type { EditorState, Transaction } from 'prosemirror-state';
import { AddMarkStep, RemoveMarkStep, ReplaceStep } from 'prosemirror-transform';
import { generateBlockId } from '$lib/domain/entities/Block';

function changesIdentities(tr: Transaction): boolean {
  return tr.steps.some((step, index) => {
    if (step instanceof AddMarkStep || step instanceof RemoveMarkStep) return false;
    if (!(step instanceof ReplaceStep)) return true;
    const before = tr.docs[index]!;
    const from = before.resolve(step.from);
    const to = before.resolve(step.to);
    if (!from.sameParent(to) || !from.parent.isTextblock) return true;
    let inlineOnly = true;
    step.slice.content.forEach(node => { if (!node.isInline) inlineOnly = false; });
    return !inlineOnly;
  });
}

export function repairBlockIdentities(state: EditorState, transactions: readonly Transaction[]): Transaction | null {
  if (!transactions.some(changesIdentities)) return null;
  const seen = new Set<string>();
  let repair: Transaction | null = null;
  state.doc.descendants((node, pos) => {
    if (!('id' in node.attrs)) return;
    const id = node.attrs.id as string | null;
    if (id && !seen.has(id)) { seen.add(id); return; }
    const freshId = generateBlockId();
    seen.add(freshId);
    if (!repair) {
      repair = state.tr.setMeta('addToHistory', false);
      // Identity maintenance must not consume the user's chance to undo an
      // automatic Markdown conversion with Backspace.
      for (const plugin of state.plugins) {
        if (plugin.spec.isInputRules) {
          const undoable = plugin.getState(state);
          if (undoable) repair.setMeta(plugin, undoable);
        }
      }
    }
    repair.setNodeMarkup(pos, undefined, { ...node.attrs, id: freshId });
  });
  return repair;
}
