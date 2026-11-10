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

test('GitHub demo histories render at workspace, project and repository scope and export daily uniques', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Repository metrics', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('img', { name: /GitHub stars by repository/ })).toBeVisible();
  await page.getByLabel('Chart metric').selectOption('uniques');
  await expect(page.getByRole('img', { name: /GitHub uniques by repository/ })).toBeVisible();
  await page.getByRole('link', { name: 'nebula/platform', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'nebula/platform', exact: true })).toBeVisible();
  await page.getByLabel('Range', { exact: true }).selectOption('7');
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Export repository CSV' }).click();
  expect((await download).suggestedFilename()).toBe('sourcemetric-repositories.csv');
  await page.getByRole('link', { name: 'Repositories', exact: true }).click();
  await expect(page.getByRole('link', { name: 'orbit/tools', exact: true })).toBeVisible();
  await page
    .getByLabel('Repository project', { exact: true })
    .selectOption({ label: 'Nebula Platform' });
  await expect(page.getByRole('link', { name: 'nebula/platform', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'orbit/tools', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'Nebula Platform', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Repository metrics', exact: true }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Collection health', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Repository collection schedule' })).toBeVisible();
  await expect(page.getByText('GITHUB_ACCESS_DENIED', { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: 'test-results/demo-repositories.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('visitor charts and rolling traffic history work at all scopes with separate CSV exports', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByLabel('Chart metric').selectOption('views');
  await expect(page.getByRole('img', { name: /GitHub views by repository/ })).toBeVisible();
  await page.getByLabel('Chart metric').selectOption('visitors');
  await expect(page.getByRole('img', { name: /GitHub visitors by repository/ })).toBeVisible();
  const group = page.getByRole('article', { name: 'nebula/platform traffic', exact: true });
  const visitors = group.getByRole('region', { name: 'Visitors snapshot', exact: true });
  await expect(visitors).toContainText('Unique visitors over 14 days');
  const paths = group.getByRole('region', { name: 'Popular content snapshot', exact: true });
  await expect(paths.getByRole('link', { name: 'Getting started', exact: true })).toBeVisible();
  await expect(
    group.getByRole('region', { name: 'Referring sites snapshot', exact: true }),
  ).toContainText('Google');
  await paths.getByRole('button', { name: 'Snapshot history', exact: true }).click();
  const pager = paths.getByRole('navigation', { name: 'paths snapshot history pagination' });
  await expect(pager).toContainText('1–10 of');
  await pager.getByRole('button', { name: 'Next paths snapshot history page' }).click();
  await expect(pager).toContainText('11–20 of');
  const choices = paths.getByRole('button', { name: /^20\d\d-/ });
  await choices.first().click();
  await expect(
    paths.getByRole('button', { name: 'Use latest snapshot at range end' }),
  ).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Export traffic snapshots CSV' }).click();
  expect((await download).suggestedFilename()).toBe('sourcemetric-traffic-snapshots.csv');
  await page.getByRole('link', { name: 'Nebula Platform', exact: true }).click();
  await expect(
    page.getByRole('article', { name: 'nebula/platform traffic', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('article', { name: 'orbit/tools traffic', exact: true })).toHaveCount(
    0,
  );
  await page.getByRole('link', { name: 'nebula/platform', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'nebula/platform', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Visitors snapshot', exact: true })).toContainText(
    'GitHub rolling 14-day snapshot',
  );
  await page.screenshot({ path: 'test-results/demo-visitor-traffic.png', fullPage: true });
  await page.getByRole('link', { name: 'Collection health', exact: true }).click();
  await expect(page.getByRole('columnheader', { name: 'Traffic endpoints' })).toBeVisible();
  expect(errors).toEqual([]);
});
