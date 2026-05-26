/**
 * Global Command Implementations
 *
 * Application-wide commands that aren't tied to the in-editor slash menu.
 * Each command:
 *  - has a stable id (used for keymap overrides and palette frecency)
 *  - declares a `defaultKeybinding` that the KeymapService picks up
 *  - declares a `scope` (defaults to 'global') so the right binding wins
 *  - executes by mutating stores (uiStore, notesStore, editorStore, …) or
 *    emitting events the route already listens to
 *
 * Commands here MAY import stores — adapters are allowed to. Domain and
 * application layers must not.
 */

import type { RegisteredCommand } from '$lib/ports/outbound';
import { events } from '$lib/events';
import {
  uiStore,
  notesStore,
  editorStore,
  lineageStore,
  aiStore,
  commandCenterStore,
  logStore,
  toastStore,
  syncStore,
  todoStore,
  noteWorkspaceStore,
} from '$lib/stores';
import { TOKENS } from '$lib/core';
import { getAppContext } from '$lib/bootstrap';
import type { ActionHistoryService } from '$lib/ports/inbound/ActionHistoryService';
import type { DocumentService } from '$lib/ports/inbound/DocumentService';
import { formatDailyDate } from '$lib/domain';
import { TODO_VIEWS, getTodoViewLabel } from '$lib/domain/values/TodoView';

async function openDailyNoteFor(date: Date): Promise<void> {
  const ctx = getAppContext();
  if (!ctx) return;
  const dateStr = formatDailyDate(date);
  const path = `daily/${dateStr}.md`;
  if (notesStore.selectNoteByAnyPath(path)) {
    return;
  }
  const docService = ctx.container.resolve<DocumentService>(TOKENS.DocumentService);
  const result = await docService.createWithContent('daily', dateStr, `# ${dateStr}\n\n`);
  if (!result.ok) {
    toastStore.error(`Could not open daily note: ${result.error.message}`);
    return;
  }
  await notesStore.refresh();
  notesStore.selectNoteByAnyPath(result.value.path);
}

const EDITOR_FIND_SCOPE = ['editor-or-empty'];
const FIND_BAR_SCOPE = ['find-bar'];
const NOTES_CONTEXT_SCOPE = ['context:notes'];
const TASKS_CONTEXT_SCOPE = ['context:tasks'];
const TASKS_NO_INPUT_SCOPE = ['context:tasks', 'no-input-focus'];
const AI_COMMAND_CONTEXT_SCOPE = ['context:ai-command-center'];

function selectTaskByOffset(offset: number): void {
  const visibleTodos = todoStore.visibleTodos;
  if (visibleTodos.length === 0) return;
  const currentIndex = visibleTodos.findIndex((todo) => todo.id === todoStore.selectedTodoId);
  if (currentIndex === -1) {
    todoStore.selectTodo(visibleTodos[offset < 0 ? visibleTodos.length - 1 : 0]!.id);
    return;
  }
  const nextIndex = Math.min(visibleTodos.length - 1, Math.max(0, currentIndex + offset));
  todoStore.selectTodo(visibleTodos[nextIndex]!.id);
}

async function deleteSelectedTask(): Promise<void> {
  const selected = todoStore.selectedTodo;
  if (!selected) return;
  await todoStore.delete(selected.id);
  todoStore.selectTodo(todoStore.visibleTodos[0]?.id ?? null);
}

async function createAICommandThread(): Promise<void> {
  if (!aiStore.ensureAIAvailable()) return;
  await aiStore.newConversation();
  commandCenterStore.reset();
  commandCenterStore.showConversationDetail();
  events.emit('ai-command:focus-composer', {});
}

/**
 * Build the full set of global commands. Called from bootstrap; pass the
 * registry's `register` function in.
 */
export function registerGlobalCommands(
  register: (command: RegisteredCommand) => void
): void {
  for (const command of createGlobalCommands()) {
    register(command);
  }
}

