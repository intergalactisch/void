/**
 * Visual snapshots at multiple viewport sizes to verify the responsive
 * layout work. This is a verification-only spec — it captures pages, it
 * doesn't assert specific pixels.
 */
import { test } from '@playwright/test';

const sizes = [
  { name: '01-phone-360', width: 360, height: 720 },
  { name: '02-phone-480', width: 480, height: 720 },
  { name: '03-tablet-640', width: 640, height: 800 },
  { name: '04-tablet-768', width: 768, height: 900 },
  { name: '05-tablet-870', width: 870, height: 900 },
  { name: '06-laptop-1024', width: 1024, height: 768 },
  { name: '07-laptop-1280', width: 1280, height: 800 },
  { name: '08-desktop-1440', width: 1440, height: 900 },
];

for (const size of sizes) {
  test(`snapshot ${size.name}`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.goto('/');
    // Wait for the empty state heading to confirm bootstrap is done.
    await page.getByRole('heading', { name: 'What are we capturing today?' }).waitFor({ timeout: 15000 });
    await page.waitForTimeout(400);
    await page.screenshot({
      path: `test-results/responsive/${size.name}-empty.png`,
      fullPage: false,
    });
  });
}
