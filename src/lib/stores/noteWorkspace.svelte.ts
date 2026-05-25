import {
  EMPTY_NOTE_WORKSPACE_LAYOUT,
  NOTE_WORKSPACE_LAYOUT_VERSION,
  type NotePaneDirection,
  type NotePaneDropIntent,
  type NotePaneLeaf,
  type NotePaneMoveIntent,
  type NotePaneMoveResult,
  type NotePaneNode,
  type NotePaneSplit,
  type NoteWorkspaceLayoutState,
  type NoteWorkspaceTab,
} from '$lib/domain';
import { events } from '$lib/events';

const STORAGE_KEY = 'void:note-workspace-layout:v1';

export interface NotePaneDropResult {
  action: 'focused-existing' | 'replaced' | 'split' | 'ignored';
  paneId: string | null;
  notePath: string | null;
}

function createId(prefix: string): string {
  const random = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  return `${prefix}-${random}`;
}

function createLeaf(notePath: string | null): NotePaneLeaf {
  return {
    type: 'leaf',
    paneId: createId('pane'),
    notePath,
  };
}

function createTab(notePath: string): NoteWorkspaceTab {
  const leaf = createLeaf(notePath);
  return {
    id: createId('tab'),
    root: leaf,
    activePaneId: leaf.paneId,
    title: null,
  };
}

function firstLeaf(node: NotePaneNode): NotePaneLeaf {
  return node.type === 'leaf' ? node : firstLeaf(node.children[0]);
}

function countLeaves(node: NotePaneNode): number {
  return node.type === 'leaf'
    ? 1
    : countLeaves(node.children[0]) + countLeaves(node.children[1]);
}

function collectLeaves(node: NotePaneNode, leaves: NotePaneLeaf[] = []): NotePaneLeaf[] {
  if (node.type === 'leaf') {
    leaves.push(node);
    return leaves;
  }
  collectLeaves(node.children[0], leaves);
  collectLeaves(node.children[1], leaves);
  return leaves;
}

function collectNotePaths(node: NotePaneNode): string[] {
  return collectLeaves(node)
    .map((leaf) => leaf.notePath)
    .filter((path): path is string => !!path);
}

function findNextLeaf(node: NotePaneNode, paneId: string, direction: 1 | -1): NotePaneLeaf | null {
  const leaves = collectLeaves(node);
  if (leaves.length === 0) return null;
  const index = leaves.findIndex((leaf) => leaf.paneId === paneId);
  if (index < 0) return leaves[0] ?? null;
  const nextIndex = (index + direction + leaves.length) % leaves.length;
  return leaves[nextIndex] ?? null;
}

function findLeaf(node: NotePaneNode, paneId: string): NotePaneLeaf | null {
  if (node.type === 'leaf') return node.paneId === paneId ? node : null;
  return findLeaf(node.children[0], paneId) ?? findLeaf(node.children[1], paneId);
}

function findLeafByPath(node: NotePaneNode, notePath: string): NotePaneLeaf | null {
  if (node.type === 'leaf') return node.notePath === notePath ? node : null;
  return findLeafByPath(node.children[0], notePath) ?? findLeafByPath(node.children[1], notePath);
}

function findOpenPaneByPath(
  tabs: NoteWorkspaceTab[],
  notePath: string,
): { tab: NoteWorkspaceTab; leaf: NotePaneLeaf } | null {
  for (const tab of tabs) {
    const leaf = findLeafByPath(tab.root, notePath);
    if (leaf) return { tab, leaf };
  }
  return null;
}

function isSingleNoteTab(tab: NoteWorkspaceTab, notePath: string): boolean {
  return tab.root.type === 'leaf' && tab.root.notePath === notePath;
}

function splitLeaf(
  node: NotePaneNode,
  paneId: string,
  direction: NotePaneDirection,
): { node: NotePaneNode; placeholder: NotePaneLeaf | null } {
  if (node.type === 'leaf') {
    if (node.paneId !== paneId) return { node, placeholder: null };
    const placeholder = createLeaf(null);
    return {
      node: {
        type: 'split',
        splitId: createId('split'),
        direction,
        sizes: [50, 50],
        children: [node, placeholder],
      },
      placeholder,
    };
  }

  const first = splitLeaf(node.children[0], paneId, direction);
  if (first.placeholder) {
    return {
      node: { ...node, children: [first.node, node.children[1]] },
      placeholder: first.placeholder,
    };
  }

  const second = splitLeaf(node.children[1], paneId, direction);
  if (second.placeholder) {
    return {
      node: { ...node, children: [node.children[0], second.node] },
      placeholder: second.placeholder,
    };
  }

  return { node, placeholder: null };
}