export function createGlobalCommands(): RegisteredCommand[] {
  return [
    // ─── Navigation ───
    {
      id: 'nav.back',
      label: 'Go Back',
      keywords: ['back', 'previous', 'history'],
      category: 'navigation',
      icon: 'arrowLeft',
      description: 'Navigate to the previously selected note',
      defaultKeybinding: 'mod+[',
      scope: ['global'],
      execute: () => {
        notesStore.goBack();
      },
      runWhen: () => notesStore.canGoBack,
    },
    {
      id: 'nav.forward',
      label: 'Go Forward',
      keywords: ['forward', 'next', 'history'],
      category: 'navigation',
      icon: 'arrowRight',
      description: 'Navigate forward in note history',
      defaultKeybinding: 'mod+]',
      scope: ['global'],
      execute: () => {
        notesStore.goForward();
      },
      runWhen: () => notesStore.canGoForward,
    },

    // ─── Palette / Quick switcher ───
    {
      id: 'palette.openNotes',
      label: 'Quick Switcher',
      keywords: ['quick', 'switcher', 'open', 'find', 'note', 'palette'],
      category: 'view',
      icon: 'search',
      description: 'Find and open a note',
      defaultKeybinding: 'mod+p',
      scope: ['global'],
      execute: () => {
        uiStore.openQuickSwitcher();
      },
    },
    {
      id: 'palette.openCommands',
      label: 'Command Palette',
      keywords: ['command', 'palette', 'all', 'actions'],
      category: 'view',
      icon: 'terminal',
      description: 'Run any command',
      defaultKeybinding: 'mod+k',
      scope: ['global'],
      // Mod+K inside the editor is "insert link" — let the editor consume it
      // first. This command only fires when the editor doesn't preventDefault.
      execute: () => {
        uiStore.openQuickSwitcher();
      },
    },
    {
      id: 'layout.balance',
      label: 'Balance Layout',
      keywords: ['balance', 'even', 'distribute', 'equal', 'pane', 'split', 'layout'],
      category: 'view',
      icon: 'layout',
      description: 'Evenly redistribute the panes in the active layout',
      scope: ['global'],
      execute: () => {
        const tabId = noteWorkspaceStore.activeTabId;
        if (tabId) noteWorkspaceStore.balanceTab(tabId);
      },
      runWhen: () => noteWorkspaceStore.isActiveTabSplit,
    },
    {
      id: 'editor.referenceNote',
      label: 'Reference Note',
      keywords: ['reference', 'note', 'wikilink', 'attach', 'link'],
      category: 'editor',
      icon: 'fileText',
      description: 'Link selected words to another note',
      defaultKeybinding: 'mod+shift+k',
      scope: ['editor'],
      execute: () => editorStore.openPageLinkPicker(),
      runWhen: () => editorStore.activePath !== null,
    },
    {
      id: 'editor.removeNoteReference',
      label: 'Remove Note Reference',
      keywords: ['reference', 'note', 'wikilink', 'unlink', 'remove'],
      category: 'editor',
      icon: 'unlink',
      description: 'Remove a note reference while keeping its text',
      scope: ['editor'],
      execute: () => editorStore.removePageLink(),
      runWhen: () => editorStore.activePath !== null,
    },

    // ─── View toggles ───
    {
      id: 'view.toggleAI',
      label: 'Toggle AI Assistant',
      keywords: ['ai', 'assistant', 'sidebar', 'ask', 'void'],
      category: 'view',
      icon: 'sparkles',
      description: 'Open or close the AI command center',
      defaultKeybinding: 'mod+shift+a',
      scope: ['global'],
      execute: () => {
        uiStore.toggleAISidebar();
      },
    },
    {
      id: 'view.toggleAIOperations',
      label: 'AI Operations',
      keywords: ['ai', 'operations', 'actions', 'queue'],
      category: 'view',
      icon: 'list',
      description: 'Show the AI operations panel',
      defaultKeybinding: 'mod+shift+o',
      scope: ['global'],
      execute: () => {
        uiStore.openAISidebar();
        aiStore.setSidebarView('actions');
      },
    },
    {
      id: 'ai.newThread',
      label: 'New Command Thread',
      keywords: ['ai', 'command', 'thread', 'conversation', 'new'],
      category: 'ai',
      icon: 'plus',
      description: 'Start a fresh AI command thread',
      defaultKeybinding: 'mod+n',
      scope: AI_COMMAND_CONTEXT_SCOPE,
      execute: createAICommandThread,
    },
    {
      id: 'view.toggleSidebar',
      label: 'Toggle Sidebar',
      keywords: ['sidebar', 'navigation', 'show', 'hide'],
      category: 'view',
      icon: 'sidebar',
      description: 'Show or hide the navigation sidebar',
      defaultKeybinding: 'mod+b',
      scope: ['global'],
      // When the editor is focused, Cmd+B should bold text. The editor
      // keymap consumes the event first; we only get here if it didn't.
      execute: () => {
        notesStore.toggleSidebar();
      },
    },
    {
      id: 'view.toggleFocusMode',
      label: 'Toggle Focus Mode',
      keywords: ['focus', 'zen', 'distraction', 'free'],
      category: 'view',
      icon: 'eye',
      description: 'Hide chrome for distraction-free writing',
      defaultKeybinding: 'mod+.',
      scope: ['global'],
      execute: () => {
        uiStore.toggleFocusMode();
        if (uiStore.focusMode) {
          notesStore.hideSidebar();
        }
      },
    },
    {
      id: 'view.toggleTasks',
      label: 'Toggle Tasks Workspace',
      keywords: ['tasks', 'todo', 'workspace'],
      category: 'tasks',
      icon: 'checkSquare',
      description: 'Open or close the dedicated tasks workspace',
      defaultKeybinding: 'mod+shift+t',
      scope: ['global'],
      execute: () => {
        events.emit('app:navigate', { view: 'tasks' });
      },
    },
    ...createTaskCommands(),
    {
      id: 'view.toggleLog',
      label: 'Toggle Log Panel',
      keywords: ['log', 'logs', 'debug', 'console'],
      category: 'view',
      icon: 'terminal',
      description: 'Open or close the debug log panel',
      defaultKeybinding: 'mod+shift+l',
      scope: ['global'],
      execute: () => {
        logStore.toggle();
      },
    },
    {
      id: 'view.toggleShortcutSheet',
      label: 'Keyboard Shortcuts',
      keywords: ['shortcuts', 'keyboard', 'help', 'cheatsheet'],
      category: 'view',
      icon: 'keyboard',
      description: 'Show or hide the keyboard shortcuts reference',
      defaultKeybinding: 'mod+/',
      scope: ['global'],
      execute: () => {
        uiStore.toggleShortcutSheet();
      },
    },
    {
      id: 'view.openSettings',
      label: 'Open Settings',
      keywords: ['settings', 'preferences', 'options', 'config'],
      category: 'settings',
      icon: 'settings',
      description: 'Open the settings panel',
      defaultKeybinding: 'mod+,',
      scope: ['global'],
      execute: () => {
        uiStore.toggleSettings();
      },
    },
    {
      id: 'sync.now',
      label: 'Sync Now',
      keywords: ['sync', 'github', 'cloud', 'push', 'pull'],
      category: 'system',
      icon: 'refreshCw',
      description: 'Sync notes with GitHub',
      scope: ['global'],
      execute: async () => {
        const ok = await syncStore.syncNow();
        if (!ok && syncStore.error) {
          toastStore.error(`Sync failed: ${syncStore.error.message}`);
        }
      },
    },
    {
      id: 'sync.refreshStatus',
      label: 'Refresh Sync Status',
      keywords: ['sync', 'github', 'status', 'refresh'],
      category: 'system',
      icon: 'activity',
      description: 'Refresh GitHub sync status',
      scope: ['global'],
      execute: () => {
        void syncStore.refreshStatus();
      },
    },
    {
      id: 'sync.openSettings',
      label: 'Open GitHub Sync',
      keywords: ['sync', 'github', 'settings', 'cloud'],
      category: 'settings',
      icon: 'cloud',
      description: 'Open GitHub sync settings',
      scope: ['global'],
      execute: () => {
        uiStore.openSettings();
      },
    },
    {
      id: 'sync.createRepo',
      label: 'Create GitHub Repo',
      keywords: ['sync', 'github', 'create', 'repo'],
      category: 'settings',
      icon: 'folderPlus',
      description: 'Create a GitHub repository for notes',
      scope: ['global'],
      execute: () => {
        uiStore.openSettings();
      },
    },
    {
      id: 'sync.attachRepo',
      label: 'Attach GitHub Repo',
      keywords: ['sync', 'github', 'attach', 'repo', 'remote'],
      category: 'settings',
      icon: 'link',
      description: 'Attach an existing GitHub repository',
      scope: ['global'],
      execute: () => {
        uiStore.openSettings();
      },
    },
    {
      id: 'sync.detach',
      label: 'Detach GitHub Repo',
      keywords: ['sync', 'github', 'detach', 'disconnect'],
      category: 'settings',
      icon: 'unlink',
      description: 'Detach GitHub sync from this notes folder',
      scope: ['global'],
      execute: async () => {
        const detached = await syncStore.detach();
        if (detached) toastStore.success('GitHub repository detached');
      },
      runWhen: () => syncStore.isAttached,
    },

    // ─── Action history (global undo) ───
    {
      id: 'action.undo',
      label: 'Undo Last Action',
      keywords: ['undo', 'restore', 'reverse', 'history'],
      category: 'system',
      icon: 'undo',
      description: 'Reverse the most recent destructive global action',
      defaultKeybinding: 'mod+shift+z',
      // Outside the editor (so the editor's own undo wins for text edits).
      scope: ['no-input-focus'],
      execute: async () => {
        const ctx = getAppContext();
        const history = ctx?.container.resolve<ActionHistoryService>(TOKENS.ActionHistoryService);
        if (!history) return;
        const result = await history.undoLast();
        if (!result.ok) {
          toastStore.error(`Undo failed: ${result.error.message}`);
          return;
        }
        if (!result.value) {
          toastStore.info('Nothing to undo');
          return;
        }
        toastStore.success(`Undone: ${result.value.summary}`);
      },
    },

    // ─── Notes ───
    {
      id: 'note.new',
      label: 'New Note',
      keywords: ['new', 'create', 'note', 'add'],
      category: 'note',
      icon: 'plus',
      description: 'Create a new note',
      defaultKeybinding: 'mod+n',
      scope: NOTES_CONTEXT_SCOPE,
      execute: async () => {
        const doc = await notesStore.createQuickNote();
        if (doc) {
          toastStore.success('Note created');
        }
      },
    },
    {
      id: 'note.save',
      label: 'Save',
      keywords: ['save', 'write', 'persist'],
      category: 'note',
      icon: 'save',
      description: 'Save the current note',
      defaultKeybinding: 'mod+s',
      scope: ['global'],
      execute: async () => {
        if (!editorStore.activePath) return;
        await editorStore.saveDocument();
        toastStore.success('Document saved');
      },
      runWhen: () => editorStore.activePath !== null,
    },
    {
      id: 'note.refreshFromGitHub',
      label: 'Refresh Note from GitHub',
      keywords: ['note', 'sync', 'github', 'remote', 'refresh'],
      category: 'note',
      icon: 'cloudDownload',
      description: 'Accept the remote GitHub version of the active note',
      scope: ['global'],
      execute: async () => {
        const path = editorStore.activePath ?? notesStore.selectedPath;
        if (!path) return;
        const preview = await syncStore.refreshNoteFromRemote(path);
        if (preview) {
          toastStore.success(`Refreshed ${path} from GitHub`);
        }
      },
      runWhen: () => syncStore.isAttached && (editorStore.activePath !== null || notesStore.selectedPath !== null),
    },
    {
      id: 'tab.next',
      label: 'Next Tab',
      keywords: ['next', 'tab', 'switch'],
      category: 'navigation',
      icon: 'arrowRight',
      description: 'Switch to the next open tab (wraps)',
      defaultKeybinding: 'mod+alt+arrowright',
      scope: ['global'],
      execute: () => {
        const tabs = editorStore.tabs;
        if (tabs.length < 2) return;
        const current = editorStore.activePath;
        const idx = tabs.findIndex((t) => t.path === current);
        const next = tabs[(idx + 1) % tabs.length];
        if (next) {
          notesStore.selectNote(next.path);
        }
      },
      runWhen: () => editorStore.tabs.length >= 2,
    },
    {
      id: 'tab.prev',
      label: 'Previous Tab',
      keywords: ['previous', 'prev', 'tab', 'switch'],
      category: 'navigation',
      icon: 'arrowLeft',
      description: 'Switch to the previous open tab (wraps)',
      defaultKeybinding: 'mod+alt+arrowleft',
      scope: ['global'],
      execute: () => {
        const tabs = editorStore.tabs;
        if (tabs.length < 2) return;
        const current = editorStore.activePath;
        const idx = tabs.findIndex((t) => t.path === current);
        const prev = tabs[(idx - 1 + tabs.length) % tabs.length];
        if (prev) {
          notesStore.selectNote(prev.path);
        }
      },
      runWhen: () => editorStore.tabs.length >= 2,
    },
    ...createTabSwitchCommands(),
    {
      id: 'note.openMarkdownFile',
      label: 'Open Markdown File…',
      keywords: ['open', 'markdown', 'import', 'file', 'external'],
      category: 'note',
      icon: 'folderOpen',
      description: 'Import external .md files into this workspace',
      defaultKeybinding: 'mod+o',
      scope: ['global'],
      execute: () => {
        events.emit('app:request-open-markdown-file', {});
      },
    },
    {
      id: 'tab.close',
      label: 'Close Tab',
      keywords: ['close', 'tab', 'document'],
      category: 'note',
      icon: 'x',
      description: 'Close the active tab',
      defaultKeybinding: 'mod+w',
      scope: ['global'],
      execute: () => {
        events.emit('app:request-close-active-note', {});
      },
      runWhen: () => editorStore.activePath !== null || notesStore.selectedPath !== null,
    },
    {
      id: 'note.exportMarkdown',
      label: 'Export as Markdown',
      keywords: ['export', 'markdown', 'save', 'file', 'download'],
      category: 'note',
      icon: 'download',
      description: 'Export the current note as a .md file',
      defaultKeybinding: 'mod+shift+x',
      scope: ['global'],
      execute: () => {
        events.emit('app:request-export-markdown', {});
      },
      runWhen: () => editorStore.activePath !== null,
    },
    {
      id: 'note.revealCurrent',
      label: 'Show in Finder',
      keywords: ['reveal', 'finder', 'show', 'file'],
      category: 'note',
      icon: 'folderSearch',
      description: 'Reveal the current note in Finder',
      execute: async () => {
        if (!editorStore.activePath) {
          toastStore.error('No document to reveal');
          return;
        }
        const result = await editorStore.revealCurrentDocument();
        if (!result.ok) {
          toastStore.error('Could not show note in Finder');
        }
      },
      runWhen: () => editorStore.activePath !== null,
    },
    // ─── In-document find / replace ───
    {
      id: 'editor.find',
      label: 'Find in Document',
      keywords: ['find', 'search', 'document'],
      category: 'editor',
      icon: 'search',
      description: 'Search within the current note',
      defaultKeybinding: 'mod+f',
      scope: EDITOR_FIND_SCOPE,
      execute: () => {
        uiStore.openFindBar('find');
        editorStore.openFindReplace('find');
      },
      runWhen: () => editorStore.activePath !== null,
    },
    {
      id: 'editor.findReplace',
      label: 'Find and Replace',
      keywords: ['find', 'replace', 'document'],
      category: 'editor',
      icon: 'replace',
      description: 'Find and replace within the current note',
      defaultKeybinding: 'mod+alt+f',
      scope: EDITOR_FIND_SCOPE,
      execute: () => {
        uiStore.openFindBar('replace');
        editorStore.openFindReplace('replace');
      },
      runWhen: () => editorStore.activePath !== null,
    },
    {
      id: 'editor.findNext',
      label: 'Next Match',
      keywords: ['next', 'match', 'find'],
      category: 'editor',
      description: 'Move to the next find match',
      defaultKeybinding: 'mod+g',
      scope: FIND_BAR_SCOPE,
      execute: () => editorStore.findNextMatch(),
      runWhen: () => uiStore.findBarOpen,
    },
    {
      id: 'editor.toggleTodos',
      label: 'Toggle Selected Todos',
      keywords: ['todo', 'task', 'check', 'toggle', 'batch', 'multi'],
      category: 'editor',
      icon: 'checkSquare',
      description: 'Toggle the checked state of every selected todo block',
      defaultKeybinding: 'mod+shift+i',
      scope: ['editor'],
      execute: () => {
        const count = editorStore.toggleSelectedTodos();
        if (count > 0) {
          toastStore.success(`Toggled ${count} todo${count === 1 ? '' : 's'}`);
        }
      },
      runWhen: () => editorStore.activePath !== null,
    },
    {
      id: 'editor.quickJump',
      label: 'Quick Jump',
      keywords: ['jump', 'navigate', 'block', 'acejump'],
      category: 'editor',
      icon: 'crosshair',
      description: 'Label every visible block with a 2-letter code; type to jump',
      defaultKeybinding: 'mod+shift+j',
      scope: ['editor'],
      execute: () => editorStore.activateQuickJump(),
      runWhen: () => editorStore.activePath !== null,
    },
    {
      id: 'editor.findPrev',
      label: 'Previous Match',
      keywords: ['previous', 'match', 'find'],
      category: 'editor',
      description: 'Move to the previous find match',
      defaultKeybinding: 'mod+shift+g',
      scope: FIND_BAR_SCOPE,
      execute: () => editorStore.findPrevMatch(),
      runWhen: () => uiStore.findBarOpen,
    },

    // ─── Workspace presets ───
    {
      id: 'workspace.writing',
      label: 'Workspace: Writing',
      keywords: ['workspace', 'writing', 'focus', 'preset', 'distraction'],
      category: 'view',
      icon: 'pen',
      description: 'Hide sidebar + AI panel, enable focus mode',
      scope: ['global'],
      execute: () => {
        notesStore.hideSidebar();
        uiStore.closeAISidebar();
        uiStore.closeRelationsPanel();
        uiStore.setFocusMode(true);
      },
    },
    {
      id: 'workspace.research',
      label: 'Workspace: Research',
      keywords: ['workspace', 'research', 'preset', 'split', 'relations'],
      category: 'view',
      icon: 'book',
      description: 'Show sidebar, AI sidebar, and relations panel for cross-referencing',
      scope: ['global'],
      execute: () => {
        notesStore.showSidebar();
        uiStore.openAISidebar();
        uiStore.openRelationsPanel();
        uiStore.setFocusMode(false);
      },
    },
    {
      id: 'workspace.triage',
      label: 'Workspace: Triage',
      keywords: ['workspace', 'triage', 'tasks', 'preset', 'inbox'],
      category: 'view',
      icon: 'inbox',
      description: 'Open tasks workspace + AI sidebar for quick triage',
      scope: ['global'],
      execute: () => {
        events.emit('app:navigate', { view: 'tasks' });
        uiStore.openAISidebar();
        uiStore.setFocusMode(false);
      },
    },

    // ─── Graph ───
    {
      id: 'view.toggleGraph',
      label: 'Toggle Local Graph',
      keywords: ['graph', 'visualization', 'neighbors', 'map'],
      category: 'view',
      icon: 'network',
      description: 'Show a graph of notes linked to the current one',
      defaultKeybinding: 'mod+shift+g',
      scope: ['global'],
      execute: () => uiStore.toggleGraphView(),
      runWhen: () => notesStore.selectedPath !== null,
    },

    // ─── Pulse ───
    {
      id: 'view.togglePulse',
      label: 'Toggle Pulse Inbox',
      keywords: ['pulse', 'insights', 'notifications', 'inbox', 'connections'],
      category: 'view',
      icon: 'sparkles',
      description: 'Show or hide the proactive insights inbox',
      defaultKeybinding: 'mod+shift+u',
      scope: ['global'],
      execute: () => uiStore.togglePulseInbox(),
    },

    // ─── Branches ───
    {
      id: 'view.toggleBranchPicker',
      label: 'Toggle Branch Picker',
      keywords: ['branch', 'alternative', 'version', 'compare'],
      category: 'view',
      icon: 'gitBranch',
      description: 'Show alternative versions of the current note',
      defaultKeybinding: 'mod+shift+h',
      scope: ['global'],
      execute: () => uiStore.toggleBranchPicker(),
      runWhen: () => notesStore.selectedPath !== null,
    },

    // ─── Provenance ───
    {
      id: 'view.toggleProvenance',
      label: 'Open History',
      keywords: ['history', 'lineage', 'provenance', 'timeline', 'edits', 'changes'],
      category: 'view',
      icon: 'clock',
      description: 'Open the lineage history workspace',
      defaultKeybinding: 'mod+alt+t',
      scope: ['global'],
      execute: () => {
        uiStore.openLineageWorkspace();
        void lineageStore.openWorkspace(notesStore.selectedPath);
      },
      runWhen: () => notesStore.selectedPath !== null,
    },

    // ─── Relations ───
    {
      id: 'view.toggleRelations',
      label: 'Toggle Relations Panel',
      keywords: ['relations', 'backlinks', 'links', 'graph'],
      category: 'view',
      icon: 'link',
      description: 'Show or hide the backlinks and outgoing links panel',
      defaultKeybinding: 'mod+shift+b',
      scope: ['global'],
      execute: () => uiStore.toggleRelationsPanel(),
    },

    // ─── Clipboard history ───
    {
      id: 'clipboard.openHistory',
      label: 'Clipboard History',
      keywords: ['clipboard', 'paste', 'history', 'copy'],
      category: 'view',
      icon: 'clipboard',
      description: 'Show recent clipboard entries — search and Enter pastes at the cursor',
      defaultKeybinding: 'mod+shift+v',
      scope: ['global'],
      execute: () => uiStore.openClipboardPicker(),
    },

    // ─── Search ───
    {
      id: 'search.findInFiles',
      label: 'Find in Files',
      keywords: ['search', 'find', 'grep', 'content', 'global'],
      category: 'search',
      icon: 'search',
      description: 'Search across all notes',
      defaultKeybinding: 'mod+shift+f',
      scope: ['global'],
      execute: () => {
        uiStore.openSearchPanel();
      },
    },

    {
      id: 'note.duplicate',
      label: 'Duplicate Note',
      keywords: ['duplicate', 'copy', 'fork', 'clone', 'template'],
      category: 'note',
      icon: 'copy',
      description: 'Create a copy of the current note with a unique title',
      execute: async () => {
        const ctx = getAppContext();
        const path = notesStore.selectedPath;
        if (!ctx || !path) {
          toastStore.error('No note open');
          return;
        }
        const docService = ctx.container.resolve<DocumentService>(TOKENS.DocumentService);
        const contentResult = await docService.readContent(path);
        if (!contentResult.ok) {
          toastStore.error(`Could not read note: ${contentResult.error.message}`);
          return;
        }
        const lastSlash = path.lastIndexOf('/');
        const folder = lastSlash >= 0 ? path.slice(0, lastSlash) : '';
        const baseName = (lastSlash >= 0 ? path.slice(lastSlash + 1) : path).replace(/\.md$/i, '');
        const newTitle = `${baseName} (copy)`;
        const result = await docService.createWithContent(folder, newTitle, contentResult.value);
        if (!result.ok) {
          toastStore.error(`Duplicate failed: ${result.error.message}`);
          return;
        }
        await notesStore.refresh();
        notesStore.selectNoteByAnyPath(result.value.path);
        toastStore.success('Note duplicated');
      },
      runWhen: () => notesStore.selectedPath !== null,
    },
    {
      id: 'note.openDaily',
      label: 'Open Today’s Daily Note',
      keywords: ['daily', 'today', 'journal', 'log', 'date'],
      category: 'note',
      icon: 'calendar',
      description: 'Open or create the daily note for today (daily/YYYY-MM-DD.md)',
      defaultKeybinding: 'mod+shift+d',
      scope: ['global'],
      execute: () => openDailyNoteFor(new Date()),
    },
    {
      id: 'note.openDailyYesterday',
      label: 'Open Yesterday’s Daily Note',
      keywords: ['daily', 'yesterday', 'journal', 'log', 'previous'],
      category: 'note',
      icon: 'calendar',
      description: 'Open or create the daily note for yesterday',
      execute: () => {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        return openDailyNoteFor(yesterday);
      },
    },
    {
      id: 'note.openDailyTomorrow',
      label: 'Open Tomorrow’s Daily Note',
      keywords: ['daily', 'tomorrow', 'journal', 'log', 'next'],
      category: 'note',
      icon: 'calendar',
      description: 'Open or create the daily note for tomorrow',
      execute: () => {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        return openDailyNoteFor(tomorrow);
      },
    },
    {
      id: 'note.copyPath',
      label: 'Copy Note Path',
      keywords: ['copy', 'path', 'reference', 'clipboard'],
      category: 'note',
      icon: 'copy',
      description: 'Copy the current note’s path to the clipboard',
      execute: async () => {
        const path = notesStore.selectedPath;
        if (!path) {
          toastStore.error('No note open');
          return;
        }
        try {
          await navigator.clipboard.writeText(path);
          toastStore.success('Path copied');
        } catch (e) {
          toastStore.error('Could not copy path');
        }
      },
      runWhen: () => notesStore.selectedPath !== null,
    },
    {
      id: 'note.copyWikilink',
      label: 'Copy Wikilink',
      keywords: ['copy', 'wikilink', 'reference', 'link', 'clipboard'],
      category: 'note',
      icon: 'link',
      description: 'Copy a [[wikilink]] referencing the current note',
      execute: async () => {
        const path = notesStore.selectedPath;
        if (!path) {
          toastStore.error('No note open');
          return;
        }
        const filename = (path.split('/').pop() ?? path).replace(/\.md$/i, '');
        try {
          await navigator.clipboard.writeText(`[[${filename}]]`);
          toastStore.success('Wikilink copied');
        } catch (e) {
          toastStore.error('Could not copy wikilink');
        }
      },
      runWhen: () => notesStore.selectedPath !== null,
    },
    {
      id: 'note.deleteCurrent',
      label: 'Move Current Note to Trash',
      keywords: ['delete', 'remove', 'trash'],
      category: 'note',
      icon: 'trash',
      description: 'Move the currently open note to recoverable Trash',
      execute: () => {
        const path = notesStore.selectedPath;
        const doc = editorStore.document;
        if (!path || !doc) {
          toastStore.error('No document to delete');
          return;
        }
        const title = doc.meta.title || path.split('/').pop() || 'this note';
        uiStore.requestNoteDelete(path, title);
      },
      runWhen: () => notesStore.selectedPath !== null,
    },
    {
      id: 'capture.open',
      label: 'Open Quick Capture',
      keywords: ['capture', 'quick', 'inbox', 'idea', 'jot', 'note'],
      category: 'system',
      icon: 'inbox',
      description: 'Open the quick-capture window (works globally if Void is in the tray)',
      defaultKeybinding: 'mod+shift+enter',
      scope: ['global'],
      execute: async () => {
        const ctx = getAppContext();
        if (!ctx) return;
        const target = ctx.settings.current().captureTargetDefault;
        await ctx.captureManager.showCapture(target);
      },
    },
  ];
}

