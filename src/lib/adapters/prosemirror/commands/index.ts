/**
 * ProseMirror Commands barrel export
 *
 * Commands for manipulating blocks and marks in the editor.
 */

// Block manipulation commands
export {
  insertBlockAfter,
  deleteBlock,
  moveBlockUp,
  moveBlockDown,
  setBlockType,
  setBlockTypeFromDomain,
  liftBlock,
  exitFinalCodeBlockOnArrowDown,
  insertHorizontalRule,
  splitBlock,
} from './blocks';

// Block utilities (visible block order, range resolution)
export {
  getVisibleBlockOrder,
  findVisibleBlock,
  getPreviousVisibleBlock,
  getNextVisibleBlock,
  resolveVisibleBlockRange,
  resolveVisibleBlock,
  type VisibleBlock,
} from './blockUtils';

// Block navigation commands (depth-aware)
export {
  moveCurrentBlockUp,
  moveCurrentBlockDown,
  duplicateCurrentBlock,
  deleteCurrentBlock,
} from './blockNavigation';

// List commands
export { toggleList, deleteEmptyListItem } from './lists';

// Mark toggle commands
export {
  toggleMark,
  toggleBold,
  toggleItalic,
  toggleUnderline,
  toggleStrikethrough,
  toggleCode,
  toggleHighlight,
  removeHighlight,
  setLink,
  removeLink,
  isMarkActive,
  toggleMarkFromDomain,
} from './marks';
