/**
 * E2E tests for Note CRUD operations
 */
import { test, expect } from '@playwright/test';

test.describe('Note CRUD', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Wait for app to be ready
    await expect(page.locator('main')).toBeVisible();
  });

  test('creates a quick note with the sidebar button', async ({ page }) => {
    await page
      .getByRole('navigation', { name: 'Notes navigation' })
      .getByRole('button', { name: 'Create new note' })
      .click();

    await expect(page.locator('.ProseMirror')).toBeVisible();
  });

  test('creates a quick note with Cmd+N', async ({ page }) => {
    await page.keyboard.press('Meta+n');

    await expect(page.locator('.ProseMirror')).toBeVisible();
  });

  test('creates a quick note from the empty-state action', async ({ page }) => {
    await page
      .locator('main')
      .getByRole('button', { name: /new note/i })
      .click();

    await expect(page.locator('.ProseMirror')).toBeVisible();
  });

  test('quick-create action does not open a modal', async ({ page }) => {
    await page
      .getByRole('navigation', { name: 'Notes navigation' })
      .getByRole('button', { name: 'Create new note' })
      .click();

    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('.ProseMirror')).toBeVisible();
  });

  test('sidebar empty-state create button creates a quick note', async ({ page }) => {
    const emptySidebarCreate = page
      .getByRole('navigation', { name: 'Notes navigation' })
      .getByRole('button', { name: 'Create a note' });

    if (await emptySidebarCreate.isVisible()) {
      await emptySidebarCreate.click();
    } else {
      await page
        .getByRole('navigation', { name: 'Notes navigation' })
        .getByRole('button', { name: 'Create new note' })
        .click();
    }

    await expect(page.locator('.ProseMirror')).toBeVisible();
  });

  test('repeated quick-create keeps the editor usable', async ({ page }) => {
    await page.keyboard.press('Meta+n');
    await expect(page.locator('.ProseMirror')).toBeVisible();

    await page.keyboard.press('Meta+n');

    await expect(page.locator('.ProseMirror')).toBeVisible();
  });
});
