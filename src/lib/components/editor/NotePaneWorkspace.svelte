<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import type { Document } from '$lib/domain/entities/Document';
  import type { NotePaneDragPayload, NotePaneLeaf } from '$lib/domain';
  import { editorStore, noteWorkspaceStore, notesStore } from '$lib/stores';
  import ConflictBanner from './ConflictBanner.svelte';
  import EditorShell from './EditorShell.svelte';
  import NotePaneNode from './NotePaneNode.svelte';
  import SplitNotePicker from './SplitNotePicker.svelte';
  import {
    rectFromDOMRect,
    resolvePaneMovePreview,
    type PaneMovePoint,
    type PaneMovePreview,
    type PaneMoveRect,
    type PaneMoveSession,
    type PaneMoveTarget,
  } from './paneMove';

  interface Props {
    document: Document | null;
    onSaveStatusChange?: ((status: 'saved' | 'saving' | 'unsaved') => void) | undefined;
    onCountsChange?: ((wordCount: number, charCount: number) => void) | undefined;
    onError?: ((error: string | null) => void) | undefined;
    onTitleRename?: ((newTitle: string, path?: string) => void) | undefined;
    editorStyle?: string;
  }

  let {
    document,
    onSaveStatusChange,
    onCountsChange,
    onError,
    onTitleRename,
    editorStyle = '',
  }: Props = $props();

  let narrowPaneMode = $state(false);
  let paneMoveSession = $state<PaneMoveSession | null>(null);
  let paneMoveHoverTabId: string | null = null;
  let paneMoveTabHoverTimer: ReturnType<typeof setTimeout> | null = null;
  const PANE_MOVE_THRESHOLD = 4;
  const PANE_TAB_HOVER_MS = 450;

  const activeTab = $derived.by(() =>
    noteWorkspaceStore.tabs.find((tab) => tab.id === noteWorkspaceStore.activeTabId) ?? null
  );
  const splitMode = $derived(activeTab?.root.type === 'split');
  const panes = $derived(activeTab ? noteWorkspaceStore.getPanes(activeTab) : []);
  const activePane = $derived(activeTab ? noteWorkspaceStore.getActivePane(activeTab) : null);
  const maximizedPane = $derived.by(() => {
    if (!activeTab || !noteWorkspaceStore.maximizedPaneId) return null;
    return panes.find((pane) => pane.paneId === noteWorkspaceStore.maximizedPaneId) ?? null;
  });
  const visibleLeaf = $derived<NotePaneLeaf | null>(
    narrowPaneMode && splitMode ? activePane : maximizedPane
  );
  const paneMoveSourceId = $derived(paneMoveSession?.active ? paneMoveSession.source.paneId : null);
  const paneMoveTargetId = $derived(paneMoveSession?.preview ? paneMoveSession.target?.paneId ?? null : null);

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

  function basename(path: string): string {
    const last = path.split('/').pop() ?? path;
    return last.replace(/\.md$/i, '');
  }

  function titleForPath(path: string | null): string {
    if (!path) return 'Choose note';
    return notesStore.titleForPath(path, basename(path));
  }

  function switchPane(paneId: string): void {
    if (!activeTab) return;
    const path = noteWorkspaceStore.focusPane(activeTab.id, paneId);
    if (path) notesStore.selectNote(path);
  }

  function rectStyle(rect: PaneMoveRect): string {
    return [
      `left: ${rect.left}px`,
      `top: ${rect.top}px`,
      `width: ${rect.width}px`,
      `height: ${rect.height}px`,
    ].join('; ');
  }

  function labelStyle(point: PaneMovePoint): string {
    const left = Math.min(Math.max(point.x + 12, 8), window.innerWidth - 148);
    const top = Math.min(Math.max(point.y + 14, 8), window.innerHeight - 34);
    return `left: ${left}px; top: ${top}px;`;
  }

  function setPaneMoveHoverTab(tabId: string | null): void {
    if (paneMoveHoverTabId === tabId) return;
    const doc = globalThis.document;
    doc
      .querySelectorAll<HTMLElement>('.workspace-tab[data-pane-move-hover="true"]')
      .forEach((item) => item.removeAttribute('data-pane-move-hover'));
    paneMoveHoverTabId = tabId;
    if (!tabId) return;
    doc
      .querySelector<HTMLElement>(`.workspace-tab[data-tab-id="${CSS.escape(tabId)}"]`)
      ?.setAttribute('data-pane-move-hover', 'true');
  }

  function clearPaneMoveTabHover(): void {
    if (paneMoveTabHoverTimer) {
      clearTimeout(paneMoveTabHoverTimer);
      paneMoveTabHoverTimer = null;
    }
    setPaneMoveHoverTab(null);
  }

  function schedulePaneMoveTabActivation(tabId: string): void {
    if (tabId === noteWorkspaceStore.activeTabId) return;
    if (paneMoveHoverTabId === tabId) return;
    if (paneMoveTabHoverTimer) clearTimeout(paneMoveTabHoverTimer);
    setPaneMoveHoverTab(tabId);
    paneMoveTabHoverTimer = setTimeout(() => {
      const path = noteWorkspaceStore.focusTab(tabId);
      if (path) notesStore.selectNote(path);
      const pointer = paneMoveSession?.pointer;
      if (pointer) {
        requestAnimationFrame(() => updatePaneMoveSession(pointer));
      }
      paneMoveTabHoverTimer = null;
    }, PANE_TAB_HOVER_MS);
  }

  function resolvePaneMoveTarget(point: PaneMovePoint, source: NotePaneDragPayload): PaneMoveTarget | null {
    const element = globalThis.document.elementFromPoint(point.x, point.y);
    if (!(element instanceof HTMLElement)) {
      clearPaneMoveTabHover();
      return null;
    }

    const tabElement = element.closest<HTMLElement>('.workspace-tab[data-tab-id]');
    if (tabElement?.dataset.tabId) {
      schedulePaneMoveTabActivation(tabElement.dataset.tabId);
      return null;
    }

    clearPaneMoveTabHover();
    const paneElement = element.closest<HTMLElement>('.note-pane-leaf[data-pane-id][data-tab-id]');
    if (!paneElement?.dataset.paneId || !paneElement.dataset.tabId) return null;

    const target: PaneMoveTarget = {
      tabId: paneElement.dataset.tabId,
      paneId: paneElement.dataset.paneId,
      notePath: paneElement.dataset.notePath || null,
      rect: rectFromDOMRect(paneElement.getBoundingClientRect()),
    };

    if (target.tabId === source.tabId && target.paneId === source.paneId) return target;
    return target;
  }

  function previewForTarget(
    point: PaneMovePoint,
    source: NotePaneDragPayload,
    target: PaneMoveTarget | null,
  ): PaneMovePreview | null {
    if (!target) return null;
    if (target.tabId === source.tabId && target.paneId === source.paneId) return null;
    if (!target.notePath) return null;
    return resolvePaneMovePreview(point, target.rect);
  }

  function updatePaneMoveSession(point: PaneMovePoint): void {
    const session = paneMoveSession;
    if (!session) return;

    const distance = Math.hypot(point.x - session.start.x, point.y - session.start.y);
    const active = session.active || distance >= PANE_MOVE_THRESHOLD;
    if (!active) {
      paneMoveSession = { ...session, pointer: point };
      return;
    }

    globalThis.document.documentElement.classList.add('pane-moving');
    const target = resolvePaneMoveTarget(point, session.source);
    const preview = previewForTarget(point, session.source, target);
    paneMoveSession = {
      ...session,
      pointer: point,
      active,
      target,
      preview,
    };
  }

  function handlePaneMovePointerMove(event: PointerEvent): void {
    const session = paneMoveSession;
    if (!session || event.pointerId !== session.pointerId) return;
    event.preventDefault();
    updatePaneMoveSession({ x: event.clientX, y: event.clientY });
  }

  function commitPaneMove(): void {
    const session = paneMoveSession;
    if (!session?.active || !session.target || !session.preview) return;
    const result = noteWorkspaceStore.movePane(
      session.source.tabId,
      session.source.paneId,
      session.target.tabId,
      session.target.paneId,
      session.preview.intent,
    );
    if (result.activeTabId && result.activePaneId) {
      const selectedPath = noteWorkspaceStore.focusPane(result.activeTabId, result.activePaneId, {
        preserveMaximized: true,
      }) ?? result.sourceNotePath;
      if (selectedPath) notesStore.selectNote(selectedPath);
      editorStore.focusPane(result.activePaneId);
    }
  }

  function cleanupPaneMove(): void {
    if (typeof window === 'undefined' || typeof globalThis.document === 'undefined') return;
    window.removeEventListener('pointermove', handlePaneMovePointerMove);
    window.removeEventListener('pointerup', handlePaneMovePointerUp);
    window.removeEventListener('pointercancel', handlePaneMovePointerCancel);
    window.removeEventListener('keydown', handlePaneMoveKeydown);
    globalThis.document.documentElement.classList.remove('pane-moving');
    clearPaneMoveTabHover();
    paneMoveSession = null;
  }

  function handlePaneMovePointerUp(event: PointerEvent): void {
    const session = paneMoveSession;
    if (!session || event.pointerId !== session.pointerId) return;
    event.preventDefault();
    commitPaneMove();
    cleanupPaneMove();
  }

  function handlePaneMovePointerCancel(event: PointerEvent): void {
    const session = paneMoveSession;
    if (!session || event.pointerId !== session.pointerId) return;
    cleanupPaneMove();
  }

  function handlePaneMoveKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    cleanupPaneMove();
  }

  function startPaneMove(event: PointerEvent, source: NotePaneDragPayload): void {
    if (narrowPaneMode || !splitMode) return;
    event.preventDefault();
    event.stopPropagation();
    cleanupPaneMove();
    paneMoveSession = {
      pointerId: event.pointerId,
      source,
      start: { x: event.clientX, y: event.clientY },
      pointer: { x: event.clientX, y: event.clientY },
      active: false,
      target: null,
      preview: null,
    };
    window.addEventListener('pointermove', handlePaneMovePointerMove, { passive: false });
    window.addEventListener('pointerup', handlePaneMovePointerUp);
    window.addEventListener('pointercancel', handlePaneMovePointerCancel);
    window.addEventListener('keydown', handlePaneMoveKeydown);
  }

  onMount(() => {
    const query = window.matchMedia('(max-width: 879px)');
    const sync = () => {
      narrowPaneMode = query.matches;
    };
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  });

  onDestroy(() => {
    cleanupPaneMove();
  });
