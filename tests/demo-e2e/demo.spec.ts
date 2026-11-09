import { test, expect } from '@playwright/test';
test('demo launches populated dashboards using real local API data', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('status')).toContainText('Demo workspace');
  await expect(page.getByRole('img', { name: /Observed download growth/ })).toBeVisible();
  await expect(page.getByText('Your history starts here.')).toHaveCount(0);
  const metrics = await page.request.get(
    '/api/v1/metrics?from=' +
      new Date(Date.now() - 30 * 86400000).toISOString() +
      '&to=' +
      new Date().toISOString(),
  );
  const data = await metrics.json();
  expect(data.points.length).toBeGreaterThan(100);
  expect(data.versions.length).toBe(18);
  await page.getByRole('button', { name: '90 days', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Growth over time' })).toBeVisible();
  await page.getByLabel('Version channel').selectOption('prerelease');
  await expect(page.getByRole('link', { name: 'Pulse.Telemetry' }).first()).toBeVisible();
  await page.screenshot({ path: 'test-results/demo-dashboard.png', fullPage: true });
  await page.getByRole('link', { name: 'Packages', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Nebula.Core', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Nebula.Core', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Nebula.Core', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Collection health', exact: true }).click();
  await expect(page.getByText('RATE_LIMITED', { exact: true }).first()).toBeVisible();
  const mutation = await page.request.post('/api/v1/projects', {
    data: { name: 'Cannot edit demo' },
    headers: { Origin: 'http://localhost:8791' },
  });
  expect(mutation.status()).toBe(409);
  expect(errors).toEqual([]);
});
