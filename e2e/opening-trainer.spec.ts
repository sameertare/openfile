import { test, expect } from '@playwright/test';

test.describe('Opening Trainer', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/opening-trainer.html');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
  });

  test('loads the default repertoire and lets you click through the book line', async ({ page }) => {
    await expect(page.locator('#repertoire-description')).toContainText('Haxo Gambit');
    await expect(page.locator('#your-moves')).toContainText('e4');

    await page.locator('#your-moves .move-btn', { hasText: 'e4' }).click();
    await expect(page.locator('#your-moves')).toContainText('e5');
  });

  test('shows a live Stockfish eval that updates after every move', async ({ page }) => {
    await expect(page.locator('#trainer-candidates')).toContainText('e4', { timeout: 15000 });
    await expect(page.locator('#trainer-candidates')).toContainText('in this repertoire');

    await page.locator('#your-moves .move-btn', { hasText: 'e4' }).click();
    await expect(page.locator('#trainer-candidates')).toContainText('Analyzing');
    await expect(page.locator('#trainer-candidates')).toContainText('e5', { timeout: 15000 });
  });

  test('switching repertoires resets the board and shows the new description', async ({ page }) => {
    await page.selectOption('#repertoire-select', 'panov-white');
    await expect(page.locator('#repertoire-description')).toContainText('Panov');
    await expect(page.locator('#your-moves')).toContainText('e4');
  });

  test('drilling quizzes the recommended move and gives feedback', async ({ page }) => {
    await page.click('#drill-start-btn');
    await expect(page.locator('#drill-session')).toBeVisible();

    // The tree walk visits the root before its children, so the very first due card in a fresh
    // session (no localStorage) is always the start position, asking for White's first move.
    await page.locator('#drill-board [data-sq="e2"]').click();
    await page.locator('#drill-board [data-sq="e4"]').click();
    await expect(page.locator('#drill-feedback')).toContainText('Correct');
  });
});