function splitLeafWithNote(
  node: NotePaneNode,
  paneId: string,
  intent: Exclude<NotePaneDropIntent, 'replace'>,
  notePath: string,
): { node: NotePaneNode; created: NotePaneLeaf | null } {
  if (node.type === 'leaf') {
    if (node.paneId !== paneId) return { node, created: null };
    const created = createLeaf(notePath);
    const direction: NotePaneDirection = intent === 'left' || intent === 'right'
      ? 'horizontal'
      : 'vertical';
    const children: [NotePaneNode, NotePaneNode] =
      intent === 'left' || intent === 'top'
        ? [created, node]
        : [node, created];
    return {
      node: {
        type: 'split',
        splitId: createId('split'),
        direction,
        sizes: [50, 50],
        children,
      },
      created,
    };
  }

  const first = splitLeafWithNote(node.children[0], paneId, intent, notePath);
  if (first.created) {
    return {
      node: { ...node, children: [first.node, node.children[1]] },
      created: first.created,
    };
  }

  const second = splitLeafWithNote(node.children[1], paneId, intent, notePath);
  if (second.created) {
    return {
      node: { ...node, children: [node.children[0], second.node] },
      created: second.created,
    };
  }

  return { node, created: null };
}

function detachLeaf(
  node: NotePaneNode,
  paneId: string,
): { node: NotePaneNode | null; detached: NotePaneLeaf | null } {
  if (node.type === 'leaf') {
    return node.paneId === paneId
      ? { node: null, detached: node }
      : { node, detached: null };
  }

  const left = detachLeaf(node.children[0], paneId);
  if (left.detached) {
    if (!left.node) return { node: node.children[1], detached: left.detached };
    return {
      node: { ...node, children: [left.node, node.children[1]] },
      detached: left.detached,
    };
  }

  const right = detachLeaf(node.children[1], paneId);
  if (right.detached) {
    if (!right.node) return { node: node.children[0], detached: right.detached };
    return {
      node: { ...node, children: [node.children[0], right.node] },
      detached: right.detached,
    };
  }

  return { node, detached: null };
}

function insertLeafAt(
  node: NotePaneNode,
  targetPaneId: string,
  intent: Exclude<NotePaneMoveIntent, 'swap'>,
  leaf: NotePaneLeaf,
): { node: NotePaneNode; inserted: boolean } {
  if (node.type === 'leaf') {
    if (node.paneId !== targetPaneId) return { node, inserted: false };
    const direction: NotePaneDirection = intent === 'left' || intent === 'right'
      ? 'horizontal'
      : 'vertical';
    const children: [NotePaneNode, NotePaneNode] =
      intent === 'left' || intent === 'top'
        ? [leaf, node]
        : [node, leaf];
    return {
      node: {
        type: 'split',
        splitId: createId('split'),
        direction,
        sizes: [50, 50],
        children,
      },
      inserted: true,
    };
  }

  const first = insertLeafAt(node.children[0], targetPaneId, intent, leaf);
  if (first.inserted) {
    return {
      node: { ...node, children: [first.node, node.children[1]] },
      inserted: true,
    };
  }

  const second = insertLeafAt(node.children[1], targetPaneId, intent, leaf);
  if (second.inserted) {
    return {
      node: { ...node, children: [node.children[0], second.node] },
      inserted: true,
    };
  }

  return { node, inserted: false };
}

function replaceLeafNote(node: NotePaneNode, paneId: string, notePath: string): NotePaneNode {
  if (node.type === 'leaf') {
    return node.paneId === paneId ? { ...node, notePath } : node;
  }
  return {
    ...node,
    children: [
      replaceLeafNote(node.children[0], paneId, notePath),
      replaceLeafNote(node.children[1], paneId, notePath),
    ],
  };
}

