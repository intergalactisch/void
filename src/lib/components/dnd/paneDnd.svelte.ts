/**
 * Unified pane drag-and-drop controller.
 *
 * One pointer-based engine drives every workspace drag — relocating an open pane
 * (kind: 'pane') and opening a note from the sidebar or command palette
 * (kind: 'note'). It owns hit-testing, the drag threshold, spring-loaded tab
 * switching, ESC-to-cancel and cleanup, and exposes reactive state that
 * `PaneDropOverlay.svelte` renders. Pointer events (not HTML5 DnD) are used so
 * drops land reliably even over the ProseMirror editor.
 *
 * Modeled on the sortable controller in `./sortable.ts`.
 */

import type { DragKind } from '$lib/domain';
import type { NotePaneDropIntent, NotePaneMoveIntent } from '$lib/domain';
import { editorStore, noteWorkspaceStore, notesStore } from '$lib/stores';
import {
  rectFromDOMRect,
  resolvePaneDropPreview,
  type PaneDropPreview,
  type PanePoint,
  type PaneRect,
} from '$lib/components/editor/paneMove';

const THRESHOLD_PX = 4;
const TAB_HOVER_MS = 450;
const DRAGGING_CLASS = 'pane-dragging';

function basename(path: string): string {
  const last = path.split('/').pop() ?? path;
  return last.replace(/\.md$/i, '');
}

export interface PaneDragSource {
  kind: DragKind;
  notePath: string | null;
  title: string | null;
  /** Set only for kind === 'pane'. */
  tabId: string | null;
  paneId: string | null;
  /** Fires once the drag crosses the threshold (e.g. close the command palette). */
  onBegin?: (() => void) | undefined;
}

export interface PaneDragTarget {
  tabId: string;
  paneId: string;
  notePath: string | null;
  rect: PaneRect;
  /** True when dropping onto an "open in a new tab" zone (empty workspace or the tab bar). */
  empty?: boolean;
  /** Optional label for the empty-drop preview (defaults to "Open note"). */
  emptyLabel?: string | undefined;
}

interface PointerSession {
  pointerId: number;
  source: PaneDragSource;
  startX: number;
  startY: number;
  started: boolean;
  abort: AbortController;
}

class PaneDragController {
  /** True once the pointer has moved past the threshold and a drag is live. */
  active = $state(false);
  source = $state<PaneDragSource | null>(null);
  pointer = $state<PanePoint>({ x: 0, y: 0 });
  target = $state<PaneDragTarget | null>(null);
  preview = $state<PaneDropPreview | null>(null);
  /** Center drop of a pane → the two panes swap (overlay highlights both). */
  swap = $state(false);
  /** Note being dragged is already open elsewhere → the drop will focus it instead. */
  alreadyOpen = $state(false);
  /** Polite live-region message announcing the last drop outcome (screen readers). */
  announcement = $state('');

  #session: PointerSession | null = null;
  #tabHoverId: string | null = null;
  #tabHoverTimer: ReturnType<typeof setTimeout> | null = null;

  get sourcePaneId(): string | null {
    return this.source?.kind === 'pane' ? this.source.paneId : null;
  }

  start(event: PointerEvent, source: PaneDragSource): void {
    if (event.button !== 0) return;
    this.#teardown();

    const abort = new AbortController();
    this.#session = {
      pointerId: event.pointerId,
      source,
      startX: event.clientX,
      startY: event.clientY,
      started: false,
      abort,
    };

    window.addEventListener('pointermove', this.#onPointerMove, { passive: false, signal: abort.signal });
    window.addEventListener('pointerup', this.#onPointerUp, { signal: abort.signal });
    window.addEventListener('pointercancel', this.#onPointerCancel, { signal: abort.signal });
    window.addEventListener('keydown', this.#onKeyDown, { capture: true, signal: abort.signal });
  }

  cancel(): void {
    this.#teardown();
  }

  #onPointerMove = (event: PointerEvent): void => {
    const session = this.#session;
    if (!session || event.pointerId !== session.pointerId) return;
    const point: PanePoint = { x: event.clientX, y: event.clientY };

    if (!session.started) {
      if (Math.hypot(point.x - session.startX, point.y - session.startY) < THRESHOLD_PX) return;
      session.started = true;
      this.active = true;
      this.source = session.source;
      document.documentElement.classList.add(DRAGGING_CLASS);
      session.source.onBegin?.();
    }

    event.preventDefault();
    this.#updateTarget(point, session.source);
  };

  #onPointerUp = (event: PointerEvent): void => {
    const session = this.#session;
    if (!session || event.pointerId !== session.pointerId) return;
    const { started, source } = session;
    const target = this.target;
    const preview = this.preview;
    this.#teardown();
    if (started) this.#suppressNextClick();
    if (started && target && preview) this.#commit(source, target, preview);
  };

  #onPointerCancel = (event: PointerEvent): void => {
    const session = this.#session;
    if (!session || event.pointerId !== session.pointerId) return;
    this.#teardown();
  };

