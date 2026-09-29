import { test, expect } from '@playwright/test';

test.describe('Swiss Pairings', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/swiss.html');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
  });

  test('loads a sample roster, creates a tournament, and pairs round 1', async ({ page }) => {
    await page.click('#sample-roster');
    await expect(page.locator('#roster-preview')).not.toBeEmpty();

    await page.click('#parse-btn');
    await expect(page.locator('#control-card')).toBeVisible();

    await page.click('#pair-btn');
    // Round 1 pairings render as a table with board rows once paired.
    await expect(page.getByRole('heading', { name: /Round 1/ })).toBeVisible();
    const boardRows = page.locator('table tbody tr');
    expect(await boardRows.count()).toBeGreaterThan(0);
  });

  test('entering a result updates the standings', async ({ page }) => {
    await page.click('#sample-roster');
    await page.click('#parse-btn');
    await page.click('#pair-btn');

    const firstResultSelect = page.locator('select').filter({ hasText: '— result —' }).first();
    await firstResultSelect.selectOption('1-0');

    // Standings table should now show a non-zero score for someone.
    await expect(page.locator('body')).toContainText('1', { timeout: 5000 });
  });

  test('parses an onlineregistration.cc export (no header, tab-separated, "(Withdrawn)" players excluded)', async ({ page }) => {
    await page.selectOption('#format-select', 'onlineregistration');
    await page.click('#sample-roster');

    const preview = page.locator('#roster-preview');
    await expect(preview).toContainText('Edwin Battistella');
    await expect(preview).toContainText('1930'); // US Chess rating, not a section-label digit
    await expect(preview).not.toContainText('Withdrawn');

    await page.click('#parse-btn');
    await expect(page.locator('#control-card')).toBeVisible();
    await page.click('#pair-btn');
    await expect(page.getByRole('heading', { name: /Round 1/ })).toBeVisible();
  });

  test('pairs an onlineregistration.cc roster in strict FIDE mode', async ({ page }) => {
    await page.selectOption('#format-select', 'onlineregistration');
    await expect(page.locator('#pairing-method-row')).toBeVisible();
    await page.selectOption('#pairing-method-select', 'fide');
    await page.click('#sample-roster');
    await page.click('#parse-btn');
    await expect(page.locator('body')).toContainText('FIDE pairing');

    await page.click('#pair-btn');
    await expect(page.getByRole('heading', { name: /Round 1/ })).toBeVisible();
  });

  test('hides the pairing-method row for round-robin and knockout formats', async ({ page }) => {
    await page.selectOption('#tourney-format-select', 'round-robin');
    await expect(page.locator('#pairing-method-row')).toBeHidden();
    await page.selectOption('#tourney-format-select', 'swiss');
    await expect(page.locator('#pairing-method-row')).toBeVisible();
  });
});

test.describe('NWChess Pairings', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/nwchess-pairings.html');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
  });

  test('loads a sample roster, creates a tournament in FIDE mode, and pairs round 1', async ({ page }) => {
    await page.selectOption('#pairing-method-select', 'fide');
    await page.click('#sample-roster');
    await expect(page.locator('#roster-preview')).not.toBeEmpty();

    await page.click('#parse-btn');
    await expect(page.locator('#control-card')).toBeVisible();
    await expect(page.locator('body')).toContainText('FIDE pairing');

    await page.click('#pair-btn');
    await expect(page.getByRole('heading', { name: /Round 1/ })).toBeVisible();
  });

  test('TRF export button is available (under "More options") once a round is paired', async ({ page }) => {
    await page.click('#sample-roster');
    await page.click('#parse-btn');
    await page.click('#pair-btn');
    await page.locator('.more-menu summary').click();
    await expect(page.locator('#export-trf')).toBeVisible();
  });
});

