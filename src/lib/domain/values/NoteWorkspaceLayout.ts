/**
 * Note workspace layout values.
 *
 * Top-level editor tabs can contain either a single note leaf or a split tree
 * of note leaves. These types are pure domain values; UI stores/components own
 * persistence and rendering.
 */

export type NotePaneDirection = 'horizontal' | 'vertical';
export type NotePaneDropIntent = 'replace' | 'left' | 'right' | 'top' | 'bottom';
export type NotePaneMoveIntent = 'swap' | 'left' | 'right' | 'top' | 'bottom';

/** What is being dragged: an existing open pane (relocate) or a note from the sidebar/palette (open). */
export type DragKind = 'pane' | 'note';
/** Geometric drop zone within a target pane. `center` resolves to swap (pane) or replace (note). */
export type DropPlacement = 'center' | 'left' | 'right' | 'top' | 'bottom';

export interface NotePaneDragPayload {
  paneId: string;
  tabId: string;
  notePath: string | null;
}

export interface NotePaneMoveResult {
  action: 'moved' | 'swapped' | 'ignored';
  activeTabId: string | null;
  activePaneId: string | null;
  sourceNotePath: string | null;
  targetNotePath: string | null;
}

export interface NotePaneLeaf {
  type: 'leaf';
  paneId: string;
  notePath: string | null;
}

export interface NotePaneSplit {
  type: 'split';
  splitId: string;
  direction: NotePaneDirection;
  sizes: [number, number];
  children: [NotePaneNode, NotePaneNode];
}

export type NotePaneNode = NotePaneLeaf | NotePaneSplit;

export interface NoteWorkspaceTab {
  id: string;
  root: NotePaneNode;
  activePaneId: string;
  title: string | null;
}

export interface NoteWorkspaceLayoutState {
  version: 1;
  tabs: NoteWorkspaceTab[];
  activeTabId: string | null;
}

export const NOTE_WORKSPACE_LAYOUT_VERSION = 1 as const;

export const EMPTY_NOTE_WORKSPACE_LAYOUT: NoteWorkspaceLayoutState = {
  version: NOTE_WORKSPACE_LAYOUT_VERSION,
  tabs: [],
  activeTabId: null,
};

export function isNotePaneLeaf(node: NotePaneNode): node is NotePaneLeaf {
  return node.type === 'leaf';
}

export function isNotePaneSplit(node: NotePaneNode): node is NotePaneSplit {
  return node.type === 'split';
}
