/**
 * ScopeSnapshot - frozen UI/runtime state used to resolve commands and keystrokes.
 *
 * Pure domain value: no DOM, no stores, no imports. Built at command-execution
 * time by registered scope predicates (see src/lib/keymap/scopes.ts).
 *
 * The keymap resolver and command-runWhen filter both consume this shape to
 * decide whether a command is currently applicable.
 */

export interface ScopeSnapshot {
  /** Path of the active note in the editor, or null when no note is open. */
  activeNotePath: string | null;
  /** True when the ProseMirror editor (or another contenteditable) has focus. */
  editorFocused: boolean;
  /** True when any modal or focus-trapped dialog is open. */
  modalOpen: boolean;
  /** True when the command palette / quick switcher is open. */
  paletteOpen: boolean;
  /** True when the AI command center / sidebar is visible. */
  aiSidebarOpen: boolean;
  /** True when the dedicated tasks workspace is the foreground view. */
  tasksWorkspaceOpen: boolean;
  /** True when a tag detail view is the foreground content. */
  tagViewActive: boolean;
  /** True when the focus / zen mode is on. */
  focusMode: boolean;
  /** True when the sidebar is currently visible. */
  sidebarVisible: boolean;
  /** True when the find/replace bar is open inside the editor. */
  findBarOpen: boolean;
}

/** Empty snapshot — useful for tests and as a starting state in scope resolution. */
export const EMPTY_SCOPE: ScopeSnapshot = {
  activeNotePath: null,
  editorFocused: false,
  modalOpen: false,
  paletteOpen: false,
  aiSidebarOpen: false,
  tasksWorkspaceOpen: false,
  tagViewActive: false,
  focusMode: false,
  sidebarVisible: true,
  findBarOpen: false,
};
