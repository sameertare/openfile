import { test, expect } from '@playwright/test';

const PAGES = [
  '/',
  '/analyze.html',
  '/strength-report.html',
  '/live.html',
  '/swiss.html',
  '/nwchess-pairings.html',
  '/opening-explorer.html',
  '/compare-reports.html',
  '/rating.html',
  '/fide-rating.html',
  '/getting-started.html',
  '/about.html',
];

for (const path of PAGES) {
  test(`${path} loads without console errors`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    const res = await page.goto(path);
    expect(res?.ok()).toBe(true);
    await expect(page.locator('#theme-toggle')).toBeVisible();
    expect(errors, `console/page errors on ${path}: ${errors.join('; ')}`).toEqual([]);
  });
}

test('hub loads and no longer links to removed tools (Coach Roster, Openings Deviation)', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'OpenFile' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Coach Roster/i })).toHaveCount(0);
  await expect(page.locator('a[href="roster.html"]')).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Openings Deviation/i })).toHaveCount(0);
  await expect(page.locator('a[href="opening-deviation.html"]')).toHaveCount(0);
});

test('every sidebar nav link on the hub resolves to a real page', async ({ page, request }) => {
  await page.goto('/');
  const hrefs = await page.locator('.sidebar-links a').evaluateAll((els) => els.map((e) => (e as HTMLAnchorElement).getAttribute('href')));
  expect(hrefs.length).toBeGreaterThan(5);
  for (const href of hrefs) {
    if (!href) continue;
    const res = await request.get(href);
    expect(res.ok(), `expected ${href} to resolve`).toBe(true);
  }
});
