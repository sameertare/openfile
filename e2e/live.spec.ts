import { test, expect } from '@playwright/test';

test.describe('Game Analysis — Any position mode', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/live.html');
  });

  test('loading a FEN updates the board and turn indicator', async ({ page }) => {
    await page.fill('#fen-input', '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1');
    await page.click('#load-fen');
    await expect(page.locator('#board')).toBeVisible();
    await expect(page.locator('#turn-indicator')).not.toBeEmpty();
  });

  test('loading a PGN enables move-by-move navigation', async ({ page }) => {
    await page.fill('#pgn-input', '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6');
    await page.click('#load-pgn');
    await expect(page.locator('#nav-row')).toBeVisible();

    const plyBefore = await page.locator('#ply-counter').textContent();
    await page.click('#nav-fwd');
    await expect(page.locator('#ply-counter')).not.toHaveText(plyBefore ?? '');

    await page.click('#nav-first');
    await page.click('#nav-last');
    await expect(page.locator('#ply-counter')).toBeVisible();
  });

  test('Start position resets the board back to the initial FEN', async ({ page }) => {
    await page.fill('#fen-input', '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1');
    await page.click('#load-fen');
    await page.click('#reset-board');
    await expect(page.locator('#turn-indicator')).toContainText(/white/i);
  });

  test('Deep analysis (PV) actually runs the real Stockfish WASM engine and reports a result', async ({ page }) => {
    // The only end-to-end exercise of engine.ts's real Worker/WASM Stockfish wrapper — everything
    // else in this suite avoids invoking the engine to stay fast and deterministic. First WASM
    // load+compile can be slow, hence the generous timeout.
    test.setTimeout(60000);
    await page.selectOption('#depth-position', '12');
    await page.click('#suggest-btn');
    await expect(page.locator('#engine-out')).not.toBeEmpty({ timeout: 30000 });
  });
});

test.describe('Game Analysis — Endgame Drill mode', () => {
  test('switching to Drill mode and requesting a new position renders a board', async ({ page }) => {
    await page.goto('/live.html');
    await page.click('button[data-mode="drill"]');
    await expect(page.locator('#drill-layout')).toBeVisible();
    await page.click('#drill-new-btn');
    await expect(page.locator('#drill-board')).toBeVisible();
    await expect(page.locator('#drill-position-label')).not.toBeEmpty();
  });
});
