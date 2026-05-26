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

async function selectedTreeNotePath(page: Page): Promise<string> {
  const row = page.locator('.note-item[aria-selected="true"][data-note-path]').first();
  await expect(row).toBeVisible();
  const path = await row.getAttribute('data-note-path');
  expect(path).toBeTruthy();
  return path!;
}

function treeNoteRow(page: Page, path: string) {
  return page.locator(`.note-item[data-note-path="${path.replace(/"/g, '\\"')}"]`).first();
}

function treeFolderRow(page: Page, path: string) {
  return page.locator(`.note-item-folder[data-note-path="${path.replace(/"/g, '\\"')}"]`).first();
}

async function closeActiveWorkspaceTab(page: Page) {
  await page.locator('.workspace-tab.active').getByRole('button', { name: 'Close workspace tab' }).click();
}

async function createFolderAtRoot(page: Page, name: string) {
  await page.getByRole('button', { name: 'New folder at root' }).click();
  const input = page.getByRole('dialog').getByRole('textbox');
  await input.fill(name);
  await page.getByRole('button', { name: /create folder/i }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

async function openFolderOverviewByName(page: Page, name: string) {
  await treeFolderRow(page, name).click();
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
}

async function createFolderOverviewNote(page: Page, body: string) {
  await page.locator('.folder-overview').getByRole('button', { name: 'New note' }).click();
  await expect(page.locator('.workspace-tab.active')).toBeVisible();
  const editor = page.locator('.note-pane-single-target .ProseMirror').first();
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.type(body);
  await page.keyboard.press('Meta+s');
  await page.waitForTimeout(250);
}

async function createTwoNotesAndSplit(page: Page) {
  await createQuickNote(page, 'Alpha pane body');
  const alphaPath = await selectedTreeNotePath(page);
  await createQuickNote(page, 'Beta pane body');
  const betaPath = await selectedTreeNotePath(page);

  const tabs = page.locator('.workspace-tab');
  await expect(tabs).toHaveCount(2);
  await tabs.nth(1).getByRole('button', { name: 'Close workspace tab' }).click();
  await expect(tabs).toHaveCount(1);
  await tabs.nth(0).click();
  await tabs.nth(0).click({ button: 'right' });
  await page.getByRole('menuitem', { name: /Split Right/ }).click();

  await expect(page.locator('.note-pane-leaf')).toHaveCount(2);
  await expect(page.locator('.split-note-picker')).toBeVisible();
  const betaResult = page.locator(`.split-note-result[data-note-path="${betaPath.replace(/"/g, '\\"')}"]`);
  await expect(betaResult).toBeVisible();
  await expect(page.getByText(splitPaneError)).toHaveCount(0);

  await betaResult.click();
  await expect(page.locator('.split-note-picker')).toHaveCount(0);
  await expect(page.locator('.note-pane-leaf')).toHaveCount(2);
  await expect(page.locator('.note-pane-leaf .ProseMirror')).toHaveCount(2);
  return { alphaPath, betaPath };
}

async function createThreeNoteMixedLayout(page: Page) {
  await createQuickNote(page, 'Alpha mixed body');
  const alphaPath = await selectedTreeNotePath(page);
  await createQuickNote(page, 'Beta mixed body');
  const betaPath = await selectedTreeNotePath(page);
  await createQuickNote(page, 'Gamma mixed body');
  const gammaPath = await selectedTreeNotePath(page);

  await closeActiveWorkspaceTab(page);
  await closeActiveWorkspaceTab(page);
  await expect(page.locator('.workspace-tab')).toHaveCount(1);

  await treeNoteRow(page, betaPath).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Open in Split Right' }).click();
  await expect(page.locator('.note-pane-leaf')).toHaveCount(2);

  await page.locator('.note-pane-leaf').nth(1).locator('.note-pane-header').getByRole('button', { name: 'Split Down' }).click();
  await expect(page.locator('.split-note-picker')).toBeVisible();
  await page.locator(`.split-note-result[data-note-path="${gammaPath.replace(/"/g, '\\"')}"]`).click();
  await expect(page.locator('.split-note-picker')).toHaveCount(0);
  await expect(page.locator('.note-pane-leaf')).toHaveCount(3);

  return { alphaPath, betaPath, gammaPath };
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

async function dragTreeNoteToPane(
  page: Page,
  sourcePath: string,
  targetIndex: number,
  zone: 'left' | 'right' | 'top' | 'bottom',
) {
  const sourceRow = treeNoteRow(page, sourcePath);
  const targetPane = page.locator('.note-pane-leaf').nth(targetIndex);
  const targetBox = await targetPane.boundingBox();
  expect(targetBox).toBeTruthy();

  const points = {
    left: [12, targetBox!.height / 2],
    right: [targetBox!.width - 12, targetBox!.height / 2],
    top: [targetBox!.width / 2, 12],
    bottom: [targetBox!.width / 2, targetBox!.height - 12],
  } as const;
  const [targetX, targetY] = points[zone];

  await sourceRow.dragTo(targetPane, {
    targetPosition: { x: targetX, y: targetY },
    force: true,
  });
  await expect(page.locator('.pane-drop-overlay')).toHaveCount(0);
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
    const secondPath = await selectedTreeNotePath(page);

    const tabs = page.locator('.workspace-tab');
    await tabs.nth(1).getByRole('button', { name: 'Close workspace tab' }).click();
    await tabs.nth(0).click({ button: 'right' });
    await page.getByRole('menuitem', { name: /Split Right/ }).click();
    await page.locator(`.split-note-result[data-note-path="${secondPath.replace(/"/g, '\\"')}"]`).click();

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

  test('context menu focuses already-open notes instead of offering duplicate open actions', async ({ page }) => {
    await createQuickNote(page, 'Alpha focus body');
    const alphaPath = await selectedTreeNotePath(page);
    await createQuickNote(page, 'Beta focus body');

    await treeNoteRow(page, alphaPath).click({ button: 'right' });
    const menu = page.getByRole('menu', { name: 'Note options' });
    await expect(menu.getByRole('menuitem', { name: 'Focus Open Note' })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Open in New Tab' })).toHaveCount(0);
    await expect(menu.getByRole('menuitem', { name: 'Open in Split Down' })).toHaveCount(0);
    await expect(menu.getByRole('menuitem', { name: 'Open in New Layout' })).toHaveCount(0);

    await menu.getByRole('menuitem', { name: 'Focus Open Note' }).click();
    await expect(page.locator('.ProseMirror').first()).toContainText('Alpha focus body');
  });

  test('open indicators appear in sidebar, quick switcher, and split picker', async ({ page }) => {
    await createQuickNote(page, 'Alpha open indicator body');
    const alphaPath = await selectedTreeNotePath(page);
    await createQuickNote(page, 'Beta open indicator body');
    const betaPath = await selectedTreeNotePath(page);
    await closeActiveWorkspaceTab(page);

    await treeNoteRow(page, betaPath).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Open in Split Right' }).click();

    await expect(treeNoteRow(page, alphaPath).locator('[data-open-note-state="open"]')).toBeVisible();
    await expect(treeNoteRow(page, betaPath).locator('[data-open-note-state="focused"]')).toBeVisible();

    await page.keyboard.press('Meta+p');
    const switcher = page.getByRole('dialog', { name: 'Quick Switcher' });
    await expect(switcher).toBeVisible();
    await expect(switcher.locator('.switcher-item [data-open-note-state]').first()).toBeVisible();
    await page.keyboard.press('Escape');

    await page.locator('.note-pane-leaf').nth(1).locator('.note-pane-header').getByRole('button', { name: 'Split Right' }).click();
    await expect(page.locator('.split-note-picker')).toBeVisible();
    const splitAlpha = page.locator(`.split-note-result[data-note-path="${alphaPath.replace(/"/g, '\\"')}"]`);
    await expect(splitAlpha).toBeVisible();
    await expect(splitAlpha.locator('[data-open-note-state="open"]')).toBeVisible();
  });

  test('selecting an already-open note from the split picker focuses it without leaving a placeholder', async ({ page }) => {
    const { alphaPath } = await createTwoNotesAndSplit(page);

    await page.locator('.note-pane-leaf').nth(1).locator('.note-pane-header').getByRole('button', { name: 'Split Right' }).click();
    await expect(page.locator('.split-note-picker')).toBeVisible();
    await page.locator(`.split-note-result[data-note-path="${alphaPath.replace(/"/g, '\\"')}"]`).click();

    const panes = page.locator('.note-pane-leaf');
    await expect(page.locator('.split-note-picker')).toHaveCount(0);
    await expect(panes).toHaveCount(2);
    await expect(panes.nth(0)).toContainText('Alpha pane body');
    await expect(panes.nth(0)).toHaveClass(/active/);
    await expect(panes.nth(1)).toContainText('Beta pane body');
  });

  test('unopened note context menu can open in a split or a new layout', async ({ page }) => {
    await createQuickNote(page, 'Alpha open target body');
    await createQuickNote(page, 'Beta split target body');
    const betaPath = await selectedTreeNotePath(page);
    await closeActiveWorkspaceTab(page);

    await treeNoteRow(page, betaPath).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Open in Split Right' }).click();
    await expect(page.locator('.note-pane-leaf')).toHaveCount(2);
    await expect(page.locator('body')).toContainText('Beta split target body');

    await resetApp(page);
    await createQuickNote(page, 'Alpha layout target body');
    await createQuickNote(page, 'Beta layout target body');
    const layoutBetaPath = await selectedTreeNotePath(page);
    await closeActiveWorkspaceTab(page);

    await treeNoteRow(page, layoutBetaPath).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Open in New Layout' }).click();
    await expect(page.locator('.note-pane-leaf')).toHaveCount(2);
    await expect(page.locator('.note-pane-leaf').nth(0)).toContainText('Beta layout target body');
    await expect(page.locator('.note-pane-leaf').nth(0)).toHaveClass(/active/);
    await expect(page.locator('.note-pane-leaf').nth(1)).toContainText('Alpha layout target body');
  });

  test('Open in Split Right appends an unopened note to the visible layout edge', async ({ page }) => {
    await createTwoNotesAndSplit(page);
    await createQuickNote(page, 'Gamma right edge body');
    const gammaPath = await selectedTreeNotePath(page);
    await closeActiveWorkspaceTab(page);

    await treeNoteRow(page, gammaPath).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Open in Split Right' }).click();

    const panes = page.locator('.note-pane-leaf');
    await expect(panes).toHaveCount(3);
    await expect(panes.nth(0)).toContainText('Alpha pane body');
    await expect(panes.nth(1)).toContainText('Beta pane body');
    await expect(panes.nth(2)).toContainText('Gamma right edge body');

    const widths = await panes.evaluateAll((nodes) =>
      nodes.map((node) => node.getBoundingClientRect().width),
    );
    expect(Math.max(...widths) - Math.min(...widths)).toBeLessThan(14);
  });

  test('Open in Split Down appends an unopened note to the visible layout edge', async ({ page }) => {
    await createQuickNote(page, 'Alpha row edge body');
    await createQuickNote(page, 'Beta row edge body');
    const betaPath = await selectedTreeNotePath(page);
    await createQuickNote(page, 'Gamma row edge body');
    const gammaPath = await selectedTreeNotePath(page);
    await closeActiveWorkspaceTab(page);
    await closeActiveWorkspaceTab(page);

    await treeNoteRow(page, betaPath).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Open in Split Down' }).click();
    await treeNoteRow(page, gammaPath).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Open in Split Down' }).click();

    const panes = page.locator('.note-pane-leaf');
    await expect(panes).toHaveCount(3);
    await expect(panes.nth(0)).toContainText('Alpha row edge body');
    await expect(panes.nth(1)).toContainText('Beta row edge body');
    await expect(panes.nth(2)).toContainText('Gamma row edge body');

    const heights = await panes.evaluateAll((nodes) =>
      nodes.map((node) => node.getBoundingClientRect().height),
    );
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(14);
  });

  test('unopened note can be added to an existing multi-pane layout', async ({ page }) => {
    await createTwoNotesAndSplit(page);
    await createQuickNote(page, 'Gamma existing layout body');
    const gammaPath = await selectedTreeNotePath(page);
    await closeActiveWorkspaceTab(page);

    await treeNoteRow(page, gammaPath).click({ button: 'right' });
    const existingLayout = page.getByRole('menuitem', { name: 'Open in Existing Layout' });
    await expect(existingLayout).toBeVisible();
    await existingLayout.hover();
    await expect(page.locator('.context-submenu button:not(:disabled)')).toHaveCount(1);
    await page.locator('.context-submenu button:not(:disabled)').first().click();

    await expect(page.locator('.note-pane-leaf')).toHaveCount(3);
    await expect(page.locator('body')).toContainText('Alpha pane body');
    await expect(page.locator('body')).toContainText('Beta pane body');
    await expect(page.locator('body')).toContainText('Gamma existing layout body');
  });

  test('Escape closes note context menus and layout submenus', async ({ page }) => {
    await createTwoNotesAndSplit(page);
    await createQuickNote(page, 'Gamma escape menu body');
    const gammaPath = await selectedTreeNotePath(page);
    await closeActiveWorkspaceTab(page);

    await treeNoteRow(page, gammaPath).click({ button: 'right' });
    await expect(page.getByRole('menu', { name: 'Note options' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu', { name: 'Note options' })).toHaveCount(0);

    await treeNoteRow(page, gammaPath).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Open in Existing Layout' }).hover();
    await expect(page.locator('.context-submenu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu', { name: 'Note options' })).toHaveCount(0);
    await expect(page.locator('.context-submenu')).toHaveCount(0);
  });

  test('Escape closes workspace tab and pane more menus', async ({ page }) => {
    await createTwoNotesAndSplit(page);

    await page.locator('.workspace-tab.active').click({ button: 'right' });
    await expect(page.getByRole('menu', { name: 'Tab options' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu', { name: 'Tab options' })).toHaveCount(0);

    await page.locator('.note-pane-header').first().getByRole('button', { name: 'More' }).click();
    await expect(page.getByRole('menu', { name: 'Pane options' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu', { name: 'Pane options' })).toHaveCount(0);
  });

  test('Cmd+W in a multi-pane layout closes the focused note only', async ({ page }) => {
    await createTwoNotesAndSplit(page);

    const panes = page.locator('.note-pane-leaf');
    await panes.nth(1).locator('.ProseMirror').click();
    await page.keyboard.press('Meta+w');

    await expect(panes).toHaveCount(1);
    await expect(panes.first()).toContainText('Alpha pane body');
    await expect(panes.first()).not.toContainText('Beta pane body');
    await expect(panes.first()).toHaveClass(/active/);
  });

  test('closing one of four side-by-side panes rebalances the remaining widths', async ({ page }) => {
    await createQuickNote(page, 'Alpha width body');
    await createQuickNote(page, 'Beta width body');
    const betaPath = await selectedTreeNotePath(page);
    await createQuickNote(page, 'Gamma width body');
    const gammaPath = await selectedTreeNotePath(page);
    await createQuickNote(page, 'Delta width body');
    const deltaPath = await selectedTreeNotePath(page);

    await closeActiveWorkspaceTab(page);
    await closeActiveWorkspaceTab(page);
    await closeActiveWorkspaceTab(page);
    await expect(page.locator('.workspace-tab')).toHaveCount(1);

    for (const path of [betaPath, gammaPath, deltaPath]) {
      await treeNoteRow(page, path).click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Open in Split Right' }).click();
    }
    await expect(page.locator('.note-pane-leaf')).toHaveCount(4);

    await page.locator('.note-pane-leaf').nth(3).locator('.ProseMirror').click();
    await page.keyboard.press('Meta+w');
    await expect(page.locator('.note-pane-leaf')).toHaveCount(3);

    const widths = await page.locator('.note-pane-leaf').evaluateAll((nodes) =>
      nodes.map((node) => node.getBoundingClientRect().width),
    );
    const max = Math.max(...widths);
    const min = Math.min(...widths);
    expect(max - min).toBeLessThan(14);
  });

  test('dragging a pane from a mixed layout into a row creates equal columns with an honest preview', async ({ page }) => {
    await createThreeNoteMixedLayout(page);

    const sourceHeader = page.locator('.note-pane-leaf').nth(2).locator('.note-pane-header');
    const targetPane = page.locator('.note-pane-leaf').nth(1);
    const sourceBox = await sourceHeader.boundingBox();
    const targetBox = await targetPane.boundingBox();
    expect(sourceBox).toBeTruthy();
    expect(targetBox).toBeTruthy();

    await page.mouse.move(sourceBox!.x + 42, sourceBox!.y + sourceBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(sourceBox!.x + 52, sourceBox!.y + sourceBox!.height / 2);
    await page.mouse.move(targetBox!.x + targetBox!.width - 12, targetBox!.y + targetBox!.height / 2);
    const preview = page.locator('.pane-move-preview-rect');
    await expect(preview).toBeVisible();

    const workspaceBox = await page.locator('.note-pane-workspace').boundingBox();
    const previewBox = await preview.boundingBox();
    expect(workspaceBox).toBeTruthy();
    expect(previewBox).toBeTruthy();
    expect(Math.abs(previewBox!.width - workspaceBox!.width / 3)).toBeLessThan(16);

    await page.mouse.up();
    await expect(page.locator('.pane-move-preview-rect')).toHaveCount(0);

    const panes = page.locator('.note-pane-leaf');
    await expect(panes).toHaveCount(3);
    await expect(panes.nth(0)).toContainText('Alpha mixed body');
    await expect(panes.nth(1)).toContainText('Beta mixed body');
    await expect(panes.nth(2)).toContainText('Gamma mixed body');
    const widths = await panes.evaluateAll((nodes) =>
      nodes.map((node) => node.getBoundingClientRect().width),
    );
    expect(Math.max(...widths) - Math.min(...widths)).toBeLessThan(14);
  });

  test('dragging a sidebar note into a mixed layout edge creates equal columns', async ({ page }) => {
    await createQuickNote(page, 'Alpha mixed body');
    await createQuickNote(page, 'Beta mixed body');
    const betaPath = await selectedTreeNotePath(page);
    await createQuickNote(page, 'Gamma mixed body');
    const gammaPath = await selectedTreeNotePath(page);
    await createQuickNote(page, 'Delta dragged body');
    const deltaPath = await selectedTreeNotePath(page);

    await closeActiveWorkspaceTab(page);
    await closeActiveWorkspaceTab(page);
    await closeActiveWorkspaceTab(page);
    await expect(page.locator('.workspace-tab')).toHaveCount(1);

    await treeNoteRow(page, betaPath).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Open in Split Right' }).click();
    await expect(page.locator('.note-pane-leaf')).toHaveCount(2);

    await page.locator('.note-pane-leaf').nth(1).locator('.note-pane-header').getByRole('button', { name: 'Split Down' }).click();
    await expect(page.locator('.split-note-picker')).toBeVisible();
    await page.locator(`.split-note-result[data-note-path="${gammaPath.replace(/"/g, '\\"')}"]`).click();
    await expect(page.locator('.split-note-picker')).toHaveCount(0);
    await expect(page.locator('.note-pane-leaf')).toHaveCount(3);

    await dragTreeNoteToPane(page, deltaPath, 1, 'right');

    const panes = page.locator('.note-pane-leaf');
    await expect(panes).toHaveCount(4);
    await expect(panes.nth(0)).toContainText('Alpha mixed body');
    await expect(panes.nth(1)).toContainText('Beta mixed body');
    await expect(panes.nth(2)).toContainText('Delta dragged body');
    await expect(panes.nth(3)).toContainText('Gamma mixed body');
    const widths = await panes.evaluateAll((nodes) =>
      nodes.map((node) => node.getBoundingClientRect().width),
    );
    expect(Math.max(...widths) - Math.min(...widths)).toBeLessThan(14);
  });

  test('switching from a single-note tab back to a multi-pane tab renders pane editors', async ({ page }) => {
    await createTwoNotesAndSplit(page);
    await createQuickNote(page, 'Gamma single tab body');

    const tabs = page.locator('.workspace-tab');
    await expect(tabs).toHaveCount(2);
    await tabs.nth(0).click();
    await expect(page.locator('.note-pane-leaf .ProseMirror')).toHaveCount(2);
    await expect(page.locator('body')).toContainText('Alpha pane body');
    await expect(page.locator('body')).toContainText('Beta pane body');

    await tabs.nth(1).click();
    await expect(page.locator('.note-pane-single-target .ProseMirror')).toBeVisible();
    await expect(page.locator('.ProseMirror').first()).toContainText('Gamma single tab body');
  });

  test('folder context menu opens recursive notes as a capped layout', async ({ page }) => {
    await createQuickNote(page, 'Root note just enables folders');
    await createFolderAtRoot(page, 'Pane Folder');
    await openFolderOverviewByName(page, 'Pane Folder');
    await createFolderOverviewNote(page, 'Folder layout first body');
    await openFolderOverviewByName(page, 'Pane Folder');
    await createFolderOverviewNote(page, 'Folder layout second body');

    await treeFolderRow(page, 'Pane Folder').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Open Folder as Layout' }).click();

    await expect(page.locator('.note-pane-leaf')).toHaveCount(2);
    await expect(page.locator('body')).toContainText('Folder layout first body');
    await expect(page.locator('body')).toContainText('Folder layout second body');
  });
});
