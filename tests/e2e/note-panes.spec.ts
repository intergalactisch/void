import { expect, test, type Page } from '@playwright/test';

const splitPaneError = 'Editor container not found';

async function resetApp(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('main')).toBeVisible();
}

async function createQuickNote(page: Page, body: string) {
  await page.keyboard.press('Meta+n');
  const editor = page.locator('.ProseMirror').first();
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
  await page.evaluate(({ sourceIndex, targetIndex, zone }) => {
    const panes = Array.from(document.querySelectorAll<HTMLElement>('.note-pane-leaf'));
    const source = panes[sourceIndex];
    const target = panes[targetIndex];
    if (!source || !target) throw new Error('Pane not found');

    const rect = target.getBoundingClientRect();
    const points = {
      center: [rect.left + rect.width / 2, rect.top + rect.height / 2],
      left: [rect.left + 12, rect.top + rect.height / 2],
      right: [rect.right - 12, rect.top + rect.height / 2],
      top: [rect.left + rect.width / 2, rect.top + 12],
      bottom: [rect.left + rect.width / 2, rect.bottom - 12],
    } as const;
    const [clientX, clientY] = points[zone];
    const data = new DataTransfer();
    data.effectAllowed = 'move';
    data.setData('application/x-void-pane', JSON.stringify({
      tabId: source.dataset.tabId,
      paneId: source.dataset.paneId,
      notePath: source.dataset.notePath,
    }));

    for (const type of ['dragenter', 'dragover', 'drop']) {
      target.dispatchEvent(new DragEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX,
        clientY,
        dataTransfer: data,
      }));
    }
  }, { sourceIndex, targetIndex, zone });
}

test.describe('note split panes', () => {
  test.beforeEach(async ({ page }) => {
    await resetApp(page);
  });

  test('first split from a single note opens a picker without a stale mount error', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

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

  test('dragging a pane to an edge moves it and changes split orientation', async ({ page }) => {
    await createTwoNotesAndSplit(page);

    await dragPaneToPane(page, 1, 0, 'top');

    await expect(page.locator('.note-pane-group[data-direction="vertical"]').first()).toBeVisible();
    const panes = page.locator('.note-pane-leaf');
    await expect(panes.nth(0)).toContainText('Beta pane body');
    await expect(panes.nth(1)).toContainText('Alpha pane body');
  });
});
