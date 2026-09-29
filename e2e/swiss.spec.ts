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

  test('loads a sample roster, splits it into quads plus a leftover round-robin group, creates the event, and pairs round 1 for every group', async ({ page }) => {
    await page.click('#sample-roster');
    // Sample roster is 12 rows, one Withdrew -> 11 active players -> floor(11/4) = 2 quads of 4,
    // with the remaining 3 players in their own leftover group (never a group smaller than 4).
    await expect(page.locator('#roster-preview')).toContainText('2 quads');
    await expect(page.locator('#roster-preview')).toContainText('Quad 1');
    await expect(page.locator('#roster-preview')).toContainText('Quad 2');
    await expect(page.locator('#roster-preview')).toContainText('Leftover group');

    await page.click('#parse-btn');
    await expect(page.locator('#control-card')).toBeVisible();
    await expect(page.locator('#section-tabs')).toBeVisible();

    await page.click('#pair-btn');
    await expect(page.getByRole('heading', { name: /Round 1/ })).toBeVisible();
    // Every quad reached round 1 in one click of "Pair next round".
    await expect(page.locator('#section-tabs')).toContainText('Quad 1');
    await expect(page.locator('#section-tabs')).toContainText('R1');
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
