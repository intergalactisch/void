<script lang="ts">
  import { Pane, PaneGroup } from 'paneforge';
  import type { Document } from '$lib/domain/entities/Document';
  import type {
    NotePaneDragPayload,
    NotePaneDropIntent,
    NotePaneNode as NotePaneNodeValue,
  } from '$lib/domain';
  import { editorStore, noteWorkspaceStore, notesStore } from '$lib/stores';
  import ConflictBanner from './ConflictBanner.svelte';
  import EditorShell from './EditorShell.svelte';
  import NotePaneNodeComponent from './NotePaneNode.svelte';
  import NotePaneHeader from './NotePaneHeader.svelte';
  import NotePaneResizer from './NotePaneResizer.svelte';
  import SplitNotePicker from './SplitNotePicker.svelte';

  interface Props {
    node: NotePaneNodeValue | null | undefined;
    tabId: string;
    document: Document | null;
    onSaveStatusChange?: ((status: 'saved' | 'saving' | 'unsaved') => void) | undefined;
    onCountsChange?: ((wordCount: number, charCount: number) => void) | undefined;
    onError?: ((error: string | null) => void) | undefined;
    onTitleRename?: ((newTitle: string, path?: string) => void) | undefined;
    onPaneMoveStart?: ((event: PointerEvent, payload: NotePaneDragPayload) => void) | undefined;
    paneMoveSourceId?: string | null;
    paneMoveTargetId?: string | null;
    editorStyle?: string;
  }

  let {
    node,
    tabId,
    document,
    onSaveStatusChange,
    onCountsChange,
    onError,
    onTitleRename,
    onPaneMoveStart,
    paneMoveSourceId = null,
    paneMoveTargetId = null,
    editorStyle = '',
  }: Props = $props();

  let paneGroup: { setLayout?: (layout: number[]) => void } | null = $state(null);
  let replacingPaneId = $state<string | null>(null);
  let leafDocument = $state<Document | null>(null);
  let loadedLeafPath = $state<string | null>(null);
  let dropIntent = $state<NotePaneDropIntent | null>(null);
  let dragDepth = 0;
  const splitChildren = $derived(
    node?.type === 'split' && Array.isArray(node.children) && node.children.length === 2
      ? node.children
      : null
  );
  const firstSplitChild = $derived(splitChildren?.[0] ?? null);
  const secondSplitChild = $derived(splitChildren?.[1] ?? null);
  const splitSizes = $derived(
    node?.type === 'split' && Array.isArray(node.sizes) && node.sizes.length >= 2
      ? node.sizes
      : [50, 50]
  );
  const firstSplitSize = $derived(splitSizes[0] ?? 50);
  const secondSplitSize = $derived(splitSizes[1] ?? 50);
  const leafNode = $derived(node?.type === 'leaf' ? node : null);

  function forwardSaveStatusChange(status: 'saved' | 'saving' | 'unsaved'): void {
    onSaveStatusChange?.(status);
  }

  function forwardCountsChange(wordCount: number, charCount: number): void {
    onCountsChange?.(wordCount, charCount);
  }

  function forwardError(error: string | null): void {
    onError?.(error);
  }

  function forwardTitleRename(newTitle: string, path?: string): void {
    onTitleRename?.(newTitle, path);
  }

  function syncSelectedPath(path: string | null): void {
    if (path && notesStore.selectedPath !== path) {
      notesStore.selectNote(path);
    } else if (!path && notesStore.selectedPath !== null) {
      notesStore.selectNote(null);
    }
  }

  function remainingWorkspacePaths(): Set<string> {
    return new Set(noteWorkspaceStore.tabs.flatMap((tab) => noteWorkspaceStore.getNotePaths(tab)));
  }

  async function closeEditorSessionIfUnused(path: string | null): Promise<void> {
    if (!path) return;
    if (remainingWorkspacePaths().has(path)) return;
    if (!editorStore.tabs.some((tab) => tab.path === path)) return;
    await editorStore.closeTab(path);
  }

  function focusLeaf(paneId: string, notePath: string | null): void {
    const selectedPath = noteWorkspaceStore.focusPane(tabId, paneId, {
      preserveMaximized: noteWorkspaceStore.maximizedPaneId === paneId,
    }) ?? notePath;
    if (selectedPath && notesStore.selectedPath !== selectedPath) {
      notesStore.selectNote(selectedPath);
    }
    editorStore.focusPane(paneId);
  }

  function paneState(notePath: string) {
    const pane = node?.type === 'leaf' ? editorStore.getPaneState(node.paneId) : null;
    const session = editorStore.tabs.find((tab) => tab.path === notePath);
    const activeEditor = editorStore.activePath === notePath;
    return {
      dirty: pane?.isDirty ?? (activeEditor ? editorStore.isDirty : (session?.isDirty ?? false)),
      saving: pane?.isSaving ?? (activeEditor ? editorStore.isSaving : (session?.isSaving ?? false)),
      conflict: pane
        ? pane.conflictState !== 'clean'
        : activeEditor
        ? editorStore.conflictState !== 'clean'
        : (session?.conflictState ?? 'clean') !== 'clean',
    };
  }

  function resolvePaneDocument(notePath: string, paneId: string): Document | null {
    const paneDocument = editorStore.getPaneDocument(paneId);
    return (paneDocument?.path === notePath ? paneDocument : null)
      ?? (document?.path === notePath ? document : null)
      ?? (leafDocument?.path === notePath ? leafDocument : null);
  }

  async function closePane(paneId: string, notePath: string | null): Promise<void> {
    const nextPath = noteWorkspaceStore.closePane(tabId, paneId);
    await closeEditorSessionIfUnused(notePath);
    syncSelectedPath(nextPath);
  }

  function handlePickerCancel(paneId: string): void {
    if (replacingPaneId === paneId) {
      replacingPaneId = null;
      return;
    }
    const nextPath = noteWorkspaceStore.closePane(tabId, paneId);
    syncSelectedPath(nextPath);
  }

  function balanceSplit(splitId: string): void {
    paneGroup?.setLayout?.([50, 50]);
    noteWorkspaceStore.setSplitSizes(tabId, splitId, [50, 50]);
  }

  function hasNoteDrag(event: DragEvent): boolean {
    const types = event.dataTransfer?.types;
    if (!types) return false;
    const dragTypes = Array.from(types);
    return dragTypes.includes('application/x-void-note') && !dragTypes.includes('application/x-void-note-link');
  }

  function readDraggedNotePath(event: DragEvent): string | null {
    const transfer = event.dataTransfer;
    if (!transfer) return null;
    const raw = transfer.getData('application/x-void-note');
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as { path?: string };
        if (parsed.path) return parsed.path;
      } catch {
        return raw;
      }
    }
    return null;
  }

  function isKnownNotePath(path: string): boolean {
    return notesStore.allNotes.some((note) => !note.isFolder && note.path === path);
  }

  function resolveDropIntent(event: DragEvent, element: HTMLElement): NotePaneDropIntent {
    const rect = element.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const distances = [
      ['left', x],
      ['right', rect.width - x],
      ['top', y],
      ['bottom', rect.height - y],
    ] as const;
    const nearest = distances.reduce((best, current) => current[1] < best[1] ? current : best);
    const threshold = Math.min(Math.max(Math.min(rect.width, rect.height) * 0.24, 72), 150);
    return nearest[1] <= threshold ? nearest[0] : 'replace';
  }

  function handleDragEnter(event: DragEvent): void {
    if (!hasNoteDrag(event)) return;
    dragDepth += 1;
    event.preventDefault();
  }

  function handleDragOver(event: DragEvent): void {
    if (!hasNoteDrag(event)) return;
    event.preventDefault();
    event.dataTransfer!.dropEffect = 'copy';
    dropIntent = resolveDropIntent(event, event.currentTarget as HTMLElement);
  }

  function handleDragLeave(event: DragEvent): void {
    if (!hasNoteDrag(event)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) {
      dropIntent = null;
    }
  }

  function handleDrop(event: DragEvent, paneId: string): void {
    if (!hasNoteDrag(event)) return;
    event.preventDefault();
    dragDepth = 0;
    const intent = dropIntent ?? 'replace';
    dropIntent = null;

    const notePath = readDraggedNotePath(event);
    if (!notePath || !isKnownNotePath(notePath)) return;
    const result = noteWorkspaceStore.dropNoteOnPane(tabId, paneId, notePath, intent);
    if (result.notePath) {
      notesStore.selectNote(result.notePath);
    }
  }

  $effect(() => {
    if (node?.type !== 'leaf' || !node.notePath) {
      leafDocument = null;
      loadedLeafPath = null;
      return;
    }

    const paneDocument = editorStore.getPaneDocument(node.paneId);
    if (paneDocument?.path === node.notePath) {
      leafDocument = paneDocument;
      loadedLeafPath = node.notePath;
      return;
    }

    if (document?.path === node.notePath) {
      leafDocument = document;
      loadedLeafPath = node.notePath;
      return;
    }

    if (loadedLeafPath === node.notePath && leafDocument?.path === node.notePath) return;

    const path = node.notePath;
    loadedLeafPath = path;
    leafDocument = null;
    void notesStore.loadDocument(path).then((loaded) => {
      if (loadedLeafPath === path) leafDocument = loaded;
    });
  });
