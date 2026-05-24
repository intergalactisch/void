import { expect, test, type Page } from '@playwright/test';

const splitPaneError = 'Editor container not found';

async function resetApp(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('main')).toBeVisible();
}

async function createQuickNote(page: Page, body: string) {
  const tabs = page.locator('.workspace-tab');
  const previousTabCount = await tabs.count();
  await page.keyboard.press('Meta+n');
  await expect(tabs).toHaveCount(previousTabCount + 1);
  await expect(tabs.nth(previousTabCount)).toHaveClass(/active/);
  const editor = page.locator('.note-pane-single-target .ProseMirror').first();
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.type(body);
  await page.keyboard.press('Meta+s');
  await page.waitForTimeout(250);
}

async function createTwoNotesAndSplit(page: Page) {
  await createQuickNote(page, 'Alpha pane body');
  await createQuickNote(page, 'Beta pane body');

  const tabs = page.locator('.workspace-tab');
  await expect(tabs).toHaveCount(2);
  await tabs.nth(1).getByRole('button', { name: 'Close workspace tab' }).click();
  await expect(tabs).toHaveCount(1);
  await tabs.nth(0).click();
  await tabs.nth(0).click({ button: 'right' });
  await page.getByRole('menuitem', { name: /Split Right/ }).click();

  await expect(page.locator('.note-pane-leaf')).toHaveCount(2);
  await expect(page.locator('.split-note-picker')).toBeVisible();
  await expect(page.locator('.split-note-result')).toHaveCount(1);
  await expect(page.getByText(splitPaneError)).toHaveCount(0);

  await page.locator('.split-note-result').first().click();
  await expect(page.locator('.split-note-picker')).toHaveCount(0);
  await expect(page.locator('.note-pane-leaf')).toHaveCount(2);
  await expect(page.locator('.note-pane-leaf .ProseMirror')).toHaveCount(2);
}

async function dragPaneToPane(
  page: Page,
  sourceIndex: number,
  targetIndex: number,
  zone: 'center' | 'left' | 'right' | 'top' | 'bottom',
) {
  const sourceHeader = page.locator('.note-pane-leaf').nth(sourceIndex).locator('.note-pane-header');
  const targetPane = page.locator('.note-pane-leaf').nth(targetIndex);
  const sourceBox = await sourceHeader.boundingBox();
  const targetBox = await targetPane.boundingBox();
  expect(sourceBox).toBeTruthy();
  expect(targetBox).toBeTruthy();

  const startX = sourceBox!.x + Math.min(42, sourceBox!.width / 3);
  const startY = sourceBox!.y + sourceBox!.height / 2;
  const points = {
    center: [targetBox!.x + targetBox!.width / 2, targetBox!.y + targetBox!.height / 2],
    left: [targetBox!.x + 12, targetBox!.y + targetBox!.height / 2],
    right: [targetBox!.x + targetBox!.width - 12, targetBox!.y + targetBox!.height / 2],
    top: [targetBox!.x + targetBox!.width / 2, targetBox!.y + 12],
    bottom: [targetBox!.x + targetBox!.width / 2, targetBox!.y + targetBox!.height - 12],
  } as const;
  const [targetX, targetY] = points[zone];

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 8, startY + 2);
  await page.mouse.move(targetX, targetY);
  await expect(page.locator('.pane-move-preview-rect')).toBeVisible();
  await page.mouse.up();
  await expect(page.locator('.pane-move-preview-rect')).toHaveCount(0);
}

