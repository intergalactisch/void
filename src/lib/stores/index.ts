/**
 * Stores - Primary Adapters
 *
 * Svelte 5 stores that connect UI components to application services.
 * Part of Hexagonal Architecture primary adapters layer.
 */

export { settingsStore } from './settings.svelte';
export { protectionStore } from './protection.svelte';
export { folderAccessStore } from './folderAccess.svelte';
export { workspaceStore } from './workspace.svelte';
export { editorStore } from './editor.svelte';
export { noteWorkspaceStore } from './noteWorkspace.svelte';
export { inlineAIStore } from './inlineAI.svelte';
export { noteAIActivityStore } from './noteAIActivity.svelte';
export { commandsStore } from './commands.svelte';
export { uiStore } from './ui.svelte';
export { keymapStore } from './keymap.svelte';
export { relationsStore } from './relations.svelte';
export { provenanceStore } from './provenance.svelte';
export { lineageStore } from './lineage.svelte';
export type { LineageTimelineFilter } from './lineage.svelte';
export { pulseStore } from './pulse.svelte';
export { branchesStore } from './branches.svelte';
export { clipboardStore } from './clipboard.svelte';
export { sessionsStore } from './sessions.svelte';
export { syncStore } from './sync.svelte';
export { updaterStore } from './updater.svelte';

// AI Assistant stores
export { aiStore } from './ai.svelte';
export { conversationStore } from './conversation.svelte';
export { toolStore } from './tools.svelte';
export { commandCenterStore } from './commandCenter.svelte';
export type { CommandStreamDensity } from './commandCenter.svelte';

// TODO store
export { getTodoViewLabel, todoStore } from './todo.svelte';
export type { TodoView, TodoViewInfo } from './todo.svelte';

// Notes store
export { notesStore } from './notes.svelte';
export type { RecentNote } from './notes.svelte';

// Logging
export { logStore } from './log.svelte';

// Operations store
export { operationsStore } from './operations.svelte';

// Toast notifications
export { toastStore } from './toast.svelte';
export type { Toast, ToastType, ToastOptions } from './toast.svelte';

// Files & credentials (thin wrappers used by export and settings flows)
export { filesStore } from './files.svelte';
export { credentialsStore } from './credentials.svelte';
