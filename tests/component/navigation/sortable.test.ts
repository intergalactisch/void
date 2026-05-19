import { describe, expect, it, vi } from 'vitest';
import {
  createSortableDnd,
  dropPositionFromY,
  resolveReorderIntent,
  type ReorderIntent,
  type SortableState,
} from '$lib/components/dnd/sortable';

function pointerEvent(type: string, init: {
  pointerId?: number;
  clientX?: number;
  clientY?: number;
  button?: number;
} = {}): PointerEvent {
  const event = new Event(type, { bubbles: true, cancelable: true }) as PointerEvent;
  Object.defineProperties(event, {
    pointerId: { value: init.pointerId ?? 1 },
    clientX: { value: init.clientX ?? 0 },
    clientY: { value: init.clientY ?? 0 },
    button: { value: init.button ?? 0 },
  });
  return event;
}

function keyEvent(type: string, key: string): KeyboardEvent {
  const event = new Event(type, { bubbles: true, cancelable: true }) as KeyboardEvent;
  Object.defineProperty(event, 'key', { value: key });
  return event;
}

function stubRect(element: HTMLElement, rect: Partial<DOMRect>) {
  element.getBoundingClientRect = vi.fn(() => ({
    x: rect.left ?? 0,
    y: rect.top ?? 0,
    top: rect.top ?? 0,
    left: rect.left ?? 0,
    right: rect.right ?? ((rect.left ?? 0) + (rect.width ?? 100)),
    bottom: rect.bottom ?? ((rect.top ?? 0) + (rect.height ?? 20)),
    width: rect.width ?? 100,
    height: rect.height ?? 20,
    toJSON: () => ({}),
  }));
}

function makeItem(label: string) {
  const item = document.createElement('div');
  const handle = document.createElement('button');
  handle.dataset.folderDragHandle = '';
  handle.textContent = label;
  item.appendChild(handle);
  return { item, handle };
}

function setupSortable() {
  const commits: ReorderIntent[] = [];
  let state: SortableState | null = null;
  const sortable = createSortableDnd({
    onCommit: (intent) => {
      commits.push(intent);
    },
    onStateChange: (next) => {
      state = next;
    },
  });

  const list = document.createElement('div');
  const alpha = makeItem('Alpha');
  const zeta = makeItem('Zeta');
  document.body.appendChild(list);
  list.append(alpha.item, zeta.item);

  stubRect(list, { top: 0, left: 0, right: 220, bottom: 70, width: 220, height: 70 });
  stubRect(alpha.item, { top: 0, left: 0, right: 220, bottom: 24, width: 220, height: 24 });
  stubRect(zeta.item, { top: 24, left: 0, right: 220, bottom: 48, width: 220, height: 24 });

  const listAction = sortable.listAction(list, { groupId: 'Research/topic' });
  const alphaAction = sortable.itemAction(alpha.item, {
    id: 'Research/topic/Alpha',
    groupId: 'Research/topic',
    handle: '[data-folder-drag-handle]',
  });
  const zetaAction = sortable.itemAction(zeta.item, {
    id: 'Research/topic/Zeta',
    groupId: 'Research/topic',
    handle: '[data-folder-drag-handle]',
  });

  return {
    sortable,
    commits,
    get state() {
      return state;
    },
    listAction,
    alphaAction,
    zetaAction,
    alpha,
    zeta,
    destroy() {
      alphaAction.destroy?.();
      zetaAction.destroy?.();
      listAction.destroy?.();
      list.remove();
    },
  };
}

describe('sortable dnd primitive', () => {
  it('resolves before and after positions from a row midpoint', () => {
    const rect = { top: 20, height: 32 };

    expect(dropPositionFromY(28, rect)).toBe('before');
    expect(dropPositionFromY(44, rect)).toBe('after');
  });

  it('rejects self-drops and cross-group drops', () => {
    expect(resolveReorderIntent(
      { id: 'A', groupId: 'root' },
      { id: 'A', groupId: 'root', position: 'after' }
    )).toBeNull();
    expect(resolveReorderIntent(
      { id: 'A', groupId: 'root' },
      { id: 'B', groupId: 'other', position: 'before' }
    )).toBeNull();
  });

  it('starts dragging only after the pointer threshold', () => {
    const ctx = setupSortable();

    ctx.alpha.handle.dispatchEvent(pointerEvent('pointerdown', { clientX: 5, clientY: 5 }));
    window.dispatchEvent(pointerEvent('pointermove', { clientX: 6, clientY: 6 }));

    expect(ctx.state?.isDragging ?? false).toBe(false);

    window.dispatchEvent(pointerEvent('pointermove', { clientX: 5, clientY: 16 }));

    expect(ctx.state?.isDragging).toBe(true);
    expect(ctx.state?.dragging?.id).toBe('Research/topic/Alpha');

    ctx.destroy();
  });

  it('commits a sibling reorder before the hovered target', () => {
    const ctx = setupSortable();

    ctx.zeta.handle.dispatchEvent(pointerEvent('pointerdown', { clientX: 8, clientY: 36 }));
    window.dispatchEvent(pointerEvent('pointermove', { clientX: 8, clientY: 4 }));
    window.dispatchEvent(pointerEvent('pointerup', { clientX: 8, clientY: 4 }));

    expect(ctx.commits).toEqual([
      {
        sourceId: 'Research/topic/Zeta',
        targetId: 'Research/topic/Alpha',
        groupId: 'Research/topic',
        position: 'before',
      },
    ]);

    ctx.destroy();
  });

  it('uses the trailing list area as an after-last drop target', () => {
    const ctx = setupSortable();

    ctx.alpha.handle.dispatchEvent(pointerEvent('pointerdown', { clientX: 8, clientY: 8 }));
    window.dispatchEvent(pointerEvent('pointermove', { clientX: 8, clientY: 64 }));
    window.dispatchEvent(pointerEvent('pointerup', { clientX: 8, clientY: 64 }));

    expect(ctx.commits).toEqual([
      {
        sourceId: 'Research/topic/Alpha',
        targetId: 'Research/topic/Zeta',
        groupId: 'Research/topic',
        position: 'after',
      },
    ]);

    ctx.destroy();
  });

  it('cancels active drags with Escape', () => {
    const ctx = setupSortable();

    ctx.alpha.handle.dispatchEvent(pointerEvent('pointerdown', { clientX: 8, clientY: 8 }));
    window.dispatchEvent(pointerEvent('pointermove', { clientX: 8, clientY: 40 }));
    window.dispatchEvent(keyEvent('keydown', 'Escape'));
    window.dispatchEvent(pointerEvent('pointerup', { clientX: 8, clientY: 40 }));

    expect(ctx.commits).toEqual([]);
    expect(ctx.state?.isDragging).toBe(false);

    ctx.destroy();
  });
});