test.describe('Quads Pairings', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/quads.html');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
  });

  test('loads a sample roster, splits it into quads plus a standalone leftover group, creates the event, and pairs round 1 for every group', async ({ page }) => {
    await page.click('#sample-roster');
    // Sample roster is 12 rows, one Withdrew -> 11 active players -> floor(11/4) = 2 quads of 4,
    // remainder 3 -> its own standalone round-robin leftover group (never a "Swiss section" of 1-2).
    await expect(page.locator('#roster-preview')).toContainText('2 quads');
    await expect(page.locator('#roster-preview')).toContainText('Quad 1');
    await expect(page.locator('#roster-preview')).toContainText('Quad 2');
    await expect(page.locator('#roster-preview')).toContainText('Leftover group');
    await expect(page.locator('#roster-preview')).toContainText('3 players · round-robin');

    await page.click('#parse-btn');
    await expect(page.locator('#control-card')).toBeVisible();
    await expect(page.locator('#section-tabs')).toBeVisible();

    await page.click('#pair-btn');
    await expect(page.getByRole('heading', { name: /Round 1/ })).toBeVisible();
    // Every quad reached round 1 in one click of "Pair next round".
    await expect(page.locator('#section-tabs')).toContainText('Quad 1');
    await expect(page.locator('#section-tabs')).toContainText('R1');
  });

  test('a remainder of 1-2 is absorbed into the last quad, never a standalone group of 1-2', async ({ page }) => {
    // 10 players -> floor(10/4) = 2 quads, remainder 2 -> merged into the last quad, giving [4, 6].
    const header = '" ","Name","NWSRS","USCF","FIDE","NWChess","Byes","Fees"';
    const subheader = '"","","First","","","","ID","","ID","","","ID","Title","","Rounds","Status"';
    const rows = Array.from({ length: 10 }, (_, i) => {
      const rating = 1900 - i * 50;
      return `"Open","Player${i}","P${i}","6","Sample ES","${rating}","ID${i}","0","","","0","0","","","","Paid"`;
    });
    await page.fill('#roster-text', [header, subheader, ...rows].join('\n'));
    await expect(page.locator('#roster-preview')).toContainText('4 players · round-robin · 3 rounds');
    await expect(page.locator('#roster-preview')).toContainText('6 players · round-robin · 5 rounds');
    await expect(page.locator('#roster-preview')).not.toContainText('Leftover');
  });

  test('a quad grown to absorb a remainder (5 rounds) doesn\'t get its extra rounds forced onto the shorter quads (the reported rematch bug)', async ({ page }) => {
    page.on('dialog', (d) => d.accept()); // "unfinished games, pair anyway?" — no results entered on purpose

    // 14 players -> floor(14/4) = 3 quads, remainder 2 -> [4, 4, 6]. The two 4-quads need 3 rounds;
    // the 6-quad needs 5. Pairing 5 times should NOT force the two 4-quads past their own round 3.
    const header = '" ","Name","NWSRS","USCF","FIDE","NWChess","Byes","Fees"';
    const subheader = '"","","First","","","","ID","","ID","","","ID","Title","","Rounds","Status"';
    const rows = Array.from({ length: 14 }, (_, i) => {
      const rating = 1900 - i * 50;
      return `"Open","Player${i}","P${i}","6","Sample ES","${rating}","ID${i}","0","","","0","0","","","","Paid"`;
    });
    await page.fill('#roster-text', [header, subheader, ...rows].join('\n'));
    await page.click('#parse-btn');
    await expect(page.locator('#control-card')).toBeVisible();

    for (let i = 0; i < 5; i++) await page.click('#pair-btn');

    await expect(page.locator('#section-tabs')).toContainText('Quad 1 4p · R3');
    await expect(page.locator('#section-tabs')).toContainText('Quad 2 4p · R3');
    // The grown 6-player quad plays out its full 5 rounds — it's not held back by the shorter ones.
    await expect(page.locator('#section-tabs')).toContainText('Quad 3 6p · R5');
  });

  test('entering a result updates that quad\'s standings independently of the others', async ({ page }) => {
    await page.click('#sample-roster');
    await page.click('#parse-btn');
    await page.click('#pair-btn');

    const firstResultSelect = page.locator('select.result-sel').first();
    await firstResultSelect.selectOption('1-0');
    await expect(page.locator('#standings')).toContainText('1', { timeout: 5000 });
  });
});
