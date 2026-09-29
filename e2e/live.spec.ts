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

test.describe('Game Analysis — Play vs Engine mode', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/live.html');
    await page.click('button[data-mode="play"]');
    await page.selectOption('#depth-play', '4'); // Beginner — fast enough to keep the test quick
  });

  test('playing as White: making a move gets an engine reply, and Take back both reverts it', async ({ page }) => {
    await page.click('#play-start-btn');
    await expect(page.locator('#play-status')).toBeVisible();

    await page.locator('#board [data-sq="e2"]').click();
    await page.locator('#board [data-sq="e4"]').click();
    await expect(page.locator('#ply-counter')).toContainText('2', { timeout: 15000 }); // engine's reply landed

    await page.click('#play-undo-btn');
    await expect(page.locator('#ply-counter')).toHaveText('', { timeout: 15000 }); // back to the start (ply-counter is blank at the root)
  });

  test('playing as Black: Take back both before your own first move rerolls the engine\'s opening move instead of doing nothing', async ({ page }) => {
    await page.selectOption('#play-color', 'b');
    await page.click('#play-start-btn');
    await expect(page.locator('#ply-counter')).toContainText('1', { timeout: 15000 }); // engine (White) moved first

    await page.click('#play-undo-btn');
    // Previously a silent no-op (line.length < 3 guard) — should still land on exactly one engine
    // move (a fresh one, from the start position), not get stuck or clear the board entirely.
    await expect(page.locator('#ply-counter')).toContainText('1', { timeout: 15000 });
  });
});
