import { test, expect } from '@playwright/test';

test.describe('USCF Rating Estimator', () => {
  test('estimates a rating rise for a strong score, and updates on Clear', async ({ page }) => {
    await page.goto('/rating.html');
    await page.fill('#r-current', '1500');
    await page.fill('#r-score', '4');
    await page.fill('#r-priorgames', '40');

    // Fill in the opponent rating grid (5 rated opponents, all ~1500).
    const opponentInputs = page.locator('#opponent-grid input');
    const count = await opponentInputs.count();
    expect(count).toBeGreaterThanOrEqual(5);
    for (let i = 0; i < 5; i++) await opponentInputs.nth(i).fill('1500');

    await page.click('#r-estimate-btn');

    await expect(page.locator('#r-results-card')).toBeVisible();
    const change = await page.locator('#r-change').textContent();
    expect(change).toBeTruthy();
    expect(change!.trim().startsWith('+')).toBe(true); // 4/5 against equal opposition -> rating rise
    await expect(page.locator('#r-games')).toHaveText('5');

    await page.click('#r-clear-btn');
    await expect(page.locator('#r-current')).toHaveValue('');
    await expect(page.locator('#r-results-card')).toBeHidden();
  });

  test('shows a validation error instead of a result for an out-of-range rating', async ({ page }) => {
    await page.goto('/rating.html');
    await page.fill('#r-current', '50'); // below the 100 floor
    const opponentInputs = page.locator('#opponent-grid input');
    await opponentInputs.nth(0).fill('1500');
    await page.click('#r-estimate-btn');
    await expect(page.locator('#r-error')).not.toBeEmpty();
    await expect(page.locator('#r-results-card')).toBeHidden();
  });
});

test.describe('FIDE Rating Estimator', () => {
  test('estimates a rating drop for a poor score', async ({ page }) => {
    await page.goto('/fide-rating.html');
    await page.fill('#f-current', '2000');
    await page.fill('#f-score', '0');
    const opponentInputs = page.locator('#opponent-grid input');
    for (let i = 0; i < 3; i++) await opponentInputs.nth(i).fill('2000');
    await page.click('#f-estimate-btn');

    await expect(page.locator('#f-results-card')).toBeVisible();
    const change = await page.locator('#f-change').textContent();
    expect(change!.trim().startsWith('-')).toBe(true);
    await expect(page.locator('#f-ktier')).not.toBeEmpty();
  });

  test('clears results on Clear all', async ({ page }) => {
    await page.goto('/fide-rating.html');
    await page.fill('#f-current', '2000');
    await page.fill('#f-score', '1');
    const opponentInputs = page.locator('#opponent-grid input');
    await opponentInputs.nth(0).fill('2000');
    await page.click('#f-estimate-btn');
    await expect(page.locator('#f-results-card')).toBeVisible();
    await page.click('#f-clear-btn');
    await expect(page.locator('#f-results-card')).toBeHidden();
  });
});
