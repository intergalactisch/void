/**
 * Page Link Plugin State
 *
 * Manages the state for the page link autocomplete menu, including
 * whether it's open, the current query, filtered notes,
 * and positioning information.
 *
 * Part of the ProseMirror infrastructure adapter.
 */

import { PluginKey } from 'prosemirror-state';

export type PageLinkMode = 'typed' | 'selection';

export type PageLinkMatchKind = 'title' | 'path' | 'tag' | 'recent' | 'all';

export type PageLinkRelationHint = 'attached' | 'backlink' | 'none';

/**
 * A note item for the page link autocomplete.
 */
export interface PageLinkNote {
  /** Relative path from notes folder */
  path: string;
  /** Note title (from frontmatter or filename) */
  title: string;
  /** Folder portion of the path, if nested */
  folder?: string;
  /** Normalized frontmatter tags */
  tags?: string[];
  /** Last modified date from the note index */
  modifiedAt?: Date;
  /** Why this note matched the current query */
  matchKind?: PageLinkMatchKind;
  /** Human-readable match detail, e.g. "#research" */
  matchLabel?: string;
  /** Ranking score used by the provider */
  score?: number;
  /** Lightweight relation hint when available */
  relation?: PageLinkRelationHint;
  /** Whether frecency/recent activity influenced the result */
  isRecent?: boolean;
}

export interface PageLinkSelectionRange {
  from: number;
  to: number;
  text: string;
}

/**
 * State shape for the page link plugin.
 */
export interface PageLinkState {
  /** Whether menu is open */
  isOpen: boolean;
  /** How the picker was opened */
  mode: PageLinkMode;
  /** Current search query (text after [[) */
  query: string;
  /** Position where [[ was typed */
  triggerPos: number;
  /** Editor selection to convert into a note link for programmatic opens */
  selectionRange: PageLinkSelectionRange | null;
  /** Currently selected note index */
  selectedIndex: number;
  /** Filtered notes matching query */
  filteredNotes: PageLinkNote[];
  /** DOM coordinates for positioning the menu popup */
  coords: { top: number; left: number } | null;
  /** Whether menu should open above the cursor */
  openAbove: boolean;
}

/**
 * Initial state for the page link menu.
 * Menu starts closed with no query or notes.
 */
export const INITIAL_STATE: PageLinkState = {
  isOpen: false,
  mode: 'typed',
  query: '',
  triggerPos: 0,
  selectionRange: null,
  selectedIndex: 0,
  filteredNotes: [],
  coords: null,
  openAbove: false,
};

/**
 * Plugin key for accessing page link state.
 * Use this to retrieve the current page link state from the editor state.
 *
 * @example
 * ```typescript
 * const linkState = pageLinkKey.getState(editorState);
 * if (linkState?.isOpen) {
 *   // Render the page link menu
 * }
 * ```
 */
export const pageLinkKey = new PluginKey<PageLinkState>('pageLink');

/**
 * Helper to safely get page link state from editor state.
 *
 * @param state - The ProseMirror editor state
 * @returns The page link state or initial state if not found
 */
export function getPageLinkState(state: unknown): PageLinkState {
  const pluginState = pageLinkKey.getState(state as Parameters<typeof pageLinkKey.getState>[0]);
  return pluginState || INITIAL_STATE;
}
