import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  await page.getByRole('button', { name: 'Create new note', exact: true }).click();
  const title = page.getByRole('textbox', { name: 'Note title', exact: true });
  await title.fill('Writing reliability');
  await title.press('Enter');
});

test('block menu preserves line breaks, identity and word counts through code conversion', async ({ page }) => {
  const editor = page.getByRole('textbox', { name: 'Document editor', exact: true });
  await page.keyboard.type('First line');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('Second line');
  const originalId = await editor.locator('[data-block-type="paragraph"]').getAttribute('data-block-id');
  await expect(page.getByRole('status', { name: /^4 words,/ })).toBeVisible();
  await editor.getByRole('button', { name: 'Change block type from P', exact: true }).click();
  await page.getByRole('menuitem', { name: 'CD Code', exact: true }).click();
  await expect(editor.locator('pre')).toHaveText('First line\nSecond line');
  await expect(editor.locator('[data-block-type="codeBlock"]')).toHaveAttribute('data-block-id', originalId!);
  await editor.getByRole('button', { name: 'Change block type from CD', exact: true }).click();
  await page.getByRole('menuitem', { name: 'P Text', exact: true }).click();
  await expect(editor.locator('p br')).toHaveCount(1);
  await expect(editor.locator('[data-block-type="paragraph"]')).toHaveAttribute('data-block-id', originalId!);
  await editor.press('ControlOrMeta+Z');
  await expect(editor.locator('pre')).toHaveText('First line\nSecond line');
  await editor.press('ControlOrMeta+Shift+Z');
  await expect(editor.locator('p br')).toHaveCount(1);
  await expect(page.getByRole('status', { name: /^4 words,/ })).toBeVisible();
});

test('Enter before a completed task preserves the completed task and its identity', async ({ page }) => {
  const editor = page.getByRole('textbox', { name: 'Document editor', exact: true });
  await page.evaluate(() => navigator.clipboard.writeText('- [x] Finished task'));
  await page.keyboard.press('ControlOrMeta+V');
  const originalId = await editor.locator('[data-block-type="todoItem"]').getAttribute('data-block-id');
  for (let i = 0; i < 'Finished task'.length; i++) await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Enter');
  await expect(editor.getByRole('checkbox')).toHaveCount(2);
  await expect(editor.getByRole('checkbox').first()).not.toBeChecked();
  await expect(editor.getByRole('checkbox').last()).toBeChecked();
  await expect(editor.locator('[data-block-type="todoItem"]').last()).toHaveAttribute('data-block-id', originalId!);
  await expect(editor.locator('[data-block-type="todoItem"]').last()).toContainText('Finished task');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.type('New task above');
  await expect(editor.locator('[data-block-type="todoItem"]').first()).toContainText('New task above');
  await expect(editor.getByRole('checkbox').last()).toHaveText('');
  await expect(editor.locator('[data-block-type="todoItem"]').last()).toContainText('Finished task');
  await page.keyboard.press('ControlOrMeta+Z');
  // Typing may join the Enter action or form a separate history group.
  if (await editor.getByRole('checkbox').count() === 2) await page.keyboard.press('ControlOrMeta+Z');
  await expect(editor.getByRole('checkbox')).toHaveCount(1);
  await expect(editor.getByRole('checkbox')).toBeChecked();
});
