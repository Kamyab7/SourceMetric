import { it, expect, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import { app } from '../apps/worker/src/app';
import {
  registerRepository,
  getRepository,
  associateRepository,
} from '../apps/worker/src/features/repositories/repository';
import {
  collectRepositories,
  claimRepository,
  commitRepository,
  failRepository,
} from '../apps/worker/src/features/repositories/collector';
import {
  repositoryMetrics,
  gaugeSummary,
  cloneSummary,
} from '../apps/worker/src/features/repositories/metrics';
import { repositoryMetricsSchema } from '@sourcemetric/contracts';
import type {
  RepositoryCollection,
  RepositoryProvider,
} from '../apps/worker/src/providers/github/provider';
const db = env.DB;
const at = (hours: number) =>
  new Date(Date.parse('2026-01-01T00:00:00Z') + hours * 3600000).toISOString();
const metadata = {
  githubId: '123',
  fullName: 'owner/tool',
  url: 'https://github.com/owner/tool',
  description: 'Fixture',
  private: false,
  stars: 10,
  forks: 4,
};
const result = (stars = 10, count = 5): RepositoryCollection => ({
  metadata: { ...metadata, stars },
  traffic: { days: [{ day: at(0), count, uniques: 3 }], error: null },
});
async function seed(githubId = '123') {
  const repository = await registerRepository(db, { ...metadata, githubId });
  await db
    .prepare('UPDATE repository_jobs SET next_attempt=? WHERE repository_id=?')
    .bind(at(0), repository!.id)
    .run();
  return repository!;
}
function provider(collection = result()): RepositoryProvider {
  return { resolve: vi.fn(), collect: vi.fn(async () => collection) };
}
async function request(path: string, method = 'GET', body?: unknown, overrides: Partial<Env> = {}) {
  return app.request(
    'http://localhost:8787/api/v1' + path,
    {
      method,
      headers: { Origin: 'http://localhost:8787', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    { ...env, ...overrides },
  );
}
it('registers by immutable identity, deduplicates project associations, and preserves history on rename', async () => {
  const r = await seed();
  const project = crypto.randomUUID();
  await db
    .prepare('INSERT INTO projects(id,name,created_at) VALUES(?,?,?)')
    .bind(project, 'Toolkit', at(0))
    .run();
  await associateRepository(db, project, r.id);
  await associateRepository(db, project, r.id);
  const same = await registerRepository(db, { ...metadata, fullName: 'new/renamed' }, project);
  expect(same!.id).toBe(r.id);
  expect(same!.fullName).toBe('new/renamed');
  expect((await request('/repositories?projectId=' + project)).status).toBe(200);
  await collectRepositories(db, { now: new Date(at(6)), provider: provider() });
  const a = await repositoryMetrics(db, { from: at(0), to: at(24) }),
    b = await repositoryMetrics(db, { from: at(0), to: at(24), projectId: project });
  expect(a.stars.latest).toBe(10);
  expect(b.stars.latest).toBe(a.stars.latest);
  expect(repositoryMetricsSchema.safeParse(a).success).toBe(true);
});
it('upserts revised daily buckets without duplicate counts, retaining older buckets', async () => {
  const r = await seed();
  await collectRepositories(db, { now: new Date(at(6)), provider: provider() });
  await collectRepositories(db, { now: new Date(at(30)), provider: provider(result(8, 9)) });
  expect(await db.prepare('SELECT COUNT(*) n FROM repository_clones').first()).toEqual({ n: 1 });
  const data = await repositoryMetrics(db, { from: at(0), to: at(48), repositoryId: r.id });
  expect(data.days[0]).toMatchObject({ count: 9, provisional: false });
  expect(data.stars.change).toBe(-2);
  expect(data.clones.total).toBe(9);
  expect(data.clones.complete).toBe(false);
  expect(data.clones.comparison).toBeNull();
  const later = result(12);
  later.traffic = { days: [], error: null };
  await collectRepositories(db, { now: new Date(at(400)), provider: provider(later) });
  expect(await db.prepare('SELECT count FROM repository_clones').first()).toEqual({ count: 9 });
});
it('commits metadata on traffic-only failure and respects long retry delays', async () => {
  const r = await seed(),
    partial: RepositoryCollection = {
      metadata,
      traffic: { days: null, error: 'GITHUB_RATE_LIMITED', retryAfter: 90000000 },
    };
  const report = await collectRepositories(db, {
    now: new Date(at(6)),
    provider: provider(partial),
  });
  expect(report.partial).toBe(1);
  const row = await getRepository(db, r.id);
  expect(row).toMatchObject({
    lastSuccess: at(6),
    trafficSuccess: null,
    trafficError: 'GITHUB_RATE_LIMITED',
    status: 'partial',
  });
  expect(Date.parse(row!.nextAttempt) - Date.parse(at(6))).toBe(90000000);
  expect(await db.prepare('SELECT stars FROM repository_snapshots').first()).toEqual({ stars: 10 });
});
it('recovers expired leases and fences every stale success and failure write', async () => {
  const r = await seed();
  expect(await claimRepository(db, r.id, 'old', at(0))).toBe(true);
  expect(await claimRepository(db, r.id, 'early', at(0))).toBe(false);
  expect(await claimRepository(db, r.id, 'new', at(1))).toBe(true);
  const job = { repository_id: r.id, github_id: '123', failures: 0 };
  await commitRepository(db, job, 'old', at(2), at(8), result(999));
  await failRepository(db, r.id, 'old', at(2), at(8), 'STALE');
  expect(await db.prepare('SELECT COUNT(*) n FROM repository_snapshots').first()).toEqual({ n: 0 });
  expect(
    await db.prepare("SELECT status,error FROM repository_attempts WHERE id='old'").first(),
  ).toEqual({ status: 'interrupted', error: 'LEASE_EXPIRED' });
  await commitRepository(db, job, 'new', at(2), at(8), result());
  expect((await getRepository(db, r.id))!.status).toBe('success');
});
it('bounds repository batches, retries safely, and keeps configuration failures visible', async () => {
  for (let i = 0; i < 6; i++) await seed(String(i));
  const report = await collectRepositories(db, {
    now: new Date(at(0)),
    provider: {
      resolve: vi.fn(),
      collect: async () => {
        throw new Error('secret');
      },
    },
  });
  expect(report.repositories).toBe(4);
  expect(report.failures).toBe(4);
  const remaining = await collectRepositories(db, { now: new Date(at(0)) });
  expect(remaining.repositories).toBe(2);
  expect(
    (await db
      .prepare("SELECT COUNT(*) n FROM repository_jobs WHERE last_error='GITHUB_NOT_CONFIGURED'")
      .first<{ n: number }>())!.n,
  ).toBe(2);
});
it('supports lifecycle, cooldown, association routes, pagination, and CSV', async () => {
  const r = await seed();
  const project = (await (await request('/projects', 'POST', { name: 'Toolkit' })).json()) as {
    id: string;
  };
  expect((await request(`/projects/${project.id}/repositories/${r.id}`, 'PUT', {})).status).toBe(
    200,
  );
  expect((await request('/repository-sync/' + r.id + '/refresh', 'POST', {})).status).toBe(202);
  expect((await request('/repository-sync/' + r.id + '/refresh', 'POST', {})).status).toBe(429);
  await db
    .prepare('UPDATE repository_jobs SET next_attempt=? WHERE repository_id=?')
    .bind(at(0), r.id)
    .run();
  await collectRepositories(db, { now: new Date(at(6)), provider: provider() });
  const csv = await request('/repository-exports?from=' + at(0) + '&to=' + at(24));
  expect(csv.status).toBe(200);
  expect(await csv.text()).toContain('daily_unique_cloners');
  expect((await request('/repository-sync?limit=1&repositoryLimit=1')).status).toBe(200);
  expect(
    (await request('/repositories/' + r.id + '?confirm=delete-history', 'DELETE')).status,
  ).toBe(409);
  expect((await request('/repositories/' + r.id, 'PATCH', { archived: true })).status).toBe(200);
  expect((await request('/repository-sync/' + r.id + '/refresh', 'POST', {})).status).toBe(409);
  expect((await request('/repositories/' + r.id, 'PATCH', { archived: false })).status).toBe(200);
  expect((await request(`/projects/${project.id}/repositories/${r.id}`, 'DELETE')).status).toBe(
    200,
  );
  await request('/repositories/' + r.id, 'PATCH', { archived: true });
  expect(
    (await request('/repositories/' + r.id + '?confirm=delete-history', 'DELETE')).status,
  ).toBe(200);
  for (const table of [
    'repository_jobs',
    'repository_snapshots',
    'repository_clones',
    'repository_attempts',
    'project_repositories',
  ])
    expect(await db.prepare(`SELECT COUNT(*) n FROM ${table}`).first()).toEqual({ n: 0 });
});
it('enforces the active capacity on registration and restore', async () => {
  const first = await seed('0');
  for (let i = 1; i < 20; i++) await seed(String(i));
  await expect(seed('20')).rejects.toMatchObject({ code: 'CAPACITY_REACHED' });
  expect((await registerRepository(db, { ...metadata, githubId: '0' }))!.id).toBe(first.id);
  await request('/repositories/' + first.id, 'PATCH', { archived: true });
  await seed('20');
  expect((await request('/repositories/' + first.id, 'PATCH', { archived: false })).status).toBe(
    409,
  );
});
it('calculates gauges as net change and leaves missing clone days and uniques unaggregated', () => {
  const id = crypto.randomUUID(),
    snapshots = [0, 6, 12, 18, 24].map((h, i) => ({
      repositoryId: id,
      observedAt: at(h),
      stars: 10 - i,
      forks: 5 - i,
    }));
  expect(gaugeSummary([id], snapshots, at(0), at(24), 'stars')).toEqual({
    latest: 6,
    change: -4,
    complete: true,
  });
  expect(gaugeSummary([id], [snapshots[0]!], at(0), at(24), 'stars')).toMatchObject({
    change: null,
    complete: false,
  });
  expect(gaugeSummary([id], [snapshots[0]!, snapshots[4]!], at(0), at(24), 'stars').complete).toBe(
    false,
  );
  const days = [
    { repositoryId: id, day: at(0), count: 4, uniques: 3, observedAt: at(30), provisional: false },
  ];
  expect(cloneSummary([id], days, at(0), at(24))).toEqual({ total: 4, complete: true });
  expect(cloneSummary([id], days, at(1), at(24))).toEqual({ total: null, complete: false });
  expect(cloneSummary([id], [{ ...days[0]!, provisional: true }], at(0), at(24))).toEqual({
    total: null,
    complete: false,
  });
});
it('blocks demo mutations before any GitHub fetch', async () => {
  for (const path of ['/repositories', '/repositories/resolve'])
    expect(
      (await request(path, 'POST', { repository: 'owner/tool' }, { DEMO_MODE: 'true' })).status,
    ).toBe(409);
});

it('resolves and registers through the API with upstream fixtures', async () => {
  const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
    Response.json({
      id: 123,
      full_name: 'owner/tool',
      description: 'API fixture',
      private: true,
      stargazers_count: 20,
      forks_count: 3,
    }),
  );
  try {
    const resolved = await request(
      '/repositories/resolve',
      'POST',
      { repository: 'owner/tool' },
      { GITHUB_TOKEN: 'test-secret' },
    );
    expect(resolved.status).toBe(200);
    const created = await request(
      '/repositories',
      'POST',
      { repository: 'owner/tool' },
      { GITHUB_TOKEN: 'test-secret' },
    );
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ githubId: '123', private: true });
  } finally {
    fetcher.mockRestore();
  }
});
it('caps oversized metric responses and rejects truncated CSV exports', async () => {
  const r = await seed();
  await db
    .prepare(
      `WITH RECURSIVE n(x) AS (SELECT 0 UNION ALL SELECT x+1 FROM n WHERE x<50000)
    INSERT INTO repository_snapshots(repository_id,observed_at,stars,forks)
    SELECT ?,strftime('%Y-%m-%dT%H:%M:%fZ',julianday('2026-01-01')+x/1440.0),x,1 FROM n`,
    )
    .bind(r.id)
    .run();
  const range = '?from=' + at(0) + '&to=' + at(1000);
  const response = await request('/repository-metrics' + range);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    truncated: true,
    stars: { complete: false, comparison: null },
  });
  expect((await request('/repository-exports' + range)).status).toBe(400);
});

it('compares complete periods while allowing negative gauge changes', async () => {
  const r = await seed();
  await db.batch(
    Array.from({ length: 9 }, (_, i) =>
      db
        .prepare(
          'INSERT INTO repository_snapshots(repository_id,observed_at,stars,forks) VALUES(?,?,?,?)',
        )
        .bind(r.id, at(i * 6), 10 + (i <= 4 ? i : 4 + (i - 4) * 2), 20 - i),
    ),
  );
  await db.batch(
    [0, 1].map((i) =>
      db
        .prepare(
          'INSERT INTO repository_clones(repository_id,day,count,uniques,observed_at,provisional) VALUES(?,?,?,?,?,0)',
        )
        .bind(r.id, at(i * 24), 5 + i * 5, 3, at(48)),
    ),
  );
  const data = await repositoryMetrics(db, { from: at(24), to: at(48) });
  expect(data.stars).toEqual({ latest: 22, change: 8, complete: true, comparison: 100 });
  expect(data.forks).toEqual({ latest: 12, change: -4, complete: true, comparison: 0 });
  expect(data.clones).toEqual({ total: 10, complete: true, comparison: 100 });
  expect(data.days).toHaveLength(1);
});
