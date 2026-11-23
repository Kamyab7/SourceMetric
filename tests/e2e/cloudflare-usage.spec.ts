import { test, expect } from '@playwright/test';

test('usage has its own menu item and loads only when visited', async ({ page }) => {
  let requests = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/api/v1/cloudflare/usage')) requests++;
  });
  await page.goto('/');
  const link = page.getByRole('link', { name: 'Cloudflare usage', exact: true });
  await expect(link).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cloudflare usage', exact: true })).toHaveCount(0);
  expect(requests).toBe(0);
  await link.click();
  await expect(page).toHaveURL(/\/cloudflare-usage$/);
  await expect(link).toHaveClass(/selected/);
  await expect(page.getByRole('heading', { name: 'Cloudflare usage', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Set up usage reporting' })).toBeVisible();
  expect(requests).toBe(1);
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect.poll(() => requests).toBe(2);
  await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled();
  await page.getByRole('link', { name: 'Overview', exact: true }).click();
  await link.click();
  await expect(page.getByRole('heading', { name: 'Set up usage reporting' })).toBeVisible();
  expect(requests).toBe(2);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Cloudflare usage', exact: true })).toBeVisible();
});

test('usage displays request failures and can retry', async ({ page }) => {
  let fail = true;
  await page.route('**/api/v1/cloudflare/usage', async (route) => {
    if (fail)
      await route.fulfill({
        status: 503,
        json: { error: { message: 'Usage temporarily unavailable.' } },
      });
    else await route.continue();
  });
  await page.goto('/cloudflare-usage');
  const usagePage = page.getByRole('region', { name: 'Cloudflare usage', exact: true });
  await expect(usagePage.getByRole('alert')).toHaveText('Usage temporarily unavailable.');
  fail = false;
  await usagePage.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(usagePage.getByRole('heading', { name: 'Set up usage reporting' })).toBeVisible();
  await expect(usagePage.getByRole('alert')).toHaveCount(0);
});

test('usage renders loading, partial metrics, and mobile layout', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let release!: () => void;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/v1/cloudflare/usage', async (route) => {
    await ready;
    await route.fulfill({
      json: {
        configured: true,
        demo: false,
        fetchedAt: '2026-11-23T12:34:00Z',
        periodStart: '2026-11-23T00:00:00Z',
        periodEnd: '2026-11-23T12:34:00Z',
        resetsAt: '2026-11-24T00:00:00Z',
        metrics: [
          {
            id: 'worker-requests',
            label: 'Worker requests',
            unit: 'count',
            period: 'daily',
            allowanceScope: 'account',
            allowance: 100000,
            status: 'available',
            used: 25000,
            remaining: 75000,
            percent: 25,
            measuredAt: '2026-11-23T12:34:00Z',
            message: null,
          },
          {
            id: 'd1-storage',
            label: 'D1 database storage',
            unit: 'bytes',
            period: 'storage',
            allowanceScope: 'database',
            allowance: 500000000,
            status: 'unavailable',
            used: null,
            remaining: null,
            percent: null,
            measuredAt: null,
            message: 'No storage measurement is available.',
          },
        ],
      },
    });
  });
  await page.goto('/cloudflare-usage');
  const usagePage = page.getByRole('region', { name: 'Cloudflare usage', exact: true });
  await expect(usagePage.getByRole('status')).toHaveText('Loading Cloudflare usage…');
  await expect(usagePage.getByRole('button', { name: 'Refresh', exact: true })).toBeDisabled();
  release();
  await expect(usagePage.getByText('75,000 remaining, excluding other apps')).toBeVisible();
  await expect(
    usagePage.getByText('Unavailable. No storage measurement is available.'),
  ).toBeVisible();
  await expect(usagePage.getByRole('progressbar')).toHaveAttribute('value', '25');
  expect(await usagePage.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
    true,
  );
});
