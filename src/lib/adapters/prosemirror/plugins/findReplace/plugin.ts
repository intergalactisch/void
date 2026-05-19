/**
 * Find/Replace Plugin
 *
 * In-document search and replace with ProseMirror decorations:
 *  - Highlights every match in the current document
 *  - Tracks a single "active" match for keyboard navigation
 *  - Supports plain text, case toggle, whole word, regex
 *  - Replace one / replace all (single transaction so undo is atomic)
 *
 * State is mutated through a meta channel keyed by the plugin's PluginKey.
 * Outside callers use the helpers below; the editor adapter wires
 * `editor.find` / `editor.findReplace` / `editor.findNext` / `editor.findPrev`
 * commands to those helpers.
 */

import { Plugin, PluginKey, type EditorState, type Transaction } from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';

export interface FindReplaceState {
  active: boolean;
  query: string;
  regex: boolean;
  caseSensitive: boolean;
  wholeWord: boolean;
  matches: { from: number; to: number }[];
  activeIndex: number;
}

interface MatchPosition {
  from: number;
  to: number;
}

const FIND_REPLACE_META = 'findReplace';

export const findReplaceKey = new PluginKey<FindReplaceState>('findReplace');

export type FindReplaceMeta =
  | { type: 'open'; mode?: 'find' | 'replace' }
  | { type: 'close' }
  | { type: 'set-query'; query: string; regex?: boolean; caseSensitive?: boolean; wholeWord?: boolean }
  | { type: 'next' }
  | { type: 'prev' }
  | { type: 'replace'; replacement: string }
  | { type: 'replace-all'; replacement: string };

function initialState(): FindReplaceState {
  return {
    active: false,
    query: '',
    regex: false,
    caseSensitive: false,
    wholeWord: false,
    matches: [],
    activeIndex: 0,
  };
}

function findAllMatches(doc: EditorState['doc'], state: FindReplaceState): MatchPosition[] {
  if (!state.query) return [];

  const matcher = compileMatcher(state);
  if (!matcher) return [];

  const matches: MatchPosition[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText) return true;
    const text = node.text ?? '';
    for (const match of matcher(text)) {
      matches.push({
        from: pos + match.start,
        to: pos + match.end,
      });
    }
    return true;
  });
  return matches;
}

function compileMatcher(state: FindReplaceState): ((text: string) => Array<{ start: number; end: number }>) | null {
  if (state.regex) {
    try {
      const re = new RegExp(state.query, state.caseSensitive ? 'g' : 'gi');
      return (text) => {
        const out: Array<{ start: number; end: number }> = [];
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(text)) !== null) {
          out.push({ start: m.index, end: m.index + m[0].length });
          if (m[0].length === 0) re.lastIndex += 1;
        }
        return out;
      };
    } catch {
      return null;
    }
  }
  const wholeWord = state.wholeWord;
  const cs = state.caseSensitive;
  const target = cs ? state.query : state.query.toLowerCase();
  if (!target) return null;
  return (text) => {
    const haystack = cs ? text : text.toLowerCase();
    const out: Array<{ start: number; end: number }> = [];
    let from = 0;
    while (from <= haystack.length) {
      const idx = haystack.indexOf(target, from);
      if (idx === -1) break;
      const end = idx + target.length;
      const before = idx > 0 ? text[idx - 1] : '';
      const after = end < text.length ? text[end] : '';
      const isWord = !wholeWord || ((!before || !/\w/.test(before)) && (!after || !/\w/.test(after)));
      if (isWord) {
        out.push({ start: idx, end });
      }
      from = end > from ? end : from + 1;
    }
    return out;
  };
}

function applyMeta(state: FindReplaceState, meta: FindReplaceMeta, doc: EditorState['doc']): FindReplaceState {
  switch (meta.type) {
    case 'open': {
      return { ...state, active: true };
    }
    case 'close': {
      return { ...initialState() };
    }
    case 'set-query': {
      const next: FindReplaceState = {
        ...state,
        active: true,
        query: meta.query,
        regex: meta.regex ?? state.regex,
        caseSensitive: meta.caseSensitive ?? state.caseSensitive,
        wholeWord: meta.wholeWord ?? state.wholeWord,
      };
      next.matches = findAllMatches(doc, next);
      next.activeIndex = next.matches.length > 0 ? 0 : 0;
      return next;
    }
    case 'next': {
      if (state.matches.length === 0) return state;
      return {
        ...state,
        activeIndex: (state.activeIndex + 1) % state.matches.length,
      };
    }
    case 'prev': {
      if (state.matches.length === 0) return state;
      return {
        ...state,
        activeIndex: state.activeIndex === 0 ? state.matches.length - 1 : state.activeIndex - 1,
      };
    }
    case 'replace':
    case 'replace-all':
      // The replace path handles document mutation; matches are recomputed
      // by the apply() pass after the doc transformation completes.
      return state;
  }
}

