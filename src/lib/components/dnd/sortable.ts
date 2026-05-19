export type DropPosition = 'before' | 'after';

export type SortableRef = {
  id: string;
  groupId: string;
};

export type SortableDropTarget = SortableRef & {
  position: DropPosition;
};

export type ReorderIntent = {
  sourceId: string;
  targetId: string;
  groupId: string;
  position: DropPosition;
};

export type SortableState = {
  dragging: SortableRef | null;
  dropTarget: SortableDropTarget | null;
  isDragging: boolean;
};

export type SortableListParams = {
  groupId: string;
};

export type SortableItemParams = SortableRef & {
  disabled?: boolean;
  handle?: string;
};

type ActionReturn<T> = {
  update?: (params: T) => void;
  destroy?: () => void;
};

type ItemRegistration = {
  node: HTMLElement;
  ref: SortableItemParams;
};

type ListRegistration = {
  node: HTMLElement;
  groupId: string;
};

type PointerSession = {
  source: SortableRef;
  pointerId: number;
  startX: number;
  startY: number;
  started: boolean;
  node: HTMLElement;
  abort: AbortController;
};

export function createSortableState(): SortableState {
  return {
    dragging: null,
    dropTarget: null,
    isDragging: false,
  };
}

export function dropPositionFromY(
  clientY: number,
  rect: Pick<DOMRect, 'top' | 'height'>
): DropPosition {
  return clientY < rect.top + rect.height / 2 ? 'before' : 'after';
}

export function resolveReorderIntent(
  source: SortableRef | null,
  target: SortableDropTarget | null
): ReorderIntent | null {
  if (!source || !target) return null;
  if (source.groupId !== target.groupId) return null;
  if (source.id === target.id) return null;

  return {
    sourceId: source.id,
    targetId: target.id,
    groupId: source.groupId,
    position: target.position,
  };
}

