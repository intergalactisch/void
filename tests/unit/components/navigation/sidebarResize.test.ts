import { describe, expect, it } from 'vitest';
import {
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_DESKTOP_BREAKPOINT,
  SIDEBAR_DRAWER_MAX_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  clampSidebarWidth,
  getDefaultSidebarWidth,
  getSidebarDrawerWidth,
  getSidebarEffectiveMaxWidth,
  isDesktopSidebarViewport,
  parseStoredSidebarWidth,
  resolveSidebarWidth,
} from '$lib/components/navigation/sidebarResize';

describe('sidebar resize helpers', () => {
  it('detects desktop viewports at the existing sidebar breakpoint', () => {
    expect(isDesktopSidebarViewport(SIDEBAR_DESKTOP_BREAKPOINT - 1)).toBe(false);
    expect(isDesktopSidebarViewport(SIDEBAR_DESKTOP_BREAKPOINT)).toBe(true);
  });

  it('clamps desktop widths to the configured range', () => {
    expect(clampSidebarWidth(100, 1280)).toBe(SIDEBAR_MIN_WIDTH);
    expect(clampSidebarWidth(360, 1280)).toBe(360);
    expect(clampSidebarWidth(900, 1280)).toBe(SIDEBAR_MAX_WIDTH);
  });

  it('preserves at least the minimum main content width on narrow desktop windows', () => {
    expect(getSidebarEffectiveMaxWidth(900)).toBe(340);
    expect(clampSidebarWidth(420, 900)).toBe(340);
  });

  it('uses the default desktop width when no preferred width exists', () => {
    expect(getDefaultSidebarWidth(1280)).toBe(SIDEBAR_DEFAULT_WIDTH);
    expect(resolveSidebarWidth(1280, null)).toBe(SIDEBAR_DEFAULT_WIDTH);
  });

  it('parses and clamps stored width values', () => {
    expect(parseStoredSidebarWidth('333', 1280)).toBe(333);
    expect(parseStoredSidebarWidth('999', 1280)).toBe(SIDEBAR_MAX_WIDTH);
    expect(parseStoredSidebarWidth('nope', 1280)).toBeNull();
    expect(parseStoredSidebarWidth(null, 1280)).toBeNull();
  });

  it('uses drawer sizing below the desktop breakpoint', () => {
    expect(getSidebarDrawerWidth(480)).toBe(SIDEBAR_DRAWER_MAX_WIDTH);
    expect(getDefaultSidebarWidth(360)).toBe(288);
    expect(resolveSidebarWidth(480, 420)).toBe(SIDEBAR_DRAWER_MAX_WIDTH);
  });
});
