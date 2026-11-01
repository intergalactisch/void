import { expect, test } from '@playwright/test';

test('large Markdown note survives task edits, tab switches and close/reopen', async ({ page, context }) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  await page.getByRole('button', { name: 'Create new note', exact: true }).click();
  const title = page.getByRole('textbox', { name: 'Note title', exact: true });
  await title.fill('Stress note');
  await title.press('Enter');
  const markdown = Array.from({ length: 100 }, (_, section) =>
    `## Section ${section}\n\nA **bold** paragraph with a [link](https://example.com).\n\n` +
    Array.from({ length: 10 }, (_, task) => `- [ ] Task ${section}.${task}`).join('\n') +
    '\n\n> One paragraph\n>\n> Another paragraph\n\n```ts\nconst n = 1;\n\n\nconsole.log(n);\n```\n',
  ).join('\n');
  await page.evaluate(text => navigator.clipboard.writeText(text), markdown);
  await page.keyboard.press('ControlOrMeta+V');
  const editor = page.getByRole('textbox', { name: 'Document editor', exact: true });
  await expect(editor.getByRole('checkbox')).toHaveCount(1000);
  await expect(editor.locator('h2')).toHaveCount(100);
  await editor.getByRole('checkbox').last().click();
  await expect(editor.getByRole('checkbox').last()).toBeChecked();

  await page.getByRole('button', { name: 'Create new note', exact: true }).click();
  await page.getByRole('button', { name: /^Stress note Open in editor tab/ }).click();
  await expect(editor.getByRole('checkbox')).toHaveCount(1000);
  await expect(editor.getByRole('checkbox').last()).toBeChecked();

  await page.getByRole('tab', { name: /^Stress note / }).getByRole('button', { name: 'Close workspace tab', exact: true }).click();
  await page.getByRole('button', { name: /^Stress note Remove/ }).click();
  await expect(editor.getByRole('checkbox')).toHaveCount(1000);
  await expect(editor.getByRole('checkbox').last()).toBeChecked();
  await expect(editor.locator('h2')).toHaveCount(100);
  await expect(editor.locator('pre')).toHaveCount(100);
  expect(await editor.locator('pre').first().textContent()).toBe('const n = 1;\n\n\nconsole.log(n);\n');
  expect(errors).toEqual([]);
});
