import { beforeEach, describe, expect, it } from 'vitest';
import type { NotePaneNode } from '$lib/domain';
import { noteWorkspaceStore } from '$lib/stores/noteWorkspace.svelte';

function installMemoryLocalStorage(): void {
  const entries = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return entries.size;
    },
    clear() {
      entries.clear();
    },
    getItem(key: string) {
      return entries.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(entries.keys())[index] ?? null;
    },
    removeItem(key: string) {
      entries.delete(key);
    },
    setItem(key: string, value: string) {
      entries.set(key, String(value));
    },
  };
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage,
  });
}

function collectEffectiveWidths(node: NotePaneNode, width = 100): number[] {
  if (node.type === 'leaf') return [width];
  const [firstSize = 50, secondSize = 50] = node.sizes;
  if (node.direction === 'horizontal') {
    return [
      ...collectEffectiveWidths(node.children[0], width * (firstSize / 100)),
      ...collectEffectiveWidths(node.children[1], width * (secondSize / 100)),
    ];
  }
  return [
    ...collectEffectiveWidths(node.children[0], width),
    ...collectEffectiveWidths(node.children[1], width),
  ];
}

function collectEffectiveHeights(node: NotePaneNode, height = 100): number[] {
  if (node.type === 'leaf') return [height];
  const [firstSize = 50, secondSize = 50] = node.sizes;
  if (node.direction === 'vertical') {
    return [
      ...collectEffectiveHeights(node.children[0], height * (firstSize / 100)),
      ...collectEffectiveHeights(node.children[1], height * (secondSize / 100)),
    ];
  }
  return [
    ...collectEffectiveHeights(node.children[0], height),
    ...collectEffectiveHeights(node.children[1], height),
  ];
}

function collectPathsFromNode(node: NotePaneNode): string[] {
  if (node.type === 'leaf') return node.notePath ? [node.notePath] : [];
  return [
    ...collectPathsFromNode(node.children[0]),
    ...collectPathsFromNode(node.children[1]),
  ];
}

function allWorkspaceNotePaths(): string[] {
  return noteWorkspaceStore.tabs.flatMap((tab) => noteWorkspaceStore.getNotePaths(tab));
}