function replaceLeaf(node: NotePaneNode, paneId: string, leaf: NotePaneLeaf): NotePaneNode {
  if (node.type === 'leaf') return node.paneId === paneId ? leaf : node;
  return {
    ...node,
    children: [
      replaceLeaf(node.children[0], paneId, leaf),
      replaceLeaf(node.children[1], paneId, leaf),
    ],
  };
}

function swapLeavesInNode(
  node: NotePaneNode,
  sourcePaneId: string,
  targetPaneId: string,
  sourceLeaf: NotePaneLeaf,
  targetLeaf: NotePaneLeaf,
): NotePaneNode {
  if (node.type === 'leaf') {
    if (node.paneId === sourcePaneId) return targetLeaf;
    if (node.paneId === targetPaneId) return sourceLeaf;
    return node;
  }
  return {
    ...node,
    children: [
      swapLeavesInNode(node.children[0], sourcePaneId, targetPaneId, sourceLeaf, targetLeaf),
      swapLeavesInNode(node.children[1], sourcePaneId, targetPaneId, sourceLeaf, targetLeaf),
    ],
  };
}

function swapLeaves(node: NotePaneNode, sourcePaneId: string, targetPaneId: string): NotePaneNode {
  const sourceLeaf = findLeaf(node, sourcePaneId);
  const targetLeaf = findLeaf(node, targetPaneId);
  if (!sourceLeaf || !targetLeaf) return node;
  return swapLeavesInNode(node, sourcePaneId, targetPaneId, sourceLeaf, targetLeaf);
}

function closeLeaf(node: NotePaneNode, paneId: string): NotePaneNode | null {
  if (node.type === 'leaf') return node.paneId === paneId ? null : node;

  const left = closeLeaf(node.children[0], paneId);
  const right = closeLeaf(node.children[1], paneId);
  if (!left && !right) return null;
  if (!left) return right;
  if (!right) return left;
  return { ...node, children: [left, right] };
}

function setSplitSizes(node: NotePaneNode, splitId: string, sizes: [number, number]): NotePaneNode {
  if (node.type === 'leaf') return node;
  if (node.splitId === splitId) return { ...node, sizes };
  return {
    ...node,
    children: [
      setSplitSizes(node.children[0], splitId, sizes),
      setSplitSizes(node.children[1], splitId, sizes),
    ],
  };
}

function removeEmptyLeaves(node: NotePaneNode): NotePaneNode | null {
  if (node.type === 'leaf') return node.notePath ? node : null;
  const left = removeEmptyLeaves(node.children[0]);
  const right = removeEmptyLeaves(node.children[1]);
  if (!left && !right) return null;
  if (!left) return right;
  if (!right) return left;
  return { ...node, children: [left, right] };
}

function renamePathInNode(node: NotePaneNode, oldPath: string, newPath: string): NotePaneNode {
  if (node.type === 'leaf') {
    return node.notePath === oldPath ? { ...node, notePath: newPath } : node;
  }
  return {
    ...node,
    children: [
      renamePathInNode(node.children[0], oldPath, newPath),
      renamePathInNode(node.children[1], oldPath, newPath),
    ],
  };
}

function parseStoredState(raw: string | null): NoteWorkspaceLayoutState {
  if (!raw) return { ...EMPTY_NOTE_WORKSPACE_LAYOUT, tabs: [] };

  try {
    const parsed = JSON.parse(raw) as Partial<NoteWorkspaceLayoutState>;
    if (parsed.version !== NOTE_WORKSPACE_LAYOUT_VERSION || !Array.isArray(parsed.tabs)) {
      return { ...EMPTY_NOTE_WORKSPACE_LAYOUT, tabs: [] };
    }

    const tabs = parsed.tabs
      .filter((tab): tab is NoteWorkspaceTab => !!tab && typeof tab.id === 'string' && !!tab.root)
      .map((tab) => {
        const root = removeEmptyLeaves(tab.root);
        if (!root) return null;
        const active = findLeaf(root, tab.activePaneId) ?? firstLeaf(root);
        return { ...tab, root, activePaneId: active.paneId };
      })
      .filter((tab): tab is NoteWorkspaceTab => !!tab);

    return {
      version: NOTE_WORKSPACE_LAYOUT_VERSION,
      tabs,
      activeTabId: tabs.some((tab) => tab.id === parsed.activeTabId)
        ? parsed.activeTabId ?? null
        : tabs[0]?.id ?? null,
    };
  } catch {
    return { ...EMPTY_NOTE_WORKSPACE_LAYOUT, tabs: [] };
  }
}