export function createSortableDnd(options: {
  thresholdPx?: number;
  canDrop?: (source: SortableRef, target: SortableRef) => boolean;
  onCommit: (intent: ReorderIntent) => void | Promise<void>;
  onStateChange?: (state: SortableState) => void;
}) {
  const thresholdPx = options.thresholdPx ?? 4;
  const items = new Map<string, ItemRegistration>();
  const lists = new Map<string, ListRegistration>();
  let state = createSortableState();
  let session: PointerSession | null = null;

  function key(ref: SortableRef): string {
    return `${ref.groupId}\u0000${ref.id}`;
  }

  function snapshot(): SortableState {
    return {
      dragging: state.dragging ? { ...state.dragging } : null,
      dropTarget: state.dropTarget ? { ...state.dropTarget } : null,
      isDragging: state.isDragging,
    };
  }

  function setState(next: SortableState) {
    state = next;
    options.onStateChange?.(snapshot());
  }

  function updateDropTarget(dropTarget: SortableDropTarget | null) {
    setState({
      dragging: state.dragging ? { ...state.dragging } : null,
      dropTarget,
      isDragging: state.isDragging,
    });
  }

  function getOrderedGroupItems(groupId: string, sourceId: string): ItemRegistration[] {
    return [...items.values()]
      .filter((item) => item.ref.groupId === groupId && item.ref.id !== sourceId && item.node.isConnected)
      .sort((a, b) => a.node.getBoundingClientRect().top - b.node.getBoundingClientRect().top);
  }

  function resolveDropTarget(source: SortableRef, clientX: number, clientY: number): SortableDropTarget | null {
    const groupItems = getOrderedGroupItems(source.groupId, source.id);
    if (groupItems.length === 0) return null;

    const list = lists.get(source.groupId);
    if (list?.node.isConnected) {
      const rect = list.node.getBoundingClientRect();
      const withinX = clientX >= rect.left - 24 && clientX <= rect.right + 24;
      const withinY = clientY >= rect.top - 16 && clientY <= rect.bottom + 16;
      if (!withinX || !withinY) return null;
    }

    for (const item of groupItems) {
      const rect = item.node.getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) {
        const target = { id: item.ref.id, groupId: item.ref.groupId };
        if (options.canDrop && !options.canDrop(source, target)) return null;
        return { ...target, position: 'before' };
      }
    }

    const last = groupItems[groupItems.length - 1]!;
    const target = { id: last.ref.id, groupId: last.ref.groupId };
    if (options.canDrop && !options.canDrop(source, target)) return null;
    return { ...target, position: 'after' };
  }

  function beginDrag(activeSession: PointerSession) {
    activeSession.started = true;
    activeSession.node.classList.add('sortable-source-active');
    setState({
      dragging: { ...activeSession.source },
      dropTarget: null,
      isDragging: true,
    });
  }

  function finishSession() {
    if (!session) return;
    session.node.classList.remove('sortable-source-active');
    session.abort.abort();
    session = null;
    setState(createSortableState());
  }

  function cancel() {
    finishSession();
  }

  function onPointerMove(event: PointerEvent) {
    if (!session || event.pointerId !== session.pointerId) return;
    const dx = event.clientX - session.startX;
    const dy = event.clientY - session.startY;
    if (!session.started && Math.hypot(dx, dy) < thresholdPx) return;
    if (!session.started) beginDrag(session);

    event.preventDefault();
    updateDropTarget(resolveDropTarget(session.source, event.clientX, event.clientY));
  }

  function onPointerUp(event: PointerEvent) {
    if (!session || event.pointerId !== session.pointerId) return;
    const intent = resolveReorderIntent(session.source, state.dropTarget);
    const didStart = session.started;
    finishSession();
    if (didStart && intent) {
      void options.onCommit(intent);
    }
  }

  function onPointerCancel(event: PointerEvent) {
    if (!session || event.pointerId !== session.pointerId) return;
    cancel();
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    cancel();
  }

  function targetMatchesHandle(target: EventTarget | null, node: HTMLElement, handle?: string): boolean {
    if (!handle) return target instanceof Node && node.contains(target);
    if (!(target instanceof Element)) return false;
    const handleEl = target.closest(handle);
    return handleEl !== null && node.contains(handleEl);
  }

  function startPointerSession(event: PointerEvent, node: HTMLElement, ref: SortableItemParams) {
    if (ref.disabled || event.button !== 0) return;
    if (!targetMatchesHandle(event.target, node, ref.handle)) return;

    event.preventDefault();
    event.stopPropagation();
    cancel();

    const abort = new AbortController();
    const source = { id: ref.id, groupId: ref.groupId };
    session = {
      source,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      started: false,
      node,
      abort,
    };

    node.setPointerCapture?.(event.pointerId);
    window.addEventListener('pointermove', onPointerMove, { signal: abort.signal });
    window.addEventListener('pointerup', onPointerUp, { signal: abort.signal });
    window.addEventListener('pointercancel', onPointerCancel, { signal: abort.signal });
    window.addEventListener('keydown', onKeyDown, { capture: true, signal: abort.signal });
  }

  function listAction(node: HTMLElement, params: SortableListParams): ActionReturn<SortableListParams> {
    lists.set(params.groupId, { node, groupId: params.groupId });
    return {
      update(next) {
        if (next.groupId !== params.groupId) {
          lists.delete(params.groupId);
        }
        params = next;
        lists.set(params.groupId, { node, groupId: params.groupId });
      },
      destroy() {
        lists.delete(params.groupId);
      },
    };
  }

  function itemAction(node: HTMLElement, params: SortableItemParams): ActionReturn<SortableItemParams> {
    let current = params;
    function register() {
      if (current.disabled) return;
      items.set(key(current), { node, ref: current });
    }
    function unregister() {
      items.delete(key(current));
    }
    function handlePointerDown(event: PointerEvent) {
      startPointerSession(event, node, current);
    }

    register();
    node.addEventListener('pointerdown', handlePointerDown);

    return {
      update(next) {
        unregister();
        current = next;
        register();
      },
      destroy() {
        unregister();
        node.removeEventListener('pointerdown', handlePointerDown);
        if (session?.node === node) cancel();
      },
    };
  }

  return {
    listAction,
    itemAction,
    cancel,
    getState: snapshot,
  };
}
