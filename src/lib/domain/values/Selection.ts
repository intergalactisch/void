/**
 * Selection value object - represents editor selection state
 *
 * This is a pure domain value with ZERO external dependencies.
 * Part of the Hexagonal Architecture domain layer.
 */

export interface Selection {
  /** Start position (character offset from document start) */
  from: number;
  /** End position */
  to: number;
  /** Selected text content */
  text: string;
  /** Block ID containing the selection anchor */
  anchorBlockId: string | null;
  /** Block ID containing the selection head */
  headBlockId: string | null;
}

export const EMPTY_SELECTION: Selection = {
  from: 0,
  to: 0,
  text: '',
  anchorBlockId: null,
  headBlockId: null,
};

export function isCollapsed(selection: Selection): boolean {
  return selection.from === selection.to;
}

export function hasSelection(selection: Selection): boolean {
  return selection.from !== selection.to && selection.text.length > 0;
}

/**
 * Build a Selection that enforces `from <= to`. Rejects negative offsets
 * outright. Use this whenever the source of `from`/`to` is anything other
 * than the editor itself (e.g. AI tools, persisted state, tests).
 */
export function createSelection(input: Selection): Selection {
  if (!Number.isFinite(input.from) || !Number.isFinite(input.to)) {
    throw new Error(`Selection offsets must be finite: from=${input.from}, to=${input.to}`);
  }
  if (input.from < 0 || input.to < 0) {
    throw new Error(`Selection offsets must be non-negative: from=${input.from}, to=${input.to}`);
  }
  if (input.from > input.to) {
    throw new Error(`Selection invariant violated: from (${input.from}) > to (${input.to})`);
  }
  return input;
}
