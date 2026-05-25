export const SIDEBAR_WIDTH_STORAGE_KEY = 'void:sidebar-width:v1';
export const SIDEBAR_DESKTOP_BREAKPOINT = 880;
export const SIDEBAR_DEFAULT_WIDTH = 260;
export const SIDEBAR_MIN_WIDTH = 220;
export const SIDEBAR_MAX_WIDTH = 420;
export const SIDEBAR_MIN_MAIN_WIDTH = 560;
export const SIDEBAR_DRAWER_MIN_WIDTH = 180;
export const SIDEBAR_DRAWER_MAX_WIDTH = 300;

export function isDesktopSidebarViewport(viewportWidth: number): boolean {
  return Number.isFinite(viewportWidth) && viewportWidth >= SIDEBAR_DESKTOP_BREAKPOINT;
}

export function getSidebarEffectiveMaxWidth(viewportWidth: number): number {
  if (!Number.isFinite(viewportWidth)) return SIDEBAR_MAX_WIDTH;
  const availableWidth = Math.floor(viewportWidth) - SIDEBAR_MIN_MAIN_WIDTH;
  return Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, availableWidth));
}

export function clampSidebarWidth(width: number, viewportWidth: number): number {
  const rounded = Number.isFinite(width) ? Math.round(width) : SIDEBAR_DEFAULT_WIDTH;
  return Math.min(
    getSidebarEffectiveMaxWidth(viewportWidth),
    Math.max(SIDEBAR_MIN_WIDTH, rounded),
  );
}

export function getSidebarDrawerWidth(viewportWidth: number): number {
  if (!Number.isFinite(viewportWidth)) return SIDEBAR_DRAWER_MAX_WIDTH;
  return Math.min(
    SIDEBAR_DRAWER_MAX_WIDTH,
    Math.max(SIDEBAR_DRAWER_MIN_WIDTH, Math.floor(viewportWidth * 0.8)),
  );
}

export function getDefaultSidebarWidth(viewportWidth: number): number {
  if (!isDesktopSidebarViewport(viewportWidth)) return getSidebarDrawerWidth(viewportWidth);
  return clampSidebarWidth(SIDEBAR_DEFAULT_WIDTH, viewportWidth);
}

export function parseStoredSidebarWidth(value: string | null, viewportWidth: number): number | null {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return clampSidebarWidth(parsed, viewportWidth);
}

export function resolveSidebarWidth(viewportWidth: number, preferredWidth: number | null): number {
  if (!isDesktopSidebarViewport(viewportWidth)) return getSidebarDrawerWidth(viewportWidth);
  return clampSidebarWidth(preferredWidth ?? SIDEBAR_DEFAULT_WIDTH, viewportWidth);
}
