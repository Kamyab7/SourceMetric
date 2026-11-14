import { test } from 'node:test';
import assert from 'node:assert/strict';
import { settings, setup } from './setup-cloudflare.ts';
const publicPaths = [
  '/mcp',
  '/.well-known/oauth-authorization-server',
  '/.well-known/oauth-protected-resource',
  '/.well-known/oauth-protected-resource/mcp',
  '/oauth/token',
  '/oauth/register',
];
const env = {
  CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32),
  CLOUDFLARE_API_TOKEN: 'test-token',
  ACCESS_ALLOWED_EMAILS: 'owner@example.com',
};
test('requires explicit credentials and a nonempty email allowlist', () => {
  for (const key of Object.keys(env)) assert.throws(() => settings({ ...env, [key]: '' }));
  assert.throws(() => settings({ ...env, ACCESS_ALLOWED_EMAILS: '*' }));
  assert.deepEqual(
    settings({ ...env, ACCESS_ALLOWED_EMAILS: 'Owner@example.com,owner@example.com' }).emails,
    ['owner@example.com'],
  );
});
test('reuses resources, reconciles the allowlist, migrates before deploying', async () => {
  const calls: { path: string; method: string; body: any }[] = [];
  const commands: string[][] = [];
  const fakeFetch: typeof fetch = async (url, init) => {
    const path = new URL(String(url)).pathname.split(env.CLOUDFLARE_ACCOUNT_ID)[1]!;
    const method = init?.method || 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ path, method, body });
    let result: unknown;
    if (path === '/workers/subdomain') result = { subdomain: 'my-team' };
    else if (path === '/access/organizations')
      result = { auth_domain: 'my-team.cloudflareaccess.com' };
    else if (path === '/access/identity_providers') result = [{ id: 'otp', type: 'onetimepin' }];
    else if (path === '/access/apps')
      result = [
        {
          id: 'app',
          domain: 'sourcemetric.my-team.workers.dev',
          name: 'SourceMetric setup: sourcemetric',
        },
        ...publicPaths.map((path, index) => ({
          id: `bypass-${index}`,
          domain: 'sourcemetric.my-team.workers.dev' + path,
          name: 'SourceMetric MCP setup: sourcemetric' + path,
        })),
      ];
    else if (path === '/access/apps/app') result = { id: 'app', aud: 'audience' };
    else if (path === '/access/apps/app/policies')
      result = [{ id: 'policy', name: 'SourceMetric email allowlist' }];
    else if (path === '/access/apps/app/policies/policy') result = {};
    else if (/^\/access\/apps\/bypass-\d+$/.test(path)) result = { id: path.split('/').at(-1) };
    else if (/^\/access\/apps\/bypass-\d+\/policies$/.test(path))
      result = [{ id: 'bypass-policy', name: 'SourceMetric OAuth protocol bypass' }];
    else if (path.endsWith('/bypass-policy')) result = {};
    else if (path === '/storage/kv/namespaces')
      result = [{ id: 'oauth-kv', title: 'sourcemetric-oauth' }];
    else if (path === '/d1/database') result = [{ name: 'sourcemetric', uuid: 'database' }];
    else throw new Error(`Unexpected ${path}`);
    return Response.json({ success: true, result });
  };
  await setup(
    env,
    fakeFetch,
    (args) => {
      commands.push(args);
    },
    '.wrangler/setup-tests',
  );
  assert.equal(
    calls.some((c) => c.method === 'POST'),
    false,
  );
  assert.deepEqual(calls.find((c) => c.path.endsWith('/policy'))?.body.include, [
    { email: { email: 'owner@example.com' } },
  ]);
  const bypassWrites = calls.filter((c) => c.path.endsWith('/bypass-policy'));
  assert.equal(bypassWrites.length, publicPaths.length);
  assert.ok(
    bypassWrites.every(
      (c) => c.body.decision === 'bypass' && JSON.stringify(c.body.include) === '[{"everyone":{}}]',
    ),
  );
  assert.equal(
    calls.some((c) => c.body?.domain?.endsWith('/authorize')),
    false,
  );
  assert.equal(commands[1]?.includes('migrations'), true);
  assert.equal(commands[2]?.includes('deploy'), true);
});
test('permission failures stop before deployment without leaking response bodies', async () => {
  const commands: string[][] = [];
  await assert.rejects(
    setup(
      env,
      async () =>
        Response.json(
          { success: false, errors: [{ code: 10000, message: 'sensitive' }] },
          { status: 403 },
        ),
      (args) => {
        commands.push(args);
      },
    ),
    (error: Error) => error.message.includes('10000') && !error.message.includes('sensitive'),
  );
  assert.equal(commands.length, 1);
});
for (const customDomain of [undefined, 'metrics.example.com']) {
  test(`provisions resources with production auth (${customDomain || 'workers.dev'})`, async () => {
    const writes: string[] = [];
    const commands: string[][] = [];
    const fakeFetch: typeof fetch = async (url, init) => {
      const path = new URL(String(url)).pathname.split(env.CLOUDFLARE_ACCOUNT_ID)[1]!;
      const method = init?.method || 'GET';
      if (method === 'GET') {
        if (path === '/workers/subdomain' || path === '/access/organizations')
          return new Response('{}', { status: 404 });
        return Response.json({ success: true, result: [] });
      }
      writes.push(path);
      const result =
        path === '/workers/subdomain'
          ? { subdomain: 'fresh-team' }
          : path === '/access/organizations'
            ? { auth_domain: 'fresh.cloudflareaccess.com' }
            : path === '/access/identity_providers'
              ? { id: 'otp' }
              : path === '/access/apps'
                ? { id: 'app', aud: 'fresh-aud' }
                : path === '/storage/kv/namespaces'
                  ? { id: 'fresh-kv' }
                  : path === '/d1/database'
                    ? { uuid: 'fresh-db' }
                    : {};
      return Response.json({ success: true, result });
    };
    await setup(
      { ...env, WORKERS_SUBDOMAIN: 'fresh-team', CUSTOM_DOMAIN: customDomain },
      fakeFetch,
      (args) => {
        commands.push(args);
      },
      '.wrangler/setup-tests',
    );
    assert.deepEqual(writes, [
      ...(!customDomain ? ['/workers/subdomain'] : []),
      '/access/organizations',
      '/access/identity_providers',
      '/access/apps',
      '/access/apps/app/policies',
      ...publicPaths.flatMap(() => ['/access/apps', '/access/apps/app/policies']),
      '/storage/kv/namespaces',
      '/d1/database',
    ]);
    const { readFile } = await import('node:fs/promises');
    const config = JSON.parse(
      await readFile(new URL('../.wrangler/setup-tests/wrangler.json', import.meta.url), 'utf8'),
    );
    assert.deepEqual(config.kv_namespaces, [{ binding: 'OAUTH_KV', id: 'fresh-kv' }]);
    assert.ok(config.compatibility_flags.includes('global_fetch_strictly_public'));
    assert.equal(config.vars.APP_ENV, 'production');
    assert.equal(
      config.vars.APP_ORIGIN,
      `https://${customDomain || 'sourcemetric.fresh-team.workers.dev'}`,
    );
    assert.equal(config.vars.ACCESS_AUD, 'fresh-aud');
    assert.equal(config.preview_urls, false);
    assert.equal(config.workers_dev, !customDomain);
    assert.deepEqual(
      config.routes,
      customDomain ? [{ pattern: customDomain, custom_domain: true }] : [],
    );
    assert.equal(config.env, undefined);
    assert.equal(JSON.stringify(config).includes(env.CLOUDFLARE_API_TOKEN), false);
    assert.equal(commands.at(-1)?.includes('deploy'), true);
  });
}

test('validates custom hostnames', () => {
  for (const domain of [
    'https://metrics.example.com',
    '*.example.com',
    'example.com/path',
    'example.com:443',
    'localhost',
    'test.workers.dev',
  ])
    assert.throws(() => settings({ ...env, CUSTOM_DOMAIN: domain }));
  assert.equal(
    settings({ ...env, CUSTOM_DOMAIN: ' Metrics.Example.com ' }).customDomain,
    'metrics.example.com',
  );
});