</script>

{#if activeTab}
  <div class="note-pane-workspace" class:split={splitMode} class:narrow={narrowPaneMode}>
    {#if splitMode && narrowPaneMode}
      <div class="pane-switcher" role="tablist" aria-label="Open panes">
        {#each panes as pane (pane.paneId)}
          <button
            type="button"
            class:active={pane.paneId === activeTab.activePaneId}
            role="tab"
            aria-selected={pane.paneId === activeTab.activePaneId}
            onclick={() => switchPane(pane.paneId)}
          >
            {titleForPath(pane.notePath)}
          </button>
        {/each}
      </div>
    {/if}

    {#key `${activeTab.id}:${activeTab.root.type}`}
      {#if activeTab.root.type === 'leaf'}
        <section
          class="note-pane-leaf note-pane-single-target"
          class:pane-moving-target={paneMoveTargetId === activeTab.root.paneId}
          data-pane-id={activeTab.root.paneId}
          data-tab-id={activeTab.id}
          data-note-path={activeTab.root.notePath ?? ''}
          aria-label={activeTab.root.notePath ?? 'Choose note'}
        >
          {#if activeTab.root.notePath}
            {#if document?.path === activeTab.root.notePath}
              <ConflictBanner />
              <EditorShell
                {document}
                onSaveStatusChange={forwardSaveStatusChange}
                onCountsChange={forwardCountsChange}
                onError={forwardError}
                onTitleRename={forwardTitleRename}
                {editorStyle}
              />
            {:else}
              <div class="note-pane-loading">Opening...</div>
            {/if}
          {:else}
            <SplitNotePicker tabId={activeTab.id} paneId={activeTab.root.paneId} />
          {/if}
        </section>
      {:else if visibleLeaf}
        <NotePaneNode
          node={visibleLeaf}
          tabId={activeTab.id}
          {document}
          onSaveStatusChange={forwardSaveStatusChange}
          onCountsChange={forwardCountsChange}
          onError={forwardError}
          onTitleRename={forwardTitleRename}
          onPaneMoveStart={startPaneMove}
          {paneMoveSourceId}
          {paneMoveTargetId}
          {editorStyle}
        />
      {:else}
        <NotePaneNode
          node={activeTab.root}
          tabId={activeTab.id}
          {document}
          onSaveStatusChange={forwardSaveStatusChange}
          onCountsChange={forwardCountsChange}
          onError={forwardError}
          onTitleRename={forwardTitleRename}
          onPaneMoveStart={startPaneMove}
          {paneMoveSourceId}
          {paneMoveTargetId}
          {editorStyle}
        />
      {/if}
    {/key}

    {#if paneMoveSession?.active && paneMoveSession.preview}
      <div class="pane-move-overlay" aria-hidden="true">
        <div class="pane-move-target-frame" style={rectStyle(paneMoveSession.preview.targetRect)}></div>
        <div
          class="pane-move-preview-rect"
          data-intent={paneMoveSession.preview.intent}
          style={rectStyle(paneMoveSession.preview.previewRect)}
        ></div>
        <div class="pane-move-label" style={labelStyle(paneMoveSession.pointer)}>
          {paneMoveSession.preview.label}
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  .note-pane-workspace {
    display: flex;
    flex: 1;
    min-width: 0;
    min-height: 0;
    flex-direction: column;
    overflow: hidden;
    background: var(--bg-editor);
  }

  .note-pane-workspace.split {
    position: relative;
    background: var(--surface-sunken);
  }

  .note-pane-single-target {
    display: flex;
    flex: 1;
    min-width: 0;
    min-height: 0;
    flex-direction: column;
    overflow: hidden;
    background: var(--bg-editor);
  }

  .note-pane-single-target.pane-moving-target {
    outline: 2px solid color-mix(in srgb, var(--accent-primary) 50%, transparent);
    outline-offset: -2px;
  }

  :global(.pane-moving) {
    user-select: none;
    cursor: grabbing;
  }

  .pane-move-overlay {
    position: fixed;
    inset: 0;
    z-index: 90;
    pointer-events: none;
  }

  .pane-move-target-frame,
  .pane-move-preview-rect {
    position: fixed;
    border-radius: var(--radius-sm);
  }

  .pane-move-target-frame {
    border: 1px solid color-mix(in srgb, var(--accent-primary) 48%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent-primary) 18%, transparent);
  }

  .pane-move-preview-rect {
    border: 1px solid var(--accent-primary);
    background: color-mix(in srgb, var(--accent-primary) 22%, transparent);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }

  .pane-move-preview-rect[data-intent='swap'] {
    background: color-mix(in srgb, var(--accent-primary) 12%, transparent);
  }

  .pane-move-label {
    position: fixed;
    max-width: 140px;
    padding: 4px 7px;
    border: 1px solid color-mix(in srgb, var(--accent-primary) 42%, var(--border-light));
    border-radius: var(--radius-sm);
    background: var(--bg-card);
    color: var(--text-primary);
    box-shadow: var(--shadow-popover);
    font-size: var(--text-caption);
    font-weight: 650;
    letter-spacing: 0;
    white-space: nowrap;
  }

  .pane-switcher {
    display: flex;
    align-items: center;
    gap: 4px;
    min-height: 34px;
    padding: 5px 8px;
    overflow-x: auto;
    border-bottom: 1px solid var(--border-light);
    background: var(--surface-sunken);
    scrollbar-width: thin;
  }

  .pane-switcher button {
    min-width: 0;
    max-width: 180px;
    height: 24px;
    padding: 0 9px;
    overflow: hidden;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    font: inherit;
    font-size: var(--text-small);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .pane-switcher button:hover,
  .pane-switcher button:focus-visible,
  .pane-switcher button.active {
    border-color: var(--border-light);
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .note-pane-loading {
    display: flex;
    flex: 1;
    align-items: center;
    justify-content: center;
    color: var(--text-tertiary);
    font-size: var(--text-small);
  }
</style>