function createTaskCommands(): RegisteredCommand[] {
  return [
    {
      id: 'tasks.new',
      label: 'New Todo',
      keywords: ['tasks', 'todo', 'new', 'add', 'capture'],
      category: 'tasks',
      icon: 'plus',
      description: 'Focus the task capture input',
      defaultKeybinding: 'mod+n',
      scope: TASKS_CONTEXT_SCOPE,
      execute: () => {
        events.emit('tasks:request-new', {});
      },
    },
    {
      id: 'tasks.search',
      label: 'Search Todos',
      keywords: ['tasks', 'todo', 'search', 'filter'],
      category: 'tasks',
      icon: 'search',
      description: 'Focus task search',
      defaultKeybinding: 'mod+f',
      scope: TASKS_CONTEXT_SCOPE,
      execute: () => {
        events.emit('tasks:request-search', {});
      },
    },
    {
      id: 'tasks.toggleSelected',
      label: 'Toggle Selected Todo',
      keywords: ['tasks', 'todo', 'complete', 'check', 'toggle'],
      category: 'tasks',
      icon: 'checkSquare',
      description: 'Toggle completion for the selected todo',
      defaultKeybinding: 'mod+k',
      scope: TASKS_CONTEXT_SCOPE,
      execute: async () => {
        const selected = todoStore.selectedTodo;
        if (selected) await todoStore.toggle(selected.id);
      },
    },
    {
      id: 'tasks.selectNext',
      label: 'Select Next Todo',
      keywords: ['tasks', 'todo', 'next', 'down'],
      category: 'tasks',
      icon: 'arrowDown',
      description: 'Select the next visible todo',
      defaultKeybinding: 'arrowdown',
      scope: TASKS_NO_INPUT_SCOPE,
      execute: () => selectTaskByOffset(1),
    },
    {
      id: 'tasks.selectPrevious',
      label: 'Select Previous Todo',
      keywords: ['tasks', 'todo', 'previous', 'up'],
      category: 'tasks',
      icon: 'arrowUp',
      description: 'Select the previous visible todo',
      defaultKeybinding: 'arrowup',
      scope: TASKS_NO_INPUT_SCOPE,
      execute: () => selectTaskByOffset(-1),
    },
    {
      id: 'tasks.editSelected',
      label: 'Edit Selected Todo',
      keywords: ['tasks', 'todo', 'edit', 'title'],
      category: 'tasks',
      icon: 'edit3',
      description: 'Focus the selected todo title',
      defaultKeybinding: 'enter',
      scope: TASKS_NO_INPUT_SCOPE,
      execute: () => {
        events.emit('tasks:request-edit-selected', {});
      },
    },
    {
      id: 'tasks.deleteSelected',
      label: 'Delete Selected Todo',
      keywords: ['tasks', 'todo', 'delete', 'remove'],
      category: 'tasks',
      icon: 'trash',
      description: 'Delete the selected todo',
      defaultKeybinding: 'delete',
      scope: TASKS_NO_INPUT_SCOPE,
      execute: deleteSelectedTask,
    },
    {
      id: 'tasks.deleteSelectedBackspace',
      label: 'Delete Selected Todo (Backspace)',
      keywords: ['tasks', 'todo', 'delete', 'remove', 'backspace'],
      category: 'tasks',
      icon: 'trash',
      description: 'Delete the selected todo with Backspace',
      defaultKeybinding: 'backspace',
      scope: TASKS_NO_INPUT_SCOPE,
      execute: deleteSelectedTask,
    },
    ...createTaskViewSwitchCommands(),
  ];
}

