import { expect, test, type Page } from '@playwright/test';

function localDateInput(offsetDays = 0): string {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + offsetDays);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function openTasks(page: Page) {
  await page.keyboard.press('Meta+Shift+t');
  await expect(page.getByRole('heading', { name: 'All' })).toBeVisible();
}

async function createTask(page: Page, title: string) {
  await page.locator('input[name="task-capture"]').fill(title);
  await page.keyboard.press('Enter');
  const row = page.locator('.task-row').filter({ hasText: title }).first();
  await expect(row).toBeVisible();
  return row;
}

test.describe('Todo date picker', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('main')).toBeVisible();
    await openTasks(page);
  });

  test('quick capture can choose Tomorrow before creating a task', async ({ page }) => {
    const title = `Date picker capture ${Date.now()}`;
    const capture = page.locator('.capture');

    await page.locator('input[name="task-capture"]').fill(title);
    await capture.getByRole('button', { name: 'Due date' }).click();
    await expect(page.getByRole('dialog', { name: 'Due date' })).toBeVisible();
    await page.getByRole('button', { name: 'Tomorrow' }).click();
    await capture.getByRole('button', { name: 'Add' }).click();

    const row = page.locator('.task-row').filter({ hasText: title }).first();
    await expect(row).toBeVisible();
    await expect(row.locator('.chip.due')).toContainText('Tomorrow');
  });

  test('quick capture opens due picker before a title is typed', async ({ page }) => {
    const capture = page.locator('.capture');

    await page.locator('input[name="task-capture"]').click();
    await capture.getByRole('button', { name: 'Due date' }).click();

    await expect(page.getByRole('dialog', { name: 'Due date' })).toBeVisible();
    await expect(capture.getByRole('button', { name: 'Due date' })).toBeVisible();
  });

  test('inspector can set and clear due/start dates', async ({ page }) => {
    const title = `Date picker inspector ${Date.now()}`;
    const row = await createTask(page, title);
    await row.click();

    const inspector = page.locator('.inspector');
    await expect(inspector).toBeVisible();

    await inspector.getByRole('button', { name: 'Due date' }).click();
    await page.getByRole('button', { name: 'Next week' }).click();
    await expect(inspector.getByRole('button', { name: 'Due date' })).toContainText('In 7 days');

    await inspector.getByRole('button', { name: 'Start date' }).click();
    await page.getByRole('dialog', { name: 'Start date' }).getByRole('button', { name: 'Today' }).click();
    await expect(inspector.getByRole('button', { name: 'Start date' })).toContainText('Today');

    await inspector.getByRole('button', { name: 'Due date' }).click();
    await page.getByRole('button', { name: 'Clear' }).click();
    await expect(inspector.getByRole('button', { name: 'Due date' })).toContainText('Add a deadline');
  });

  test('filters support presets, custom ranges, and clearing chips', async ({ page }) => {
    await page.getByRole('button', { name: /Filter/ }).click();
    await expect(page.getByRole('dialog', { name: 'Filters' })).toBeVisible();

    await page.getByRole('dialog', { name: 'Filters' }).getByRole('button', { name: 'Date range' }).click();
    await page.getByRole('button', { name: 'Last 7 days' }).click();
    await expect(page.locator('.chips')).toContainText('Smart date');
    await expect(page.locator('.chips')).toContainText('Last 7 days');

    const today = localDateInput(0);
    const tomorrow = localDateInput(1);
    await page.getByRole('dialog', { name: 'Filters' }).getByRole('button', { name: 'Date range' }).click();
    await page.locator(`.date-picker-panel button[data-date="${today}"]`).click();
    await page.locator(`.date-picker-panel button[data-date="${tomorrow}"]`).click();

    await expect(page.locator('.chips')).toContainText(today);
    await expect(page.locator('.chips')).toContainText(tomorrow);

    await page.getByRole('dialog', { name: 'Filters' }).getByRole('button', { name: 'Done' }).click();
    await page.locator('.chips .chip').filter({ hasText: today }).getByRole('button', { name: /Clear/ }).click();
    await expect(page.locator('.chips .chip').filter({ hasText: today })).toHaveCount(0);
  });

  test('calendar grid supports keyboard selection and Escape close', async ({ page }) => {
    const capture = page.locator('.capture');
    await page.locator('input[name="task-capture"]').fill(`Keyboard date ${Date.now()}`);

    await capture.getByRole('button', { name: 'Due date' }).click();
    const dialog = page.getByRole('dialog', { name: 'Due date' });
    await expect(dialog).toBeVisible();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    await expect(capture.getByRole('button', { name: 'Due date' })).toContainText('Tomorrow');

    await capture.getByRole('button', { name: 'Due date' }).click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
  });
});
