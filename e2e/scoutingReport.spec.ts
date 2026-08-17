import { test, expect } from '@playwright/test';

test('scouting report shows the empty state with no handoff data', async ({ page }) => {
  await page.goto('/scouting-report.html');
  await expect(page.locator('#empty-state')).toBeVisible();
  await expect(page.locator('#report-card')).toBeHidden();
});

test('Opening Explorer hands off to a full scouting report', async ({ page }) => {
  await page.goto('/opening-explorer.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  await page.click('#load-sample');
  await expect(page.locator('#scouting-link-btn')).toBeVisible({ timeout: 15000 });

  await page.click('#scouting-link-btn');
  await expect(page).toHaveURL(/scouting-report\.html/);
  await expect(page.locator('#report-card')).toBeVisible();
  await expect(page.locator('#report-body')).not.toBeEmpty();
});
