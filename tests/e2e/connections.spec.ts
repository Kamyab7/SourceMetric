import { test, expect } from '@playwright/test';
import { createHash, randomBytes } from 'node:crypto';

test('maintainer can authorize an MCP client and revoke it from AI connections', async ({
  page,
  request,
}) => {
  const origin = 'http://localhost:8789';
  const callback = origin + '/oauth-test-callback';
  const clientName = 'Browser test AI ' + Date.now();
  const registration = await request.post('/oauth/register', {
    data: {
      client_name: clientName,
      redirect_uris: [callback],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    },
  });
  expect(registration.status()).toBe(201);
  const { client_id } = await registration.json();
  const verifier = randomBytes(32).toString('base64url');
  const params = new URLSearchParams({
    client_id,
    redirect_uri: callback,
    response_type: 'code',
    scope: 'stats:read offline_access',
    resource: origin + '/mcp',
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
  });
  await page.goto('/authorize?' + params);
  await expect(page.getByRole('heading', { name: 'Connect ' + clientName })).toBeVisible();
  await expect(
    page.getByText('private repository names and traffic', { exact: false }),
  ).toBeVisible();
  const callbackRequest = page.waitForRequest((req) => req.url().startsWith(callback + '?'));
  await page.getByRole('button', { name: 'Allow read-only access' }).click();
  const code = new URL((await callbackRequest).url()).searchParams.get('code');
  const token = await request.post('/oauth/token', {
    form: {
      grant_type: 'authorization_code',
      client_id,
      code: code!,
      redirect_uri: callback,
      resource: origin + '/mcp',
      code_verifier: verifier,
    },
  });
  expect(token.status()).toBe(200);
  const { access_token } = await token.json();
  await page.goto('/connections');
  await expect(page.getByRole('heading', { name: 'AI connections' })).toBeVisible();
  await expect(page.getByLabel('MCP server URL')).toHaveValue(origin + '/mcp');
  await expect(page.getByRole('heading', { name: clientName })).toBeVisible();
  const card = page.getByRole('heading', { name: clientName }).locator('..').locator('..');
  await card.getByRole('button', { name: 'Revoke', exact: true }).click();
  await expect(card.getByRole('button', { name: 'Revoked', exact: true })).toBeVisible();
  const revoked = await request.post('/mcp', {
    headers: {
      Authorization: 'Bearer ' + access_token,
      Accept: 'application/json, text/event-stream',
    },
    data: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
  });
  expect(revoked.status()).toBe(401);
});
