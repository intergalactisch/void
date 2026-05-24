import type { NotePaneDragPayload, NotePaneMoveIntent } from '$lib/domain';

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
}

export interface PaneMovePreview {
  intent: NotePaneMoveIntent;
  label: string;
  targetRect: PaneMoveRect;
  previewRect: PaneMoveRect;
}

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

export function resolvePaneMovePreview(
  pointer: PaneMovePoint,
  targetRect: PaneMoveRect,
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
    previewRect = { ...targetRect, width: targetRect.width / 2 };
  } else if (intent === 'right') {
    previewRect = {
      ...targetRect,
      left: targetRect.left + targetRect.width / 2,
      width: targetRect.width / 2,
    };
  } else if (intent === 'top') {
    previewRect = { ...targetRect, height: targetRect.height / 2 };
  } else if (intent === 'bottom') {
    previewRect = {
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
