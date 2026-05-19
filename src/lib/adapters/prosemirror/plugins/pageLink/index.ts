/**
 * Page Link Plugin exports
 *
 * Provides wiki-style [[link]] functionality for the ProseMirror editor.
 */

export {
  createPageLinkPlugin,
  pageLinkKey,
  INITIAL_STATE,
  getPageLinkState,
  type PageLinkState,
  type PageLinkNote,
  type PageLinkMode,
  type PageLinkMatchKind,
  type PageLinkRelationHint,
  type PageLinkSelectionRange,
  type PageLinkPluginOptions,
  type NotesProvider,
} from './plugin';

export {
  createPageLinkHandlers,
  createPageLinkReducer,
  insertPageLink,
  openPageLinkPicker,
  setPageLink,
  removePageLink,
  closePageLinkPicker,
} from './handlers';
