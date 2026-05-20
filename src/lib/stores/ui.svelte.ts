/**
 * UI Store - Primary Adapter
 *
 * Shared shell-level UI state that needs to be reachable from routes,
 * commands, and chrome without coupling those components together.
 *
 * Wave-1 expansion: this store now owns every panel-visibility flag that
 * a registered command might toggle. The main route (`+page.svelte`)
 * continues to render based on these flags but no longer owns them as
 * local state.
 */

class UIStore {
  // Modals / sheets
  shortcutSheetOpen = $state(false);
  settingsOpen = $state(false);
  quickSwitcherOpen = $state(false);
  searchPanelOpen = $state(false);

  // Panels
  aiSidebarVisible = $state(false);
  tasksWorkspaceOpen = $state(false);
  relationsPanelVisible = $state(false);
  provenancePanelVisible = $state(false);
  lineageWorkspaceOpen = $state(false);
  syncConflictWorkspaceOpen = $state(false);
  graphViewOpen = $state(false);
  pulseInboxOpen = $state(false);
  branchPickerOpen = $state(false);
  clipboardPickerOpen = $state(false);

  // Modes
  focusMode = $state(false);

  // In-document find/replace
  findBarOpen = $state(false);
  findBarMode = $state<'find' | 'replace'>('find');

  // Bookkeeping for tasks-workspace return path
  notePathBeforeTasks = $state<string | null>(null);
  aiSidebarWasOpenBeforeTasks = $state(false);

  // Pending destructive-action confirmations
  pendingNoteDelete = $state<{ path: string; title: string } | null>(null);

  // ---------- Shortcut sheet ----------
  openShortcutSheet() {
    this.shortcutSheetOpen = true;
  }

  closeShortcutSheet() {
    this.shortcutSheetOpen = false;
  }

  toggleShortcutSheet() {
    this.shortcutSheetOpen = !this.shortcutSheetOpen;
  }

  // ---------- Settings ----------
  openSettings() {
    this.settingsOpen = true;
  }

  closeSettings() {
    this.settingsOpen = false;
  }

  toggleSettings() {
    this.settingsOpen = !this.settingsOpen;
  }

  // ---------- Quick switcher / command palette ----------
  openQuickSwitcher() {
    this.quickSwitcherOpen = true;
  }

  closeQuickSwitcher() {
    this.quickSwitcherOpen = false;
  }

  toggleQuickSwitcher() {
    this.quickSwitcherOpen = !this.quickSwitcherOpen;
  }

  // ---------- Search panel ----------
  openSearchPanel() {
    this.searchPanelOpen = true;
  }

  closeSearchPanel() {
    this.searchPanelOpen = false;
  }

  toggleSearchPanel() {
    this.searchPanelOpen = !this.searchPanelOpen;
  }

  // ---------- AI sidebar / command center ----------
  openAISidebar() {
    this.aiSidebarVisible = true;
  }

  closeAISidebar() {
    this.aiSidebarVisible = false;
  }

  toggleAISidebar() {
    this.aiSidebarVisible = !this.aiSidebarVisible;
  }

  // ---------- Relations panel ----------
  openRelationsPanel() {
    this.relationsPanelVisible = true;
  }
  closeRelationsPanel() {
    this.relationsPanelVisible = false;
  }
  toggleRelationsPanel() {
    this.relationsPanelVisible = !this.relationsPanelVisible;
  }

  // ---------- Provenance panel ----------
  openProvenancePanel() {
    this.provenancePanelVisible = true;
  }
  closeProvenancePanel() {
    this.provenancePanelVisible = false;
  }
  toggleProvenancePanel() {
    this.provenancePanelVisible = !this.provenancePanelVisible;
  }

  // ---------- Lineage history workspace ----------
  openLineageWorkspace() {
    this.lineageWorkspaceOpen = true;
    this.provenancePanelVisible = false;
  }
  closeLineageWorkspace() {
    this.lineageWorkspaceOpen = false;
  }
  toggleLineageWorkspace() {
    this.lineageWorkspaceOpen = !this.lineageWorkspaceOpen;
    if (this.lineageWorkspaceOpen) this.provenancePanelVisible = false;
  }

  // ---------- GitHub sync conflict workspace ----------
  openSyncConflictWorkspace() {
    this.syncConflictWorkspaceOpen = true;
    this.settingsOpen = false;
  }
  closeSyncConflictWorkspace() {
    this.syncConflictWorkspaceOpen = false;
  }
  toggleSyncConflictWorkspace() {
    this.syncConflictWorkspaceOpen = !this.syncConflictWorkspaceOpen;
    if (this.syncConflictWorkspaceOpen) this.settingsOpen = false;
  }

  // ---------- Graph view ----------
  openGraphView() {
    this.graphViewOpen = true;
  }
  closeGraphView() {
    this.graphViewOpen = false;
  }
  toggleGraphView() {
    this.graphViewOpen = !this.graphViewOpen;
  }

  // ---------- Pulse inbox ----------
  openPulseInbox() {
    this.pulseInboxOpen = true;
  }
  closePulseInbox() {
    this.pulseInboxOpen = false;
  }
  togglePulseInbox() {
    this.pulseInboxOpen = !this.pulseInboxOpen;
  }

  // ---------- Branch picker ----------
  openBranchPicker() {
    this.branchPickerOpen = true;
  }
  closeBranchPicker() {
    this.branchPickerOpen = false;
  }
  toggleBranchPicker() {
    this.branchPickerOpen = !this.branchPickerOpen;
  }

  // ---------- Clipboard history picker ----------
  openClipboardPicker() {
    this.clipboardPickerOpen = true;
  }
  closeClipboardPicker() {
    this.clipboardPickerOpen = false;
  }
  toggleClipboardPicker() {
    this.clipboardPickerOpen = !this.clipboardPickerOpen;
  }

  // ---------- Tasks workspace ----------
  openTasksWorkspace(notePathBefore: string | null, aiSidebarWasOpen: boolean) {
    this.notePathBeforeTasks = notePathBefore;
    this.aiSidebarWasOpenBeforeTasks = aiSidebarWasOpen;
    this.tasksWorkspaceOpen = true;
  }

  closeTasksWorkspace() {
    this.tasksWorkspaceOpen = false;
    this.notePathBeforeTasks = null;
    this.aiSidebarWasOpenBeforeTasks = false;
  }

  // ---------- Focus mode ----------
  setFocusMode(value: boolean) {
    this.focusMode = value;
  }

  toggleFocusMode() {
    this.focusMode = !this.focusMode;
  }

  // ---------- Find / replace bar ----------
  openFindBar(mode: 'find' | 'replace' = 'find') {
    this.findBarMode = mode;
    this.findBarOpen = true;
  }
  closeFindBar() {
    this.findBarOpen = false;
  }

  // ---------- Delete confirmation ----------
  requestNoteDelete(path: string, title: string) {
    this.pendingNoteDelete = { path, title };
  }

  clearPendingNoteDelete() {
    this.pendingNoteDelete = null;
  }
}

export const uiStore = new UIStore();
