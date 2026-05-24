/**
 * E2E coverage for the line-level lineage entry point.
 */
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

async function gotoHome(page: Page) {
  await page.goto('/');
  await expect(page.locator('#main-content')).toBeVisible({ timeout: 15000 });
}

async function createQuickNote(page: Page) {
  await page
    .getByRole('navigation', { name: 'Notes navigation' })
    .getByRole('button', { name: 'Create new note' })
    .click();

  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();
  return editor;
}

async function saveAndWait(page: Page) {
  await page.keyboard.press('Meta+s');
  await expect(page.locator('.save-indicator.save-saved')).toBeVisible({ timeout: 5000 });
}

async function openBlockMenu(page: Page, text: string) {
  const block = page.locator('.void-block', { hasText: text }).first();
  await expect(block).toBeVisible();
  await block.hover();
  await block.locator('.void-gutter-drag').click({ force: true });

  const menu = page.getByRole('menu', { name: 'Block options' });
  await expect(menu).toBeVisible();
  return menu;
}

async function openLineHistory(page: Page, text: string) {
  await openBlockMenu(page, text);

  const lineHistory = page.getByRole('menuitem', { name: 'Line history' });
  await expect(lineHistory).toBeVisible();
  await lineHistory.click();

  const workspace = page.getByRole('dialog', { name: 'Lineage history workspace' });
  await expect(workspace).toBeVisible();
  return workspace;
}

async function deleteBlockFromMenu(page: Page, text: string) {
  await openBlockMenu(page, text);
  await page.getByRole('menuitem', { name: /Delete/ }).click();
}

test.describe('Lineage menu entry', () => {
  test('opens note history from the document toolbar', async ({ page }) => {
    await gotoHome(page);

    await createQuickNote(page);
    await page.keyboard.type('Toolbar history test');
    await saveAndWait(page);

    await page.getByRole('button', { name: 'Open note history' }).click();
    const workspace = page.getByRole('dialog', { name: 'Lineage history workspace' });
    await expect(workspace).toBeVisible();
    await expect(workspace.getByText('Timeline')).toBeVisible();
  });

  test('opens and closes information popovers accessibly', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('main')).toBeVisible();

    await createQuickNote(page);
    await page.keyboard.type('Popover help test');
    await saveAndWait(page);

    await page.getByRole('button', { name: 'Open note history' }).click();
    const workspace = page.getByRole('dialog', { name: 'Lineage history workspace' });
    await expect(workspace).toBeVisible();

    const helpButton = workspace.getByRole('button', { name: 'About Saved history' });
    const popover = page.getByRole('dialog', { name: 'Saved history' });
    await helpButton.click();
    await expect(popover).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(popover).toHaveCount(0);

    await helpButton.evaluate((element) => (element as HTMLButtonElement).blur());
    await helpButton.focus();
    await expect(popover).toBeVisible();

    await page.mouse.click(12, 12);
    await expect(popover).toHaveCount(0);
    await expect(workspace).toBeVisible();
  });

  test('opens line history from the block menu', async ({ page }) => {
    await gotoHome(page);

    await createQuickNote(page);
    await page.keyboard.type('This is a test');

    const block = page.locator('.void-block', { hasText: 'This is a test' }).first();
    await expect(block).toBeVisible();
    await block.hover();

    await expect(block.locator('.void-gutter-lineage')).toHaveCount(0);
    await block.locator('.void-gutter-drag').click({ force: true });

    const menu = page.getByRole('menu', { name: 'Block options' });
    await expect(menu).toBeVisible();

    const lineHistory = page.getByRole('menuitem', { name: 'Line history' });
    await expect(lineHistory).toBeVisible();
    await lineHistory.click();

    await expect(page.getByRole('dialog', { name: 'Lineage history workspace' })).toBeVisible();
    await expect(menu).toHaveCount(0);
  });

  test('closes the block menu when clicking outside', async ({ page }) => {
    await gotoHome(page);

    await createQuickNote(page);
    await page.keyboard.type('Outside click closes me');

    const menu = await openBlockMenu(page, 'Outside click closes me');
    await page.mouse.click(24, 24);

    await expect(menu).toHaveCount(0);
    await expect(page.getByRole('menuitem', { name: 'Line history' })).toHaveCount(0);
  });

  test('opens the turn-into menu upward near the bottom of the viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 420 });
    await gotoHome(page);

    await createQuickNote(page);
    for (let index = 0; index < 16; index++) {
      await page.keyboard.type(`Spacer ${index}`);
      await page.keyboard.press('Enter');
    }
    await page.keyboard.type('Bottom type target');

    const block = page.locator('.void-block', { hasText: 'Bottom type target' }).first();
    await expect(block).toBeVisible();
    await block.evaluate((element) => element.scrollIntoView({ block: 'end' }));
    await block.hover();

    const label = block.locator('.void-gutter-label');
    const labelBox = await label.boundingBox();
    expect(labelBox).not.toBeNull();
    await label.click({ force: true });

    const menu = page.getByRole('menu', { name: 'Change block type' });
    await expect(menu).toBeVisible();
    const menuBox = await menu.boundingBox();
    expect(menuBox).not.toBeNull();
    expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(labelBox!.y + 2);
    expect(menuBox!.y).toBeGreaterThanOrEqual(0);
    expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(420);
  });

  test('shows previous versions after editing and saving a line', async ({ page }) => {
    await gotoHome(page);

    const initial = 'Hoe gaat het daar?';
    const updated = 'Hoe gaat het daar? Goed.';

    await createQuickNote(page);
    await page.keyboard.type(initial);
    await saveAndWait(page);

    const content = page.locator('.void-block', { hasText: initial }).first().locator('.void-block-content');
    await content.click();
    await page.keyboard.press('Meta+a');
    await page.keyboard.type(updated);
    await expect(page.locator('.void-block', { hasText: updated }).first()).toBeVisible();
    await saveAndWait(page);

    const workspace = await openLineHistory(page, updated);
    await expect(workspace.getByRole('heading', { name: /History|User saved editor document|Sharpen/i }).first()).toBeVisible();
    await expect(workspace.getByText(updated).first()).toBeVisible();
    await expect(workspace.getByText(initial).first()).toBeVisible();
    await expect(workspace.getByText('Sentence Diff')).toBeVisible();
    await expect(workspace.getByText('Selected Line Trace')).toBeVisible();
  });

  test('recovers a deleted line from the note-wide history workspace', async ({ page }) => {
    await gotoHome(page);

    await createQuickNote(page);
    await page.keyboard.type('Alpha');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Beta');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Gamma');
    await saveAndWait(page);

    await deleteBlockFromMenu(page, 'Beta');
    await expect(page.locator('.void-block', { hasText: 'Beta' })).toHaveCount(0);
    await saveAndWait(page);

    const workspace = await openLineHistory(page, 'Alpha');
    await workspace.getByRole('button', { name: 'Deleted', exact: true }).click();
    await expect(workspace.getByText('Deleted archive')).toBeVisible();
    await expect(workspace.getByText('Beta').first()).toBeVisible();

    await workspace.getByRole('button', { name: /Restore preview/ }).first().click();
    await expect(workspace.getByText('Restore Preview', { exact: true })).toBeVisible();
    await expect(workspace.getByText('Placement')).toBeVisible();
    await workspace.getByRole('button', { name: 'Apply restore' }).click();

    await workspace.getByRole('button', { name: 'Close history' }).click();
    await expect(page.locator('.void-block', { hasText: 'Beta' }).first()).toBeVisible({ timeout: 5000 });
  });
});
