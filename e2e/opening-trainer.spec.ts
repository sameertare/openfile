import { test, expect, type Page } from '@playwright/test';

const sqOf = (x: number, y: number) => 'abcdefgh'[Math.floor(x)] + (8 - Math.floor(y));

/** Reads the blue book-move arrow off the board (white at the bottom) as [from, to] squares. */
async function bookArrow(page: Page): Promise<[string, string]> {
  const line = page.locator('#ot-board svg.board-arrows line').first();
  await expect(line).toBeAttached({ timeout: 10000 });
  const [x1, y1, x2, y2] = await Promise.all(['x1', 'y1', 'x2', 'y2'].map(async (a) => parseFloat((await line.getAttribute(a))!)));
  return [sqOf(x1, y1), sqOf(x2, y2)];
}
const sq = (page: Page, s: string) => page.locator(`#ot-board [data-sq="${s}"]`);
async function playArrow(page: Page) {
  const [from, to] = await bookArrow(page);
  await sq(page, from).click();
  await sq(page, to).click();
}

test.describe('Opening Trainer', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/opening-trainer.html');
    await expect(page.locator('#ot-book-move')).not.toHaveText(''); // boot (async) must finish saving before we clear
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expect(page.locator('#ot-line-title')).not.toHaveText(/Loading/);
    await expect(page.locator('#ot-book-move')).not.toHaveText('');
  });

  test('loads a line with a book-move arrow, the book move, and the starting-position name', async ({ page }) => {
    await expect(page.locator('#ot-name')).toHaveText('Starting position');
    await expect(page.locator('#ot-book-move')).toHaveText('1.e4');
    await expect(page.locator('#ot-turn')).toContainText('White to move (you)');
    await expect(page.locator('#ot-progress')).toContainText('Viewing 1 of 2: arrows on every move.');
    expect(await bookArrow(page)).toEqual(['e2', 'e4']);
    // the opening picker carries status tags and sides
    await expect(page.locator('#ot-opening option:checked')).toContainText('Italian Game (White)');
  });

  test('playing the book line out completes it, scores it, and marks the line as learning', async ({ page }) => {
    test.setTimeout(90000);
    for (let i = 0; i < 12; i++) {
      await playArrow(page);
      await expect(page.locator('#ot-feedback')).toContainText('Book move');
      if (i < 11) await expect(page.locator('#ot-turn')).toContainText('(you)', { timeout: 5000 });
    }
    await expect(page.locator('#ot-done')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('#ot-done-msg')).toContainText('Line complete — no mistakes');
    await expect(page.locator('#ot-score-today')).toHaveText('17'); // 12 moves x 1 (arrow showing) + 5 clean-run bonus
    await expect(page.locator('#ot-line option:checked')).toContainText('◐');
  });

  test('a non-book move is rejected: it explains the book move, then puts the piece back', async ({ page }) => {
    await sq(page, 'd2').click();
    await sq(page, 'd4').click();
    await expect(page.locator('#ot-feedback')).toContainText('Not the book move — the book plays e4');
    await expect(page.locator('#ot-moves .lpm-move[data-i]')).toHaveCount(0);
    // after the brief preview the position is restored and you can play the right move
    await expect(page.locator('#ot-turn')).toContainText('White to move (you)');
    await page.waitForTimeout(1700);
    expect(await bookArrow(page)).toEqual(['e2', 'e4']);
    await sq(page, 'e2').click();
    await sq(page, 'e4').click();
    await expect(page.locator('#ot-moves .lpm-move[data-i]').first()).toHaveText('e4');
    await expect(page.locator('#ot-score-today')).toHaveText('0'); // a retry after a miss earns nothing
  });

  test('Stockfish grades the moves (colour-coded in the move list)', async ({ page }) => {
    await playArrow(page);
    await expect(page.locator('#ot-moves .lpm-move[data-i="0"]')).toHaveClass(/m-best/, { timeout: 15000 });
    await expect(page.locator('#ot-eval')).toContainText(/White|Black/, { timeout: 15000 });
  });

  test('Back / forward step through the line without breaking it', async ({ page }) => {
    await playArrow(page);
    await expect(page.locator('#ot-turn')).toContainText('(you)', { timeout: 5000 });
    await expect(page.locator('#ot-moves .lpm-move[data-i]')).toHaveCount(2);
    await page.click('#ot-back');
    await expect(page.locator('#ot-fwd')).toBeEnabled();
    await page.click('#ot-fwd');
    await expect(page.locator('#ot-fwd')).toBeDisabled();
    expect(await bookArrow(page)).toEqual(['g1', 'f3']);
  });

  test('Explore mode hides the line picker and offers book continuations', async ({ page }) => {
    await page.click('#ot-mode [data-mode="explore"]');
    await expect(page.locator('#ot-line-row')).toBeHidden();
    await expect(page.locator('#ot-continuations')).toBeVisible();
    await sq(page, 'e2').click();
    await sq(page, 'e4').click();
    await expect(page.locator('#ot-name')).toHaveText("King's Pawn Game");
    await page.locator('.ot-cont[data-san="e5"]').click();
    await expect(page.locator('#ot-moves .lpm-move[data-i]')).toHaveCount(2);
  });

  test('Play engine mode: the engine follows the book while you do, then plays on its own', async ({ page }) => {
    test.setTimeout(60000);
    await page.click('#ot-mode [data-mode="play"]');
    await sq(page, 'e2').click();
    await sq(page, 'e4').click();
    await expect(page.locator('#ot-moves .lpm-move[data-i]')).toHaveCount(2, { timeout: 5000 });
    await expect(page.locator('#ot-progress')).toHaveText('Still in book.');
    await sq(page, 'a2').click();
    await sq(page, 'a3').click();
    await expect(page.locator('#ot-progress')).toHaveText(/Out of book/);
    await expect(page.locator('#ot-moves .lpm-move[data-i]')).toHaveCount(4, { timeout: 30000 }); // engine answered
  });

  test('priority flag and settings persist across a reload', async ({ page }) => {
    await page.click('#ot-priority');
    await expect(page.locator('#ot-priority')).toContainText('✓');
    await page.locator('#ot-settings summary').click();
    await page.locator('#ot-fade').selectOption('4');
    await page.reload();
    await expect(page.locator('#ot-line-title')).not.toHaveText(/Loading/);
    await expect(page.locator('#ot-priority')).toContainText('✓');
    await expect(page.locator('#ot-fade')).toHaveValue('4');
  });

  test('progress can be exported and a bad import is rejected without touching saved progress', async ({ page }) => {
    await playArrow(page);
    await page.locator('#ot-settings summary').click();
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#ot-export')]);
    expect(download.suggestedFilename()).toMatch(/^opening-trainer-progress-\d{4}-\d{2}-\d{2}\.json$/);
    await page.setInputFiles('#ot-import-file', { name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"nope":true}') });
    await expect(page.locator('#ot-progress-msg')).toContainText('Could not read that file');
    await expect(page.locator('#ot-score-today')).toHaveText('1');
  });

  test('Start over resets progress', async ({ page }) => {
    await playArrow(page);
    await expect(page.locator('#ot-score-today')).toHaveText('1');
    await page.locator('#ot-settings summary').click();
    await page.click('#ot-reset');
    await page.click('#ot-reset-all');
    await expect(page.locator('#ot-score-today')).toHaveText('0');
    await expect(page.locator('#ot-progress-msg')).toContainText('All progress was reset');
  });
});
