/**
 * Verifies the sidebar drawer behavior on tablet/phone viewports:
 *   1. Sidebar is hidden on initial load (no backdrop covering content)
 *   2. Tapping the hamburger reveals the drawer + backdrop
 *   3. Tapping the backdrop dismisses the drawer
 */
import { test, expect, type Page } from '@playwright/test';

const sidebar = (page: Page) =>
  page.getByRole('navigation', { name: 'Notes navigation' });

async function sidebarWidth(page: Page): Promise<number> {
  const box = await sidebar(page).boundingBox();
  expect(box).not.toBeNull();
  return Math.round(box!.width);
}

test('desktop sidebar resizes with drag, persists, and resets', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');

  const resizeRail = page.getByRole('separator', { name: 'Resize notes sidebar' });
  await expect(resizeRail).toBeVisible();

  const initialWidth = await sidebarWidth(page);
  expect(initialWidth).toBe(260);

  const railBox = await resizeRail.boundingBox();
  expect(railBox).not.toBeNull();

  await page.mouse.move(railBox!.x + railBox!.width / 2, railBox!.y + 80);
  await page.mouse.down();
  await page.mouse.move(railBox!.x + railBox!.width / 2 + 86, railBox!.y + 80);
  await page.mouse.up();

  await expect.poll(() => sidebarWidth(page)).toBeGreaterThanOrEqual(340);

  const mainBox = await page.locator('.app-main').boundingBox();
  expect(mainBox).not.toBeNull();
  expect(Math.round(mainBox!.width)).toBeGreaterThanOrEqual(560);

  const resizedWidth = await sidebarWidth(page);
  await page.reload();
  await expect.poll(() => sidebarWidth(page)).toBe(resizedWidth);

  await resizeRail.dblclick();
  await expect.poll(() => sidebarWidth(page)).toBe(260);
});

test('desktop sidebar resize rail supports keyboard controls', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');

  const resizeRail = page.getByRole('separator', { name: 'Resize notes sidebar' });
  await resizeRail.focus();

  await resizeRail.press('ArrowRight');
  await expect.poll(() => sidebarWidth(page)).toBe(270);

  await page.keyboard.down('Shift');
  await resizeRail.press('ArrowRight');
  await page.keyboard.up('Shift');
  await expect.poll(() => sidebarWidth(page)).toBe(310);

  await resizeRail.press('Home');
  await expect.poll(() => sidebarWidth(page)).toBe(220);

  await resizeRail.press('End');
  await expect.poll(() => sidebarWidth(page)).toBe(420);

  await resizeRail.press('Enter');
  await expect.poll(() => sidebarWidth(page)).toBe(260);
});

test('sidebar drawer opens & closes at 480px', async ({ page }) => {
  await page.setViewportSize({ width: 480, height: 800 });
  await page.goto('/');

  // Empty state is visible (drawer is closed on first load).
  await expect(page.getByRole('heading', { name: 'What are we capturing today?' })).toBeVisible();

  // Take a snapshot of the resting state.
  await page.screenshot({ path: 'test-results/responsive/drawer-01-closed.png' });

  // Tap hamburger to open the drawer.
  await page.getByRole('button', { name: 'Toggle sidebar' }).click();

  // Drawer is open: workspace label visible.
  await expect(page.locator('.sidebar').getByText('Void')).toBeVisible();
  await expect(page.getByRole('separator', { name: 'Resize notes sidebar' })).toHaveCount(0);

  // Wait for slide-in animation (280ms transition) to complete before snapshot.
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'test-results/responsive/drawer-02-open.png' });

  // Tap the visible portion of the backdrop (right of the drawer) to
  // dismiss. The drawer is ~300px wide on a 480px viewport, so a click
  // at x=420 (relative to backdrop's top-left) is clearly past the drawer.
  await page.locator('.sidebar-overlay-backdrop').click({ position: { x: 420, y: 400 } });

  // Empty state visible again.
  await expect(page.getByRole('heading', { name: 'What are we capturing today?' })).toBeVisible();
  await page.screenshot({ path: 'test-results/responsive/drawer-03-dismissed.png' });
});