  #onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    this.#teardown();
  };

  #updateTarget(point: PanePoint, source: PaneDragSource): void {
    this.pointer = point;
    const target = this.#resolveTarget(point, source);
    if (!target) {
      this.target = null;
      this.preview = null;
      this.swap = false;
      this.alreadyOpen = false;
      return;
    }

    if (target.empty) {
      this.target = target;
      this.preview = {
        placement: 'center',
        label: target.emptyLabel ?? 'Open note',
        targetRect: target.rect,
        previewRect: target.rect,
        survivorRect: null,
      };
      this.swap = false;
      this.alreadyOpen = false;
      return;
    }

    const alreadyOpen =
      source.kind === 'note' && !!source.notePath && !!noteWorkspaceStore.findOpenNote(source.notePath);
    const preview = resolvePaneDropPreview(point, target.rect, { kind: source.kind, alreadyOpen });
    this.target = target;
    this.preview = preview;
    this.alreadyOpen = alreadyOpen;
    this.swap = source.kind === 'pane' && preview.placement === 'center';
  }

  #resolveTarget(point: PanePoint, source: PaneDragSource): PaneDragTarget | null {
    const element = document.elementFromPoint(point.x, point.y);
    if (!(element instanceof HTMLElement)) {
      this.#clearTabHover();
      return null;
    }

    const tabElement = element.closest<HTMLElement>('.workspace-tab[data-tab-id]');
    if (tabElement?.dataset.tabId) {
      this.#scheduleTabActivation(tabElement.dataset.tabId, point);
      return null;
    }
    this.#clearTabHover();

    const paneElement = element.closest<HTMLElement>('.note-pane-leaf[data-pane-id][data-tab-id]');
    if (!paneElement?.dataset.paneId || !paneElement.dataset.tabId) {
      // Empty workspace (no tabs): a note can be dropped to open it in a fresh tab.
      if (source.kind === 'note') {
        const emptyElement = element.closest<HTMLElement>('[data-empty-drop="true"]');
        if (emptyElement) {
          return {
            tabId: '',
            paneId: '',
            notePath: null,
            rect: rectFromDOMRect(emptyElement.getBoundingClientRect()),
            empty: true,
            emptyLabel: emptyElement.dataset.emptyDropLabel,
          };
        }
      }
      return null;
    }

    // A pane cannot be dropped onto itself.
    if (
      source.kind === 'pane' &&
      source.tabId === paneElement.dataset.tabId &&
      source.paneId === paneElement.dataset.paneId
    ) {
      return null;
    }

    return {
      tabId: paneElement.dataset.tabId,
      paneId: paneElement.dataset.paneId,
      notePath: paneElement.dataset.notePath || null,
      rect: rectFromDOMRect(paneElement.getBoundingClientRect()),
    };
  }

  #scheduleTabActivation(tabId: string, point: PanePoint): void {
    if (tabId === noteWorkspaceStore.activeTabId) {
      this.#setTabHoverAttr(tabId);
      return;
    }
    if (this.#tabHoverId === tabId) return;
    if (this.#tabHoverTimer) clearTimeout(this.#tabHoverTimer);
    this.#setTabHoverAttr(tabId);
    this.#tabHoverTimer = setTimeout(() => {
      const path = noteWorkspaceStore.focusTab(tabId);
      if (path) notesStore.selectNote(path);
      this.#tabHoverTimer = null;
      const session = this.#session;
      if (session) requestAnimationFrame(() => this.#updateTarget(point, session.source));
    }, TAB_HOVER_MS);
  }

  #setTabHoverAttr(tabId: string | null): void {
    if (this.#tabHoverId === tabId) return;
    if (typeof document === 'undefined') return;
    document
      .querySelectorAll<HTMLElement>('.workspace-tab[data-pane-drag-hover="true"]')
      .forEach((node) => node.removeAttribute('data-pane-drag-hover'));
    this.#tabHoverId = tabId;
    if (!tabId) return;
    document
      .querySelector<HTMLElement>(`.workspace-tab[data-tab-id="${CSS.escape(tabId)}"]`)
      ?.setAttribute('data-pane-drag-hover', 'true');
  }

  #clearTabHover(): void {
    if (this.#tabHoverTimer) {
      clearTimeout(this.#tabHoverTimer);
      this.#tabHoverTimer = null;
    }
    this.#setTabHoverAttr(null);
  }

  #commit(source: PaneDragSource, target: PaneDragTarget, preview: PaneDropPreview): void {
    if (target.empty) {
      if (source.notePath) {
        noteWorkspaceStore.openNoteTab(source.notePath);
        notesStore.selectNote(source.notePath);
        this.announcement = `Opened ${source.title ?? basename(source.notePath)} in a new tab`;
      }
      return;
    }

    if (source.kind === 'pane') {
      if (!source.tabId || !source.paneId) return;
      const intent: NotePaneMoveIntent = preview.placement === 'center' ? 'swap' : preview.placement;
      const result = noteWorkspaceStore.movePane(source.tabId, source.paneId, target.tabId, target.paneId, intent);
      if (result.action === 'ignored') return;
      if (result.activeTabId && result.activePaneId) {
        const path =
          noteWorkspaceStore.focusPane(result.activeTabId, result.activePaneId, { preserveMaximized: true }) ??
          result.sourceNotePath;
        if (path) notesStore.selectNote(path);
        editorStore.focusPane(result.activePaneId);
      }
      this.announcement = intent === 'swap' ? 'Swapped panes' : `Moved pane ${intent}`;
      return;
    }

    if (!source.notePath) return;
    const title = source.title ?? basename(source.notePath);
    const intent: NotePaneDropIntent = preview.placement === 'center' ? 'replace' : preview.placement;
    const result = noteWorkspaceStore.dropNoteOnPane(target.tabId, target.paneId, source.notePath, intent);
    if (result.notePath) {
      notesStore.selectNote(result.notePath);
      if (result.paneId) editorStore.focusPane(result.paneId);
    }
    if (result.action === 'focused-existing') this.announcement = `${title} already open — focused`;
    else if (result.action === 'replaced') this.announcement = `Opened ${title}`;
    else if (result.action === 'split') this.announcement = `Opened ${title} ${intent}`;
  }

  /** Swallow the click the browser emits after a drag so a dragged note doesn't also open in the active pane. */
  #suppressNextClick(): void {
    if (typeof window === 'undefined') return;
    const handler = (event: MouseEvent) => {
      event.stopPropagation();
      event.preventDefault();
      window.removeEventListener('click', handler, true);
    };
    window.addEventListener('click', handler, true);
    setTimeout(() => window.removeEventListener('click', handler, true), 250);
  }

  #teardown(): void {
    this.#session?.abort.abort();
    this.#session = null;
    this.#clearTabHover();
    this.active = false;
    this.source = null;
    this.target = null;
    this.preview = null;
    this.swap = false;
    this.alreadyOpen = false;
    if (typeof document !== 'undefined') {
      document.documentElement.classList.remove(DRAGGING_CLASS);
    }
  }
}

