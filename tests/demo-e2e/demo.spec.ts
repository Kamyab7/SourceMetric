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

test('real demo lists page independently and reset when dashboard filters change', async ({
  page,
}) => {
  await page.goto('/');
  const versions = page.getByRole('navigation', { name: 'versions pagination' });
  await expect(versions).toContainText('1–10 of 18');
  await versions.getByRole('button', { name: 'Next versions page' }).click();
  await expect(versions).toContainText('11–18 of 18');
  await page.getByLabel('Version channel').selectOption('prerelease');
  await expect(versions).toContainText('1–6 of 6');
  await page.getByRole('button', { name: '90 days', exact: true }).click();
  const notes = page.getByRole('navigation', { name: 'dashboard notes pagination' });
  await expect(notes).toContainText('1–10 of 16');
  await notes.getByRole('button', { name: 'Next dashboard notes page' }).click();
  await expect(notes).toContainText('11–16 of 16');
  await page.getByRole('button', { name: '7 days', exact: true }).click();
  await expect(notes).toContainText('1–2 of 2');
  await page.getByRole('link', { name: 'Collection health', exact: true }).click();
  const attempts = page.getByRole('navigation', { name: 'collection attempts pagination' });
  await expect(attempts).toContainText('1–10 of 48');
  await attempts.getByRole('button', { name: 'Next collection attempts page' }).click();
  await expect(attempts).toContainText('11–20 of 48');
  await expect(
    page.getByRole('navigation', { name: 'collection schedule pagination' }),
  ).toContainText('1–6 of 6');
});
