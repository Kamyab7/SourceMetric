import { test, expect } from '@playwright/test';
test('maintainer can organize a project and campaign in an empty workspace', async ({ page }) => {
  const title = 'Toolkit ' + Date.now();
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Your open source, in perspective.' }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your history starts here.' })).toBeVisible();
  await page.getByRole('link', { name: '▤ Projects', exact: true }).click();
  await page.getByLabel('Project name').fill(title);
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('heading', { name: title + ' ↗' })).toBeVisible();
  await page.getByRole('link', { name: '✎ Releases & campaigns' }).click();
  await page.getByLabel('Project or package').selectOption({ label: title });
  await page.getByLabel('Title', { exact: true }).fill('Launch announcement');
  await page
    .getByLabel('Notes', { exact: true })
    .fill('Shared the first release with the community.');
  await page.getByRole('button', { name: 'Save note' }).click();
  await expect(
    page.getByRole('heading', { name: 'Launch announcement', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
  await page.getByLabel('Title', { exact: true }).fill('Launch retrospective');
  await page.getByRole('button', { name: 'Save note' }).click();
  await expect(page.getByRole('heading', { name: 'Launch retrospective' })).toBeVisible();
  await page.getByRole('button', { name: 'Delete', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Launch retrospective' })).toHaveCount(0);
});
test('package flow uses backend validation and presents unavailable registry data', async ({
  page,
}) => {
  await page.route('**/api/v1/packages', { times: 1 }, async (route) => {
    if (route.request().method() === 'POST')
      return route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { code: 'PACKAGE_UNAVAILABLE', message: 'Listed NuGet package not found.' },
        }),
      });
    return route.fallback();
  });
  await page.goto('/packages');
  // Register a deterministic error without depending on the live registry.
  await page.route('**/api/v1/packages', async (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({
            error: { code: 'PACKAGE_UNAVAILABLE', message: 'Listed NuGet package not found.' },
          }),
        })
      : route.fallback(),
  );
  await page.getByLabel('NuGet package ID').fill('SourceMetric.Does.Not.Exist');
  await page.getByRole('button', { name: '+ Track package' }).click();
  await expect(page.getByRole('alert')).toContainText('Listed NuGet package not found.');
});
test('mobile navigation and unknown frontend paths work', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/unknown');
  await expect(
    page.getByRole('heading', { name: 'Your open source, in perspective.' }),
  ).toBeVisible();
  await page.getByRole('link', { name: '↻ Collection health' }).click();
  await expect(
    page.getByRole('heading', { name: 'Every observation accounted for.' }),
  ).toBeVisible();
});

test('package registration and observed-growth charts render with registry fixtures', async ({
  page,
}) => {
  const id = '11111111-1111-4111-8111-111111111111';
  const pkg = {
    id,
    provider: 'nuget',
    canonicalId: 'example.core',
    displayName: 'Example.Core',
    description: 'A toolkit for building better things.',
    latestStable: '1.2.0',
    latestPrerelease: '2.0.0-beta.1',
    archived: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    lastSuccess: '2026-11-08T18:00:00.000Z',
    lastAttempt: '2026-11-08T18:00:00.000Z',
    nextAttempt: '2026-11-09T00:00:00.000Z',
    lastError: null,
    status: 'success',
    observationCount: 128,
  };
  let registered = false;
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/api/v1/packages?*', (route) =>
    route.fulfill({ json: { items: registered ? [pkg] : [], total: registered ? 1 : 0 } }),
  );
  await page.route('**/api/v1/packages', (route) => {
    registered = true;
    return route.fulfill({ status: 201, json: pkg });
  });
  await page.route('**/api/v1/packages/' + id, (route) => route.fulfill({ json: pkg }));
  await page.route('**/api/v1/metrics?*', (route) =>
    route.fulfill({
      json: {
        latestTotal: 10240,
        growth: 240,
        previousGrowth: 120,
        comparison: 100,
        complete: true,
        trackingSince: pkg.createdAt,
        stale: false,
        truncated: false,
        from: '2026-11-01T00:00:00.000Z',
        to: '2026-11-09T00:00:00.000Z',
        points: Array.from({ length: 8 }, (_, n) => ({
          packageId: id,
          version: null,
          observedAt: new Date(Date.UTC(2026, 10, 1 + n)).toISOString(),
          intervalStart: new Date(Date.UTC(2026, 10, n)).toISOString(),
          value: 10000 + n * 30,
          growth: 30 + n * 5,
          quality: 'ok',
        })),
        versions: [
          { packageId: id, version: '1.2.0', downloads: 10240, observedAt: pkg.lastSuccess },
        ],
        annotations: [],
      },
    }),
  );
  await page.goto('/packages');
  await page.getByLabel('NuGet package ID').fill('Example.Core');
  await page.getByRole('button', { name: '+ Track package' }).click();
  await expect(page.getByRole('link', { name: 'Example.Core', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Example.Core', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Example.Core', exact: true })).toBeVisible();
  await expect(page.getByText('10,240', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('img', { name: /Observed download growth/ })).toBeVisible();
  await page.getByRole('button', { name: '7 days', exact: true }).click();
  await page.getByLabel('Version channel').selectOption('stable');
  await expect(page.getByRole('heading', { name: 'Available version downloads' })).toBeVisible();
  await page.screenshot({ path: 'test-results/growth-dashboard.png', fullPage: true });
  expect(errors).toEqual([]);
});
