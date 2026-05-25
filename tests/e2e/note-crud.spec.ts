/**
 * E2E tests for Note CRUD operations
 */
import { test, expect } from '@playwright/test';

async function dispatchPaste(page: import('@playwright/test').Page, text: string, selector?: string) {
  await page.evaluate(
    ({ pastedText, targetSelector }) => {
      const data = new DataTransfer();
      data.setData('text/plain', pastedText);
      const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', { value: data });
      const target = targetSelector ? document.querySelector(targetSelector) : document;
      if (!target) throw new Error(`Paste target not found: ${targetSelector}`);
      target.dispatchEvent(event);
    },
    { pastedText: text, targetSelector: selector ?? null },
  );
}

test.describe('Note CRUD', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Wait for app to be ready
    await expect(page.locator('main')).toBeVisible({ timeout: 15000 });
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

  test('pasting text with no open note creates a note with the clipboard content', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'What are we capturing today?' })).toBeVisible();

    await dispatchPaste(page, 'Clipboard paste title\n\nBody from clipboard');

    await expect(page.locator('.ProseMirror')).toBeVisible();
    await expect(page.locator('.ProseMirror')).toContainText('Clipboard paste title');
    await expect(page.locator('.ProseMirror')).toContainText('Body from clipboard');
  });

  test('pasting from a folder overview creates the note in that folder', async ({ page }) => {
    await page.locator('main').getByRole('button', { name: /new note/i }).click();
    await expect(page.locator('.ProseMirror')).toBeVisible();

    await page.getByRole('button', { name: 'New folder at root' }).click();
    const input = page.getByRole('dialog').getByRole('textbox');
    await input.fill('Paste Target');
    await page.getByRole('button', { name: /create folder/i }).click();
    await page.getByRole('treeitem', { name: 'Paste Target' }).click();
    await expect(page.getByRole('heading', { name: 'Paste Target', level: 1 })).toBeVisible();

    await dispatchPaste(page, 'Folder paste title\n\nFolder body');

    await expect(page.locator('.ProseMirror')).toBeVisible();
    await expect(page.locator('.ProseMirror')).toContainText('Folder body');

    await page.getByRole('treeitem', { name: 'Paste Target' }).click();
    await expect(page.getByRole('heading', { name: 'Paste Target', level: 1 })).toBeVisible();
    await expect(page.locator('.folder-overview .row-title', { hasText: 'Folder paste title' })).toBeVisible();
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

  test('paste inside an open editor does not create another note', async ({ page }) => {
    await page.keyboard.press('Meta+n');
    await expect(page.locator('.ProseMirror')).toBeVisible();
    const noteCount = await page.getByRole('treeitem').count();

    await dispatchPaste(page, 'This should not create a new note', '.ProseMirror');

    await expect.poll(() => page.getByRole('treeitem').count(), { timeout: 500 }).toBe(noteCount);
  });

  test('moves a deleted note to Trash and restores it', async ({ page }) => {
    const initialCount = await page.getByRole('treeitem').count();

    await page
      .getByRole('navigation', { name: 'Notes navigation' })
      .getByRole('button', { name: 'Create new note' })
      .click();
    await expect(page.locator('.ProseMirror')).toBeVisible();
    await expect.poll(() => page.getByRole('treeitem').count()).toBe(initialCount + 1);

    await page.getByRole('button', { name: 'Note actions' }).click();
    await page.getByRole('menuitem', { name: /move to trash/i }).click();
    await page.getByRole('button', { name: /move to trash/i }).click();

    await expect.poll(() => page.getByRole('treeitem').count()).toBe(initialCount);

    await page.getByRole('link', { name: 'Trash' }).click();
    await expect(page.getByRole('heading', { name: 'Trash', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /^restore$/i })).toBeVisible();
    await page.getByRole('button', { name: /^restore$/i }).click();

    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator('.ProseMirror')).toBeVisible();
    await expect.poll(() => page.getByRole('treeitem').count()).toBe(initialCount + 1);
  });
});
