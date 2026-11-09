import { test, expect } from '@playwright/test';
test('project pages reset on page-size changes and selectors include projects past 100', async ({
  page,
}) => {
  const projects = Array.from({ length: 125 }, (_, n) => ({
    id: '10000000-0000-4000-8000-' + String(n + 1).padStart(12, '0'),
    name: 'Project ' + String(n).padStart(3, '0'),
    createdAt: '2026-01-01T00:00:00Z',
    archived: false,
  }));
  await page.route('**/api/v1/projects?*', (route) => {
    const url = new URL(route.request().url()),
      offset = Number(url.searchParams.get('offset') ?? 0),
      limit = Number(url.searchParams.get('limit') ?? 100);
    return route.fulfill({
      json: { items: projects.slice(offset, offset + limit), total: projects.length },
    });
  });
  await page.goto('/projects');
  await expect(page.getByRole('heading', { name: 'Project 000 ↗', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Project 010 ↗', exact: true })).toHaveCount(0);
  const pager = page.getByRole('navigation', { name: 'projects pagination' });
  await expect(pager).toContainText('1–10 of 125');
  await pager.getByRole('button', { name: 'Next projects page' }).click();
  await expect(page.getByRole('heading', { name: 'Project 010 ↗', exact: true })).toBeVisible();
  await pager.getByLabel('projects items per page').selectOption('50');
  await expect(pager).toContainText('1–50 of 125');
  await expect(page.getByRole('heading', { name: 'Project 049 ↗', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Packages', exact: true }).click();
  await expect(page.getByRole('option', { name: 'Project 124', exact: true })).toHaveCount(1);
  await page.getByRole('link', { name: 'Projects', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'projects pagination' })).toContainText(
    '1–10 of 125',
  );
});
test('deleting the only note on the last page returns to a valid page', async ({ page }) => {
  let count = 11;
  await page.route('**/api/v1/annotations?*', (route) => {
    const url = new URL(route.request().url()),
      offset = Number(url.searchParams.get('offset') ?? 0),
      limit = Number(url.searchParams.get('limit') ?? 10);
    const items = Array.from({ length: count }, (_, n) => ({
      id: '20000000-0000-4000-8000-' + String(n + 1).padStart(12, '0'),
      projectId: '10000000-0000-4000-8000-000000000001',
      packageId: null,
      kind: 'campaign',
      title: 'Campaign ' + n,
      body: 'Sample',
      occurredAt: '2026-01-01T00:00:00Z',
      automatic: false,
    }));
    return route.fulfill({ json: { items: items.slice(offset, offset + limit), total: count } });
  });
  await page.route('**/api/v1/annotations/*', (route) => {
    count--;
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto('/annotations');
  const pager = page.getByRole('navigation', { name: 'notes pagination' });
  await pager.getByRole('button', { name: 'Next notes page' }).click();
  await expect(page.getByRole('heading', { name: 'Campaign 10', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(pager).toContainText('1–10 of 10');
  await expect(page.getByRole('heading', { name: 'Campaign 0', exact: true })).toBeVisible();
  await expect(pager.getByRole('button', { name: 'Next notes page' })).toBeDisabled();
});
