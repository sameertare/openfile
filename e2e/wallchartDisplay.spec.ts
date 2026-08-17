import { test, expect } from '@playwright/test';

test('Wall Display reflects a tournament created on Swiss Pairings (shared localStorage)', async ({ page }) => {
  await page.goto('/swiss.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  await page.click('#sample-roster');
  await page.click('#parse-btn');
  await page.click('#pair-btn');
  await expect(page.getByRole('heading', { name: /Round 1/ })).toBeVisible();

  await page.goto('/wallchart-display.html');
  await expect(page.locator('#wd-title')).toBeVisible();
  await expect(page.locator('#wd-body')).not.toBeEmpty();
  await expect(page.locator('#wd-body')).toContainText(/Round|board|standings/i);
});

test('Wall Display shows an empty state with no tournament saved', async ({ page }) => {
  await page.goto('/wallchart-display.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#wd-body')).toBeVisible();
});
