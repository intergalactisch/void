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
const MAX_OPEN_LAYOUT_NOTES = 6;

export interface NotePaneDropResult {
  action: 'focused-existing' | 'replaced' | 'split' | 'ignored';
  paneId: string | null;
  notePath: string | null;
}

export interface NotePaneCloseResult {
  action: 'closed-pane' | 'closed-tab' | 'ignored';
  closedPath: string | null;
  nextPath: string | null;
  nextPaneId: string | null;
  closedTabId: string | null;
  activeTabId: string | null;
}

export interface NoteLayoutAddResult {
  action: 'appended' | 'focused-existing' | 'ignored';
  tabId: string | null;
  paneId: string | null;
  notePath: string | null;
}

export interface OpenNoteLocation {
  tabId: string;
  paneId: string;
  notePath: string;
  tabTitle: string | null;
  paneIndex: number;
  paneCount: number;
  isActiveTab: boolean;
  isActivePane: boolean;
}

export interface OpenNoteDisplayState {
  isOpen: boolean;
  isFocused: boolean;
  tabId: string | null;
  paneId: string | null;
  paneIndex: number | null;
  paneCount: number;
  tabTitle: string | null;
  label: string;
  tooltip: string;
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

function createBalancedLayout(notePaths: string[], depth = 0): NotePaneNode {
  const leaves = notePaths.map((notePath) => createLeaf(notePath));
  return buildBalancedFromLeaves(leaves, { mode: 'mixed', rootDirection: 'horizontal' }, depth);
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

function collectSplitDirections(node: NotePaneNode, directions: NotePaneDirection[] = []): NotePaneDirection[] {
  if (node.type === 'leaf') return directions;
  directions.push(node.direction);
  collectSplitDirections(node.children[0], directions);
  collectSplitDirections(node.children[1], directions);
  return directions;
}

function oppositeDirection(direction: NotePaneDirection): NotePaneDirection {
  return direction === 'horizontal' ? 'vertical' : 'horizontal';
}

type LayoutRebalanceMode = 'single-axis' | 'mixed';

interface LayoutRebalanceOptions {
  mode: LayoutRebalanceMode;
  rootDirection: NotePaneDirection;
}

function rebalanceOptionsFromNode(node: NotePaneNode): LayoutRebalanceOptions {
  if (node.type === 'leaf') return { mode: 'single-axis', rootDirection: 'horizontal' };
  const directions = collectSplitDirections(node);
  const uniqueDirections = new Set(directions);
  return {
    mode: uniqueDirections.size <= 1 ? 'single-axis' : 'mixed',
    rootDirection: node.direction,
  };
}

function buildBalancedFromLeaves(
  leaves: NotePaneLeaf[],
  options: LayoutRebalanceOptions,
  depth = 0,
): NotePaneNode {
  if (leaves.length <= 1) return leaves[0] ?? createLeaf(null);

  const midpoint = Math.ceil(leaves.length / 2);
  const leftLeaves = leaves.slice(0, midpoint);
  const rightLeaves = leaves.slice(midpoint);
  const direction = options.mode === 'single-axis' || depth % 2 === 0
    ? options.rootDirection
    : oppositeDirection(options.rootDirection);
  const leftSize = (leftLeaves.length / leaves.length) * 100;

  return {
    type: 'split',
    splitId: createId('split'),
    direction,
    sizes: [leftSize, 100 - leftSize],
    children: [
      buildBalancedFromLeaves(leftLeaves, options, depth + 1),
      buildBalancedFromLeaves(rightLeaves, options, depth + 1),
    ],
  };
}

function noteLeavesInVisualOrder(node: NotePaneNode): NotePaneLeaf[] {
  return collectLeaves(node).filter((leaf) => !!leaf.notePath);
}

function rebalanceNodeFromLeaves(
  leaves: NotePaneLeaf[],
  options: LayoutRebalanceOptions,
): NotePaneNode | null {
  const noteLeaves = leaves.filter((leaf) => !!leaf.notePath);
  if (noteLeaves.length === 0) return null;
  return buildBalancedFromLeaves(noteLeaves, options);
}

function isSingleAxisLayout(node: NotePaneNode, direction: NotePaneDirection): boolean {
  if (node.type === 'leaf') return true;
  const directions = collectSplitDirections(node);
  return directions.length > 0 && directions.every((candidate) => candidate === direction);
}

function appendLeafToLayoutEdge(
  root: NotePaneNode,
  leaf: NotePaneLeaf,
  direction: NotePaneDirection,
): NotePaneNode {
  if (root.type === 'leaf') {
    return {
      type: 'split',
      splitId: createId('split'),
      direction,
      sizes: [50, 50],
      children: [root, leaf],
    };
  }

  if (isSingleAxisLayout(root, direction)) {
    return buildBalancedFromLeaves([...noteLeavesInVisualOrder(root), leaf], {
      mode: 'single-axis',
      rootDirection: direction,
    });
  }

  const existingCount = Math.max(1, noteLeavesInVisualOrder(root).length);
  const existingSize = (existingCount / (existingCount + 1)) * 100;
  return {
    type: 'split',
    splitId: createId('split'),
    direction,
    sizes: [existingSize, 100 - existingSize],
    children: [root, leaf],
  };
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

function openNoteLocation(
  tab: NoteWorkspaceTab,
  leaf: NotePaneLeaf,
  activeTabId: string | null,
): OpenNoteLocation {
  const panes = collectLeaves(tab.root);
  const paneIndex = panes.findIndex((pane) => pane.paneId === leaf.paneId);
  return {
    tabId: tab.id,
    paneId: leaf.paneId,
    notePath: leaf.notePath ?? '',
    tabTitle: tab.title,
    paneIndex: Math.max(0, paneIndex),
    paneCount: panes.length,
    isActiveTab: tab.id === activeTabId,
    isActivePane: tab.id === activeTabId && tab.activePaneId === leaf.paneId,
  };
}

function closedNoteDisplayState(): OpenNoteDisplayState {
  return {
    isOpen: false,
    isFocused: false,
    tabId: null,
    paneId: null,
    paneIndex: null,
    paneCount: 0,
    tabTitle: null,
    label: '',
    tooltip: '',
  };
}

function openNoteDisplayState(location: OpenNoteLocation): OpenNoteDisplayState {
  const label = location.isActivePane ? 'Focused' : 'Open';
  const displayIndex = location.paneIndex + 1;
  const workspaceName = location.tabTitle?.trim() || (location.paneCount > 1 ? 'layout' : 'editor tab');
  const tooltip = location.paneCount > 1
    ? `${label} in ${workspaceName}, pane ${displayIndex} of ${location.paneCount}`
    : `${label} in ${workspaceName}`;

  return {
    isOpen: true,
    isFocused: location.isActivePane,
    tabId: location.tabId,
    paneId: location.paneId,
    paneIndex: location.paneIndex,
    paneCount: location.paneCount,
    tabTitle: location.tabTitle,
    label,
    tooltip,
  };
}

function isSingleNoteTab(tab: NoteWorkspaceTab, notePath: string): boolean {
  return tab.root.type === 'leaf' && tab.root.notePath === notePath;
}

function directionForEdgeIntent(intent: Exclude<NotePaneMoveIntent, 'swap'>): NotePaneDirection {
  return intent === 'left' || intent === 'right' ? 'horizontal' : 'vertical';
}

function isBeforeEdgeIntent(intent: Exclude<NotePaneMoveIntent, 'swap'>): boolean {
  return intent === 'left' || intent === 'top';
}

function insertLeafRelativeToTarget(
  leaves: NotePaneLeaf[],
  targetPaneId: string,
  intent: Exclude<NotePaneMoveIntent, 'swap'>,
  leaf: NotePaneLeaf,
): NotePaneLeaf[] | null {
  const targetIndex = leaves.findIndex((candidate) => candidate.paneId === targetPaneId);
  if (targetIndex < 0) return null;
  const insertIndex = isBeforeEdgeIntent(intent) ? targetIndex : targetIndex + 1;
  const next = [...leaves];
  next.splice(insertIndex, 0, leaf);
  return next;
}

function rebuildSingleAxisLayout(
  leaves: NotePaneLeaf[],
  direction: NotePaneDirection,
): NotePaneNode | null {
  const noteLeaves = leaves.filter((leaf) => !!leaf.notePath);
  if (noteLeaves.length === 0) return null;
  return buildBalancedFromLeaves(noteLeaves, {
    mode: 'single-axis',
    rootDirection: direction,
  });
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

  findOpenNote(notePath: string): OpenNoteLocation | null {
    this.init();
    const existing = findOpenPaneByPath(this.tabs, notePath);
    if (!existing || !existing.leaf.notePath) return null;
    return openNoteLocation(existing.tab, existing.leaf, this.activeTabId);
  }

  openStateForPath(notePath: string): OpenNoteDisplayState {
    const location = this.findOpenNote(notePath);
    return location ? openNoteDisplayState(location) : closedNoteDisplayState();
  }

  focusOpenNote(notePath: string): OpenNoteLocation | null {
    this.init();
    const existing = findOpenPaneByPath(this.tabs, notePath);
    if (!existing || !existing.leaf.notePath) return null;

    this.activeTabId = existing.tab.id;
    existing.tab.activePaneId = existing.leaf.paneId;
    this.maximizedPaneId = null;
    this.tabs = [...this.tabs];
    this.persist();
    this.highlightPane(existing.leaf.paneId);

    return openNoteLocation(existing.tab, existing.leaf, this.activeTabId);
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

  openNotesLayout(notePaths: string[], title: string | null = null): string | null {
    this.init();
    const uniquePaths = Array.from(new Set(notePaths.filter(Boolean))).slice(0, MAX_OPEN_LAYOUT_NOTES);
    if (uniquePaths.length === 0) return this.activeNotePath;
    if (uniquePaths.length === 1) {
      this.openNoteTab(uniquePaths[0]!);
      return this.activeNotePath;
    }

    const pathsToMove = new Set(uniquePaths);
    const remainingTabs: NoteWorkspaceTab[] = [];

    for (const tab of this.tabs) {
      const remainingLeaves = noteLeavesInVisualOrder(tab.root)
        .filter((leaf) => !leaf.notePath || !pathsToMove.has(leaf.notePath));
      const root = rebalanceNodeFromLeaves(remainingLeaves, rebalanceOptionsFromNode(tab.root));
      if (!root) continue;
      const active = findLeaf(root, tab.activePaneId) ?? firstLeaf(root);
      remainingTabs.push({ ...tab, root, activePaneId: active.paneId });
    }

    const root = createBalancedLayout(uniquePaths);
    const active = firstLeaf(root);
    const tab: NoteWorkspaceTab = {
      id: createId('tab'),
      root,
      activePaneId: active.paneId,
      title: title?.trim() || null,
    };

    this.tabs = [...remainingTabs, tab];
    this.activeTabId = tab.id;
    this.maximizedPaneId = null;
    this.tabs = [...this.tabs];
    this.persist();
    this.highlightPane(active.paneId);
    return active.notePath;
  }

  focusTab(tabId: string): string | null {
    this.init();
    const tab = this.tabs.find((item) => item.id === tabId);
    if (!tab) return null;
    const activeLeaf = findLeaf(tab.root, tab.activePaneId);
    const targetLeaf = activeLeaf?.notePath
      ? activeLeaf
      : noteLeavesInVisualOrder(tab.root)[0] ?? activeLeaf ?? firstLeaf(tab.root);
    tab.activePaneId = targetLeaf.paneId;
    this.activeTabId = tab.id;
    this.maximizedPaneId = null;
    this.tabs = [...this.tabs];
    this.persist();
    return targetLeaf.notePath;
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
    if (duplicate?.leaf.notePath) {
      duplicate.tab.activePaneId = duplicate.leaf.paneId;
      this.activeTabId = duplicate.tab.id;
      this.maximizedPaneId = null;
      this.tabs = [...this.tabs];
      this.persist();
      this.highlightPane(duplicate.leaf.paneId);
      return { action: 'focused-existing', paneId: duplicate.leaf.paneId, notePath };
    }

    const targetLeaf = findLeaf(tab.root, paneId);
    if (!targetLeaf) return { action: 'ignored', paneId: null, notePath: null };
    if (!targetLeaf.notePath) {
      return this.replacePaneNote(tabId, paneId, notePath);
    }

    const created = createLeaf(notePath);
    const direction = directionForEdgeIntent(intent);
    const orderedLeaves = insertLeafRelativeToTarget(
      noteLeavesInVisualOrder(tab.root),
      paneId,
      intent,
      created,
    );
    if (!orderedLeaves) return { action: 'ignored', paneId: null, notePath: null };
    const root = rebuildSingleAxisLayout(orderedLeaves, direction);
    if (!root) return { action: 'ignored', paneId: null, notePath: null };

    tab.root = root;
    tab.activePaneId = created.paneId;
    this.activeTabId = tab.id;
    this.maximizedPaneId = null;
    this.tabs = [...this.tabs];
    this.persist();
    this.highlightPane(created.paneId);
    return { action: 'split', paneId: created.paneId, notePath };
  }

  addNoteToLayout(tabId: string, notePath: string): NoteLayoutAddResult {
    this.init();
    const existing = findOpenPaneByPath(this.tabs, notePath);
    if (existing?.leaf.notePath) {
      this.activeTabId = existing.tab.id;
      existing.tab.activePaneId = existing.leaf.paneId;
      this.maximizedPaneId = null;
      this.tabs = [...this.tabs];
      this.persist();
      this.highlightPane(existing.leaf.paneId);
      return {
        action: 'focused-existing',
        tabId: existing.tab.id,
        paneId: existing.leaf.paneId,
        notePath,
      };
    }

    const tab = this.tabs.find((item) => item.id === tabId);
    if (!tab) return { action: 'ignored', tabId: null, paneId: null, notePath: null };

    const created = createLeaf(notePath);
    const leaves = [...noteLeavesInVisualOrder(tab.root), created];
    const root = rebalanceNodeFromLeaves(leaves, rebalanceOptionsFromNode(tab.root));
    if (!root) return { action: 'ignored', tabId: null, paneId: null, notePath: null };

    tab.root = root;
    tab.activePaneId = created.paneId;
    this.activeTabId = tab.id;
    this.maximizedPaneId = null;
    this.tabs = [...this.tabs];
    this.persist();
    this.highlightPane(created.paneId);

    return {
      action: 'appended',
      tabId: tab.id,
      paneId: created.paneId,
      notePath,
    };
  }

  addNoteToLayoutEdge(tabId: string, notePath: string, direction: NotePaneDirection): NoteLayoutAddResult {
    this.init();
    const existing = findOpenPaneByPath(this.tabs, notePath);
    if (existing?.leaf.notePath) {
      this.activeTabId = existing.tab.id;
      existing.tab.activePaneId = existing.leaf.paneId;
      this.maximizedPaneId = null;
      this.tabs = [...this.tabs];
      this.persist();
      this.highlightPane(existing.leaf.paneId);
      return {
        action: 'focused-existing',
        tabId: existing.tab.id,
        paneId: existing.leaf.paneId,
        notePath,
      };
    }

    const tab = this.tabs.find((item) => item.id === tabId);
    if (!tab) return { action: 'ignored', tabId: null, paneId: null, notePath: null };

    const compactRoot = removeEmptyLeaves(tab.root);
    if (!compactRoot || collectNotePaths(compactRoot).length === 0) {
      return { action: 'ignored', tabId: null, paneId: null, notePath: null };
    }

    const created = createLeaf(notePath);
    tab.root = appendLeafToLayoutEdge(compactRoot, created, direction);
    tab.activePaneId = created.paneId;
    this.activeTabId = tab.id;
    this.maximizedPaneId = null;
    this.tabs = [...this.tabs];
    this.persist();
    this.highlightPane(created.paneId);

    return {
      action: 'appended',
      tabId: tab.id,
      paneId: created.paneId,
      notePath,
    };
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
    const direction = directionForEdgeIntent(intent);

    if (sourceTab.id === targetTab.id) {
      const remainingLeaves = noteLeavesInVisualOrder(sourceTab.root)
        .filter((leaf) => leaf.paneId !== sourcePaneId);
      const orderedLeaves = insertLeafRelativeToTarget(remainingLeaves, targetPaneId, intent, sourceLeaf);
      if (!orderedLeaves) {
        return ignoredMoveResult(sourceNotePath, targetNotePath);
      }
      const root = rebuildSingleAxisLayout(orderedLeaves, direction);
      if (!root) return ignoredMoveResult(sourceNotePath, targetNotePath);

      sourceTab.root = root;
      sourceTab.activePaneId = sourceLeaf.paneId;
      this.activeTabId = sourceTab.id;
      this.maximizedPaneId = null;
      this.tabs = [...this.tabs];
      this.persist();
      this.highlightPane(sourceLeaf.paneId);

      return {
        action: 'moved',
        activeTabId: sourceTab.id,
        activePaneId: sourceLeaf.paneId,
        sourceNotePath,
        targetNotePath,
      };
    }

    const detached = detachLeaf(sourceTab.root, sourcePaneId);
    if (!detached.detached) return ignoredMoveResult(sourceNotePath, targetNotePath);

    const remainingSourceLeaves = noteLeavesInVisualOrder(sourceTab.root)
      .filter((leaf) => leaf.paneId !== sourcePaneId);
    const sourceRoot = rebalanceNodeFromLeaves(remainingSourceLeaves, rebalanceOptionsFromNode(sourceTab.root));
    if (sourceRoot) {
      sourceTab.root = sourceRoot;
      const active = findLeaf(sourceTab.root, sourceTab.activePaneId) ?? firstLeaf(sourceTab.root);
      sourceTab.activePaneId = active.paneId;
    } else {
      this.tabs = this.tabs.filter((item) => item.id !== sourceTab.id);
    }

    const freshTargetTab = this.tabs.find((item) => item.id === targetTabId);
    if (!freshTargetTab || !findLeaf(freshTargetTab.root, targetPaneId)) {
      return ignoredMoveResult(sourceNotePath, targetNotePath);
    }

    const orderedLeaves = insertLeafRelativeToTarget(
      noteLeavesInVisualOrder(freshTargetTab.root),
      targetPaneId,
      intent,
      detached.detached,
    );
    if (!orderedLeaves) return ignoredMoveResult(sourceNotePath, targetNotePath);
    const targetRoot = rebuildSingleAxisLayout(orderedLeaves, direction);
    if (!targetRoot) return ignoredMoveResult(sourceNotePath, targetNotePath);

    freshTargetTab.root = targetRoot;
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

  removePaneAndCollapse(tabId: string, paneId: string): NotePaneCloseResult {
    return this.closePane(tabId, paneId);
  }

  findPaneByPath(tabId: string, notePath: string): NotePaneLeaf | null {
    this.init();
    const tab = this.tabs.find((item) => item.id === tabId);
    return tab ? findLeafByPath(tab.root, notePath) : null;
  }

  closePane(tabId: string, paneId: string): NotePaneCloseResult {
    this.init();
    const tab = this.tabs.find((item) => item.id === tabId);
    if (!tab) {
      return {
        action: 'ignored',
        closedPath: null,
        nextPath: this.activeNotePath,
        nextPaneId: this.activePaneId,
        closedTabId: null,
        activeTabId: this.activeTabId,
      };
    }

    const leaves = collectLeaves(tab.root);
    const closedIndex = leaves.findIndex((leaf) => leaf.paneId === paneId);
    const closedLeaf = closedIndex >= 0 ? leaves[closedIndex] ?? null : null;
    if (!closedLeaf) {
      return {
        action: 'ignored',
        closedPath: null,
        nextPath: this.activeNotePath,
        nextPaneId: this.activePaneId,
        closedTabId: null,
        activeTabId: this.activeTabId,
      };
    }

    const closedPath = closedLeaf.notePath;
    const remainingLeaves = leaves.filter((leaf) => leaf.paneId !== paneId && !!leaf.notePath);

    if (remainingLeaves.length === 0) {
      const nextPath = this.closeTab(tabId);
      return {
        action: 'closed-tab',
        closedPath,
        nextPath,
        nextPaneId: this.activePaneId,
        closedTabId: tabId,
        activeTabId: this.activeTabId,
      };
    }

    const root = buildBalancedFromLeaves(remainingLeaves, rebalanceOptionsFromNode(tab.root));
    const nextLeaf = remainingLeaves[Math.min(closedIndex, remainingLeaves.length - 1)] ?? remainingLeaves[0]!;
    tab.root = root;
    tab.activePaneId = nextLeaf.paneId;
    this.activeTabId = tab.id;
    this.maximizedPaneId = this.maximizedPaneId === paneId ? null : this.maximizedPaneId;
    this.tabs = [...this.tabs];
    this.persist();
    if (nextLeaf.notePath) this.highlightPane(nextLeaf.paneId);
    return {
      action: 'closed-pane',
      closedPath,
      nextPath: nextLeaf.notePath,
      nextPaneId: nextLeaf.paneId,
      closedTabId: null,
      activeTabId: tab.id,
    };
  }

  closeActivePane(): NotePaneCloseResult {
    this.init();
    const tab = this.activeTab;
    if (!tab) {
      return {
        action: 'ignored',
        closedPath: null,
        nextPath: null,
        nextPaneId: null,
        closedTabId: null,
        activeTabId: null,
      };
    }
    return this.closePane(tab.id, tab.activePaneId);
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
      const remainingLeaves = noteLeavesInVisualOrder(tab.root)
        .filter((leaf) => leaf.notePath !== notePath);
      const root = rebalanceNodeFromLeaves(remainingLeaves, rebalanceOptionsFromNode(tab.root));
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
