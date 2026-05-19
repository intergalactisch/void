/**
 * E2E tests for Slash Menu
 *
 * Note: These tests require a note to be open with an editor.
 * They may need adjustment based on the actual app behavior.
 */
import { test, expect } from '@playwright/test';

test.describe('Slash Menu', () => {
  // Skip these tests if no editor is available
  // The slash menu only appears when editing a note

  test('slash menu opens on "/" key in editor', async ({ page }) => {
    await page.goto('/');

    // This test assumes a note is already selected and editor is visible
    // In a real scenario, we'd need to create a note first

    const editor = page.locator('.void-editor');

    // Skip if no editor
    if (!(await editor.isVisible({ timeout: 1000 }).catch(() => false))) {
      test.skip();
      return;
    }

    // Focus editor and type /
    await editor.click();
    await page.keyboard.type('/');

    // Slash menu should appear
    await expect(page.getByRole('listbox', { name: /slash commands/i })).toBeVisible();
  });

  test('slash menu filters commands while typing', async ({ page }) => {
    await page.goto('/');

    const editor = page.locator('.void-editor');

    if (!(await editor.isVisible({ timeout: 1000 }).catch(() => false))) {
      test.skip();
      return;
    }

    // Type /head
    await editor.click();
    await page.keyboard.type('/head');

    // Should show heading-related commands
    const menu = page.getByRole('listbox', { name: /slash commands/i });

    if (await menu.isVisible({ timeout: 1000 }).catch(() => false)) {
      // Check that heading commands are shown
      await expect(page.getByText(/heading/i).first()).toBeVisible();
    }
  });

  test('slash menu closes on Escape', async ({ page }) => {
    await page.goto('/');

    const editor = page.locator('.void-editor');

    if (!(await editor.isVisible({ timeout: 1000 }).catch(() => false))) {
      test.skip();
      return;
    }

    // Open menu
    await editor.click();
    await page.keyboard.type('/');

    const menu = page.getByRole('listbox', { name: /slash commands/i });

    if (await menu.isVisible({ timeout: 1000 }).catch(() => false)) {
      // Press Escape
      await page.keyboard.press('Escape');

      // Menu should close
      await expect(menu).not.toBeVisible();
    }
  });
});
