import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPORT_A = path.join(__dirname, 'fixtures', 'report-a.md');
const REPORT_B = path.join(__dirname, 'fixtures', 'report-b.md');

test.describe('Compare Reports', () => {
  test('loads two saved reports and shows a side-by-side delta table', async ({ page }) => {
    await page.goto('/compare-reports.html');
    await page.setInputFiles('#file-a', REPORT_A);
    await page.setInputFiles('#file-b', REPORT_B);

    await expect(page.locator('#results')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#overview-table')).not.toBeEmpty();
    // Report B was generated with higher accuracy (90% vs 80%) — the delta should show it.
    await expect(page.locator('#overview-table')).toContainText('10');
  });
});
