import { beforeEach, describe, expect, it } from 'vitest';
import { noteWorkspaceStore } from '$lib/stores/noteWorkspace.svelte';

describe('noteWorkspaceStore split pane operations', () => {
  beforeEach(() => {
    localStorage.clear();
    noteWorkspaceStore.init();
    noteWorkspaceStore.reset();
  });

  it('creates an active placeholder when splitting a single-note tab', () => {
    noteWorkspaceStore.openNoteTab('alpha.md');
    const tab = noteWorkspaceStore.activeTab!;

    const placeholderId = noteWorkspaceStore.splitActivePane('horizontal');

    expect(placeholderId).toBeTruthy();
    expect(noteWorkspaceStore.activePaneId).toBe(placeholderId);
    expect(noteWorkspaceStore.activeNotePath).toBeNull();
    expect(tab.root.type).toBe('split');
    expect(noteWorkspaceStore.getPanes(tab).map((pane) => pane.notePath)).toEqual([
      'alpha.md',
      null,
    ]);
  });

  it('fills a split placeholder with a note and focuses that pane', () => {
    noteWorkspaceStore.openNoteTab('alpha.md');
    const tab = noteWorkspaceStore.activeTab!;
    const placeholderId = noteWorkspaceStore.splitActivePane('horizontal')!;

    const selectedPath = noteWorkspaceStore.setPaneNote(tab.id, placeholderId, 'beta.md');

    expect(selectedPath).toBe('beta.md');
    expect(noteWorkspaceStore.activePaneId).toBe(placeholderId);
    expect(noteWorkspaceStore.activeNotePath).toBe('beta.md');
    expect(noteWorkspaceStore.getPanes(noteWorkspaceStore.activeTab!).map((pane) => pane.notePath)).toEqual([
      'alpha.md',
      'beta.md',
    ]);
  });

  it('collapses a placeholder when the chosen note already exists in the layout', () => {
    noteWorkspaceStore.openNoteTab('alpha.md');
    const tab = noteWorkspaceStore.activeTab!;
    const originalPaneId = tab.activePaneId;
    const placeholderId = noteWorkspaceStore.splitActivePane('horizontal')!;

    const selectedPath = noteWorkspaceStore.setPaneNote(tab.id, placeholderId, 'alpha.md');

    expect(selectedPath).toBe('alpha.md');
    expect(noteWorkspaceStore.activePaneId).toBe(originalPaneId);
    expect(noteWorkspaceStore.getPanes(noteWorkspaceStore.activeTab!)).toHaveLength(1);
    expect(noteWorkspaceStore.activeNotePath).toBe('alpha.md');
  });

  it('splits a target pane with a concrete note and focuses the new pane', () => {
    noteWorkspaceStore.openNoteTab('alpha.md');
    const tab = noteWorkspaceStore.activeTab!;

    const result = noteWorkspaceStore.splitPaneWithNote(tab.id, tab.activePaneId, 'right', 'beta.md');

    expect(result.action).toBe('split');
    expect(result.notePath).toBe('beta.md');
    expect(noteWorkspaceStore.activeNotePath).toBe('beta.md');
    expect(noteWorkspaceStore.getPanes(noteWorkspaceStore.activeTab!).map((pane) => pane.notePath)).toEqual([
      'alpha.md',
      'beta.md',
    ]);
  });

  it('focuses an existing note pane instead of duplicating it', () => {
    noteWorkspaceStore.openNoteTab('alpha.md');
    let tab = noteWorkspaceStore.activeTab!;
    noteWorkspaceStore.splitPaneWithNote(tab.id, tab.activePaneId, 'right', 'beta.md');
    tab = noteWorkspaceStore.activeTab!;

    const result = noteWorkspaceStore.splitPaneWithNote(tab.id, tab.activePaneId, 'bottom', 'alpha.md');

    expect(result.action).toBe('focused-existing');
    expect(result.notePath).toBe('alpha.md');
    expect(noteWorkspaceStore.activeNotePath).toBe('alpha.md');
    expect(noteWorkspaceStore.getPanes(noteWorkspaceStore.activeTab!)).toHaveLength(2);
  });

  it('opening a note already visible in a split tab focuses that pane instead of adding a tab', () => {
    noteWorkspaceStore.openNoteTab('alpha.md');
    let tab = noteWorkspaceStore.activeTab!;
    noteWorkspaceStore.splitPaneWithNote(tab.id, tab.activePaneId, 'right', 'beta.md');
    const splitTabId = noteWorkspaceStore.activeTabId;

    noteWorkspaceStore.openNoteTab('gamma.md');
    expect(noteWorkspaceStore.tabs).toHaveLength(2);

    const focusedTabId = noteWorkspaceStore.openNoteTab('alpha.md');

    expect(focusedTabId).toBe(splitTabId);
    expect(noteWorkspaceStore.tabs).toHaveLength(2);
    expect(noteWorkspaceStore.activeNotePath).toBe('alpha.md');
    expect(noteWorkspaceStore.activeTab?.root.type).toBe('split');
  });

  it('split requests move an already-open standalone note into the target layout', () => {
    noteWorkspaceStore.openNoteTab('alpha.md');
    noteWorkspaceStore.openNoteTab('beta.md');

    const alphaTab = noteWorkspaceStore.tabs.find((tab) => noteWorkspaceStore.getNotePaths(tab).includes('alpha.md'))!;
    const result = noteWorkspaceStore.splitPaneWithNote(alphaTab.id, alphaTab.activePaneId, 'right', 'beta.md');

    expect(result.action).toBe('split');
    expect(result.notePath).toBe('beta.md');
    expect(noteWorkspaceStore.activeTabId).toBe(alphaTab.id);
    expect(noteWorkspaceStore.tabs).toHaveLength(1);
    expect(noteWorkspaceStore.getPanes(noteWorkspaceStore.activeTab!)).toHaveLength(2);
    expect(noteWorkspaceStore.getNotePaths(noteWorkspaceStore.activeTab!)).toEqual(['alpha.md', 'beta.md']);
  });

  it('resolves drop intents for replace and edge splits', () => {
    noteWorkspaceStore.openNoteTab('alpha.md');
    let tab = noteWorkspaceStore.activeTab!;
    const replace = noteWorkspaceStore.dropNoteOnPane(tab.id, tab.activePaneId, 'beta.md', 'replace');
    expect(replace.action).toBe('replaced');
    expect(noteWorkspaceStore.activeNotePath).toBe('beta.md');

    tab = noteWorkspaceStore.activeTab!;
    const split = noteWorkspaceStore.dropNoteOnPane(tab.id, tab.activePaneId, 'gamma.md', 'top');
    expect(split.action).toBe('split');
    expect(noteWorkspaceStore.activeNotePath).toBe('gamma.md');
    expect(noteWorkspaceStore.getPanes(noteWorkspaceStore.activeTab!).map((pane) => pane.notePath)).toEqual([
      'gamma.md',
      'beta.md',
    ]);
  });

  it('focuses an existing pane when replacing with a duplicate note', () => {
    noteWorkspaceStore.openNoteTab('alpha.md');
    let tab = noteWorkspaceStore.activeTab!;
    noteWorkspaceStore.splitPaneWithNote(tab.id, tab.activePaneId, 'right', 'beta.md');
    tab = noteWorkspaceStore.activeTab!;
    const betaPane = noteWorkspaceStore.getPanes(tab).find((pane) => pane.notePath === 'beta.md')!;

    const result = noteWorkspaceStore.dropNoteOnPane(tab.id, betaPane.paneId, 'alpha.md', 'replace');

    expect(result.action).toBe('focused-existing');
    expect(noteWorkspaceStore.activeNotePath).toBe('alpha.md');
    expect(noteWorkspaceStore.getPanes(noteWorkspaceStore.activeTab!)).toHaveLength(1);
  });

  it('moves a pane to the right of another pane in the same tab', () => {
    noteWorkspaceStore.openNoteTab('alpha.md');
    let tab = noteWorkspaceStore.activeTab!;
    noteWorkspaceStore.splitPaneWithNote(tab.id, tab.activePaneId, 'right', 'beta.md');
    tab = noteWorkspaceStore.activeTab!;
    const alphaPane = noteWorkspaceStore.getPanes(tab).find((pane) => pane.notePath === 'alpha.md')!;
    const betaPane = noteWorkspaceStore.getPanes(tab).find((pane) => pane.notePath === 'beta.md')!;

    const result = noteWorkspaceStore.movePane(tab.id, alphaPane.paneId, tab.id, betaPane.paneId, 'right');

    expect(result.action).toBe('moved');
    expect(noteWorkspaceStore.activeNotePath).toBe('alpha.md');
    expect(noteWorkspaceStore.activePaneId).toBe(alphaPane.paneId);
    expect(noteWorkspaceStore.getNotePaths(noteWorkspaceStore.activeTab!)).toEqual(['beta.md', 'alpha.md']);
    expect(noteWorkspaceStore.activeTab!.root.type).toBe('split');
    if (noteWorkspaceStore.activeTab!.root.type === 'split') {
      expect(noteWorkspaceStore.activeTab!.root.direction).toBe('horizontal');
    }
  });

  it('moves a pane above another pane and changes the split orientation', () => {
    noteWorkspaceStore.openNoteTab('alpha.md');
    let tab = noteWorkspaceStore.activeTab!;
    noteWorkspaceStore.splitPaneWithNote(tab.id, tab.activePaneId, 'right', 'beta.md');
    tab = noteWorkspaceStore.activeTab!;
    const alphaPane = noteWorkspaceStore.getPanes(tab).find((pane) => pane.notePath === 'alpha.md')!;
    const betaPane = noteWorkspaceStore.getPanes(tab).find((pane) => pane.notePath === 'beta.md')!;

    const result = noteWorkspaceStore.movePane(tab.id, betaPane.paneId, tab.id, alphaPane.paneId, 'top');

    expect(result.action).toBe('moved');
    expect(noteWorkspaceStore.getNotePaths(noteWorkspaceStore.activeTab!)).toEqual(['beta.md', 'alpha.md']);
    expect(noteWorkspaceStore.activeTab!.root.type).toBe('split');
    if (noteWorkspaceStore.activeTab!.root.type === 'split') {
      expect(noteWorkspaceStore.activeTab!.root.direction).toBe('vertical');
    }
  });

  it('moves a pane across tabs and closes an empty source tab', () => {
    noteWorkspaceStore.openNoteTab('alpha.md');
    noteWorkspaceStore.openNoteTab('beta.md');
    const alphaTab = noteWorkspaceStore.tabs.find((tab) => noteWorkspaceStore.getNotePaths(tab).includes('alpha.md'))!;
    const betaTab = noteWorkspaceStore.tabs.find((tab) => noteWorkspaceStore.getNotePaths(tab).includes('beta.md'))!;
    const alphaPane = noteWorkspaceStore.getPanes(alphaTab)[0]!;
    const betaPane = noteWorkspaceStore.getPanes(betaTab)[0]!;

    const result = noteWorkspaceStore.movePane(betaTab.id, betaPane.paneId, alphaTab.id, alphaPane.paneId, 'right');

    expect(result.action).toBe('moved');
    expect(noteWorkspaceStore.tabs).toHaveLength(1);
    expect(noteWorkspaceStore.activeTabId).toBe(alphaTab.id);
    expect(noteWorkspaceStore.activePaneId).toBe(betaPane.paneId);
    expect(noteWorkspaceStore.getNotePaths(noteWorkspaceStore.activeTab!)).toEqual(['alpha.md', 'beta.md']);
  });

  it('moves one pane out of a split tab and collapses the source split', () => {
    noteWorkspaceStore.openNoteTab('alpha.md');
    let sourceTab = noteWorkspaceStore.activeTab!;
    noteWorkspaceStore.splitPaneWithNote(sourceTab.id, sourceTab.activePaneId, 'right', 'beta.md');
    sourceTab = noteWorkspaceStore.activeTab!;
    noteWorkspaceStore.openNoteTab('gamma.md');
    const targetTab = noteWorkspaceStore.activeTab!;
    const betaPane = noteWorkspaceStore.getPanes(sourceTab).find((pane) => pane.notePath === 'beta.md')!;
    const gammaPane = noteWorkspaceStore.getPanes(targetTab)[0]!;

    const result = noteWorkspaceStore.movePane(sourceTab.id, betaPane.paneId, targetTab.id, gammaPane.paneId, 'left');

    expect(result.action).toBe('moved');
    expect(noteWorkspaceStore.tabs).toHaveLength(2);
    const collapsedSource = noteWorkspaceStore.tabs.find((tab) => tab.id === sourceTab.id)!;
    expect(noteWorkspaceStore.getNotePaths(collapsedSource)).toEqual(['alpha.md']);
    expect(collapsedSource.root.type).toBe('leaf');
    expect(noteWorkspaceStore.getNotePaths(noteWorkspaceStore.activeTab!)).toEqual(['beta.md', 'gamma.md']);
  });

  it('swaps panes within a tab without changing pane count', () => {
    noteWorkspaceStore.openNoteTab('alpha.md');
    let tab = noteWorkspaceStore.activeTab!;
    noteWorkspaceStore.splitPaneWithNote(tab.id, tab.activePaneId, 'right', 'beta.md');
    tab = noteWorkspaceStore.activeTab!;
    const alphaPane = noteWorkspaceStore.getPanes(tab).find((pane) => pane.notePath === 'alpha.md')!;
    const betaPane = noteWorkspaceStore.getPanes(tab).find((pane) => pane.notePath === 'beta.md')!;

    const result = noteWorkspaceStore.swapPanes(tab.id, alphaPane.paneId, tab.id, betaPane.paneId);

    expect(result.action).toBe('swapped');
    expect(noteWorkspaceStore.getPanes(noteWorkspaceStore.activeTab!)).toHaveLength(2);
    expect(noteWorkspaceStore.getNotePaths(noteWorkspaceStore.activeTab!)).toEqual(['beta.md', 'alpha.md']);
    expect(noteWorkspaceStore.activePaneId).toBe(alphaPane.paneId);
    expect(noteWorkspaceStore.activeNotePath).toBe('alpha.md');
  });

  it('swaps panes across tabs', () => {
    noteWorkspaceStore.openNoteTab('alpha.md');
    noteWorkspaceStore.openNoteTab('beta.md');
    const alphaTab = noteWorkspaceStore.tabs.find((tab) => noteWorkspaceStore.getNotePaths(tab).includes('alpha.md'))!;
    const betaTab = noteWorkspaceStore.tabs.find((tab) => noteWorkspaceStore.getNotePaths(tab).includes('beta.md'))!;
    const alphaPane = noteWorkspaceStore.getPanes(alphaTab)[0]!;
    const betaPane = noteWorkspaceStore.getPanes(betaTab)[0]!;

    const result = noteWorkspaceStore.swapPanes(alphaTab.id, alphaPane.paneId, betaTab.id, betaPane.paneId);

    expect(result.action).toBe('swapped');
    expect(noteWorkspaceStore.getNotePaths(alphaTab)).toEqual(['beta.md']);
    expect(noteWorkspaceStore.getNotePaths(betaTab)).toEqual(['alpha.md']);
    expect(noteWorkspaceStore.activeTabId).toBe(betaTab.id);
    expect(noteWorkspaceStore.activePaneId).toBe(alphaPane.paneId);
    expect(noteWorkspaceStore.activeNotePath).toBe('alpha.md');
  });

  it('ignores invalid pane moves without mutating the layout', () => {
    noteWorkspaceStore.openNoteTab('alpha.md');
    const tab = noteWorkspaceStore.activeTab!;
    const before = JSON.stringify(noteWorkspaceStore.tabs);

    const self = noteWorkspaceStore.movePane(tab.id, tab.activePaneId, tab.id, tab.activePaneId, 'right');
    const invalid = noteWorkspaceStore.movePane(tab.id, 'missing-pane', tab.id, tab.activePaneId, 'left');

    expect(self.action).toBe('ignored');
    expect(invalid.action).toBe('ignored');
    expect(JSON.stringify(noteWorkspaceStore.tabs)).toBe(before);
    expect(noteWorkspaceStore.activeNotePath).toBe('alpha.md');
  });

  it('cycles pane focus forward and backward with wrapping', () => {
    noteWorkspaceStore.openNoteTab('alpha.md');
    let tab = noteWorkspaceStore.activeTab!;
    noteWorkspaceStore.splitPaneWithNote(tab.id, tab.activePaneId, 'right', 'beta.md');
    tab = noteWorkspaceStore.activeTab!;
    noteWorkspaceStore.splitPaneWithNote(tab.id, tab.activePaneId, 'bottom', 'gamma.md');
    tab = noteWorkspaceStore.activeTab!;

    expect(noteWorkspaceStore.activeNotePath).toBe('gamma.md');
    expect(noteWorkspaceStore.focusNextPane(1)).toBe('alpha.md');
    expect(noteWorkspaceStore.focusNextPane(1)).toBe('beta.md');
    expect(noteWorkspaceStore.focusNextPane(-1)).toBe('alpha.md');
  });
});
