import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GAME_FIXTURE = path.join(__dirname, 'fixtures', 'game.pgn');

test.describe('Openings Deviation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/opening-deviation.html');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
  });

  test('accepts a pasted repertoire and an uploaded game, and shows a results table', async ({ page }) => {
    await page.fill('#rep-paste', '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6');
    await page.click('#rep-load-paste-btn');
    await expect(page.locator('#rep-summary')).not.toBeEmpty();

    await page.setInputFiles('#file-input', GAME_FIXTURE);
    await expect(page.locator('#results-card')).toBeVisible({ timeout: 10000 });
    expect(await page.locator('#results-tbody tr').count()).toBeGreaterThanOrEqual(1);
  });
});
