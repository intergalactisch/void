/**
 * Quick-Jump Plugin (AceJump-style block navigation)
 *
 * On activation:
 *  1. Iterate every visible block in the doc.
 *  2. Generate a 2-letter label per block ('aa', 'ab', 'ac', ...).
 *  3. Render labels as block-start decorations.
 *  4. Capture keystrokes: build up a 2-letter buffer.
 *  5. When the buffer matches a label, place the cursor at that block's start
 *     and deactivate. Escape cancels.
 *
 * Activation API: `activateQuickJump(view)` and `deactivateQuickJump(view)`.
 * The global keymap binds `Mod+Shift+J` (via the `view.quickJump` command in
 * the global registry) to call `activateQuickJump`.
 */

import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';
import { getVisibleBlockOrder, type VisibleBlock } from '../../commands/blockUtils';

export interface QuickJumpState {
  active: boolean;
  /** Map of generated label → target block position. */
  labels: Array<{ label: string; pos: number; blockId: string }>;
  /** Letters typed so far (0–2 chars). */
  buffer: string;
}

const QUICK_JUMP_META = 'quickJump';
export const quickJumpKey = new PluginKey<QuickJumpState>('quickJump');

type QuickJumpMeta =
  | { type: 'activate'; labels: QuickJumpState['labels'] }
  | { type: 'deactivate' }
  | { type: 'append'; char: string };

function emptyState(): QuickJumpState {
  return { active: false, labels: [], buffer: '' };
}

const LABEL_ALPHABET = 'asdfghjklqwertyuiopzxcvbnm';

function generateLabels(blocks: VisibleBlock[]): QuickJumpState['labels'] {
  const out: QuickJumpState['labels'] = [];
  for (let i = 0; i < blocks.length; i++) {
    const first = LABEL_ALPHABET[Math.floor(i / LABEL_ALPHABET.length) % LABEL_ALPHABET.length] ?? 'a';
    const second = LABEL_ALPHABET[i % LABEL_ALPHABET.length] ?? 'a';
    const block = blocks[i];
    if (!block) continue;
    out.push({
      label: `${first}${second}`,
      pos: block.pos + 1, // jump inside the node, not to its boundary
      blockId: block.blockId,
    });
  }
  return out;
}

function applyMeta(state: QuickJumpState, meta: QuickJumpMeta): QuickJumpState {
  switch (meta.type) {
    case 'activate':
      return { active: true, labels: meta.labels, buffer: '' };
    case 'deactivate':
      return emptyState();
    case 'append': {
      if (!state.active) return state;
      const buffer = (state.buffer + meta.char).slice(0, 2);
      return { ...state, buffer };
    }
  }
}

function buildDecorations(state: EditorState): DecorationSet {
  const ps = quickJumpKey.getState(state);
  if (!ps || !ps.active || ps.labels.length === 0) return DecorationSet.empty;
  const decos: Decoration[] = [];
  for (const entry of ps.labels) {
    const dom = document.createElement('span');
    dom.className = 'pm-quickjump-label';
    const remaining = entry.label.slice(ps.buffer.length);
    const consumed = entry.label.slice(0, ps.buffer.length);
    if (consumed) {
      const consumedSpan = document.createElement('span');
      consumedSpan.className = 'pm-quickjump-consumed';
      consumedSpan.textContent = consumed;
      dom.appendChild(consumedSpan);
    }
    dom.appendChild(document.createTextNode(remaining));
    if (ps.buffer && !entry.label.startsWith(ps.buffer)) {
      dom.classList.add('pm-quickjump-dimmed');
    }
    decos.push(Decoration.widget(entry.pos, dom, { side: -1, key: `qj-${entry.label}` }));
  }
  return DecorationSet.create(state.doc, decos);
}

export function createQuickJumpPlugin(): Plugin<QuickJumpState> {
  return new Plugin<QuickJumpState>({
    key: quickJumpKey,
    state: {
      init: emptyState,
      apply(tr: Transaction, prev: QuickJumpState): QuickJumpState {
        const meta = tr.getMeta(QUICK_JUMP_META) as QuickJumpMeta | undefined;
        if (meta) return applyMeta(prev, meta);
        // Doc changes without meta deactivate (typing outside the buffer
        // shouldn't leave dangling labels around).
        if (tr.docChanged && prev.active) return emptyState();
        return prev;
      },
    },
    props: {
      decorations(state) {
        return buildDecorations(state);
      },
      handleKeyDown(view, event) {
        const ps = quickJumpKey.getState(view.state);
        if (!ps || !ps.active) return false;

        if (event.key === 'Escape') {
          event.preventDefault();
          deactivateQuickJump(view);
          return true;
        }

        if (event.key.length !== 1 || !/[a-z]/i.test(event.key)) {
          return false;
        }

        event.preventDefault();
        const char = event.key.toLowerCase();
        const next = (ps.buffer + char).slice(0, 2);
        const match = ps.labels.find((entry) => entry.label === next);
        if (match) {
          jumpTo(view, match.pos);
          deactivateQuickJump(view);
          return true;
        }
        // Partial — append to buffer if any label still starts with `next`.
        const stillPossible = ps.labels.some((entry) => entry.label.startsWith(next));
        if (!stillPossible) {
          deactivateQuickJump(view);
          return true;
        }
        view.dispatch(view.state.tr.setMeta(QUICK_JUMP_META, { type: 'append', char }));
        return true;
      },
    },
  });
}

// ─── Public API ───

export function activateQuickJump(view: EditorView): void {
  const blocks = getVisibleBlockOrder(view.state.doc);
  if (blocks.length === 0) return;
  const labels = generateLabels(blocks);
  view.dispatch(view.state.tr.setMeta(QUICK_JUMP_META, { type: 'activate', labels }));
}

export function deactivateQuickJump(view: EditorView): void {
  view.dispatch(view.state.tr.setMeta(QUICK_JUMP_META, { type: 'deactivate' }));
}

export function isQuickJumpActive(state: EditorState): boolean {
  return !!quickJumpKey.getState(state)?.active;
}

function jumpTo(view: EditorView, pos: number): void {
  const $pos = view.state.doc.resolve(Math.min(pos, view.state.doc.content.size));
  const tr = view.state.tr.setSelection(TextSelection.near($pos)).scrollIntoView();
  view.dispatch(tr);
  view.focus();
}