test.describe('note split panes', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await resetApp(page);
  });

  test('first split from a single note opens a picker without a stale mount error', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));

    await createTwoNotesAndSplit(page);

    await expect(page.locator('body')).toContainText('Alpha pane body');
    await expect(page.locator('body')).toContainText('Beta pane body');
    expect(pageErrors).toEqual([]);
  });

  test('both split panes stay editable and F6 cycles the focused pane', async ({ page }) => {
    await createTwoNotesAndSplit(page);

    const panes = page.locator('.note-pane-leaf');
    const editors = page.locator('.note-pane-leaf .ProseMirror');

    await editors.nth(0).click();
    await page.keyboard.type(' editable alpha');
    await expect(panes.nth(0)).toContainText('editable alpha');

    await editors.nth(1).click();
    await page.keyboard.type(' editable beta');
    await expect(panes.nth(1)).toContainText('editable beta');

    await page.keyboard.press('F6');
    await expect(panes.nth(0)).toHaveClass(/active/);

    await page.keyboard.press('Shift+F6');
    await expect(panes.nth(1)).toHaveClass(/active/);
  });

  test('pane title chrome truncates long note titles without covering actions', async ({ page }) => {
    await createQuickNote(page, 'A very long research note title that should never collide with split pane header actions');
    await createQuickNote(page, 'Another extremely long reference note title that stays readable in a narrow pane');

    const tabs = page.locator('.workspace-tab');
    await tabs.nth(1).getByRole('button', { name: 'Close workspace tab' }).click();
    await tabs.nth(0).click({ button: 'right' });
    await page.getByRole('menuitem', { name: /Split Right/ }).click();
    await page.locator('.split-note-result').first().click();

    const header = page.locator('.note-pane-header').first();
    const title = header.locator('.pane-title').first();
    const actions = header.locator('.pane-header-actions').first();
    await expect(title).toBeVisible();
    await expect(actions).toBeVisible();

    const titleBox = await title.boundingBox();
    const actionsBox = await actions.boundingBox();
    expect(titleBox).toBeTruthy();
    expect(actionsBox).toBeTruthy();
    expect((titleBox!.x + titleBox!.width)).toBeLessThanOrEqual(actionsBox!.x + 1);
  });

  test('dragging a pane onto another pane center swaps the two notes', async ({ page }) => {
    await createTwoNotesAndSplit(page);

    await dragPaneToPane(page, 0, 1, 'center');

    const panes = page.locator('.note-pane-leaf');
    await expect(panes.nth(0)).toContainText('Beta pane body');
    await expect(panes.nth(1)).toContainText('Alpha pane body');
  });

  test('clicking pane header controls does not start pane moving', async ({ page }) => {
    await createTwoNotesAndSplit(page);

    await page.locator('.note-pane-header').first().getByRole('button', { name: 'More' }).click();

    await expect(page.locator('.pane-move-preview-rect')).toHaveCount(0);
    await expect(page.getByRole('menu', { name: 'Pane options' })).toBeVisible();
  });

  test('dragging a pane to an edge moves it and changes split orientation', async ({ page }) => {
    await createTwoNotesAndSplit(page);

    await dragPaneToPane(page, 1, 0, 'top');

    await expect(page.locator('.note-pane-group[data-direction="vertical"]').first()).toBeVisible();
    const panes = page.locator('.note-pane-leaf');
    await expect(panes.nth(0)).toContainText('Beta pane body');
    await expect(panes.nth(1)).toContainText('Alpha pane body');
  });

  test('dragging over another workspace tab activates it before dropping into its pane', async ({ page }) => {
    await createTwoNotesAndSplit(page);
    await createQuickNote(page, 'Gamma pane body');

    const tabs = page.locator('.workspace-tab');
    await expect(tabs).toHaveCount(2);
    await tabs.nth(0).click();
    await expect(page.locator('.note-pane-header')).toHaveCount(2);
    await expect(page.locator('.note-pane-leaf .ProseMirror')).toHaveCount(2);

    const sourceHeader = page.locator('.note-pane-leaf').nth(0).locator('.note-pane-header');
    const sourceBox = await sourceHeader.boundingBox();
    const targetTabBox = await tabs.nth(1).boundingBox();
    expect(sourceBox).toBeTruthy();
    expect(targetTabBox).toBeTruthy();

    await page.mouse.move(sourceBox!.x + 42, sourceBox!.y + sourceBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(sourceBox!.x + 52, sourceBox!.y + sourceBox!.height / 2);
    await page.mouse.move(targetTabBox!.x + targetTabBox!.width / 2, targetTabBox!.y + targetTabBox!.height / 2);
    await expect(tabs.nth(1)).toHaveClass(/active/, { timeout: 1200 });

    const targetPane = page.locator('.note-pane-leaf').first();
    const targetBox = await targetPane.boundingBox();
    expect(targetBox).toBeTruthy();
    await page.mouse.move(targetBox!.x + targetBox!.width - 12, targetBox!.y + targetBox!.height / 2);
    await expect(page.locator('.pane-move-preview-rect')).toBeVisible();
    await page.mouse.up();

    const panes = page.locator('.note-pane-leaf');
    await expect(panes).toHaveCount(2);
    await expect(panes.nth(0)).toContainText('Gamma pane body');
    await expect(panes.nth(1)).toContainText('Alpha pane body');
  });

  test('escape cancels an in-progress pane move without mutating layout', async ({ page }) => {
    await createTwoNotesAndSplit(page);

    const sourceHeader = page.locator('.note-pane-leaf').nth(0).locator('.note-pane-header');
    const targetPane = page.locator('.note-pane-leaf').nth(1);
    const sourceBox = await sourceHeader.boundingBox();
    const targetBox = await targetPane.boundingBox();
    expect(sourceBox).toBeTruthy();
    expect(targetBox).toBeTruthy();

    await page.mouse.move(sourceBox!.x + 42, sourceBox!.y + sourceBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(targetBox!.x + targetBox!.width / 2, targetBox!.y + targetBox!.height / 2);
    await expect(page.locator('.pane-move-preview-rect')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.mouse.up();

    const panes = page.locator('.note-pane-leaf');
    await expect(page.locator('.pane-move-preview-rect')).toHaveCount(0);
    await expect(panes.nth(0)).toContainText('Alpha pane body');
    await expect(panes.nth(1)).toContainText('Beta pane body');
  });
});
