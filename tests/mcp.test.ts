import { describe, it, expect, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { base64url } from 'jose';
import { createDemoFixture, demoIds } from '../scripts/demo-fixture.mjs';
import { app } from '../apps/worker/src/app';
import { toolResult } from '../apps/worker/src/features/mcp/tools';

const origin = 'http://localhost:8787';
const redirect = 'https://client.example/callback';
async function call(path: string, init: RequestInit = {}, bindings: Env = env) {
  const ctx = createExecutionContext();
  const response = await app.request(origin + path, init, bindings, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}
async function client() {
  const response = await call('/oauth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: 'Test AI',
      redirect_uris: [redirect],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }),
  });
  expect(response.status).toBe(201);
  return (await response.json()) as { client_id: string };
}
async function authorization(
  scope = 'stats:read offline_access',
  challengeMethod = 'S256',
  clientId?: string,
) {
  const registration = clientId ? { client_id: clientId } : await client();
  const verifier = base64url.encode(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64url.encode(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))),
  );
  const query = new URLSearchParams({
    client_id: registration.client_id,
    redirect_uri: redirect,
    response_type: 'code',
    scope,
    resource: origin + '/mcp',
    code_challenge: challenge,
    code_challenge_method: challengeMethod,
    state: 'test-state',
  });
  const path = '/authorize?' + query;
  const response = await call(path);
  const text = await response.text();
  const handle = /name="handle" value="([^"]+)"/.exec(text)?.[1] ?? '';
  const cookie = response.headers
    .getSetCookie()
    .map((s) => s.split(';')[0])
    .join('; ');
  return { registration, verifier, response, text, handle, cookie, path };
}
async function decide(
  auth: Awaited<ReturnType<typeof authorization>>,
  decision = 'approve',
  cookie = auth.cookie,
) {
  return call('/authorize', {
    method: 'POST',
    headers: {
      Origin: origin,
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: cookie,
    },
    body: new URLSearchParams({ handle: auth.handle, decision }).toString(),
  });
}
async function token(params: Record<string, string>) {
  return call('/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
}
async function connect() {
  const auth = await authorization();
  expect(auth.response.status).toBe(200);
  const approval = await decide(auth);
  expect(approval.status).toBe(302);
  const location = new URL(approval.headers.get('Location')!);
  expect(location.searchParams.get('state')).toBe('test-state');
  const params = {
    grant_type: 'authorization_code',
    client_id: auth.registration.client_id,
    code: location.searchParams.get('code')!,
    redirect_uri: redirect,
    code_verifier: auth.verifier,
    resource: origin + '/mcp',
  };
  const exchanged = await token(params);
  expect(exchanged.status).toBe(200);
  return {
    auth,
    params,
    tokens: (await exchanged.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    },
  };
}
async function rpc(accessToken: string, method: string, params?: unknown) {
  return call('/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: 'Bearer ' + accessToken,
      'MCP-Protocol-Version': '2025-11-25',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
}

describe('OAuth MCP boundary', () => {
  it('publishes discovery and bearer challenges without an Access session', async () => {
    const metadata = await call('/.well-known/oauth-protected-resource/mcp');
    expect(metadata.status).toBe(200);
    expect(await metadata.json()).toMatchObject({
      resource: origin + '/mcp',
      scopes_supported: ['stats:read'],
    });
    const server = await call('/.well-known/oauth-authorization-server');
    expect(await server.json()).toMatchObject({ code_challenge_methods_supported: ['S256'] });
    expect((await call('/mcp')).status).toBe(401);
    const production = {
      ...env,
      APP_ENV: 'production',
      APP_ORIGIN: origin,
      ACCESS_TEAM_DOMAIN: 'test.cloudflareaccess.com',
      ACCESS_AUD: 'test',
    };
    for (const path of [
      '/api/v1/health',
      '/api/v1/projects',
      '/api/v1/connections',
      '/authorize',
      '/mcp-evil',
      '/oauth/not-public',
    ])
      expect((await call(path, {}, production)).status).toBe(401);
    expect((await call('/mcp', {}, production)).status).toBe(401);
  });
  it('issues read-only tokens, lists exactly nine tools, and reuses stored stats without mutations', async () => {
    const projectId = crypto.randomUUID();
    await env.DB.prepare('INSERT INTO projects (id,name,created_at,archived) VALUES (?,?,?,0)')
      .bind(projectId, 'SDK stats', '2026-11-01T00:00:00Z')
      .run();
    const { tokens } = await connect();
    expect(tokens.expires_in).toBe(3600);
    const listing = await rpc(tokens.access_token, 'tools/list');
    expect(listing.status).toBe(200);
    const data = (await listing.json()) as {
      result: { tools: { name: string; annotations: unknown }[] };
    };
    expect(data.result.tools.map((t) => t.name).sort()).toEqual(
      [
        'list_projects',
        'list_packages',
        'list_repositories',
        'get_package_metrics',
        'list_package_versions',
        'get_repository_metrics',
        'list_repository_traffic',
        'list_traffic_history',
        'get_traffic_snapshot',
      ].sort(),
    );
    for (const tool of data.result.tools)
      expect(tool.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      });
    const range = { from: '2026-11-01T00:00:00Z', to: '2026-11-13T00:00:00Z' };
    const before = await env.DB.prepare(
      "SELECT name,sql FROM sqlite_master WHERE type='table' ORDER BY name",
    ).all();
    const tables = before.results
      .map((r) => String(r.name))
      .filter(
        (n) =>
          !n.startsWith('_') &&
          !['d1_migrations', 'sqlite_sequence', 'mcp_connections'].includes(n),
      );
    const snapshot = async () =>
      Promise.all(
        tables.map(async (t) => (await env.DB.prepare(`SELECT * FROM "${t}"`).all()).results),
      );
    const initial = await snapshot();
    for (const [name, args] of [
      ['list_projects', {}],
      ['list_packages', {}],
      ['list_repositories', {}],
      ['get_package_metrics', range],
      ['list_package_versions', range],
      ['get_repository_metrics', range],
      ['list_repository_traffic', range],
      ['list_traffic_history', { ...range, repositoryId: crypto.randomUUID(), metric: 'views' }],
    ] as const) {
      const response = await rpc(tokens.access_token, 'tools/call', { name, arguments: args });
      expect(response.status).toBe(200);
      const result = (await response.json()) as {
        result: { isError?: boolean; structuredContent: unknown };
      };
      expect(result.result.isError, name).not.toBe(true);
      expect(result.result.structuredContent, name).toBeDefined();
    }
    expect(await snapshot()).toEqual(initial);
    const result = (await (
      await rpc(tokens.access_token, 'tools/call', { name: 'list_projects', arguments: {} })
    ).json()) as { result: { structuredContent: { items: unknown[] } } };
    expect(result.result.structuredContent.items).toContainEqual(
      expect.objectContaining({ id: projectId, name: 'SDK stats' }),
    );
    expect(
      (
        await rpc(tokens.access_token, 'tools/call', {
          name: 'delete_project',
          arguments: { id: projectId },
        })
      ).status,
    ).toBe(200);
  });
  it('refreshes, revokes in D1, and prevents REST access with OAuth credentials', async () => {
    const { auth, tokens } = await connect();
    const refreshed = await token({
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
      client_id: auth.registration.client_id,
      resource: origin + '/mcp',
    });
    expect(refreshed.status).toBe(200);
    const next = (await refreshed.json()) as { access_token: string; refresh_token: string };
    expect(next.refresh_token).not.toBe(tokens.refresh_token);
    const production = {
      ...env,
      APP_ENV: 'production',
      APP_ORIGIN: origin,
      ACCESS_TEAM_DOMAIN: 'test.cloudflareaccess.com',
      ACCESS_AUD: 'test',
    };
    expect(
      (
        await call(
          '/api/v1/projects',
          { headers: { Authorization: 'Bearer ' + tokens.access_token } },
          production,
        )
      ).status,
    ).toBe(401);
    const list = await call('/api/v1/connections');
    const connections = (await list.json()) as { items: { id: string; clientName: string }[] };
    expect(connections.items[0]?.clientName).toBe('Test AI');
    const id = connections.items[0]!.id;
    await env.DB.prepare('UPDATE mcp_connections SET user_id=? WHERE id=?')
      .bind('other-user', id)
      .run();
    expect(
      (await call('/api/v1/connections/' + id, { method: 'DELETE', headers: { Origin: origin } }))
        .status,
    ).toBe(404);
    await env.DB.prepare('UPDATE mcp_connections SET user_id=? WHERE id=?')
      .bind('local-developer', id)
      .run();
    expect(
      (await call('/api/v1/connections/' + id, { method: 'DELETE', headers: { Origin: origin } }))
        .status,
    ).toBe(200);
    expect((await rpc(next.access_token, 'tools/list')).status).toBe(401);
    expect(
      (
        await token({
          grant_type: 'refresh_token',
          refresh_token: next.refresh_token,
          client_id: auth.registration.client_id,
        })
      ).status,
    ).toBe(400);
  });
  it('rejects invalid PKCE, unknown scopes, callback substitution, consent forgery and replay', async () => {
    expect((await authorization('stats:read', 'plain')).response.status).not.toBe(200);
    expect((await authorization('stats:write')).response.status).toBe(400);
    const auth = await authorization();
    expect(
      (
        await call(
          auth.path.replace(
            encodeURIComponent(redirect),
            encodeURIComponent('https://evil.example/callback'),
          ),
        )
      ).status,
    ).toBe(400);
    expect((await decide(auth, 'approve', '')).status).toBe(400);
    expect((await decide(auth)).status).toBe(302);
    expect((await decide(auth)).status).toBe(400);
    const denied = await decide(await authorization(), 'deny');
    expect(new URL(denied.headers.get('Location')!).searchParams.get('error')).toBe(
      'access_denied',
    );
  });
  it('rejects code replay, wrong verifier and wrong resource', async () => {
    const auth = await authorization();
    const approval = await decide(auth);
    const params = {
      grant_type: 'authorization_code',
      client_id: auth.registration.client_id,
      code: new URL(approval.headers.get('Location')!).searchParams.get('code')!,
      redirect_uri: redirect,
      code_verifier: auth.verifier,
      resource: origin + '/mcp',
    };
    expect((await token({ ...params, resource: origin + '/api/v1' })).status).toBe(400);
    expect((await token({ ...params, code_verifier: 'wrong-verifier' })).status).toBe(400);
    expect((await token(params)).status).toBe(200);
    expect((await token(params)).status).toBe(400);
  });
  it('returns the existing API results for all nine tools with seeded package and repository history', async () => {
    const fixture = createDemoFixture(new Date('2026-11-09T12:00:00Z'));
    const statements = fixture.sql.split('\n').filter(Boolean);
    for (let i = 0; i < statements.length; i += 30)
      await env.DB.batch(statements.slice(i, i + 30).map((sql) => env.DB.prepare(sql)));
    const { tokens } = await connect();
    const range = { from: '2026-11-07T00:00:00Z', to: '2026-11-09T00:00:00Z' };
    const row = await env.DB.prepare(
      'SELECT id FROM repository_traffic_snapshots ORDER BY observed_at DESC LIMIT 1',
    ).first<{ id: string }>();
    const cases: [string, string, Record<string, unknown>][] = [
      ['list_projects', '/projects', { limit: 2, offset: 1 }],
      ['list_packages', '/packages', { projectId: demoIds.projects[0], limit: 2, offset: 1 }],
      [
        'list_repositories',
        '/repositories',
        { projectId: demoIds.projects[0], limit: 2, offset: 0 },
      ],
      [
        'get_package_metrics',
        '/metrics',
        { ...range, projectId: demoIds.projects[0], channel: 'stable' },
      ],
      ['list_package_versions', '/metrics/versions', { ...range, limit: 2, offset: 1 }],
      ['get_repository_metrics', '/repository-metrics', range],
      ['list_repository_traffic', '/repository-traffic', { ...range, limit: 2, offset: 0 }],
      [
        'list_traffic_history',
        '/repository-traffic/history',
        { ...range, repositoryId: demoIds.repositories[0], metric: 'paths', limit: 2, offset: 1 },
      ],
      ['get_traffic_snapshot', '/repository-traffic/snapshots/' + row!.id, { id: row!.id }],
    ];
    for (const [name, path, args] of cases) {
      const result = (await (
        await rpc(tokens.access_token, 'tools/call', { name, arguments: args })
      ).json()) as { result: { isError?: boolean; structuredContent: unknown } };
      expect(result.result.isError, name).not.toBe(true);
      const query = new URLSearchParams(
        Object.entries(args).map(([key, value]) => [key, String(value)]),
      );
      const expected = await (await call('/api/v1' + path + '?' + query)).json();
      expect(result.result.structuredContent, name).toEqual(expected);
    }
    const invalid = (await (
      await rpc(tokens.access_token, 'tools/call', {
        name: 'list_projects',
        arguments: { limit: 101 },
      })
    ).json()) as { result: { isError: boolean } };
    expect(invalid.result.isError).toBe(true);
  });
  it('blocks reads immediately even when OAuth grant cleanup fails', async () => {
    const { tokens } = await connect();
    const row = await env.DB.prepare('SELECT id FROM mcp_connections').first<{ id: string }>();
    const mock = vi
      .spyOn(env.OAUTH_KV, 'delete')
      .mockRejectedValue(new Error('KV deletion unavailable'));
    try {
      expect(
        (
          await call('/api/v1/connections/' + row!.id, {
            method: 'DELETE',
            headers: { Origin: origin },
          })
        ).status,
      ).toBe(503);
      expect((await rpc(tokens.access_token, 'tools/list')).status).toBe(401);
    } finally {
      mock.mockRestore();
    }
    expect(
      (
        await call('/api/v1/connections/' + row!.id, {
          method: 'DELETE',
          headers: { Origin: origin },
        })
      ).status,
    ).toBe(200);
  });
  it('supports Client ID Metadata Documents without registration', async () => {
    const clientId = 'https://client.example/mcp-client.json';
    const mock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      expect(String(url)).toBe(clientId);
      return Response.json(
        {
          client_id: clientId,
          client_name: 'Metadata AI',
          redirect_uris: [redirect],
          token_endpoint_auth_method: 'none',
        },
        { headers: { 'Cache-Control': 'max-age=60' } },
      );
    });
    try {
      const auth = await authorization('stats:read', 'S256', clientId);
      expect(auth.response.status).toBe(200);
      expect(auth.text).toContain('Client domain: client.example');
      expect((await decide(auth)).status).toBe(302);
    } finally {
      mock.mockRestore();
    }
  });
  it('enforces resource audience and stats:read even on valid OAuth tokens', async () => {
    const { auth, tokens } = await connect();
    const ctx = createExecutionContext();
    const wrongResource = await app.request(
      'http://localhost:8799/mcp',
      { headers: { Authorization: 'Bearer ' + tokens.access_token } },
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(wrongResource.status).toBe(401);
    const narrowed = await token({
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
      client_id: auth.registration.client_id,
      scope: 'offline_access',
    });
    expect(narrowed.status).toBe(200);
    const { access_token } = (await narrowed.json()) as { access_token: string };
    expect((await rpc(access_token, 'tools/list')).status).toBe(403);
  });
  it('handles expired connections, missing data, invalid ranges, oversized results, demo, and storage outages', async () => {
    expect(() => toolResult({ items: ['x'.repeat(1024 * 1024)] })).toThrow('Result exceeds');
    const { tokens } = await connect();
    for (const args of [
      { from: 'invalid', to: 'invalid' },
      { from: '2026-01-01T00:00:00Z', to: '2028-01-01T00:00:00Z' },
    ]) {
      const result = (await (
        await rpc(tokens.access_token, 'tools/call', {
          name: 'get_package_metrics',
          arguments: args,
        })
      ).json()) as { result: { isError: boolean } };
      expect(result.result.isError).toBe(true);
    }
    const missing = (await (
      await rpc(tokens.access_token, 'tools/call', {
        name: 'get_traffic_snapshot',
        arguments: { id: crypto.randomUUID() },
      })
    ).json()) as { result: { isError: boolean } };
    expect(missing.result.isError).toBe(true);
    expect((await call('/authorize', {}, { ...env, DEMO_MODE: 'true' })).status).toBe(409);
    await env.DB.prepare("UPDATE mcp_connections SET expires_at='2000-01-01T00:00:00Z'").run();
    expect((await rpc(tokens.access_token, 'tools/list')).status).toBe(401);
    const spy = vi.spyOn(env.OAUTH_KV, 'get').mockRejectedValue(new Error('offline'));
    try {
      expect(
        (await call('/mcp', { headers: { Authorization: 'Bearer ' + tokens.access_token } }))
          .status,
      ).toBeGreaterThanOrEqual(500);
    } finally {
      spy.mockRestore();
    }
  });
});
