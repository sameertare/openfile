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

  test('shows an engine-backed theory departure and model continuation for each analyzed game', async ({ page }) => {
    await page.click('#load-sample');
    await expect(page.locator('#config-card')).toBeVisible({ timeout: 15000 });
    await page.selectOption('#depth-select', '8');
    await page.click('#analyze-btn');
    await expect(page.locator('#results')).toBeVisible({ timeout: 120000 });
    await expect(page.locator('#results')).toContainText('You left theory first');
    await expect(page.locator('th', { hasText: 'Theory' }).first()).toBeVisible();

    await page.locator('.assess-btn').first().click();
    const detail = page.locator('.assess-row:not([hidden])');
    await expect(detail).toContainText('Opening theory & Stockfish line');
    await expect(detail).toContainText('Stockfish 19');
    await expect(detail).toContainText('Model continuation');
  });
});