export const paneDrag = new PaneDragController();

// ─── Svelte actions ───────────────────────────────────────────────────────

export interface PaneSourceParams {
  tabId: string;
  paneId: string;
  notePath: string | null;
  /** When set, pointerdowns starting inside a matching element are ignored (e.g. control buttons). */
  ignore?: string;
  disabled?: boolean;
}

/** Drag handle for relocating an open pane (used on the pane header). */
export function paneSource(node: HTMLElement, params: PaneSourceParams) {
  let current = params;

  function onPointerDown(event: PointerEvent): void {
    if (current.disabled || event.button !== 0) return;
    // Alt-drag is reserved for exporting a note link via native HTML5 drag.
    if (event.altKey) return;
    const target = event.target;
    if (target instanceof Element && current.ignore && target.closest(current.ignore)) return;

    const path = noteWorkspaceStore.focusPane(current.tabId, current.paneId);
    if (path) notesStore.selectNote(path);
    paneDrag.start(event, {
      kind: 'pane',
      tabId: current.tabId,
      paneId: current.paneId,
      notePath: current.notePath,
      title: null,
    });
  }

  node.addEventListener('pointerdown', onPointerDown);
  return {
    update(next: PaneSourceParams) {
      current = next;
    },
    destroy() {
      node.removeEventListener('pointerdown', onPointerDown);
      if (paneDrag.sourcePaneId === current.paneId) paneDrag.cancel();
    },
  };
}

export interface NoteSourceParams {
  notePath: string;
  title: string;
  disabled?: boolean;
  /** Called once the drag crosses the threshold — e.g. close the command palette. */
  onBegin?: () => void;
}

/** Drag handle for opening a note into a pane (sidebar rows, command-palette results). */
export function noteSource(node: HTMLElement, params: NoteSourceParams) {
  let current = params;

  function onPointerDown(event: PointerEvent): void {
    if (current.disabled || event.button !== 0) return;
    paneDrag.start(event, {
      kind: 'note',
      notePath: current.notePath,
      title: current.title,
      tabId: null,
      paneId: null,
      onBegin: current.onBegin,
    });
  }

  node.addEventListener('pointerdown', onPointerDown);
  return {
    update(next: NoteSourceParams) {
      current = next;
    },
    destroy() {
      node.removeEventListener('pointerdown', onPointerDown);
    },
  };
}