function ignoredMoveResult(
  sourceNotePath: string | null = null,
  targetNotePath: string | null = null,
): NotePaneMoveResult {
  return {
    action: 'ignored',
    activeTabId: null,
    activePaneId: null,
    sourceNotePath,
    targetNotePath,
  };
}

class NoteWorkspaceStore {
  tabs = $state<NoteWorkspaceTab[]>([]);
  activeTabId = $state<string | null>(null);
  maximizedPaneId = $state<string | null>(null);
  highlightedPaneId = $state<string | null>(null);
  private highlightTimeout: ReturnType<typeof setTimeout> | null = null;
  private loaded = false;
  private eventsRegistered = false;

  constructor() {
    this.registerEventHandlers();
  }

  init(): void {
    this.registerEventHandlers();
    if (this.loaded) return;
    this.loaded = true;
    if (typeof localStorage === 'undefined') return;
    const state = parseStoredState(localStorage.getItem(STORAGE_KEY));
    this.tabs = state.tabs;
    this.activeTabId = state.activeTabId;
  }

  private registerEventHandlers(): void {
    if (this.eventsRegistered) return;
    this.eventsRegistered = true;
    events.on('note:deleted', ({ path }) => {
      this.removeNotePath(path);
    });
  }

  get activeTab(): NoteWorkspaceTab | null {
    return this.tabs.find((tab) => tab.id === this.activeTabId) ?? null;
  }

  get activePaneId(): string | null {
    return this.activeTab?.activePaneId ?? null;
  }

  get activeNotePath(): string | null {
    const tab = this.activeTab;
    if (!tab) return null;
    return findLeaf(tab.root, tab.activePaneId)?.notePath ?? null;
  }

  get hasTabs(): boolean {
    return this.tabs.length > 0;
  }

  get isActiveTabSplit(): boolean {
    return this.activeTab?.root.type === 'split';
  }

  renameTab(tabId: string, title: string | null): void {
    this.init();
    const tab = this.tabs.find((item) => item.id === tabId);
    if (!tab) return;
    tab.title = title?.trim() || null;
    this.tabs = [...this.tabs];
    this.persist();
  }

  openNoteTab(notePath: string): string {
    this.init();
    const existing = findOpenPaneByPath(this.tabs, notePath);

    if (existing) {
      this.activeTabId = existing.tab.id;
      existing.tab.activePaneId = existing.leaf.paneId;
      this.maximizedPaneId = null;
      this.tabs = [...this.tabs];
      this.persist();
      this.highlightPane(existing.leaf.paneId);
      return existing.tab.id;
    }

    const tab = createTab(notePath);
    this.tabs = [...this.tabs, tab];
    this.activeTabId = tab.id;
    this.maximizedPaneId = null;
    this.persist();
    return tab.id;
  }

  focusTab(tabId: string): string | null {
    this.init();
    const tab = this.tabs.find((item) => item.id === tabId);
    if (!tab) return null;
    this.activeTabId = tab.id;
    this.maximizedPaneId = null;
    this.persist();
    return findLeaf(tab.root, tab.activePaneId)?.notePath ?? firstLeaf(tab.root).notePath;
  }

  focusPane(tabId: string, paneId: string, options: { preserveMaximized?: boolean } = {}): string | null {
    this.init();
    const tab = this.tabs.find((item) => item.id === tabId);
    if (!tab) return null;
    const leaf = findLeaf(tab.root, paneId);
    if (!leaf) return null;
    tab.activePaneId = paneId;
    this.activeTabId = tab.id;
    if (!options.preserveMaximized) this.maximizedPaneId = null;
    this.tabs = [...this.tabs];
    this.persist();
    return leaf.notePath;
  }

  highlightPane(paneId: string): void {
    if (this.highlightTimeout) clearTimeout(this.highlightTimeout);
    this.highlightedPaneId = paneId;
    this.highlightTimeout = setTimeout(() => {
      this.highlightedPaneId = null;
      this.highlightTimeout = null;
    }, 900);
  }

