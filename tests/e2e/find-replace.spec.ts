import { expect, test } from '@playwright/test';

test('find counts update, navigation selects a match, and empty replacement works', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Create new note', exact: true }).click();
  const editor = page.locator('.ProseMirror').first();
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.type('hello hello');
  await page.evaluate(async () => {
    const { uiStore, editorStore } = await import('/src/lib/stores/index.ts');
    editorStore.openFindReplace('replace');
    uiStore.openFindBar('replace');
  });
  const bar = page.getByRole('dialog', { name: 'Find in document' });
  await bar.getByRole('textbox', { name: 'Find in document' }).fill('hello');
  await expect(bar.locator('.find-status')).toHaveText('1 / 2');
  await bar.getByRole('button', { name: 'Next match', exact: true }).click();
  await expect(bar.locator('.find-status')).toHaveText('2 / 2');
  await bar.getByRole('button', { name: 'All', exact: true }).click();
  await expect(bar.locator('.find-status')).toHaveText('No matches');
  await expect(editor).not.toContainText('hello');
  await page.setViewportSize({ width: 500, height: 800 });
  const box = await bar.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(500);
  await page.screenshot({ path: '/tmp/void-find-replace.png' });
  await bar.getByRole('textbox', { name: 'Replacement text' }).press('Escape');
  await expect(bar).toBeHidden();
  await expect(editor).toBeFocused();
  expect(errors).toEqual([]);
});