function createTaskViewSwitchCommands(): RegisteredCommand[] {
  return TODO_VIEWS.map((view, index) => ({
    id: `tasks.view.${index + 1}`,
    label: `Tasks: ${getTodoViewLabel(view)}`,
    keywords: ['tasks', 'todo', 'view', getTodoViewLabel(view).toLowerCase()],
    category: 'tasks',
    icon: 'listChecks',
    description: `Switch to the ${getTodoViewLabel(view)} task view`,
    defaultKeybinding: `mod+${index + 1}`,
    scope: TASKS_CONTEXT_SCOPE,
    execute: () => {
      todoStore.setView(view);
    },
  }));
}

/**
 * Generate Cmd+1..9 tab-switch commands. Cmd+9 jumps to the last tab
 * regardless of count (browser convention).
 */
function createTabSwitchCommands(): RegisteredCommand[] {
  const out: RegisteredCommand[] = [];
  for (let i = 1; i <= 9; i++) {
    const slot = i;
    out.push({
      id: `tab.switch.${slot}`,
      label: slot === 9 ? 'Switch to Last Tab' : `Switch to Tab ${slot}`,
      keywords: ['tab', 'switch', String(slot)],
      category: 'navigation',
      description: slot === 9 ? 'Jump to the last open tab' : `Activate the ${ordinal(slot)} tab`,
      defaultKeybinding: `mod+${slot}`,
      scope: ['global'],
      execute: () => {
        const tabs = editorStore.tabs;
        if (tabs.length === 0) return;
        const target =
          slot === 9
            ? tabs[tabs.length - 1]
            : slot - 1 < tabs.length
              ? tabs[slot - 1]
              : null;
        if (target) {
          notesStore.selectNote(target.path);
        }
      },
      runWhen: () => editorStore.tabs.length > 0,
    });
  }
  return out;
}

function ordinal(n: number): string {
  if (n === 1) return '1st';
  if (n === 2) return '2nd';
  if (n === 3) return '3rd';
  return `${n}th`;
}
