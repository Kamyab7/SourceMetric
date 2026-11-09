import { it, expect, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import { app } from '../apps/worker/src/app';
import { collectDue } from '../apps/worker/src/features/sync/collector';
import { createPackageProvider } from '../apps/worker/src/providers/factory';
import type { PackageProvider } from '../apps/worker/src/providers/contracts';
const bindings = env as Env;
async function request(path: string, method = 'GET', data?: unknown, overrides: Partial<Env> = {}) {
  return app.request(
    'http://localhost:8787/api/v1' + path,
    {
      method,
      headers: { Origin: 'http://localhost:8787', 'Content-Type': 'application/json' },
      body: data === undefined ? undefined : JSON.stringify(data),
    },
    { ...bindings, ...overrides },
  );
}
async function seed(count = 1) {
  for (let n = 0; n < count; n++) {
    const id = crypto.randomUUID();
    await bindings.DB.batch([
      bindings.DB.prepare(
        'INSERT INTO packages(id,provider,canonical_id,display_name,created_at) VALUES(?,?,?,?,?)',
      ).bind(id, 'nuget', 'example.' + n, 'Example.' + n, '2026-01-01T00:00:00.000Z'),
      bindings.DB.prepare('INSERT INTO collection_jobs(package_id,next_attempt) VALUES(?,?)').bind(
        id,
        '2026-01-01T00:00:00.000Z',
      ),
    ]);
  }
  return (
    await bindings.DB.prepare('SELECT id FROM packages ORDER BY canonical_id').all<{ id: string }>()
  ).results.map((p) => p.id);
}
function provider(value = 100): PackageProvider {
  return {
    id: 'nuget',
    capabilities: () => ({
      packageDownloads: 'cumulative',
      versionDownloads: true,
      prereleases: true,
    }),
    resolve: vi.fn(),
    metadata: vi.fn(),
    collect: async (id, observedAt) => ({
      metadata: {
        canonicalId: id,
        displayName: id,
        description: 'Fixture',
        latestStable: '1.0.0',
        latestPrerelease: null,
        versions: [{ version: '1.0.0', prerelease: false, downloads: value }],
      },
      observations: [
        {
          provider: 'nuget',
          canonicalId: id,
          metric: 'downloads',
          scope: 'package',
          kind: 'cumulative',
          value,
          observedAt,
          availability: 'available',
          quality: 'source',
        },
      ],
    }),
  };
}
it('migrates a populated database and supports projects, annotations, and association deduplication', async () => {
  const ids = await seed();
  const response = await request('/projects', 'POST', { name: 'Toolkit' });
  expect(response.status).toBe(201);
  const project = (await response.json()) as { id: string };
  expect((await request('/projects/' + project.id + '/packages/' + ids[0], 'PUT', {})).status).toBe(
    200,
  );
  await request('/projects/' + project.id + '/packages/' + ids[0], 'PUT', {});
  expect(
    (await bindings.DB.prepare('SELECT COUNT(*) n FROM project_packages').first<{ n: number }>())
      ?.n,
  ).toBe(1);
  const note = await request('/annotations', 'POST', {
    projectId: project.id,
    kind: 'campaign',
    title: 'Launch',
    occurredAt: '2026-01-01T00:00:00Z',
  });
  expect(note.status).toBe(201);
  const id = ((await note.json()) as { id: string }).id;
  expect(
    (
      await request('/annotations/' + id, 'PUT', {
        projectId: project.id,
        kind: 'campaign',
        title: 'Updated',
        occurredAt: '2026-01-02T00:00:00Z',
      })
    ).status,
  ).toBe(200);
  expect((await request('/annotations/' + id, 'DELETE')).status).toBe(200);
});
it('fences concurrent collection, persists baseline and growth atomically, and queues refresh with cooldown', async () => {
  const [id] = await seed(),
    now = new Date('2026-01-01T00:00:00Z');
  await Promise.all([
    collectDue(bindings.DB, { now, provider: () => provider() }),
    collectDue(bindings.DB, { now, provider: () => provider() }),
  ]);
  expect(
    (await bindings.DB.prepare('SELECT COUNT(*) n FROM observations').first<{ n: number }>())?.n,
  ).toBe(1);
  await collectDue(bindings.DB, {
    now: new Date('2026-01-01T06:00:00Z'),
    provider: () => provider(150),
  });
  const metrics = await request(
    '/metrics?from=2026-01-01T00:00:00.000Z&to=2026-01-01T06:00:00.000Z',
  );
  expect(metrics.status).toBe(200);
  const data = (await metrics.json()) as { growth: number; latestTotal: number };
  expect(data.growth).toBe(50);
  expect(data.latestTotal).toBe(150);
  expect((await request('/sync/' + id + '/refresh', 'POST', {})).status).toBe(202);
  expect((await request('/sync/' + id + '/refresh', 'POST', {})).status).toBe(429);
});
it('keeps prior data on failure and retries with persisted backoff', async () => {
  const [id] = await seed();
  await collectDue(bindings.DB, {
    now: new Date('2026-01-01T00:00:00Z'),
    provider: () => provider(),
  });
  const failing = provider();
  failing.collect = async () => {
    throw new Error('upstream');
  };
  await collectDue(bindings.DB, { now: new Date('2026-01-01T06:00:00Z'), provider: () => failing });
  expect(
    (await bindings.DB.prepare('SELECT COUNT(*) n FROM observations').first<{ n: number }>())?.n,
  ).toBe(1);
  const job = await bindings.DB.prepare(
    'SELECT status,next_attempt FROM collection_jobs WHERE package_id=?',
  )
    .bind(id)
    .first<{ status: string; next_attempt: string }>();
  expect(job?.status).toBe('failed');
  expect(job?.next_attempt).toBe('2026-01-01T07:00:00.000Z');
});
it('rejects production bypass, invalid JWTs, cross-origin mutations, and unknown APIs', async () => {
  expect((await request('/health', 'GET', undefined, { APP_ENV: 'production' })).status).toBe(503);
  const res = await app.request(
    'https://metrics.example/api/v1/health',
    { headers: { 'Cf-Access-Jwt-Assertion': 'invalid' } },
    {
      ...bindings,
      APP_ENV: 'production',
      APP_ORIGIN: 'https://metrics.example',
      ACCESS_TEAM_DOMAIN: 'test.cloudflareaccess.com',
      ACCESS_AUD: 'test',
    },
  );
  expect(res.status).toBe(401);
  const bad = await app.request(
    'http://localhost:8787/api/v1/projects',
    {
      method: 'POST',
      headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' },
      body: '{"name":"x"}',
    },
    bindings,
  );
  expect(bad.status).toBe(403);
  expect((await request('/missing')).status).toBe(404);
});
it('processes 20 packages in five bounded invocations', async () => {
  await seed(20);
  const start = performance.now();
  const reports = [];
  for (let i = 0; i < 5; i++)
    reports.push(
      await collectDue(bindings.DB, {
        now: new Date('2026-01-01T00:00:00Z'),
        provider: () => {
          const p = provider(),
            collect = p.collect;
          p.collect = async (id, at) => {
            const result = await collect(id, at);
            result.metadata.versions = Array.from({ length: 100 }, (_, n) => ({
              version: '1.0.' + n,
              prerelease: false,
              downloads: 1,
            }));
            result.observations.push(
              ...result.metadata.versions.map((v) => ({
                ...result.observations[0]!,
                scope: 'version' as const,
                version: v.version,
                value: 1,
              })),
            );
            return result;
          };
          return p;
        },
      }),
    );
  expect(reports.map((r) => r.successes)).toEqual([4, 4, 4, 4, 4]);
  expect(
    (await bindings.DB.prepare('SELECT COUNT(*) n FROM observations').first<{ n: number }>())?.n,
  ).toBe(2020);
  console.log(
    JSON.stringify({
      benchmark: '20-package-fixture',
      elapsedMs: performance.now() - start,
      invocations: 5,
      observations: 2020,
      versionsPerPackage: 100,
    }),
  );
});
it('registers exact NuGet packages once across projects and refuses unlisted packages', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    return url.endsWith('index.json')
      ? Response.json({
          resources: [{ '@type': 'SearchQueryService', '@id': 'https://search.nuget.org/query' }],
        })
      : Response.json({
          data: [
            {
              id: 'Example.Core',
              totalDownloads: 20,
              versions: [{ version: '1.0.0', downloads: 20 }],
            },
          ],
        });
  });
  try {
    const project = (await (await request('/projects', 'POST', { name: 'Project' })).json()) as {
      id: string;
    };
    const a = await request('/packages', 'POST', {
      provider: 'nuget',
      packageId: 'Example.Core',
      projectId: project.id,
    });
    expect(a.status).toBe(201);
    const b = await request('/packages', 'POST', {
      provider: 'nuget',
      packageId: 'EXAMPLE.CORE',
      projectId: project.id,
    });
    expect(b.status).toBe(201);
    expect(
      (await bindings.DB.prepare('SELECT COUNT(*) n FROM packages').first<{ n: number }>())?.n,
    ).toBe(1);
    expect(
      (await request('/packages', 'POST', { provider: 'nuget', packageId: 'missing' })).status,
    ).toBe(404);
  } finally {
    fetch.mockRestore();
  }
});
it('exports filtered observations, protects history deletion, and recovers expired jobs', async () => {
  const [id] = await seed();
  await bindings.DB.batch([
    bindings.DB.prepare(
      "UPDATE collection_jobs SET lease_token='expired',lease_until='2025-12-31T00:00:00.000Z',status='running' WHERE package_id=?",
    ).bind(id),
    bindings.DB.prepare(
      "INSERT INTO sync_attempts(id,package_id,started_at,status) VALUES('expired',?,'2025-12-31T00:00:00.000Z','running')",
    ).bind(id),
  ]);
  await collectDue(bindings.DB, {
    now: new Date('2026-01-01T00:00:00Z'),
    provider: () => provider(),
  });
  expect(
    (
      await bindings.DB.prepare("SELECT status FROM sync_attempts WHERE id='expired'").first<{
        status: string;
      }>()
    )?.status,
  ).toBe('interrupted');
  const exported = await request('/exports?from=2026-01-01T00:00:00Z&to=2026-01-02T00:00:00Z');
  expect(exported.status).toBe(200);
  expect(await exported.text()).toContain('baseline');
  expect((await request('/packages/' + id + '?confirm=delete-history', 'DELETE')).status).toBe(409);
  await request('/packages/' + id, 'PATCH', { archived: true });
  expect((await request('/packages/' + id + '?confirm=delete-history', 'DELETE')).status).toBe(200);
  expect(
    (await bindings.DB.prepare('SELECT COUNT(*) n FROM observations').first<{ n: number }>())?.n,
  ).toBe(0);
});

