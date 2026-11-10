import { test, expect } from '@playwright/test';
test('repository forms resolve, register, refresh, archive, restore and delete with validated responses', async ({
  page,
}) => {
  const id = '60000000-0000-4000-8000-000000000001';
  const metadata = {
    githubId: '123',
    fullName: 'owner/tool',
    url: 'https://github.com/owner/tool',
    description: 'Fixture',
    private: true,
    stars: 12,
    forks: 3,
  };
  let row: Record<string, unknown> | undefined;
  const actions: string[] = [];
  await page.route('**/api/v1/repositories**', async (route) => {
    const req = route.request(),
      path = new URL(req.url()).pathname;
    if (path.endsWith('/resolve')) return route.fulfill({ json: metadata });
    if (req.method() === 'POST') {
      expect(req.postDataJSON()).toMatchObject({ repository: 'owner/tool' });
      row = {
        ...metadata,
        id,
        provider: 'github',
        archived: false,
        createdAt: new Date().toISOString(),
        lastSuccess: null,
        trafficSuccess: null,
        trafficError: null,
        lastAttempt: null,
        nextAttempt: new Date().toISOString(),
        lastError: null,
        status: 'queued',
      };
      return route.fulfill({ status: 201, json: row });
    }
    if (req.method() === 'PATCH') {
      actions.push(req.postDataJSON().archived ? 'archive' : 'restore');
      row = { ...row, ...req.postDataJSON() };
      return route.fulfill({ json: row });
    }
    if (req.method() === 'DELETE') {
      actions.push('delete');
      row = undefined;
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({ json: { items: row ? [row] : [], total: row ? 1 : 0 } });
  });
  await page.route('**/api/v1/repository-sync/*/refresh', (route) => {
    actions.push('refresh');
    return route.fulfill({ status: 202, json: { status: 'queued' } });
  });
  await page.goto('/repositories');
  await page.getByLabel('GitHub repository').fill('owner/tool');
  await page.getByRole('button', { name: 'Resolve', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('12 stars');
  await page.getByRole('button', { name: '+ Track repository' }).click();
  await expect(page.getByRole('link', { name: 'owner/tool', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await page.getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Restore', exact: true }).click();
  await page.getByRole('button', { name: 'Archive', exact: true }).click();
  page.on('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Delete history', exact: true }).click();
  await expect(page.getByRole('link', { name: 'owner/tool', exact: true })).toHaveCount(0);
  expect(actions).toEqual(['refresh', 'archive', 'restore', 'archive', 'delete']);
});
test('missing GitHub configuration appears as a useful form error', async ({ page }) => {
  await page.goto('/repositories');
  await page.getByLabel('GitHub repository').fill('owner/tool');
  await page.getByRole('button', { name: 'Resolve', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Configure the GITHUB_TOKEN Worker secret.');
});
