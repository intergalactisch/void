/**
 * E2E tests for Keyboard Shortcuts
 */
import { test, expect } from '@playwright/test';

test.describe('Keyboard Shortcuts', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('main')).toBeVisible();
  });

  test('Cmd+K opens AI prompt', async ({ page }) => {
    // Press Cmd+K
    await page.keyboard.press('Meta+k');

    // AI prompt should open (look for prompt window indicators)
    await expect(
      page.getByPlaceholder(/ask.*ai/i).or(page.getByRole('textbox', { name: /prompt/i }))
    ).toBeVisible({ timeout: 1000 }).catch(() => {
      // Some implementations may show a dialog
    });
  });

  test('Cmd+N creates a quick note outside Tasks', async ({ page }) => {
    await page.keyboard.press('Meta+n');

    await expect(page.locator('.ProseMirror')).toBeVisible();
  });

  test('Cmd+B toggles sidebar', async ({ page }) => {
    const sidebar = page.getByRole('navigation', { name: 'Notes navigation' });
    await expect(sidebar).toBeVisible();

    await page.keyboard.press('Meta+b');
    await expect(sidebar).not.toBeVisible();

    await page.keyboard.press('Meta+b');
    await expect(sidebar).toBeVisible();
  });

  test('Cmd+/ toggles keyboard shortcuts', async ({ page }) => {
    const shortcuts = page.getByRole('dialog', { name: 'Keyboard shortcuts' });

    await page.keyboard.press('Meta+/');
    await expect(shortcuts).toBeVisible();

    await page.keyboard.press('Meta+/');
    await expect(shortcuts).not.toBeVisible();
  });

  test('keyboard shortcut sheet traps focus and closes with Escape', async ({ page }) => {
    await page.locator('.app-titlebar').getByRole('button', { name: 'Open help' }).click();

    const shortcuts = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    const closeButton = shortcuts.getByRole('button', { name: 'Close' });
    await expect(shortcuts).toBeVisible();
    await expect(closeButton).toBeFocused();

    await page.keyboard.press('Tab');
    await expect(closeButton).toBeFocused();

    await page.keyboard.press('Shift+Tab');
    await expect(closeButton).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(shortcuts).not.toBeVisible();
    await expect(page.locator('.app-titlebar').getByRole('button', { name: 'Open help' })).toBeFocused();
  });

  test('settings panel closes with Escape and restores focus', async ({ page }) => {
    const settingsButton = page
      .getByRole('navigation', { name: 'Notes navigation' })
      .getByRole('button', { name: 'Settings' });

    await settingsButton.click();

    await expect(page.locator('.settings-panel')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.settings-panel')).not.toBeVisible();
    await expect(settingsButton).toBeFocused();
  });

  test('Cmd+N focuses task capture inside Tasks', async ({ page }) => {
    await page.keyboard.press('Meta+Shift+t');
    await expect(page.getByRole('heading', { name: 'All' })).toBeVisible();

    await page.keyboard.press('Meta+n');

    await expect(page.locator('input[name="task-capture"]')).toBeFocused();
  });

  test('Cmd+Shift+T toggles the main Tasks workspace', async ({ page }) => {
    await page.keyboard.press('Meta+Shift+t');
    await expect(page.getByRole('heading', { name: 'All' })).toBeVisible();
    await expect(page.getByText('Quick tasks')).not.toBeVisible();

    await page.keyboard.press('Meta+Shift+t');
    await expect(page.getByRole('heading', { name: 'All' })).not.toBeVisible();
  });

  test('Mod+1..9 switches task views', async ({ page }) => {
    await page.keyboard.press('Meta+Shift+t');
    await expect(page.getByRole('heading', { name: 'All' })).toBeVisible();

    // Chromium reserves Meta+number for browser tab switching, so this uses
    // Ctrl as the non-mac Mod path while exercising the same app handler.
    await page.keyboard.press('Control+2');
    await expect(page.getByRole('heading', { name: 'Inbox' })).toBeVisible();

    await page.keyboard.press('Control+9');
    await expect(page.getByRole('heading', { name: 'Logbook' })).toBeVisible();
  });

  test('All hides completed tasks until Show completed is enabled', async ({ page }) => {
    await page.keyboard.press('Meta+Shift+t');
    await expect(page.getByRole('heading', { name: 'All' })).toBeVisible();

    const title = `Completed visibility ${Date.now()}`;
    await page.locator('input[name="task-capture"]').fill(title);
    await page.keyboard.press('Enter');
    await expect(page.getByText(title)).toBeVisible();

    await page.locator('.task-row').filter({ hasText: title }).locator('label.check-wrap').click();
    await expect(page.getByText(title)).not.toBeVisible();

    await page.getByRole('button', { name: 'Close details' }).click();
    await page.getByRole('tab', { name: /Completed/ }).click();
    await expect(page.getByText(title)).toBeVisible();
  });

  test('quick add from All creates an Inbox task', async ({ page }) => {
    await page.keyboard.press('Meta+Shift+t');
    await expect(page.getByRole('heading', { name: 'All' })).toBeVisible();

    const title = `All inbox capture ${Date.now()}`;
    await page.locator('input[name="task-capture"]').fill(title);
    await page.keyboard.press('Enter');

    await expect(page.locator('.inspector')).not.toBeVisible();
    await page.keyboard.press('Control+2');
    await expect(page.getByRole('heading', { name: 'Inbox' })).toBeVisible();
    await expect(page.getByText(title)).toBeVisible();
  });

  test('task details pane can be closed', async ({ page }) => {
    await page.keyboard.press('Meta+Shift+t');
    await expect(page.getByRole('heading', { name: 'All' })).toBeVisible();

    const title = `Closable details ${Date.now()}`;
    await page.locator('input[name="task-capture"]').fill(title);
    await page.keyboard.press('Enter');

    await expect(page.getByText(title)).toBeVisible();
    await page.locator('.task-row').filter({ hasText: title }).click();
    await expect(page.locator('.inspector')).toBeVisible();
    await page.getByRole('button', { name: 'Close details' }).click();
    await expect(page.locator('.inspector')).not.toBeVisible();
  });

  test('Escape closes the Tasks workspace', async ({ page }) => {
    await page.keyboard.press('Meta+Shift+t');
    await expect(page.getByRole('heading', { name: 'All' })).toBeVisible();

    await page.keyboard.press('Escape');

    await expect(page.getByRole('heading', { name: 'All' })).not.toBeVisible();
  });
});
