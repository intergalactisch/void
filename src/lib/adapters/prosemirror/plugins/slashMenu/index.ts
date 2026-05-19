/**
 * Slash Menu Plugin exports
 *
 * Provides slash command functionality for the ProseMirror editor.
 */

export {
  createSlashMenuPlugin,
  slashMenuKey,
  INITIAL_STATE,
  getSlashMenuState,
  type SlashMenuState,
  type SlashMenuPluginOptions,
} from './plugin';

export { createSlashMenuHandlers, createSlashMenuReducer } from './handlers';
