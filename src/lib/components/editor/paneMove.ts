import type { NotePaneDirection, NotePaneDragPayload, NotePaneMoveIntent } from '$lib/domain';

export interface PaneMovePoint {
  x: number;
  y: number;
}

export interface PaneMoveRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface PaneMoveTarget {
  tabId: string;
  paneId: string;
  notePath: string | null;
  rect: PaneMoveRect;
  layoutRect: PaneMoveRect;
}

export interface PaneMovePreview {
  intent: NotePaneMoveIntent;
  label: string;
  targetRect: PaneMoveRect;
  previewRect: PaneMoveRect;
}

export interface PaneMoveReflowSlot {
  index: number;
  count: number;
  layoutRect: PaneMoveRect;
}

export type PaneMoveReflowSlots = Partial<Record<Exclude<NotePaneMoveIntent, 'swap'>, PaneMoveReflowSlot>>;

export interface PaneMoveSession {
  pointerId: number;
  source: NotePaneDragPayload;
  start: PaneMovePoint;
  pointer: PaneMovePoint;
  active: boolean;
  target: PaneMoveTarget | null;
  preview: PaneMovePreview | null;
}

export function rectFromDOMRect(rect: DOMRect | ClientRect): PaneMoveRect {
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

export function paneMoveLabel(intent: NotePaneMoveIntent): string {
  switch (intent) {
    case 'left':
      return 'Move left';
    case 'right':
      return 'Move right';
    case 'top':
      return 'Move up';
    case 'bottom':
      return 'Move down';
    case 'swap':
      return 'Swap panes';
  }
}

function directionForIntent(intent: Exclude<NotePaneMoveIntent, 'swap'>): NotePaneDirection {
  return intent === 'left' || intent === 'right' ? 'horizontal' : 'vertical';
}

function reflowSlotRect(
  intent: Exclude<NotePaneMoveIntent, 'swap'>,
  slot: PaneMoveReflowSlot,
): PaneMoveRect {
  const count = Math.max(1, slot.count);
  const index = Math.max(0, Math.min(count - 1, slot.index));
  if (directionForIntent(intent) === 'horizontal') {
    const width = slot.layoutRect.width / count;
    return {
      left: slot.layoutRect.left + width * index,
      top: slot.layoutRect.top,
      width,
      height: slot.layoutRect.height,
    };
  }

  const height = slot.layoutRect.height / count;
  return {
    left: slot.layoutRect.left,
    top: slot.layoutRect.top + height * index,
    width: slot.layoutRect.width,
    height,
  };
}

export function resolvePaneMovePreview(
  pointer: PaneMovePoint,
  targetRect: PaneMoveRect,
  reflowSlots: PaneMoveReflowSlots = {},
): PaneMovePreview {
  const x = pointer.x - targetRect.left;
  const y = pointer.y - targetRect.top;
  const leftThird = targetRect.width / 3;
  const rightThird = leftThird * 2;
  const topThird = targetRect.height / 3;
  const bottomThird = topThird * 2;
  const inMiddleColumn = x >= leftThird && x <= rightThird;
  const inMiddleRow = y >= topThird && y <= bottomThird;
  const intent = inMiddleColumn && inMiddleRow
    ? 'swap'
    : nearestPaneMoveEdge(x, y, targetRect);

  let previewRect = targetRect;
  if (intent === 'left') {
    previewRect = reflowSlots.left
      ? reflowSlotRect('left', reflowSlots.left)
      : { ...targetRect, width: targetRect.width / 2 };
  } else if (intent === 'right') {
    previewRect = reflowSlots.right
      ? reflowSlotRect('right', reflowSlots.right)
      : {
          ...targetRect,
          left: targetRect.left + targetRect.width / 2,
          width: targetRect.width / 2,
        };
  } else if (intent === 'top') {
    previewRect = reflowSlots.top
      ? reflowSlotRect('top', reflowSlots.top)
      : { ...targetRect, height: targetRect.height / 2 };
  } else if (intent === 'bottom') {
    previewRect = reflowSlots.bottom
      ? reflowSlotRect('bottom', reflowSlots.bottom)
      : {
          ...targetRect,
          top: targetRect.top + targetRect.height / 2,
          height: targetRect.height / 2,
        };
  }

  return {
    intent,
    label: paneMoveLabel(intent),
    targetRect,
    previewRect,
  };
}

function nearestPaneMoveEdge(
  x: number,
  y: number,
  targetRect: PaneMoveRect,
): Exclude<NotePaneMoveIntent, 'swap'> {
  const distances = [
    ['left', x / targetRect.width],
    ['right', (targetRect.width - x) / targetRect.width],
    ['top', y / targetRect.height],
    ['bottom', (targetRect.height - y) / targetRect.height],
  ] as const;

  return distances.reduce((best, current) => current[1] < best[1] ? current : best)[0];
}