  splitActivePane(direction: NotePaneDirection): string | null {
    const tab = this.activeTab;
    if (!tab) return null;

    const result = splitLeaf(tab.root, tab.activePaneId, direction);
    if (!result.placeholder) return null;

    tab.root = result.node;
    tab.activePaneId = result.placeholder.paneId;
    this.activeTabId = tab.id;
    this.maximizedPaneId = null;
    this.tabs = [...this.tabs];
    this.persist();
    return result.placeholder.paneId;
  }

  setPaneNote(tabId: string, paneId: string, notePath: string): string | null {
    this.init();
    const tab = this.tabs.find((item) => item.id === tabId);
    if (!tab) return null;

    const duplicate = findOpenPaneByPath(this.tabs, notePath);
    if (duplicate && duplicate.tab.id !== tab.id && isSingleNoteTab(duplicate.tab, notePath)) {
      this.tabs = this.tabs.filter((item) => item.id !== duplicate.tab.id);
    } else if (duplicate && (duplicate.tab.id !== tab.id || duplicate.leaf.paneId !== paneId)) {
      const target = findLeaf(tab.root, paneId);
      if (target?.notePath === null && duplicate.tab.id !== tab.id) {
        const root = closeLeaf(tab.root, paneId);
        if (root) {
          tab.root = root;
        } else {
          this.tabs = this.tabs.filter((item) => item.id !== tab.id);
        }
      } else if (duplicate.tab.id === tab.id) {
        const root = closeLeaf(tab.root, paneId);
        if (root) tab.root = root;
      }
      duplicate.tab.activePaneId = duplicate.leaf.paneId;
      this.activeTabId = duplicate.tab.id;
      this.maximizedPaneId = null;
      this.tabs = [...this.tabs];
      this.persist();
      this.highlightPane(duplicate.leaf.paneId);
      return notePath;
    }

    const sameTabDuplicate = findLeafByPath(tab.root, notePath);
    if (sameTabDuplicate && sameTabDuplicate.paneId !== paneId) {
      const root = closeLeaf(tab.root, paneId);
      if (root) {
        tab.root = root;
        tab.activePaneId = sameTabDuplicate.paneId;
      }
    } else {
      tab.root = replaceLeafNote(tab.root, paneId, notePath);
      tab.activePaneId = paneId;
    }

    this.activeTabId = tab.id;
    this.maximizedPaneId = null;
    this.tabs = [...this.tabs];
    this.persist();
    return notePath;
  }

  replacePaneNote(tabId: string, paneId: string, notePath: string): NotePaneDropResult {
    const resultPath = this.setPaneNote(tabId, paneId, notePath);
    const tab = this.tabs.find((item) => item.id === tabId);
    const pane = tab ? findLeaf(tab.root, tab.activePaneId) : null;
    return {
      action: pane?.paneId === paneId ? 'replaced' : 'focused-existing',
      paneId: pane?.paneId ?? null,
      notePath: resultPath,
    };
  }

  splitPaneWithNote(
    tabId: string,
    paneId: string,
    intent: Exclude<NotePaneDropIntent, 'replace'>,
    notePath: string,
  ): NotePaneDropResult {
    this.init();
    const tab = this.tabs.find((item) => item.id === tabId);
    if (!tab) return { action: 'ignored', paneId: null, notePath: null };

    const duplicate = findOpenPaneByPath(this.tabs, notePath);
    if (duplicate?.tab.id === tab.id) {
      duplicate.tab.activePaneId = duplicate.leaf.paneId;
      this.activeTabId = duplicate.tab.id;
      this.maximizedPaneId = null;
      this.tabs = [...this.tabs];
      this.persist();
      this.highlightPane(duplicate.leaf.paneId);
      return { action: 'focused-existing', paneId: duplicate.leaf.paneId, notePath };
    }
    if (duplicate && !isSingleNoteTab(duplicate.tab, notePath)) {
      duplicate.tab.activePaneId = duplicate.leaf.paneId;
      this.activeTabId = duplicate.tab.id;
      this.maximizedPaneId = null;
      this.tabs = [...this.tabs];
      this.persist();
      this.highlightPane(duplicate.leaf.paneId);
      return { action: 'focused-existing', paneId: duplicate.leaf.paneId, notePath };
    }
    if (duplicate) {
      this.tabs = this.tabs.filter((item) => item.id !== duplicate.tab.id);
    }

    const result = splitLeafWithNote(tab.root, paneId, intent, notePath);
    if (!result.created) return { action: 'ignored', paneId: null, notePath: null };

    tab.root = result.node;
    tab.activePaneId = result.created.paneId;
    this.activeTabId = tab.id;
    this.maximizedPaneId = null;
    this.tabs = [...this.tabs];
    this.persist();
    this.highlightPane(result.created.paneId);
    return { action: 'split', paneId: result.created.paneId, notePath };
  }

