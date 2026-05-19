/**
 * E2E tests for App Launch
 */
import { test, expect } from '@playwright/test';

test.describe('App Launch', () => {
  test('shows main interface', async ({ page }) => {
    await page.goto('/');

    // Wait for app to load
    await expect(page.locator('main')).toBeVisible();
  });

  test('shows global window titlebar controls', async ({ page }) => {
    await page.goto('/');

    const titlebar = page.locator('.app-titlebar');
    await expect(titlebar).toBeVisible();
    await expect(titlebar.getByRole('button', { name: 'Close window' })).toBeVisible();
    await expect(titlebar.getByRole('button', { name: 'Minimize window' })).toBeVisible();
    await expect(titlebar.getByRole('button', { name: 'Open help' })).toBeVisible();
  });

  test('titlebar help opens keyboard shortcuts', async ({ page }) => {
    await page.goto('/');

    await page.locator('.app-titlebar').getByRole('button', { name: 'Open help' }).click();

    await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
  });

  test('displays sidebar by default', async ({ page }) => {
    await page.goto('/');

    // Sidebar should be visible
    const sidebar = page.getByRole('navigation', { name: 'Notes navigation' });
    await expect(sidebar).toBeVisible();

    // Workspace identity should be visible
    await expect(sidebar.getByText('Void')).toBeVisible();
  });

  test('displays empty state when no notes', async ({ page }) => {
    await page.goto('/');

    // Should show empty state message
    await expect(page.getByRole('heading', { name: 'What are we capturing today?' })).toBeVisible();
  });

  test('opens settings panel', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('navigation', { name: 'Notes navigation' }).getByRole('button', { name: 'Settings' }).click();

    await expect(page.locator('.settings-panel')).toBeVisible();
  });

  test('shows new note button', async ({ page }) => {
    await page.goto('/');

    // New Note button in sidebar
    await expect(
      page.getByRole('navigation', { name: 'Notes navigation' }).getByRole('button', { name: 'Create new note' })
    ).toBeVisible();
  });
});