it('rolls back all collection writes when an observation violates the schema', async () => {
  const [id] = await seed();
  const broken = provider();
  const collect = broken.collect;
  broken.collect = async (key, at) => {
    const data = await collect(key, at);
    data.observations[0]!.kind = 'invalid' as 'cumulative';
    return data;
  };
  await collectDue(bindings.DB, { now: new Date('2026-01-01T00:00:00Z'), provider: () => broken });
  expect(
    (await bindings.DB.prepare('SELECT COUNT(*) n FROM observations').first<{ n: number }>())?.n,
  ).toBe(0);
  expect(
    (await bindings.DB.prepare('SELECT COUNT(*) n FROM package_versions').first<{ n: number }>())
      ?.n,
  ).toBe(0);
  expect(
    (
      await bindings.DB.prepare('SELECT last_success FROM packages WHERE id=?')
        .bind(id)
        .first<{ last_success: string | null }>()
    )?.last_success,
  ).toBeNull();
});

it('filters version channels, records discovery without backfill, and preserves archived history', async () => {
  const [id] = await seed();
  const make = (step: number) => {
    const p = provider(100 + step * 50),
      collect = p.collect;
    p.collect = async (key, at) => {
      const data = await collect(key, at);
      data.metadata.versions = [
        { version: '1.0.0', prerelease: false, downloads: 20 + step * 10 },
        ...(step ? [{ version: '2.0.0-beta.1', prerelease: true, downloads: 15 + step * 5 }] : []),
      ];
      data.observations.push(
        ...data.metadata.versions.map((v) => ({
          ...data.observations[0]!,
          scope: 'version' as const,
          version: v.version,
          value: v.downloads,
        })),
      );
      return data;
    };
    return p;
  };
  for (let step = 0; step < 3; step++)
    await collectDue(bindings.DB, {
      now: new Date(Date.UTC(2026, 0, 1, step * 6)),
      provider: () => make(step),
    });
  const query = '?packageId=' + id + '&from=2026-01-01T06:00:00Z&to=2026-01-01T12:00:00Z';
  const stable = (await (await request('/metrics' + query + '&channel=stable')).json()) as {
    growth: number;
    latestTotal: number;
  };
  expect(stable.growth).toBe(10);
  expect(stable.latestTotal).toBe(40);
  const pre = (await (await request('/metrics' + query + '&channel=prerelease')).json()) as {
    growth: number;
    latestTotal: number;
  };
  expect(pre.growth).toBe(5);
  expect(pre.latestTotal).toBe(25);
  const notes = (
    await bindings.DB.prepare('SELECT title,occurred_at FROM annotations').all<{
      title: string;
      occurred_at: string;
    }>()
  ).results;
  expect(notes).toHaveLength(1);
  expect(notes[0]?.occurred_at).toBe('2026-01-01T06:00:00.000Z');
  const csv = await (await request('/exports' + query)).text();
  expect(csv).toContain('2.0.0-beta.1');
  await request('/packages/' + id, 'PATCH', { archived: true });
  const history = (await (await request('/metrics' + query)).json()) as { latestTotal: number };
  expect(history.latestTotal).toBe(200);
});