</script>

{#if !node}
  <div class="note-pane-loading">Opening...</div>
{:else if node.type === 'split' && firstSplitChild && secondSplitChild}
  {#key `${tabId}:${node.splitId}:${node.direction}`}
    <PaneGroup
      bind:this={paneGroup}
      id={node.splitId}
      class="note-pane-group"
      direction={node.direction}
      keyboardResizeBy={5}
      onLayoutChange={(layout) => noteWorkspaceStore.setSplitSizes(tabId, node.splitId, layout)}
    >
      <Pane id={`${node.splitId}:before`} class="note-pane-cell" defaultSize={firstSplitSize} minSize={16} order={1}>
        <NotePaneNodeComponent
          node={firstSplitChild}
          {tabId}
          {document}
          onSaveStatusChange={forwardSaveStatusChange}
          onCountsChange={forwardCountsChange}
          onError={forwardError}
          onTitleRename={forwardTitleRename}
          {onPaneMoveStart}
          {paneMoveSourceId}
          {paneMoveTargetId}
          {editorStyle}
        />
      </Pane>
      <NotePaneResizer direction={node.direction} onBalance={() => balanceSplit(node.splitId)} />
      <Pane id={`${node.splitId}:after`} class="note-pane-cell" defaultSize={secondSplitSize} minSize={16} order={2}>
        <NotePaneNodeComponent
          node={secondSplitChild}
          {tabId}
          {document}
          onSaveStatusChange={forwardSaveStatusChange}
          onCountsChange={forwardCountsChange}
          onError={forwardError}
          onTitleRename={forwardTitleRename}
          {onPaneMoveStart}
          {paneMoveSourceId}
          {paneMoveTargetId}
          {editorStyle}
        />
      </Pane>
    </PaneGroup>
  {/key}
{:else if node.type === 'split'}
  <div class="note-pane-loading">Opening...</div>
{:else if leafNode}
  {@const active = noteWorkspaceStore.activeTabId === tabId && noteWorkspaceStore.activePaneId === leafNode.paneId}
  {@const state = leafNode.notePath ? paneState(leafNode.notePath) : null}
  {@const paneDocument = leafNode.notePath ? resolvePaneDocument(leafNode.notePath, leafNode.paneId) : null}
  <section
    class="note-pane-leaf"
    class:active
    class:highlighted={noteWorkspaceStore.highlightedPaneId === leafNode.paneId}
    class:drop-active={dropIntent !== null}
    class:pane-moving-source={paneMoveSourceId === leafNode.paneId}
    class:pane-moving-target={paneMoveTargetId === leafNode.paneId && paneMoveSourceId !== leafNode.paneId}
    data-pane-id={leafNode.paneId}
    data-tab-id={tabId}
    data-note-path={leafNode.notePath ?? ''}
    aria-label={leafNode.notePath ?? 'Choose note'}
    ondragenter={handleDragEnter}
    ondragover={handleDragOver}
    ondragleave={handleDragLeave}
    ondrop={(event) => handleDrop(event, leafNode.paneId)}
    onpointerdown={() => focusLeaf(leafNode.paneId, leafNode.notePath)}
    onfocusin={() => focusLeaf(leafNode.paneId, leafNode.notePath)}
  >
    {#if !leafNode.notePath || replacingPaneId === leafNode.paneId}
      <SplitNotePicker
        {tabId}
        paneId={leafNode.paneId}
        onPick={() => { replacingPaneId = null; }}
        onCancel={() => handlePickerCancel(leafNode.paneId)}
      />
    {:else}
      <NotePaneHeader
        {tabId}
        paneId={leafNode.paneId}
        notePath={leafNode.notePath}
        {active}
        dirty={state?.dirty ?? false}
        saving={state?.saving ?? false}
        conflict={state?.conflict ?? false}
        editing={active}
        onOpenNote={() => { replacingPaneId = leafNode.paneId; }}
        onClosePane={() => { void closePane(leafNode.paneId, leafNode.notePath); }}
        {onPaneMoveStart}
      />
      {#if active && state?.conflict}
        <ConflictBanner />
      {/if}
      {#if paneDocument}
        <EditorShell
          document={paneDocument}
          paneId={leafNode.paneId}
          activateOnMount={active}
          onSaveStatusChange={forwardSaveStatusChange}
          onCountsChange={forwardCountsChange}
          onError={forwardError}
          onTitleRename={forwardTitleRename}
          {editorStyle}
        />
      {:else}
        <div class="note-pane-loading">Opening…</div>
      {/if}
      {#if dropIntent}
        <div class="pane-drop-overlay" aria-hidden="true">
          <div class="drop-zone drop-left" class:active={dropIntent === 'left'}>Open left</div>
          <div class="drop-zone drop-right" class:active={dropIntent === 'right'}>Open right</div>
          <div class="drop-zone drop-top" class:active={dropIntent === 'top'}>Open up</div>
          <div class="drop-zone drop-bottom" class:active={dropIntent === 'bottom'}>Open down</div>
          <div class="drop-zone drop-center" class:active={dropIntent === 'replace'}>Replace pane</div>
        </div>
      {/if}
    {/if}
  </section>
{:else}
  <div class="note-pane-loading">Opening...</div>
{/if}

<style>
  :global(.note-pane-group) {
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    background: var(--bg-editor);
  }

  :global(.note-pane-cell) {
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }

  :global(.note-pane-group[data-direction='horizontal'] > .note-pane-cell) {
    min-width: 360px;
  }

  :global(.note-pane-group[data-direction='vertical'] > .note-pane-cell) {
    min-height: 260px;
  }

  .note-pane-leaf {
    position: relative;
    display: flex;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    flex-direction: column;
    overflow: hidden;
    background: var(--bg-editor);
  }

  .note-pane-leaf.active {
    background: var(--surface-base);
  }

  .note-pane-leaf.highlighted {
    box-shadow: inset 0 0 0 2px var(--accent-primary);
  }

  .note-pane-leaf.drop-active {
    outline: 2px solid color-mix(in srgb, var(--accent-primary) 42%, transparent);
    outline-offset: -2px;
  }

  .note-pane-leaf.pane-moving-source {
    opacity: 0.72;
  }

  .note-pane-leaf.pane-moving-target {
    outline: 2px solid color-mix(in srgb, var(--accent-primary) 50%, transparent);
    outline-offset: -2px;
  }

  .note-pane-loading {
    display: flex;
    flex: 1;
    align-items: center;
    justify-content: center;
    color: var(--text-tertiary);
    font-size: var(--text-small);
  }

  .pane-drop-overlay {
    position: absolute;
    inset: 32px 0 0;
    z-index: 60;
    display: grid;
    grid-template:
      "top top top" 1fr
      "left center right" 1.35fr
      "bottom bottom bottom" 1fr / 1fr 1.35fr 1fr;
    gap: 6px;
    padding: 8px;
    background: color-mix(in srgb, var(--bg-editor) 72%, transparent);
    pointer-events: none;
  }

  .drop-zone {
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px dashed color-mix(in srgb, var(--accent-primary) 42%, var(--border-light));
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--bg-card) 82%, transparent);
    color: var(--text-secondary);
    font-size: var(--text-caption);
    font-weight: 650;
    letter-spacing: 0;
  }

  .drop-zone.active {
    border-style: solid;
    border-color: var(--accent-primary);
    background: color-mix(in srgb, var(--accent-primary) 12%, var(--bg-card));
    color: var(--text-primary);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }

  .drop-left { grid-area: left; }
  .drop-right { grid-area: right; }
  .drop-top { grid-area: top; }
  .drop-bottom { grid-area: bottom; }
  .drop-center { grid-area: center; }

  @media (max-width: 879px) {
    :global(.note-pane-group[data-direction]) {
      display: block;
    }

    :global(.note-pane-cell) {
      width: 100% !important;
      height: 100% !important;
      min-width: 0;
      min-height: 0;
    }
  }
</style>