function buildDecorations(doc: EditorState['doc'], state: FindReplaceState): DecorationSet {
  if (!state.active || state.matches.length === 0) return DecorationSet.empty;
  const decos: Decoration[] = state.matches.map((m, idx) =>
    Decoration.inline(m.from, m.to, {
      class: idx === state.activeIndex ? 'pm-find-match pm-find-match-active' : 'pm-find-match',
    })
  );
  return DecorationSet.create(doc, decos);
}

export function createFindReplacePlugin(): Plugin<FindReplaceState> {
  return new Plugin<FindReplaceState>({
    key: findReplaceKey,
    state: {
      init: () => initialState(),
      apply(tr: Transaction, prev: FindReplaceState): FindReplaceState {
        const meta = tr.getMeta(FIND_REPLACE_META) as FindReplaceMeta | undefined;
        let next = prev;
        if (meta) {
          next = applyMeta(prev, meta, tr.doc);
        }
        if (tr.docChanged && next.active && next.query) {
          next = { ...next };
          next.matches = findAllMatches(tr.doc, next);
          if (next.activeIndex >= next.matches.length) {
            next.activeIndex = next.matches.length > 0 ? next.matches.length - 1 : 0;
          }
        }
        return next;
      },
    },
    props: {
      decorations(state: EditorState) {
        const pluginState = findReplaceKey.getState(state);
        if (!pluginState) return null;
        return buildDecorations(state.doc, pluginState);
      },
    },
  });
}

// ─── Helpers / public API ────────────────────────────────────────────

export function openFindBar(view: EditorView, mode: 'find' | 'replace' = 'find'): void {
  view.dispatch(view.state.tr.setMeta(FIND_REPLACE_META, { type: 'open', mode }));
}

export function closeFindBar(view: EditorView): void {
  view.dispatch(view.state.tr.setMeta(FIND_REPLACE_META, { type: 'close' }));
}

export function setFindQuery(
  view: EditorView,
  query: string,
  options?: { regex?: boolean; caseSensitive?: boolean; wholeWord?: boolean }
): void {
  view.dispatch(view.state.tr.setMeta(FIND_REPLACE_META, {
    type: 'set-query',
    query,
    ...(options ?? {}),
  }));
}

export function findNext(view: EditorView): void {
  view.dispatch(view.state.tr.setMeta(FIND_REPLACE_META, { type: 'next' }));
  scrollActiveIntoView(view);
}

export function findPrev(view: EditorView): void {
  view.dispatch(view.state.tr.setMeta(FIND_REPLACE_META, { type: 'prev' }));
  scrollActiveIntoView(view);
}

export function replaceCurrent(view: EditorView, replacement: string): void {
  const state = findReplaceKey.getState(view.state);
  if (!state || state.matches.length === 0) return;
  const match = state.matches[state.activeIndex];
  if (!match) return;
  const tr = view.state.tr.replaceWith(
    match.from,
    match.to,
    view.state.schema.text(replacement)
  );
  view.dispatch(tr);
}

export function replaceAll(view: EditorView, replacement: string): number {
  const state = findReplaceKey.getState(view.state);
  if (!state || state.matches.length === 0) return 0;

  // Replace from the END of the document backward so earlier offsets stay valid.
  const matches = [...state.matches].sort((a, b) => b.from - a.from);
  let tr = view.state.tr;
  for (const match of matches) {
    tr = tr.replaceWith(match.from, match.to, view.state.schema.text(replacement));
  }
  view.dispatch(tr);
  return matches.length;
}

function scrollActiveIntoView(view: EditorView): void {
  const state = findReplaceKey.getState(view.state);
  if (!state || state.matches.length === 0) return;
  const match = state.matches[state.activeIndex];
  if (!match) return;
  // Use ProseMirror's scrollIntoView meta on a no-op transaction.
  const tr = view.state.tr.setSelection(view.state.selection).scrollIntoView();
  view.dispatch(tr);
  void match; // suppress unused
}

export function getFindReplaceState(state: EditorState): FindReplaceState | null {
  return findReplaceKey.getState(state) ?? null;
}