describe('noteWorkspaceStore split pane operations', () => {
  beforeEach(() => {
    installMemoryLocalStorage();
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

  it('opens an empty tab with a placeholder pane that can be filled', () => {
    noteWorkspaceStore.openNoteTab('alpha.md');

    const id = noteWorkspaceStore.openEmptyTab();

    expect(noteWorkspaceStore.activeTabId).toBe(id);
    expect(noteWorkspaceStore.tabs).toHaveLength(2);
    const tab = noteWorkspaceStore.activeTab!;
    expect(tab.root.type).toBe('leaf');
    expect(noteWorkspaceStore.activeNotePath).toBeNull();

    noteWorkspaceStore.setPaneNote(tab.id, tab.activePaneId, 'beta.md');
    expect(noteWorkspaceStore.activeNotePath).toBe('beta.md');
    expect(noteWorkspaceStore.tabs).toHaveLength(2);
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

  it('focusOpenNote activates an existing pane without duplicating it', () => {
    noteWorkspaceStore.openNoteTab('alpha.md');
    let tab = noteWorkspaceStore.activeTab!;
    noteWorkspaceStore.splitPaneWithNote(tab.id, tab.activePaneId, 'right', 'beta.md');
    noteWorkspaceStore.openNoteTab('gamma.md');

    const location = noteWorkspaceStore.focusOpenNote('beta.md');

    expect(location?.notePath).toBe('beta.md');
    expect(location?.paneCount).toBe(2);
    expect(noteWorkspaceStore.tabs).toHaveLength(2);
    expect(noteWorkspaceStore.activeNotePath).toBe('beta.md');
    expect(noteWorkspaceStore.getNotePaths(noteWorkspaceStore.activeTab!)).toEqual(['alpha.md', 'beta.md']);
  });

  it('openStateForPath identifies standalone, layout, and focused open notes', () => {
    noteWorkspaceStore.openNoteTab('alpha.md');

    let alphaState = noteWorkspaceStore.openStateForPath('alpha.md');
    expect(alphaState).toEqual(expect.objectContaining({
      isOpen: true,
      isFocused: true,
      paneCount: 1,
      label: 'Focused',
    }));
    expect(alphaState.tooltip).toContain('Focused in editor tab');

    noteWorkspaceStore.openNoteTab('beta.md');
    alphaState = noteWorkspaceStore.openStateForPath('alpha.md');
    expect(alphaState.isOpen).toBe(true);
    expect(alphaState.isFocused).toBe(false);
    expect(alphaState.label).toBe('Open');

    const tab = noteWorkspaceStore.activeTab!;
    noteWorkspaceStore.splitPaneWithNote(tab.id, tab.activePaneId, 'right', 'gamma.md');

    const gammaState = noteWorkspaceStore.openStateForPath('gamma.md');
    expect(gammaState).toEqual(expect.objectContaining({
      isOpen: true,
      isFocused: true,
      paneCount: 2,
      paneIndex: 1,
      label: 'Focused',
    }));
    expect(gammaState.tooltip).toContain('pane 2 of 2');

    expect(noteWorkspaceStore.openStateForPath('missing.md').isOpen).toBe(false);
  });

  it('creates a balanced multi-note layout tab', () => {
    const selected = noteWorkspaceStore.openNotesLayout(
      ['alpha.md', 'beta.md', 'gamma.md', 'delta.md'],
      'Research layout',
    );

    expect(selected).toBe('alpha.md');
    expect(noteWorkspaceStore.tabs).toHaveLength(1);
    expect(noteWorkspaceStore.activeTab?.title).toBe('Research layout');
    expect(noteWorkspaceStore.activeTab?.root.type).toBe('split');
    expect(noteWorkspaceStore.getNotePaths(noteWorkspaceStore.activeTab!)).toEqual([
      'alpha.md',
      'beta.md',
      'gamma.md',
      'delta.md',
    ]);
    expect(noteWorkspaceStore.getPanes(noteWorkspaceStore.activeTab!)).toHaveLength(4);
  });

  it('dedupes and caps layout note paths', () => {
    noteWorkspaceStore.openNoteTab('alpha.md');
    noteWorkspaceStore.openNoteTab('beta.md');

    noteWorkspaceStore.openNotesLayout([
      'alpha.md',
      'beta.md',
      'alpha.md',
      'gamma.md',
      'delta.md',
      'epsilon.md',
      'zeta.md',
      'eta.md',
    ]);

    expect(noteWorkspaceStore.tabs).toHaveLength(1);
    expect(noteWorkspaceStore.getNotePaths(noteWorkspaceStore.activeTab!)).toEqual([
      'alpha.md',
      'beta.md',
      'gamma.md',
      'delta.md',
      'epsilon.md',
      'zeta.md',
    ]);
    expect(new Set(allWorkspaceNotePaths()).size).toBe(allWorkspaceNotePaths().length);
  });

  it('openNotesLayout never creates duplicate note panes', () => {
    noteWorkspaceStore.openNotesLayout(['alpha.md', 'alpha.md', 'beta.md', 'beta.md']);

    expect(noteWorkspaceStore.getNotePaths(noteWorkspaceStore.activeTab!)).toEqual(['alpha.md', 'beta.md']);
    expect(new Set(allWorkspaceNotePaths()).size).toBe(allWorkspaceNotePaths().length);
  });

  it('addNoteToLayout appends without replacing existing notes and rejects duplicates', () => {
    noteWorkspaceStore.openNoteTab('alpha.md');
    let tab = noteWorkspaceStore.activeTab!;
    noteWorkspaceStore.splitPaneWithNote(tab.id, tab.activePaneId, 'right', 'beta.md');
    tab = noteWorkspaceStore.activeTab!;

    const appended = noteWorkspaceStore.addNoteToLayout(tab.id, 'gamma.md');

    expect(appended.action).toBe('appended');
    expect(appended.notePath).toBe('gamma.md');
    expect(noteWorkspaceStore.activePaneId).toBe(appended.paneId);
    expect(noteWorkspaceStore.getNotePaths(noteWorkspaceStore.activeTab!)).toEqual([
      'alpha.md',
      'beta.md',
      'gamma.md',
    ]);

    const duplicate = noteWorkspaceStore.addNoteToLayout(tab.id, 'alpha.md');

    expect(duplicate.action).toBe('focused-existing');
    expect(noteWorkspaceStore.getNotePaths(noteWorkspaceStore.activeTab!)).toEqual([
      'alpha.md',
      'beta.md',
      'gamma.md',
    ]);
    expect(new Set(allWorkspaceNotePaths()).size).toBe(allWorkspaceNotePaths().length);
  });

  it('adds a note to the right edge by wrapping the layout without rebalancing', () => {
    noteWorkspaceStore.openNoteTab('alpha.md');
    let tab = noteWorkspaceStore.activeTab!;
    noteWorkspaceStore.splitPaneWithNote(tab.id, tab.activePaneId, 'right', 'beta.md');
    tab = noteWorkspaceStore.activeTab!;

    const result = noteWorkspaceStore.addNoteToLayoutEdge(tab.id, 'gamma.md', 'horizontal');

    expect(result.action).toBe('appended');
    expect(result.notePath).toBe('gamma.md');
    expect(noteWorkspaceStore.getNotePaths(noteWorkspaceStore.activeTab!)).toEqual([
      'alpha.md',
      'beta.md',
      'gamma.md',
    ]);
    const root = noteWorkspaceStore.activeTab!.root;
    expect(root.type).toBe('split');
    if (root.type !== 'split') return;
    expect(root.direction).toBe('horizontal');
    expect(root.sizes[0]).toBeCloseTo(50, 4);
    expect(root.sizes[1]).toBeCloseTo(50, 4);
    expect(collectPathsFromNode(root.children[0])).toEqual(['alpha.md', 'beta.md']);
    expect(collectPathsFromNode(root.children[1])).toEqual(['gamma.md']);
    // Newcomer takes half; the existing two share the other half (no equal-thirds rebalance).
    const widths = collectEffectiveWidths(root);
    expect(widths).toHaveLength(3);
    expect(widths[0]).toBeCloseTo(25, 4);
    expect(widths[1]).toBeCloseTo(25, 4);
    expect(widths[2]).toBeCloseTo(50, 4);
  });

  it('adds a note to the bottom edge by wrapping the layout without rebalancing', () => {
    noteWorkspaceStore.openNoteTab('alpha.md');
    let tab = noteWorkspaceStore.activeTab!;
    noteWorkspaceStore.splitPaneWithNote(tab.id, tab.activePaneId, 'bottom', 'beta.md');
    tab = noteWorkspaceStore.activeTab!;

    const result = noteWorkspaceStore.addNoteToLayoutEdge(tab.id, 'gamma.md', 'vertical');

    expect(result.action).toBe('appended');
    expect(noteWorkspaceStore.getNotePaths(noteWorkspaceStore.activeTab!)).toEqual([
      'alpha.md',
      'beta.md',
      'gamma.md',
    ]);
    const root = noteWorkspaceStore.activeTab!.root;
    expect(root.type).toBe('split');
    if (root.type !== 'split') return;
    expect(root.direction).toBe('vertical');
    expect(root.sizes[0]).toBeCloseTo(50, 4);
    expect(root.sizes[1]).toBeCloseTo(50, 4);
    const heights = collectEffectiveHeights(root);
    expect(heights).toHaveLength(3);
    expect(heights[0]).toBeCloseTo(25, 4);
    expect(heights[1]).toBeCloseTo(25, 4);
    expect(heights[2]).toBeCloseTo(50, 4);
  });

  it('wraps a mixed layout when adding to an outer edge', () => {
    noteWorkspaceStore.openNoteTab('alpha.md');
    let tab = noteWorkspaceStore.activeTab!;
    noteWorkspaceStore.splitPaneWithNote(tab.id, tab.activePaneId, 'right', 'beta.md');
    tab = noteWorkspaceStore.activeTab!;
    noteWorkspaceStore.splitPaneWithNote(tab.id, tab.activePaneId, 'bottom', 'gamma.md');
    tab = noteWorkspaceStore.activeTab!;

    const result = noteWorkspaceStore.addNoteToLayoutEdge(tab.id, 'delta.md', 'horizontal');
    const root = noteWorkspaceStore.activeTab!.root;

    expect(result.action).toBe('appended');
    expect(root.type).toBe('split');
    if (root.type !== 'split') return;
    expect(root.direction).toBe('horizontal');
    // The previous layout is wrapped intact on one side at a fixed 50/50 — no proportional rebalance.
    expect(root.sizes[0]).toBeCloseTo(50, 4);
    expect(root.sizes[1]).toBeCloseTo(50, 4);
    expect(collectPathsFromNode(root.children[0])).toEqual(['alpha.md', 'beta.md', 'gamma.md']);
    expect(collectPathsFromNode(root.children[1])).toEqual(['delta.md']);
  });

  it('focuses duplicates when edge-adding without mutating layout geometry', () => {
    noteWorkspaceStore.openNoteTab('alpha.md');
    let tab = noteWorkspaceStore.activeTab!;
    noteWorkspaceStore.splitPaneWithNote(tab.id, tab.activePaneId, 'right', 'beta.md');
    tab = noteWorkspaceStore.activeTab!;
    const beforeRoot = JSON.stringify(tab.root);

    const result = noteWorkspaceStore.addNoteToLayoutEdge(tab.id, 'alpha.md', 'horizontal');

    expect(result.action).toBe('focused-existing');
    expect(noteWorkspaceStore.activeNotePath).toBe('alpha.md');
    expect(JSON.stringify(noteWorkspaceStore.activeTab!.root)).toBe(beforeRoot);
    expect(noteWorkspaceStore.getNotePaths(noteWorkspaceStore.activeTab!)).toEqual(['alpha.md', 'beta.md']);
  });

  it('closing a pane detaches it and preserves the surrounding sizes', () => {
    noteWorkspaceStore.openNoteTab('alpha.md');
    let tab = noteWorkspaceStore.activeTab!;
    noteWorkspaceStore.splitPaneWithNote(tab.id, tab.activePaneId, 'right', 'beta.md');
    tab = noteWorkspaceStore.activeTab!;
    noteWorkspaceStore.splitPaneWithNote(tab.id, tab.activePaneId, 'right', 'gamma.md');
    tab = noteWorkspaceStore.activeTab!;
    noteWorkspaceStore.splitPaneWithNote(tab.id, tab.activePaneId, 'right', 'delta.md');
    tab = noteWorkspaceStore.activeTab!;
    const betaPane = noteWorkspaceStore.getPanes(tab).find((pane) => pane.notePath === 'beta.md')!;

    const result = noteWorkspaceStore.closePane(tab.id, betaPane.paneId);

    expect(result).toEqual(expect.objectContaining({
      action: 'closed-pane',
      closedPath: 'beta.md',
      nextPath: 'gamma.md',
    }));
    expect(noteWorkspaceStore.getNotePaths(noteWorkspaceStore.activeTab!)).toEqual([
      'alpha.md',
      'gamma.md',
      'delta.md',
    ]);
    expect(noteWorkspaceStore.activeNotePath).toBe('gamma.md');
    // alpha keeps its original half; beta's sibling subtree (gamma|delta) is promoted intact.
    const widths = collectEffectiveWidths(noteWorkspaceStore.activeTab!.root);
    expect(widths).toHaveLength(3);
    expect(widths[0]).toBeCloseTo(50, 4);
    expect(widths[1]).toBeCloseTo(25, 4);
    expect(widths[2]).toBeCloseTo(25, 4);
  });

  it('closing a pane from a mixed layout collapses to the surviving split', () => {
    noteWorkspaceStore.openNoteTab('alpha.md');
    let tab = noteWorkspaceStore.activeTab!;
    noteWorkspaceStore.splitPaneWithNote(tab.id, tab.activePaneId, 'right', 'beta.md');
    tab = noteWorkspaceStore.activeTab!;
    noteWorkspaceStore.splitPaneWithNote(tab.id, tab.activePaneId, 'bottom', 'gamma.md');
    tab = noteWorkspaceStore.activeTab!;
    const alphaPane = noteWorkspaceStore.getPanes(tab).find((pane) => pane.notePath === 'alpha.md')!;

    const result = noteWorkspaceStore.closePane(tab.id, alphaPane.paneId);

    expect(result.closedPath).toBe('alpha.md');
    expect(noteWorkspaceStore.getNotePaths(noteWorkspaceStore.activeTab!)).toEqual(['beta.md', 'gamma.md']);
    expect(noteWorkspaceStore.activeTab!.root.type).toBe('split');
    if (noteWorkspaceStore.activeTab!.root.type === 'split') {
      expect(noteWorkspaceStore.activeTab!.root.sizes[0]).toBeCloseTo(50, 4);
      expect(noteWorkspaceStore.activeTab!.root.sizes[1]).toBeCloseTo(50, 4);
    }
  });

  it('focusTab moves focus from an empty active pane to the fallback note pane', () => {
    noteWorkspaceStore.openNoteTab('alpha.md');
    const splitTab = noteWorkspaceStore.activeTab!;
    const alphaPane = splitTab.activePaneId;
    noteWorkspaceStore.splitActivePane('horizontal');
    expect(noteWorkspaceStore.activeNotePath).toBeNull();

    noteWorkspaceStore.openNoteTab('beta.md');
    const focusedPath = noteWorkspaceStore.focusTab(splitTab.id);

    expect(focusedPath).toBe('alpha.md');
    expect(noteWorkspaceStore.activePaneId).toBe(alphaPane);
    expect(noteWorkspaceStore.activeNotePath).toBe('alpha.md');
  });

  it('split requests focus an already-open standalone note without duplicating it', () => {
    noteWorkspaceStore.openNoteTab('alpha.md');
    noteWorkspaceStore.openNoteTab('beta.md');

    const alphaTab = noteWorkspaceStore.tabs.find((tab) => noteWorkspaceStore.getNotePaths(tab).includes('alpha.md'))!;
    const result = noteWorkspaceStore.splitPaneWithNote(alphaTab.id, alphaTab.activePaneId, 'right', 'beta.md');

    expect(result.action).toBe('focused-existing');
    expect(result.notePath).toBe('beta.md');
    expect(noteWorkspaceStore.activeTabId).not.toBe(alphaTab.id);
    expect(noteWorkspaceStore.tabs).toHaveLength(2);
    expect(new Set(allWorkspaceNotePaths()).size).toBe(allWorkspaceNotePaths().length);
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

  it('moving a pane to a pane edge splits it locally without flattening', () => {
    noteWorkspaceStore.openNoteTab('alpha.md');
    let tab = noteWorkspaceStore.activeTab!;
    noteWorkspaceStore.splitPaneWithNote(tab.id, tab.activePaneId, 'right', 'beta.md');
    tab = noteWorkspaceStore.activeTab!;
    noteWorkspaceStore.splitPaneWithNote(tab.id, tab.activePaneId, 'bottom', 'gamma.md');
    tab = noteWorkspaceStore.activeTab!;
    const betaPane = noteWorkspaceStore.getPanes(tab).find((pane) => pane.notePath === 'beta.md')!;
    const gammaPane = noteWorkspaceStore.getPanes(tab).find((pane) => pane.notePath === 'gamma.md')!;

    const result = noteWorkspaceStore.movePane(tab.id, gammaPane.paneId, tab.id, betaPane.paneId, 'right');

    expect(result.action).toBe('moved');
    expect(noteWorkspaceStore.getNotePaths(noteWorkspaceStore.activeTab!)).toEqual([
      'alpha.md',
      'beta.md',
      'gamma.md',
    ]);
    const root = noteWorkspaceStore.activeTab!.root;
    expect(root.type).toBe('split');
    if (root.type !== 'split') return;
    expect(root.direction).toBe('horizontal');
    // alpha is untouched on the left; beta gets a local horizontal split with gamma.
    expect(root.children[0].type).toBe('leaf');
    expect(collectPathsFromNode(root.children[0])).toEqual(['alpha.md']);
    expect(root.children[1].type).toBe('split');
    if (root.children[1].type === 'split') {
      expect(root.children[1].direction).toBe('horizontal');
      expect(collectPathsFromNode(root.children[1])).toEqual(['beta.md', 'gamma.md']);
    }
    const widths = collectEffectiveWidths(root);
    expect(widths[0]).toBeCloseTo(50, 4);
    expect(widths[1]).toBeCloseTo(25, 4);
    expect(widths[2]).toBeCloseTo(25, 4);
  });

  it('edge-dropping a note splits the target pane locally without flattening', () => {
    noteWorkspaceStore.openNoteTab('alpha.md');
    let tab = noteWorkspaceStore.activeTab!;
    noteWorkspaceStore.splitPaneWithNote(tab.id, tab.activePaneId, 'right', 'beta.md');
    tab = noteWorkspaceStore.activeTab!;
    noteWorkspaceStore.splitPaneWithNote(tab.id, tab.activePaneId, 'bottom', 'gamma.md');
    tab = noteWorkspaceStore.activeTab!;
    const betaPane = noteWorkspaceStore.getPanes(tab).find((pane) => pane.notePath === 'beta.md')!;

    const result = noteWorkspaceStore.dropNoteOnPane(tab.id, betaPane.paneId, 'delta.md', 'right');

    expect(result.action).toBe('split');
    expect(noteWorkspaceStore.getNotePaths(noteWorkspaceStore.activeTab!)).toEqual([
      'alpha.md',
      'beta.md',
      'delta.md',
      'gamma.md',
    ]);
    const root = noteWorkspaceStore.activeTab!.root;
    expect(root.type).toBe('split');
    if (root.type !== 'split') return;
    expect(root.direction).toBe('horizontal');
    // Only beta is wrapped (beta|delta); alpha and gamma keep their places.
    expect(collectPathsFromNode(root.children[0])).toEqual(['alpha.md']);
    expect(root.children[1].type).toBe('split');
    if (root.children[1].type !== 'split') return;
    expect(root.children[1].direction).toBe('vertical');
    expect(collectPathsFromNode(root.children[1].children[0])).toEqual(['beta.md', 'delta.md']);
    expect(collectPathsFromNode(root.children[1].children[1])).toEqual(['gamma.md']);
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

  it('cross-tab move collapses the source and splits the target locally', () => {
    noteWorkspaceStore.openNoteTab('alpha.md');
    let sourceTab = noteWorkspaceStore.activeTab!;
    noteWorkspaceStore.splitPaneWithNote(sourceTab.id, sourceTab.activePaneId, 'right', 'beta.md');
    sourceTab = noteWorkspaceStore.activeTab!;
    noteWorkspaceStore.splitPaneWithNote(sourceTab.id, sourceTab.activePaneId, 'right', 'gamma.md');
    sourceTab = noteWorkspaceStore.activeTab!;

    noteWorkspaceStore.openNoteTab('delta.md');
    let targetTab = noteWorkspaceStore.activeTab!;
    noteWorkspaceStore.splitPaneWithNote(targetTab.id, targetTab.activePaneId, 'right', 'epsilon.md');
    targetTab = noteWorkspaceStore.activeTab!;

    const betaPane = noteWorkspaceStore.getPanes(sourceTab).find((pane) => pane.notePath === 'beta.md')!;
    const deltaPane = noteWorkspaceStore.getPanes(targetTab).find((pane) => pane.notePath === 'delta.md')!;

    const result = noteWorkspaceStore.movePane(sourceTab.id, betaPane.paneId, targetTab.id, deltaPane.paneId, 'right');

    expect(result.action).toBe('moved');
    const source = noteWorkspaceStore.tabs.find((tab) => tab.id === sourceTab.id)!;
    const target = noteWorkspaceStore.tabs.find((tab) => tab.id === targetTab.id)!;
    expect(noteWorkspaceStore.getNotePaths(source)).toEqual(['alpha.md', 'gamma.md']);
    expect(noteWorkspaceStore.getNotePaths(target)).toEqual(['delta.md', 'beta.md', 'epsilon.md']);
    // Source collapses to its two survivors (alpha keeps its half).
    for (const width of collectEffectiveWidths(source.root)) {
      expect(width).toBeCloseTo(50, 4);
    }
    // Target splits delta locally (delta|beta); epsilon keeps its half.
    const targetRoot = target.root;
    expect(targetRoot.type).toBe('split');
    if (targetRoot.type !== 'split') return;
    expect(collectPathsFromNode(targetRoot.children[0])).toEqual(['delta.md', 'beta.md']);
    expect(collectPathsFromNode(targetRoot.children[1])).toEqual(['epsilon.md']);
    const widths = collectEffectiveWidths(targetRoot);
    expect(widths[0]).toBeCloseTo(25, 4);
    expect(widths[1]).toBeCloseTo(25, 4);
    expect(widths[2]).toBeCloseTo(50, 4);
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

  it('moves the rightmost column below the first, keeping the third full height', () => {
    // Build three columns: [alpha | beta | gamma].
    noteWorkspaceStore.openNoteTab('alpha.md');
    let tab = noteWorkspaceStore.activeTab!;
    noteWorkspaceStore.splitPaneWithNote(tab.id, tab.activePaneId, 'right', 'beta.md');
    tab = noteWorkspaceStore.activeTab!;
    noteWorkspaceStore.splitPaneWithNote(tab.id, tab.activePaneId, 'right', 'gamma.md');
    tab = noteWorkspaceStore.activeTab!;
    const alphaPane = noteWorkspaceStore.getPanes(tab).find((pane) => pane.notePath === 'alpha.md')!;
    const gammaPane = noteWorkspaceStore.getPanes(tab).find((pane) => pane.notePath === 'gamma.md')!;

    // Drag gamma (rightmost) onto the bottom edge of alpha (first).
    const result = noteWorkspaceStore.movePane(tab.id, gammaPane.paneId, tab.id, alphaPane.paneId, 'bottom');

    expect(result.action).toBe('moved');
    // Expected tree: split(h, [ split(v, [alpha, gamma]), beta ]).
    const root = noteWorkspaceStore.activeTab!.root;
    expect(root.type).toBe('split');
    if (root.type !== 'split') return;
    expect(root.direction).toBe('horizontal');
    expect(root.children[0].type).toBe('split');
    if (root.children[0].type === 'split') {
      expect(root.children[0].direction).toBe('vertical');
      expect(collectPathsFromNode(root.children[0])).toEqual(['alpha.md', 'gamma.md']);
    }
    expect(root.children[1].type).toBe('leaf');
    expect(collectPathsFromNode(root.children[1])).toEqual(['beta.md']);
    expect(noteWorkspaceStore.activeNotePath).toBe('gamma.md');
    expect(noteWorkspaceStore.activePaneId).toBe(gammaPane.paneId);

    // beta stays full height; alpha and gamma each take half of the left column.
    const heights = collectEffectiveHeights(root); // visual order [alpha, gamma, beta]
    expect(heights[0]).toBeCloseTo(50, 4);
    expect(heights[1]).toBeCloseTo(50, 4);
    expect(heights[2]).toBeCloseTo(100, 4);
  });

  it('preserves split sizes when closing a pane', () => {
    noteWorkspaceStore.openNoteTab('alpha.md');
    let tab = noteWorkspaceStore.activeTab!;
    noteWorkspaceStore.splitPaneWithNote(tab.id, tab.activePaneId, 'right', 'beta.md');
    tab = noteWorkspaceStore.activeTab!;
    const rootSplit = tab.root;
    if (rootSplit.type !== 'split') throw new Error('expected split');
    // User drags the divider so alpha gets 70% width.
    noteWorkspaceStore.setSplitSizes(tab.id, rootSplit.splitId, [70, 30]);
    tab = noteWorkspaceStore.activeTab!;
    const betaPane = noteWorkspaceStore.getPanes(tab).find((pane) => pane.notePath === 'beta.md')!;
    // Split beta downward, then close the newcomer — the root 70/30 must survive.
    noteWorkspaceStore.splitPaneWithNote(tab.id, betaPane.paneId, 'bottom', 'gamma.md');
    tab = noteWorkspaceStore.activeTab!;
    const gammaPane = noteWorkspaceStore.getPanes(tab).find((pane) => pane.notePath === 'gamma.md')!;

    noteWorkspaceStore.closePane(tab.id, gammaPane.paneId);

    const root = noteWorkspaceStore.activeTab!.root;
    expect(root.type).toBe('split');
    if (root.type !== 'split') return;
    expect(collectPathsFromNode(root)).toEqual(['alpha.md', 'beta.md']);
    expect(root.sizes[0]).toBeCloseTo(70, 4);
    expect(root.sizes[1]).toBeCloseTo(30, 4);
  });

  it('round-trips a pane move back to its original layout', () => {
    noteWorkspaceStore.openNoteTab('alpha.md');
    let tab = noteWorkspaceStore.activeTab!;
    noteWorkspaceStore.splitPaneWithNote(tab.id, tab.activePaneId, 'right', 'beta.md');
    tab = noteWorkspaceStore.activeTab!;
    const alphaPane = noteWorkspaceStore.getPanes(tab).find((pane) => pane.notePath === 'alpha.md')!;
    let betaPane = noteWorkspaceStore.getPanes(tab).find((pane) => pane.notePath === 'beta.md')!;

    noteWorkspaceStore.movePane(tab.id, alphaPane.paneId, tab.id, betaPane.paneId, 'right');
    expect(noteWorkspaceStore.getNotePaths(noteWorkspaceStore.activeTab!)).toEqual(['beta.md', 'alpha.md']);

    tab = noteWorkspaceStore.activeTab!;
    betaPane = noteWorkspaceStore.getPanes(tab).find((pane) => pane.notePath === 'beta.md')!;
    noteWorkspaceStore.movePane(tab.id, alphaPane.paneId, tab.id, betaPane.paneId, 'left');

    expect(noteWorkspaceStore.getNotePaths(noteWorkspaceStore.activeTab!)).toEqual(['alpha.md', 'beta.md']);
    const root = noteWorkspaceStore.activeTab!.root;
    expect(root.type).toBe('split');
    if (root.type === 'split') {
      expect(root.direction).toBe('horizontal');
      expect(root.children[0].type).toBe('leaf');
      expect(root.children[1].type).toBe('leaf');
    }
  });
});
