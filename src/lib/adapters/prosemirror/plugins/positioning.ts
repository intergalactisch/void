/**
 * Shared Popover Positioning Utilities
 *
 * Calculates viewport-aware positioning for editor popovers
 * (slash menu, page link popup) to prevent clipping at edges.
 *
 * Part of the ProseMirror infrastructure adapter.
 */

interface RawCoords {
  top: number;
  bottom: number;
  left: number;
}

interface MenuDimensions {
  menuWidth: number;
  menuHeight: number;
  gap?: number;
}

interface ClampedPosition {
  top: number;
  left: number;
  openAbove: boolean;
}

/**
 * Calculate viewport-clamped coordinates for a popover menu.
 *
 * - Vertical: opens below cursor by default, above if not enough space below
 * - Horizontal: clamps left so menu stays within viewport with edge padding
 *
 * @param rawCoords - Raw coordinates from `view.coordsAtPos()`
 * @param dimensions - Menu width, height, and optional gap
 * @returns Clamped position with `openAbove` flag
 */
export function clampToViewport(
  rawCoords: RawCoords,
  { menuWidth, menuHeight, gap = 4 }: MenuDimensions
): ClampedPosition {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const edgePadding = 8;

  // Vertical: determine if menu should open above or below
  const spaceBelow = viewportHeight - rawCoords.bottom;
  const openAbove = spaceBelow < menuHeight && rawCoords.top > spaceBelow;

  const top = openAbove
    ? rawCoords.top - gap
    : rawCoords.bottom + gap;

  // Horizontal: clamp left so menu doesn't overflow right edge
  const maxLeft = viewportWidth - menuWidth - edgePadding;
  const left = Math.max(edgePadding, Math.min(rawCoords.left, maxLeft));

  return { top, left, openAbove };
}
