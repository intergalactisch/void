export interface BlockMenuAnchor {
  top: number;
  left: number;
  openAbove?: boolean;
  maxHeight?: number;
}

export interface BlockMenuSize {
  width: number;
  height: number;
}

export interface BlockMenuViewport {
  width: number;
  height: number;
}

export interface BlockMenuPlacement {
  top: number;
  left: number;
  openAbove: boolean;
  maxHeight: number;
}

interface PlacementOptions {
  gap?: number;
  padding?: number;
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

export function calculateBlockMenuPlacement(
  anchor: BlockMenuAnchor,
  menu: BlockMenuSize,
  viewport: BlockMenuViewport,
  options: PlacementOptions = {},
): BlockMenuPlacement {
  const gap = options.gap ?? 8;
  const padding = options.padding ?? 8;
  const menuWidth = Math.max(1, menu.width);
  const menuHeight = Math.max(1, menu.height);
  const viewportWidth = Math.max(1, viewport.width);
  const viewportHeight = Math.max(1, viewport.height);
  const viewportMaxHeight = Math.max(1, viewportHeight - padding * 2);

  const spaceBelow = Math.max(0, viewportHeight - anchor.top - gap - padding);
  const spaceAbove = Math.max(0, anchor.top - gap - padding);
  const openAbove = anchor.openAbove ?? (spaceBelow < menuHeight && spaceAbove > spaceBelow);
  const directionalSpace = openAbove ? spaceAbove : spaceBelow;
  const fallbackSpace = Math.max(spaceBelow, spaceAbove, viewportMaxHeight);
  const maxHeight = Math.max(1, Math.min(menuHeight, directionalSpace || fallbackSpace, viewportMaxHeight));
  const top = openAbove
    ? clamp(anchor.top - gap - maxHeight, padding, viewportHeight - padding - maxHeight)
    : clamp(anchor.top + gap, padding, viewportHeight - padding - maxHeight);
  const left = clamp(anchor.left, padding, viewportWidth - padding - menuWidth);

  return {
    top,
    left,
    openAbove,
    maxHeight,
  };
}
