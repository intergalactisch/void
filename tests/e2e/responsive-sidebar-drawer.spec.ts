/**
 * Verifies the sidebar drawer behavior on tablet/phone viewports:
 *   1. Sidebar is hidden on initial load (no backdrop covering content)
 *   2. Tapping the hamburger reveals the drawer + backdrop
 *   3. Tapping the backdrop dismisses the drawer
 */
import { test, expect } from '@playwright/test';

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
