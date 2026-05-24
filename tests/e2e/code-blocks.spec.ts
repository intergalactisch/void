import { test, expect } from '@playwright/test';

test.describe('Code blocks', () => {
  test('creates a rich fenced code block from markdown input', async ({ page }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/');
    await expect(page.locator('main')).toBeVisible();

    const mainNewNote = page.locator('main').getByRole('button', { name: /new note/i }).first();
    if (await mainNewNote.isVisible().catch(() => false)) {
      await mainNewNote.click();
    } else {
      await page
        .getByRole('navigation', { name: 'Notes navigation' })
        .getByRole('button', { name: 'Create new note' })
        .click();
    }

    const editor = page.locator('.ProseMirror');
    await expect(editor).toBeVisible();
    await editor.click();

    await page.keyboard.insertText('```ts title="api.ts" lineNumbers {2} wrap');

    await expect(page.locator('.void-code-block-header')).toBeVisible();
    await expect(page.locator('.void-code-block-lang').first()).toHaveText('ts');
    await expect(page.locator('.void-code-block-title').first()).toHaveText('api.ts');
    await expect(page.locator('.void-code-block-meta').first()).toContainText('lineNumbers');

    await page.keyboard.insertText('const answer = 41;');
    const shell = page.locator('.void-code-block-shell').first();
    await expect(shell).toBeVisible();
    const structure = await shell.evaluate((element) => {
      const header = element.querySelector('.void-code-block-header');
      const pre = element.querySelector('pre.void-code-block');
      return {
        headerParentIsShell: header?.parentElement === element,
        preParentIsShell: pre?.parentElement === element,
        headerTop: header?.getBoundingClientRect().top ?? 0,
        preTop: pre?.getBoundingClientRect().top ?? 0,
      };
    });
    expect(structure.headerParentIsShell).toBe(true);
    expect(structure.preParentIsShell).toBe(true);
    expect(structure.headerTop).toBeLessThan(structure.preTop);

    await expect(page.locator('.void-code-line-numbers span').first()).toHaveText('1');
    await expect(page.locator('pre.void-code-block').first()).toHaveClass(/is-wrapped/);

    await page.keyboard.press('ArrowDown');
    await page.keyboard.insertText('after code');
    await expect(page.locator('.void-block[data-block-type="paragraph"]', { hasText: 'after code' })).toBeVisible();

    const copyButton = page.getByRole('button', { name: 'Copy code' }).first();
    await copyButton.click();
    await expect(copyButton).toHaveText('Copied');
  });
});
