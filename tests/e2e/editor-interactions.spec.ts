import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  await page.getByRole('button', { name: 'Create new note', exact: true }).click();
  const title = page.getByRole('textbox', { name: 'Note title', exact: true });
  await title.fill('Interaction test');
  await title.press('Enter');
});

test('paste over a keyboard selection restores text and selection through undo/redo', async ({ page }) => {
  const editor = page.getByRole('textbox', { name: 'Document editor', exact: true });
  await page.keyboard.type('Keep DELETE');
  for (let i = 0; i < 6; i++) await page.keyboard.press('Shift+ArrowLeft');
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('DELETE');
  await page.evaluate(() => navigator.clipboard.writeText('**replacement**'));
  await page.keyboard.press('ControlOrMeta+V');
  await expect(editor.locator('strong')).toHaveText('replacement');
  await page.keyboard.type(' after');
  await page.keyboard.press('ControlOrMeta+Z');
  await expect(editor).not.toContainText(' after');
  await expect(editor).toContainText('replacement');
  await page.keyboard.press('ControlOrMeta+Z');
  await expect(editor).toContainText('Keep DELETE');
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('DELETE');
  await page.keyboard.press('ControlOrMeta+Shift+Z');
  await expect(editor.locator('strong')).toHaveText('replacement');
  await page.keyboard.press('ControlOrMeta+Shift+Z');
  await expect(editor).toContainText(' after');
});

test('task toggles and pasted nested lists survive undo and redo', async ({ page }) => {
  const editor = page.getByRole('textbox', { name: 'Document editor', exact: true });
  await page.evaluate(() => navigator.clipboard.writeText('- Parent\n- Second\n  1. Child\n\n- [ ] Task one\n- [ ] Task two'));
  await page.keyboard.press('ControlOrMeta+V');
  await expect(editor.getByRole('checkbox')).toHaveCount(2);
  await expect(editor.locator('ul ol')).toHaveCount(1);
  await editor.getByRole('checkbox').last().click();
  await expect(editor.getByRole('checkbox').last()).toBeChecked();
  await editor.press('ControlOrMeta+Z');
  await expect(editor.getByRole('checkbox').last()).not.toBeChecked();
  await expect(editor.getByRole('checkbox')).toHaveCount(2);
  await editor.press('ControlOrMeta+Shift+Z');
  await expect(editor.getByRole('checkbox').last()).toBeChecked();

  await editor.getByText('Second', { exact: true }).click();
  await page.keyboard.press('Tab');
  await expect(editor.locator('ul ul ol')).toHaveCount(1);
  await page.keyboard.press('Shift+Tab');
  await expect(editor.locator('ul ul')).toHaveCount(0);
  await expect(editor.locator('ul ol')).toHaveCount(1);
  await page.keyboard.press('ControlOrMeta+Z');
  await expect(editor.locator('ul ul ol')).toHaveCount(1);
  await page.keyboard.press('ControlOrMeta+Z');
  await expect(editor.locator('ul ul')).toHaveCount(0);
  await expect(editor.locator('ul ol')).toHaveCount(1);
  await expect(editor).toContainText('Parent');
  await expect(editor).toContainText('Child');
});

test('Backspace reverses autoformat, and Enter continues and exits tasks', async ({ page }) => {
  const editor = page.getByRole('textbox', { name: 'Document editor', exact: true });
  await page.keyboard.type('- ');
  await expect(editor.locator('ul')).toHaveCount(1);
  await page.keyboard.press('Backspace');
  await expect(editor.locator('ul')).toHaveCount(0);
  await expect(editor).toContainText('- ');
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('Backspace');
  await page.keyboard.type('- [ ] First');
  await expect(editor.getByRole('checkbox')).toHaveCount(1);
  await page.keyboard.press('Enter');
  await page.keyboard.type('Second');
  await expect(editor.getByRole('checkbox')).toHaveCount(2);
  await page.keyboard.press('Enter');
  await expect(editor.getByRole('checkbox')).toHaveCount(3);
  await page.keyboard.press('Enter');
  await expect(editor.getByRole('checkbox')).toHaveCount(2);
  await page.keyboard.type('Outside tasks');
  await expect(editor.locator('[data-block-type="paragraph"]')).toContainText('Outside tasks');
});
