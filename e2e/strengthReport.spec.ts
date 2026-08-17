import { test, expect } from '@playwright/test';

test.describe('Strength Report', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/strength-report.html');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
  });

  test('loads bundled sample games and produces a strengths/weaknesses report', async ({ page }) => {
    await page.click('#load-sample');
    await expect(page.locator('#config-card')).toBeVisible({ timeout: 15000 });

    await page.selectOption('#depth-select', '0');
    await page.click('#analyze-btn');

    await expect(page.locator('#results')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('#results')).not.toBeEmpty();
  });

  test('accepts a single pasted PGN game', async ({ page }) => {
    const pgn = `[Event "Casual game"]\n[Site "https://lichess.org/abcd1234"]\n[White "Hero"]\n[Black "Villain"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 1-0`;
    await page.fill('#paste-pgn', pgn);
    await page.click('#paste-pgn-btn');
    await expect(page.locator('#paste-pgn-status')).not.toBeEmpty();
    await expect(page.locator('#config-card')).toBeVisible();
  });
});

test.describe('Opening Explorer', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/opening-explorer.html');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
  });

  test('loads bundled sample games and builds a browsable opening tree', async ({ page }) => {
    await page.click('#load-sample');
    await expect(page.locator('#config-card')).toBeVisible({ timeout: 15000 });
    // The tree builds automatically once games + player are detected — no separate "build" click.
    await expect(page.locator('body')).toContainText(/games/i, { timeout: 15000 });
  });
});
