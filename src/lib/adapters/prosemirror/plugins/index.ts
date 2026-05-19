/**
 * ProseMirror Plugins barrel export
 *
 * Plugins that extend editor functionality.
 */

// Placeholder plugin for empty blocks
export {
  placeholderPlugin,
  placeholderPluginKey,
  placeholderStyles,
  type PlaceholderPluginOptions,
} from './placeholder';

// History plugin for undo/redo
export {
  historyPlugin,
  historyKeymap,
  undoCommand,
  redoCommand,
  canUndo,
  canRedo,
  type HistoryPluginOptions,
} from './history';

// Slash menu plugin for command palette
export {
  createSlashMenuPlugin,
  slashMenuKey,
  INITIAL_STATE as slashMenuInitialState,
  getSlashMenuState,
  type SlashMenuState,
  type SlashMenuPluginOptions,
} from './slashMenu';

// Drag-drop plugin for block reordering
export {
  createDragDropPlugin,
  dragDropKey,
  getDragDropState,
  handleDragStart,
  dropIndicatorStyles,
  BLOCK_DRAG_MIME,
  DROP_INDICATOR_CLASS,
  BLOCK_DRAGGING_CLASS,
  INITIAL_STATE as dragDropInitialState,
  type DragDropState,
  type DragDropPluginOptions,
  type DropPosition,
  type BlockDragData,
} from './dragDrop';

// AI Rewrite plugin for AI-powered text transformation
export {
  createAIRewritePlugin,
  aiRewriteKey,
  aiRewriteInitialState,
  getAIRewriteState,
  getOperationLabel,
  isValidSelection,
  createAIDecorations,
  aiDecorationStyles,
  startAIProcessing,
  updateAIResult,
  completeAIProcessing,
  reportAIError,
  acceptAIResult,
  rejectAIResult,
  cancelAIProcessing,
  showAIPopup,
  hideAIPopup,
  resetAIProcessing,
  AI_PROCESSING_RANGE_CLASS,
  AI_PROCESSING_INDICATOR_CLASS,
  AI_SPINNER_CLASS,
  AI_LABEL_CLASS,
  AI_RESULT_CLASS,
  AI_ERROR_CLASS,
  type AIRewritePluginState,
  type AIRewriteMeta,
  type AIRewritePluginOptions,
} from './aiRewrite';

// List input rules for auto-converting text patterns to lists
export { createListInputRules } from './listInputRules';

// Block input rules for auto-converting text patterns to block types
export { createBlockInputRules } from './blockInputRules';

// Mark input rules for inline markdown formatting
export { createMarkInputRules } from './markInputRules';

// Page Link plugin for wiki-style [[links]]
export {
  createPageLinkPlugin,
  pageLinkKey,
  INITIAL_STATE as pageLinkInitialState,
  getPageLinkState,
  type PageLinkState,
  type PageLinkNote,
  type PageLinkPluginOptions,
  type NotesProvider,
} from './pageLink';

// AI Block Lock plugin for AI-controlled block editing
export {
  createAIBlockPlugin,
  aiBlockKey,
  AI_BYPASS,
  type AIBlockPluginOptions,
} from './aiBlock';
export type { AIBlockState, AIBlockMeta, AIBlockLock, AIBlockPhase } from './aiBlock';

// Block Selection plugin for gutter-click multi-select
export {
  blockSelectionKey,
  createBlockSelectionKeymap,
  createBlockSelectionPlugin,
  getBlockSelectionState,
  isBlockSelectionActive,
  selectBlockFromGutter,
  type BlockSelectionState,
} from './blockSelection';

// AI Shortcut Keymap plugin (Cmd+Shift+R/E for rewrite/expand)
export { createAIShortcutKeymap } from './aiShortcutKeymap';

// Find/Replace plugin (Cmd+F / Cmd+Alt+F)
export {
  createFindReplacePlugin,
  findReplaceKey,
  openFindBar,
  closeFindBar,
  setFindQuery,
  findNext,
  findPrev,
  replaceCurrent,
  replaceAll,
  getFindReplaceState,
  type FindReplaceState,
  type FindReplaceMeta,
} from './findReplace';

// Quick-Jump plugin (Mod+Shift+J — AceJump-style block navigation)
export {
  createQuickJumpPlugin,
  quickJumpKey,
  activateQuickJump,
  deactivateQuickJump,
  isQuickJumpActive,
  type QuickJumpState,
} from './quickJump';