  dropNoteOnPane(
    tabId: string,
    paneId: string,
    notePath: string,
    intent: NotePaneDropIntent,
  ): NotePaneDropResult {
    this.init();
    const tab = this.tabs.find((item) => item.id === tabId);
    if (!tab) return { action: 'ignored', paneId: null, notePath: null };

    if (intent === 'replace') {
      return this.replacePaneNote(tabId, paneId, notePath);
    }

    return this.splitPaneWithNote(tabId, paneId, intent, notePath);
  }

  swapPanes(
    sourceTabId: string,
    sourcePaneId: string,
    targetTabId: string,
    targetPaneId: string,
  ): NotePaneMoveResult {
    this.init();
    if (sourceTabId === targetTabId && sourcePaneId === targetPaneId) {
      return ignoredMoveResult();
    }

    const sourceTab = this.tabs.find((item) => item.id === sourceTabId);
    const targetTab = this.tabs.find((item) => item.id === targetTabId);
    if (!sourceTab || !targetTab) return ignoredMoveResult();

    const sourceLeaf = findLeaf(sourceTab.root, sourcePaneId);
    const targetLeaf = findLeaf(targetTab.root, targetPaneId);
    if (!sourceLeaf || !targetLeaf || !sourceLeaf.notePath || !targetLeaf.notePath) {
      return ignoredMoveResult(sourceLeaf?.notePath ?? null, targetLeaf?.notePath ?? null);
    }

    const sourceNotePath = sourceLeaf.notePath;
    const targetNotePath = targetLeaf.notePath;

    if (sourceTab.id === targetTab.id) {
      sourceTab.root = swapLeaves(sourceTab.root, sourcePaneId, targetPaneId);
    } else {
      sourceTab.root = replaceLeaf(sourceTab.root, sourcePaneId, targetLeaf);
      targetTab.root = replaceLeaf(targetTab.root, targetPaneId, sourceLeaf);
      if (!findLeaf(sourceTab.root, sourceTab.activePaneId)) {
        sourceTab.activePaneId = firstLeaf(sourceTab.root).paneId;
      }
    }

    targetTab.activePaneId = sourcePaneId;
    this.activeTabId = targetTab.id;
    this.maximizedPaneId = null;
    this.tabs = [...this.tabs];
    this.persist();
    this.highlightPane(sourcePaneId);

    return {
      action: 'swapped',
      activeTabId: targetTab.id,
      activePaneId: sourcePaneId,
      sourceNotePath,
      targetNotePath,
    };
  }

