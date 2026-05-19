/**
 * Keymap module barrel export.
 */

export {
  registerScopePredicate,
  unregisterScopePredicate,
  buildScopeSnapshot,
  defaultEditorFocusedPredicate,
  defaultModalOpenPredicate,
  clearScopePredicates,
} from './scopes';

export {
  attachGlobalKeymapBinder,
  type GlobalKeymapBinder,
  type GlobalKeymapBinderOptions,
} from './globalKeymapBinder';

export { wireCommandKeybindings } from './wireCommandKeybindings';
