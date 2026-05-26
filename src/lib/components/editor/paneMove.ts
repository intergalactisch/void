import type { DragKind, DropPlacement } from '$lib/domain';

export interface PanePoint {
  x: number;
  y: number;
}

export interface PaneRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface PaneDropPreview {
  /** Geometric zone the pointer resolved to. */
  placement: DropPlacement;
  /** Human label shown near the cursor (e.g. "Open right", "Swap"). */
  label: string;
  /** The full target pane rect (drawn as a frame). */
  targetRect: PaneRect;
  /** The half where the dragged content lands — or the full rect for a center drop. */
  previewRect: PaneRect;
  /** The half that keeps the target's current note (empty for a center drop). */
  survivorRect: PaneRect | null;
}

/** Fraction of a pane's width/height that counts as an edge zone; the inner box is "center". */
const EDGE_RATIO = 0.28;

export function rectFromDOMRect(rect: DOMRect | { left: number; top: number; width: number; height: number }): PaneRect {
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

export function placementLabel(placement: DropPlacement, kind: DragKind, alreadyOpen: boolean): string {
  if (alreadyOpen) return 'Already open';
  if (placement === 'center') return kind === 'pane' ? 'Swap' : 'Replace';
  const verb = kind === 'pane' ? 'Move' : 'Open';
  switch (placement) {
    case 'left':
      return `${verb} left`;
    case 'right':
      return `${verb} right`;
    case 'top':
      return `${verb} up`;
    case 'bottom':
      return `${verb} down`;
  }
}

function halfRect(placement: Exclude<DropPlacement, 'center'>, rect: PaneRect, insertion: boolean): PaneRect {
  // `insertion` picks the side where the dragged content lands; `!insertion` is the surviving half.
  const onStart = placement === 'left' || placement === 'top';
  const takeStart = insertion ? onStart : !onStart;
  switch (placement) {
    case 'left':
    case 'right':
      return {
        left: takeStart ? rect.left : rect.left + rect.width / 2,
        top: rect.top,
        width: rect.width / 2,
        height: rect.height,
      };
    case 'top':
    case 'bottom':
      return {
        left: rect.left,
        top: takeStart ? rect.top : rect.top + rect.height / 2,
        width: rect.width,
        height: rect.height / 2,
      };
  }
}

export function resolveDropPlacement(point: PanePoint, rect: PaneRect): DropPlacement {
  const nx = clamp01((point.x - rect.left) / Math.max(1, rect.width));
  const ny = clamp01((point.y - rect.top) / Math.max(1, rect.height));
  const inCenterX = nx >= EDGE_RATIO && nx <= 1 - EDGE_RATIO;
  const inCenterY = ny >= EDGE_RATIO && ny <= 1 - EDGE_RATIO;
  if (inCenterX && inCenterY) return 'center';

  const distances: ReadonlyArray<readonly [Exclude<DropPlacement, 'center'>, number]> = [
    ['left', nx],
    ['right', 1 - nx],
    ['top', ny],
    ['bottom', 1 - ny],
  ];
  return distances.reduce((best, current) => (current[1] < best[1] ? current : best))[0];
}

export function resolvePaneDropPreview(
  point: PanePoint,
  rect: PaneRect,
  options: { kind: DragKind; alreadyOpen?: boolean },
): PaneDropPreview {
  const placement = resolveDropPlacement(point, rect);
  const alreadyOpen = options.alreadyOpen ?? false;
  if (placement === 'center') {
    return {
      placement,
      label: placementLabel(placement, options.kind, alreadyOpen),
      targetRect: rect,
      previewRect: rect,
      survivorRect: null,
    };
  }
  return {
    placement,
    label: placementLabel(placement, options.kind, alreadyOpen),
    targetRect: rect,
    previewRect: halfRect(placement, rect, true),
    survivorRect: halfRect(placement, rect, false),
  };
}
