import { test, expect } from '@playwright/test';

test.describe('Performance Analysis', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/analyze.html');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
  });

  test('loads bundled sample games and produces a report using PGN-eval-only analysis', async ({ page }) => {
    await page.click('#load-sample');
    await expect(page.locator('#config-card')).toBeVisible({ timeout: 15000 });

    // "No engine — use PGN [%eval] tags only" keeps this test fast and fully deterministic.
    await page.selectOption('#depth-select', '0');
    await page.click('#analyze-btn');

    await expect(page.locator('#results')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('#results')).toContainText('Results by time control');
    await expect(page.locator('#results')).toContainText('Training recommendations');
    await expect(page.locator('#export-card')).toBeVisible();
  });

  test('downloading the report offers a report.md file', async ({ page }) => {
    await page.click('#load-sample');
    await expect(page.locator('#config-card')).toBeVisible({ timeout: 15000 });
    await page.selectOption('#depth-select', '0');
    await page.click('#analyze-btn');
    await expect(page.locator('#export-card')).toBeVisible({ timeout: 30000 });

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#download-md'),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.md$/);
  });
});