  movePane(
    sourceTabId: string,
    sourcePaneId: string,
    targetTabId: string,
    targetPaneId: string,
    intent: NotePaneMoveIntent,
  ): NotePaneMoveResult {
    this.init();

    if (intent === 'swap') {
      return this.swapPanes(sourceTabId, sourcePaneId, targetTabId, targetPaneId);
    }

    if (sourceTabId === targetTabId && sourcePaneId === targetPaneId) {
      return ignoredMoveResult();
    }

    const sourceTab = this.tabs.find((item) => item.id === sourceTabId);
    const targetTab = this.tabs.find((item) => item.id === targetTabId);
    if (!sourceTab || !targetTab) return ignoredMoveResult();

    const sourceLeaf = findLeaf(sourceTab.root, sourcePaneId);
    const targetLeaf = findLeaf(targetTab.root, targetPaneId);
    if (!sourceLeaf || !targetLeaf || !sourceLeaf.notePath) {
      return ignoredMoveResult(sourceLeaf?.notePath ?? null, targetLeaf?.notePath ?? null);
    }

    const sourceNotePath = sourceLeaf.notePath;
    const targetNotePath = targetLeaf.notePath;

    if (sourceTab.id === targetTab.id) {
      const detached = detachLeaf(sourceTab.root, sourcePaneId);
      if (!detached.detached || !detached.node || !findLeaf(detached.node, targetPaneId)) {
        return ignoredMoveResult(sourceNotePath, targetNotePath);
      }

      const inserted = insertLeafAt(detached.node, targetPaneId, intent, detached.detached);
      if (!inserted.inserted) return ignoredMoveResult(sourceNotePath, targetNotePath);

      sourceTab.root = inserted.node;
      sourceTab.activePaneId = detached.detached.paneId;
      this.activeTabId = sourceTab.id;
      this.maximizedPaneId = null;
      this.tabs = [...this.tabs];
      this.persist();
      this.highlightPane(detached.detached.paneId);

      return {
        action: 'moved',
        activeTabId: sourceTab.id,
        activePaneId: detached.detached.paneId,
        sourceNotePath,
        targetNotePath,
      };
    }

    const detached = detachLeaf(sourceTab.root, sourcePaneId);
    if (!detached.detached) return ignoredMoveResult(sourceNotePath, targetNotePath);

    if (detached.node) {
      sourceTab.root = detached.node;
      if (!findLeaf(sourceTab.root, sourceTab.activePaneId)) {
        sourceTab.activePaneId = firstLeaf(sourceTab.root).paneId;
      }
    } else {
      this.tabs = this.tabs.filter((item) => item.id !== sourceTab.id);
    }

    const freshTargetTab = this.tabs.find((item) => item.id === targetTabId);
    if (!freshTargetTab || !findLeaf(freshTargetTab.root, targetPaneId)) {
      return ignoredMoveResult(sourceNotePath, targetNotePath);
    }

    const inserted = insertLeafAt(freshTargetTab.root, targetPaneId, intent, detached.detached);
    if (!inserted.inserted) return ignoredMoveResult(sourceNotePath, targetNotePath);

    freshTargetTab.root = inserted.node;
    freshTargetTab.activePaneId = detached.detached.paneId;
    this.activeTabId = freshTargetTab.id;
    this.maximizedPaneId = null;
    this.tabs = [...this.tabs];
    this.persist();
    this.highlightPane(detached.detached.paneId);

    return {
      action: 'moved',
      activeTabId: freshTargetTab.id,
      activePaneId: detached.detached.paneId,
      sourceNotePath,
      targetNotePath,
    };
  }

  removePaneAndCollapse(tabId: string, paneId: string): string | null {
    return this.closePane(tabId, paneId);
  }

  findPaneByPath(tabId: string, notePath: string): NotePaneLeaf | null {
    this.init();
    const tab = this.tabs.find((item) => item.id === tabId);
    return tab ? findLeafByPath(tab.root, notePath) : null;
  }

  closePane(tabId: string, paneId: string): string | null {
    this.init();
    const tab = this.tabs.find((item) => item.id === tabId);
    if (!tab) return this.activeNotePath;

    const root = closeLeaf(tab.root, paneId);
    if (!root) {
      this.closeTab(tabId);
      return this.activeNotePath;
    }

    tab.root = root;
    if (!findLeaf(root, tab.activePaneId)) {
      tab.activePaneId = firstLeaf(root).paneId;
    }
    this.maximizedPaneId = this.maximizedPaneId === paneId ? null : this.maximizedPaneId;
    this.tabs = [...this.tabs];
    this.persist();
    return findLeaf(tab.root, tab.activePaneId)?.notePath ?? null;
  }

  closeTab(tabId: string): string | null {
    this.init();
    const index = this.tabs.findIndex((tab) => tab.id === tabId);
    if (index < 0) return this.activeNotePath;

    const wasActive = this.activeTabId === tabId;
    const nextTabs = this.tabs.filter((tab) => tab.id !== tabId);
    this.tabs = nextTabs;

    if (wasActive) {
      const next = nextTabs[index] ?? nextTabs[index - 1] ?? nextTabs[0] ?? null;
      this.activeTabId = next?.id ?? null;
      this.maximizedPaneId = null;
    }

    this.persist();
    return this.activeNotePath;
  }

