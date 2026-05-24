<script lang="ts">
  import { Pane, PaneGroup } from 'paneforge';
  import type { Document } from '$lib/domain/entities/Document';
  import type {
    NotePaneDragPayload,
    NotePaneDropIntent,
    NotePaneMoveIntent,
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
    node: NotePaneNodeValue;
    tabId: string;
    document: Document | null;
    onSaveStatusChange?: ((status: 'saved' | 'saving' | 'unsaved') => void) | undefined;
    onCountsChange?: ((wordCount: number, charCount: number) => void) | undefined;
    onError?: ((error: string | null) => void) | undefined;
    onTitleRename?: ((newTitle: string) => void) | undefined;
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
    editorStyle = '',
  }: Props = $props();

  let paneGroup: { setLayout?: (layout: number[]) => void } | null = $state(null);
  let replacingPaneId = $state<string | null>(null);
  let leafDocument = $state<Document | null>(null);
  let loadedLeafPath = $state<string | null>(null);
  let dropIntent = $state<NotePaneDropIntent | NotePaneMoveIntent | null>(null);
  let dropMode = $state<'note' | 'pane' | null>(null);
  let dragDepth = 0;

  function forwardSaveStatusChange(status: 'saved' | 'saving' | 'unsaved'): void {
    onSaveStatusChange?.(status);
  }

  function forwardCountsChange(wordCount: number, charCount: number): void {
    onCountsChange?.(wordCount, charCount);
  }

  function forwardError(error: string | null): void {
    onError?.(error);
  }

  function forwardTitleRename(newTitle: string): void {
    onTitleRename?.(newTitle);
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
    const pane = node.type === 'leaf' ? editorStore.getPaneState(node.paneId) : null;
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

  function hasPaneDrag(event: DragEvent): boolean {
    const types = event.dataTransfer?.types;
    if (!types) return false;
    return Array.from(types).includes('application/x-void-pane');
  }

  function dragModeForEvent(event: DragEvent): 'note' | 'pane' | null {
    if (hasPaneDrag(event)) return 'pane';
    if (hasNoteDrag(event)) return 'note';
    return null;
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

  function readDraggedPane(event: DragEvent): NotePaneDragPayload | null {
    const raw = event.dataTransfer?.getData('application/x-void-pane');
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as Partial<NotePaneDragPayload>;
      if (typeof parsed.tabId !== 'string' || typeof parsed.paneId !== 'string') return null;
      return {
        tabId: parsed.tabId,
        paneId: parsed.paneId,
        notePath: typeof parsed.notePath === 'string' ? parsed.notePath : null,
      };
    } catch {
      return null;
    }
  }

  function isKnownNotePath(path: string): boolean {
    return notesStore.allNotes.some((note) => !note.isFolder && note.path === path);
  }

  function resolveEdgeIntent(event: DragEvent, element: HTMLElement): 'left' | 'right' | 'top' | 'bottom' | null {
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
    return nearest[1] <= threshold ? nearest[0] : null;
  }

  function resolveDropIntent(
    event: DragEvent,
    element: HTMLElement,
    mode: 'note' | 'pane',
  ): NotePaneDropIntent | NotePaneMoveIntent {
    const edge = resolveEdgeIntent(event, element);
    if (edge) return edge;
    return mode === 'pane' ? 'swap' : 'replace';
  }

  function handleDragEnter(event: DragEvent): void {
    const mode = dragModeForEvent(event);
    if (!mode) return;
    dragDepth += 1;
    dropMode = mode;
    event.preventDefault();
  }

  function handleDragOver(event: DragEvent): void {
    const mode = dragModeForEvent(event);
    if (!mode) return;
    event.preventDefault();
    dropMode = mode;
    event.dataTransfer!.dropEffect = mode === 'pane' ? 'move' : 'copy';
    dropIntent = resolveDropIntent(event, event.currentTarget as HTMLElement, mode);
  }

  function handleDragLeave(event: DragEvent): void {
    if (!dragModeForEvent(event)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) {
      dropIntent = null;
      dropMode = null;
    }
  }

  function handleDrop(event: DragEvent, paneId: string): void {
    const mode = dropMode ?? dragModeForEvent(event);
    if (!mode) return;
    event.preventDefault();
    dragDepth = 0;
    const intent = dropIntent ?? (mode === 'pane' ? 'swap' : 'replace');
    dropIntent = null;
    dropMode = null;

    if (mode === 'pane') {
      const payload = readDraggedPane(event);
      if (!payload) return;
      const result = noteWorkspaceStore.movePane(
        payload.tabId,
        payload.paneId,
        tabId,
        paneId,
        intent as NotePaneMoveIntent,
      );
      if (result.activeTabId && result.activePaneId) {
        const selectedPath = noteWorkspaceStore.focusPane(result.activeTabId, result.activePaneId, {
          preserveMaximized: true,
        }) ?? result.sourceNotePath;
        if (selectedPath) notesStore.selectNote(selectedPath);
        editorStore.focusPane(result.activePaneId);
      }
      return;
    }

    const notePath = readDraggedNotePath(event);
    if (!notePath || !isKnownNotePath(notePath)) return;
    const result = noteWorkspaceStore.dropNoteOnPane(tabId, paneId, notePath, intent as NotePaneDropIntent);
    if (result.notePath) {
      notesStore.selectNote(result.notePath);
    }
  }

  $effect(() => {
    if (node.type !== 'leaf' || !node.notePath) {
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

{#if node.type === 'split'}
  <PaneGroup
    bind:this={paneGroup}
    class="note-pane-group"
    direction={node.direction}
    keyboardResizeBy={5}
    onLayoutChange={(layout) => noteWorkspaceStore.setSplitSizes(tabId, node.splitId, layout)}
  >
    <Pane class="note-pane-cell" defaultSize={node.sizes[0]} minSize={16} order={1}>
      <NotePaneNodeComponent
        node={node.children[0]}
        {tabId}
        {document}
        onSaveStatusChange={forwardSaveStatusChange}
        onCountsChange={forwardCountsChange}
        onError={forwardError}
        onTitleRename={forwardTitleRename}
        {editorStyle}
      />
    </Pane>
    <NotePaneResizer direction={node.direction} onBalance={() => balanceSplit(node.splitId)} />
    <Pane class="note-pane-cell" defaultSize={node.sizes[1]} minSize={16} order={2}>
      <NotePaneNodeComponent
        node={node.children[1]}
        {tabId}
        {document}
        onSaveStatusChange={forwardSaveStatusChange}
        onCountsChange={forwardCountsChange}
        onError={forwardError}
        onTitleRename={forwardTitleRename}
        {editorStyle}
      />
    </Pane>
  </PaneGroup>
{:else}
  {@const active = noteWorkspaceStore.activeTabId === tabId && noteWorkspaceStore.activePaneId === node.paneId}
  {@const state = node.notePath ? paneState(node.notePath) : null}
  {@const paneDocument = node.notePath ? resolvePaneDocument(node.notePath, node.paneId) : null}
  <section
    class="note-pane-leaf"
    class:active
    class:highlighted={noteWorkspaceStore.highlightedPaneId === node.paneId}
    class:drop-active={dropIntent !== null}
    class:pane-move-drop={dropMode === 'pane'}
    data-pane-id={node.paneId}
    data-tab-id={tabId}
    data-note-path={node.notePath ?? ''}
    aria-label={node.notePath ?? 'Choose note'}
    ondragenter={handleDragEnter}
    ondragover={handleDragOver}
    ondragleave={handleDragLeave}
    ondrop={(event) => handleDrop(event, node.paneId)}
    onpointerdown={() => focusLeaf(node.paneId, node.notePath)}
    onfocusin={() => focusLeaf(node.paneId, node.notePath)}
  >
    {#if !node.notePath || replacingPaneId === node.paneId}
      <SplitNotePicker
        {tabId}
        paneId={node.paneId}
        onPick={() => { replacingPaneId = null; }}
        onCancel={() => handlePickerCancel(node.paneId)}
      />
    {:else}
      <NotePaneHeader
        {tabId}
        paneId={node.paneId}
        notePath={node.notePath}
        {active}
        dirty={state?.dirty ?? false}
        saving={state?.saving ?? false}
        conflict={state?.conflict ?? false}
        editing={active}
        onOpenNote={() => { replacingPaneId = node.paneId; }}
        onClosePane={() => { void closePane(node.paneId, node.notePath); }}
      />
      {#if active && state?.conflict}
        <ConflictBanner />
      {/if}
      {#if paneDocument}
        <EditorShell
          document={paneDocument}
          paneId={node.paneId}
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
          <div class="drop-zone drop-left" class:active={dropIntent === 'left'}>{dropMode === 'pane' ? 'Move left' : 'Open left'}</div>
          <div class="drop-zone drop-right" class:active={dropIntent === 'right'}>{dropMode === 'pane' ? 'Move right' : 'Open right'}</div>
          <div class="drop-zone drop-top" class:active={dropIntent === 'top'}>{dropMode === 'pane' ? 'Move up' : 'Open up'}</div>
          <div class="drop-zone drop-bottom" class:active={dropIntent === 'bottom'}>{dropMode === 'pane' ? 'Move down' : 'Open down'}</div>
          <div class="drop-zone drop-center" class:active={dropIntent === 'replace' || dropIntent === 'swap'}>{dropMode === 'pane' ? 'Swap panes' : 'Replace pane'}</div>
        </div>
      {/if}
    {/if}
  </section>
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

  .note-pane-leaf.pane-move-drop {
    outline-color: color-mix(in srgb, var(--accent-primary) 64%, transparent);
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
