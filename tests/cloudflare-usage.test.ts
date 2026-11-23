import { it, expect, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import { cloudflareUsage } from '../apps/worker/src/features/cloudflare/usage';
import { app } from '../apps/worker/src/app';

const bindings: Env = {
  ...env,
  CLOUDFLARE_ANALYTICS_API_TOKEN: 'private-analytics-token',
  CLOUDFLARE_ACCOUNT_ID: 'account-id',
  CLOUDFLARE_WORKER_NAME: 'my-worker',
  CLOUDFLARE_D1_DATABASE_ID: 'my-db',
  CLOUDFLARE_KV_NAMESPACE_ID: 'my-kv',
};
const now = new Date('2026-11-23T12:34:00Z');
const envelope = (rows: unknown) => Response.json({ data: { viewer: { accounts: [{ rows }] } } });
const fixtures: Record<string, unknown> = {
  workersInvocationsAdaptive: [{ sum: { requests: 120_000 } }],
  d1AnalyticsAdaptiveGroups: [
    { sum: { rowsRead: 100, rowsWritten: 20 } },
    { sum: { rowsRead: 200, rowsWritten: 30 } },
  ],
  d1StorageAdaptiveGroups: [{ max: { bytes: 12_000_000 }, dimensions: { date: '2026-11-22' } }],
  kvOperationsAdaptiveGroups: [
    { sum: { requests: 20 }, dimensions: { actionType: 'read' } },
    { sum: { requests: 30 }, dimensions: { actionType: 'read' } },
    { sum: { requests: 3 }, dimensions: { actionType: 'write' } },
    { sum: { requests: 2 }, dimensions: { actionType: 'delete' } },
    { sum: { requests: 1 }, dimensions: { actionType: 'list' } },
  ],
  kvStorageAdaptiveGroups: [{ max: { bytes: 200 }, dimensions: { date: '2026-11-23' } }],
};
function dataset(query: string) {
  return Object.keys(fixtures).find((name) => query.includes(name))!;
}
it('filters each dataset to the deployment and aggregates usage with safe remaining values', async () => {
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    expect(url).toBe('https://api.cloudflare.com/client/v4/graphql');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(init?.headers).toHaveProperty('Authorization', 'Bearer private-analytics-token');
    const { query, variables } = JSON.parse(String(init?.body));
    expect(variables.account).toBe('account-id');
    const name = dataset(query);
    expect(variables.id).toBe(
      name.startsWith('d1') ? 'my-db' : name.startsWith('kv') ? 'my-kv' : 'my-worker',
    );
    if (name.includes('Storage')) {
      expect(query).toContain('orderBy: [date_DESC]');
      expect(query).toContain('limit: 1');
      expect(variables.start).toBe('2026-10-24');
      expect(variables.end).toBe('2026-11-23');
    } else if (name.startsWith('workers')) {
      expect(variables.start).toBe('2026-11-23T00:00:00.000Z');
      expect(variables.end).toBe(now.toISOString());
    } else expect(variables.day).toBe('2026-11-23');
    return envelope(fixtures[name]);
  });
  const result = await cloudflareUsage(bindings, fetcher, now);
  expect(fetcher).toHaveBeenCalledTimes(5);
  expect(result.metrics.find((m) => m.id === 'worker-requests')).toMatchObject({
    used: 120_000,
    percent: 120,
    remaining: 0,
  });
  expect(result.metrics.find((m) => m.id === 'd1-reads')).toMatchObject({
    used: 300,
    remaining: 4_999_700,
  });
  expect(result.metrics.find((m) => m.id === 'd1-writes')?.used).toBe(50);
  expect(result.metrics.find((m) => m.id === 'kv-reads')?.used).toBe(50);
  expect(result.metrics.find((m) => m.id === 'kv-writes')?.used).toBe(3);
  expect(result.metrics.find((m) => m.id === 'kv-deletes')?.used).toBe(2);
  expect(result.metrics.find((m) => m.id === 'kv-lists')?.used).toBe(1);
  expect(result.metrics.find((m) => m.id === 'd1-storage')).toMatchObject({
    measuredAt: '2026-11-22T00:00:00.000Z',
    allowanceScope: 'database',
    used: 12_000_000,
  });
  expect(JSON.stringify(result)).not.toContain('private-analytics-token');
});
it('uses UTC periods across midnight and treats empty operations differently from missing storage', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => envelope([]));
  for (const instant of ['2026-11-23T23:59:59Z', '2026-11-24T00:00:00Z']) {
    const result = await cloudflareUsage(bindings, fetcher, new Date(instant));
    expect(result.periodStart).toBe(instant.slice(0, 10) + 'T00:00:00.000Z');
    expect(Date.parse(result.resetsAt) - Date.parse(result.periodStart)).toBe(86400000);
    expect(result.metrics.filter((m) => m.period === 'daily').every((m) => m.used === 0)).toBe(
      true,
    );
    expect(
      result.metrics
        .filter((m) => m.period === 'storage')
        .every((m) => m.used === null && m.status === 'unavailable'),
    ).toBe(true);
  }
});
for (const failure of ['permission', 'graphql', 'timeout', 'malformed', 'null', 'no-account']) {
  it(`isolates ${failure} failures without exposing upstream details`, async () => {
    const result = await cloudflareUsage(
      bindings,
      async (_url, init) => {
        const { query } = JSON.parse(String(init?.body));
        const name = dataset(query);
        if (name !== 'kvOperationsAdaptiveGroups') return envelope(fixtures[name]);
        if (failure === 'permission') return new Response('sensitive-upstream', { status: 403 });
        if (failure === 'graphql')
          return Response.json({
            errors: [{ message: 'sensitive-upstream' }],
            data: { viewer: { accounts: [{ rows: [] }] } },
          });
        if (failure === 'timeout') throw new DOMException('sensitive-upstream', 'TimeoutError');
        if (failure === 'null') return envelope(null);
        if (failure === 'no-account') return Response.json({ data: { viewer: { accounts: [] } } });
        return envelope([{ sum: { requests: -1 }, dimensions: { actionType: 'read' } }]);
      },
      now,
    );
    expect(result.metrics.find((m) => m.id === 'kv-reads')).toMatchObject({
      status: 'unavailable',
      used: null,
      percent: null,
      remaining: null,
    });
    expect(result.metrics.find((m) => m.id === 'worker-requests')?.status).toBe('available');
    expect(result.metrics.find((m) => m.id === 'kv-storage')?.status).toBe('available');
    expect(JSON.stringify(result)).not.toContain('sensitive-upstream');
  });
}
it('does not call Cloudflare without all configuration, and supplies synthetic demo data', async () => {
  const fetcher = vi.fn<typeof fetch>();
  const result = await cloudflareUsage(
    { ...bindings, CLOUDFLARE_D1_DATABASE_ID: undefined },
    fetcher,
    now,
  );
  expect(result.configured).toBe(false);
  expect(result.metrics.every((m) => m.used === null)).toBe(true);
  const demo = await cloudflareUsage(
    { ...env, APP_ENV: 'local', DEMO_MODE: 'true' } as Env,
    fetcher,
    now,
  );
  expect(demo.demo).toBe(true);
  expect(demo.metrics.every((m) => m.status === 'available')).toBe(true);
  expect(fetcher).not.toHaveBeenCalled();
});
it('exposes usage only through the authenticated API', async () => {
  const local = await app.request('http://localhost/api/v1/cloudflare/usage', {}, env);
  expect(local.status).toBe(200);
  expect(local.headers.get('Cache-Control')).toBe('private, no-store');
  const remote = await app.request(
    'https://metrics.example/api/v1/cloudflare/usage',
    {},
    {
      ...bindings,
      APP_ENV: 'production',
      APP_ORIGIN: 'https://metrics.example',
      ACCESS_AUD: 'aud',
      ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com',
    },
  );
  expect(remote.status).toBe(401);
});