  closeActiveTab(): string | null {
    const id = this.activeTabId;
    if (!id) return null;
    return this.closeTab(id);
  }

  closeOtherTabs(tabId: string): string | null {
    this.init();
    const tab = this.tabs.find((item) => item.id === tabId);
    if (!tab) return this.activeNotePath;
    this.tabs = [tab];
    this.activeTabId = tab.id;
    this.maximizedPaneId = null;
    this.persist();
    return findLeaf(tab.root, tab.activePaneId)?.notePath ?? null;
  }

  setSplitSizes(tabId: string, splitId: string, sizes: number[]): void {
    this.init();
    if (sizes.length < 2) return;
    const tab = this.tabs.find((item) => item.id === tabId);
    if (!tab) return;
    tab.root = setSplitSizes(tab.root, splitId, [sizes[0] ?? 50, sizes[1] ?? 50]);
    this.tabs = [...this.tabs];
    this.persist();
  }

  toggleMaximizedPane(paneId: string): void {
    this.maximizedPaneId = this.maximizedPaneId === paneId ? null : paneId;
  }

  focusNextPane(direction: 1 | -1 = 1): string | null {
    const tab = this.activeTab;
    if (!tab) return null;
    const next = findNextLeaf(tab.root, tab.activePaneId, direction);
    if (!next) return null;
    tab.activePaneId = next.paneId;
    this.maximizedPaneId = null;
    this.tabs = [...this.tabs];
    this.persist();
    return next.notePath;
  }

  getPaneCount(tab: NoteWorkspaceTab): number {
    return countLeaves(tab.root);
  }

  getNotePaths(tab: NoteWorkspaceTab): string[] {
    return collectNotePaths(tab.root);
  }

  getPanes(tab: NoteWorkspaceTab): NotePaneLeaf[] {
    return collectLeaves(tab.root);
  }

  getActivePane(tab: NoteWorkspaceTab): NotePaneLeaf {
    return findLeaf(tab.root, tab.activePaneId) ?? firstLeaf(tab.root);
  }

  removeNotePath(notePath: string): string | null {
    this.init();
    const nextTabs: NoteWorkspaceTab[] = [];

    for (const tab of this.tabs) {
      let root: NotePaneNode | null = tab.root;
      for (const leaf of collectLeaves(root)) {
        if (leaf.notePath === notePath) {
          const closed = closeLeaf(root, leaf.paneId);
          if (!closed) {
            root = null;
            break;
          }
          root = closed;
        }
      }
      if (!root) continue;
      const active = findLeaf(root, tab.activePaneId) ?? firstLeaf(root);
      nextTabs.push({ ...tab, root, activePaneId: active.paneId });
    }

    this.tabs = nextTabs;
    if (!this.tabs.some((tab) => tab.id === this.activeTabId)) {
      this.activeTabId = this.tabs[0]?.id ?? null;
    }
    this.persist();
    return this.activeNotePath;
  }

  renameNotePath(oldPath: string, newPath: string): void {
    this.init();
    this.tabs = this.tabs.map((tab) => ({
      ...tab,
      root: renamePathInNode(tab.root, oldPath, newPath),
    }));
    this.persist();
  }

  reset(): void {
    this.tabs = [];
    this.activeTabId = null;
    this.maximizedPaneId = null;
    this.highlightedPaneId = null;
    if (this.highlightTimeout) {
      clearTimeout(this.highlightTimeout);
      this.highlightTimeout = null;
    }
    this.persist();
  }

  private persist(): void {
    if (!this.loaded || typeof localStorage === 'undefined') return;

    const tabs = this.tabs
      .map((tab) => {
        const root = removeEmptyLeaves(tab.root);
        if (!root) return null;
        const active = findLeaf(root, tab.activePaneId) ?? firstLeaf(root);
        return { ...tab, root, activePaneId: active.paneId };
      })
      .filter((tab): tab is NoteWorkspaceTab => !!tab);

    const state: NoteWorkspaceLayoutState = {
      version: NOTE_WORKSPACE_LAYOUT_VERSION,
      tabs,
      activeTabId: tabs.some((tab) => tab.id === this.activeTabId)
        ? this.activeTabId
        : tabs[0]?.id ?? null,
    };

    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }
}

export const noteWorkspaceStore = new NoteWorkspaceStore();
