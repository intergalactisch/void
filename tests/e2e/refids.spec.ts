import { test, expect, type Page } from '@playwright/test';

async function mockClipboard(page: Page) {
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          (window as unknown as { __copiedRef?: string }).__copiedRef = text;
        },
      },
    });
  });
}

async function copiedRef(page: Page): Promise<string | undefined> {
  return page.evaluate(() => (window as unknown as { __copiedRef?: string }).__copiedRef);
}

async function createQuickNote(page: Page, text = 'RefId smoke content') {
  await page
    .getByRole('navigation', { name: 'Notes navigation' })
    .getByRole('button', { name: 'Create new note' })
    .click();

  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.type(text);
  return editor;
}

test.describe('Copy Ref', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('main')).toBeVisible();
    await mockClipboard(page);
  });

  test('copies a note ref from the sidebar context menu', async ({ page }) => {
    await createQuickNote(page);

    const selectedNote = page.locator('[role="treeitem"][aria-selected="true"]').first();
    await expect(selectedNote).toBeVisible();
    await selectedNote.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Copy Ref' }).click();

    await expect.poll(() => copiedRef(page)).toMatch(/^void:\/\/note\/.+\.md$/);
  });

  test('copies a note ref from an editor tab context menu', async ({ page }) => {
    await createQuickNote(page, 'First tab');
    await createQuickNote(page, 'Second tab');

    const activeTab = page.locator('.workspace-tab.active').first();
    await expect(activeTab).toBeVisible();
    await activeTab.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Copy Ref' }).click();

    await expect.poll(() => copiedRef(page)).toMatch(/^void:\/\/note\/.+\.md$/);
  });

  test('copies a block ref from the editor block menu', async ({ page }) => {
    const text = 'Block ref smoke text';
    await createQuickNote(page, text);

    const block = page.locator('.void-block', { hasText: text }).first();
    await expect(block).toBeVisible();
    await block.hover();
    await block.locator('.void-gutter-drag').click({ force: true });
    await page.getByRole('menuitem', { name: 'Copy Ref' }).click();

    await expect.poll(() => copiedRef(page)).toMatch(/^void:\/\/block\/.+\.md#.+/);
  });

  test('copies a todo ref from the task inspector', async ({ page }) => {
    await page.keyboard.press('Meta+Shift+t');
    await expect(page.getByRole('heading', { name: 'All' })).toBeVisible();

    const title = `Todo ref smoke ${Date.now()}`;
    await page.locator('input[name="task-capture"]').fill(title);
    await page.keyboard.press('Enter');

    const row = page.locator('.task-row').filter({ hasText: title }).first();
    await expect(row).toBeVisible();
    await row.click();

    const inspector = page.locator('.inspector');
    await expect(inspector).toBeVisible();
    await inspector.getByRole('button', { name: /copy.*ref/i }).click();

    await expect.poll(() => copiedRef(page)).toMatch(/^void:\/\/todo\/.+/);
  });
});
