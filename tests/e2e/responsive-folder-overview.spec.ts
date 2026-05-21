/**
 * Verifies the FolderOverview lays out correctly across breakpoints —
 * specifically that the title doesn't wrap per-character at narrow widths
 * (the bug shown in the screenshot that prompted this work).
 *
 * The setup creates a note (so the sidebar shows the FOLDERS panel),
 * then creates a folder, then selects it to render FolderOverview.
 */
import { test, expect } from '@playwright/test';

async function setupWorkspaceWithFolder(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByRole('heading', { name: 'What are we capturing today?' }).waitFor();

  // Create a starter note so the sidebar pivots to its normal tree layout.
  await page.getByRole('button', { name: /^New note/ }).click();
  await page.waitForTimeout(300);

  // Open command palette via Cmd+Shift+P to find folder creation, OR use
  // the sidebar's new-folder button (only visible when notes exist).
  // The "New folder at root" button is in the sidebar — but only when
  // the tree-container is visible. Open the drawer first on narrow.
  const vp = page.viewportSize();
  if (vp && vp.width < 880) {
    const toggle = page.getByRole('button', { name: 'Toggle sidebar' });
    if (await toggle.isVisible()) {
      await toggle.click();
      await page.waitForTimeout(350);
    }
  }
  await page.getByRole('button', { name: 'New folder at root' }).click();
  const input = page.getByRole('dialog').getByRole('textbox');
  await input.fill('Test');
  await page.getByRole('button', { name: /create folder/i }).click();
  await page.getByRole('treeitem', { name: 'Test' }).waitFor();
  await page.getByRole('treeitem', { name: 'Test' }).click();
  await page.getByRole('heading', { name: 'Test', level: 1 }).waitFor();
}

const sizes = [
  { name: '01-360', width: 360 },
  { name: '02-480', width: 480 },
  { name: '03-640', width: 640 },
  { name: '04-768', width: 768 },
  { name: '05-870', width: 870 },
  { name: '06-1024', width: 1024 },
  { name: '07-1280', width: 1280 },
];

for (const size of sizes) {
  test(`folder overview ${size.name}px`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: 900 });
    await setupWorkspaceWithFolder(page);
    // Close the drawer if narrow so we see the overview content.
    if (size.width < 880) {
      // On narrow viewports, selecting a folder via the tree might not auto-close
      // the drawer for folder views (only notes do). Tap backdrop to close.
      const backdrop = page.locator('.sidebar-overlay-backdrop');
      if (await backdrop.isVisible()) {
        await backdrop.click({ position: { x: Math.floor(size.width * 0.85), y: 400 } });
        await page.waitForTimeout(350);
      }
    }
    // Verify the title is on one line (no wrapping bug).
    const h1 = page.getByRole('heading', { name: 'Test', level: 1 });
    const box = await h1.boundingBox();
    expect(box?.height ?? 0).toBeLessThan(60); // single line @ 24px font

    await page.screenshot({
      path: `test-results/responsive/folder-${size.name}.png`,
      fullPage: false,
    });
  });
}
