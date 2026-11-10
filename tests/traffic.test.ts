import { it, expect, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import { app } from '../apps/worker/src/app';
import {
  registerRepository,
  associateRepository,
  getRepository,
} from '../apps/worker/src/features/repositories/repository';
import {
  collectRepositories,
  claimRepository,
  commitRepository,
  failRepository,
} from '../apps/worker/src/features/repositories/collector';
import { repositoryMetrics } from '../apps/worker/src/features/repositories/metrics';
import {
  trafficDetailSchema,
  trafficListSchema,
  repositorySyncSchema,
} from '@sourcemetric/contracts';
import type { RepositoryCollection } from '../apps/worker/src/providers/github/provider';
const db = env.DB,
  at = (h: number) => new Date(Date.parse('2026-01-01T00:00:00Z') + h * 3600000).toISOString();
const metadata = {
  githubId: '123',
  fullName: 'owner/tool',
  url: 'https://github.com/owner/tool',
  description: 'Fixture',
  private: false,
  stars: 10,
  forks: 3,
};
function collection(count = 10): RepositoryCollection {
  return {
    metadata,
    traffic: { days: [], error: null },
    views: {
      data: { count: 140, uniques: 45, days: [{ day: at(0), count, uniques: 4 }] },
      error: null,
    },
    paths: {
      data: [{ identity: '/owner/tool', title: 'Home', count: 10, uniques: 5 }],
      error: null,
    },
    referrers: { data: [{ identity: 'Google', title: null, count: 5, uniques: 4 }], error: null },
  };
}
async function seed() {
  const r = (await registerRepository(db, metadata))!;
  await db
    .prepare('UPDATE repository_jobs SET next_attempt=? WHERE repository_id=?')
    .bind(at(0), r.id)
    .run();
  return r;
}
const run = (h: number, result = collection()) =>
  collectRepositories(db, {
    now: new Date(at(h)),
    provider: { resolve: vi.fn(), collect: async () => result },
  });
const query = (from = 0, to = 48) => '?from=' + at(from) + '&to=' + at(to);
function request(path: string, method = 'GET', data?: unknown) {
  return app.request(
    'http://localhost:8787/api/v1' + path,
    {
      method,
      headers: { Origin: 'http://localhost:8787', 'Content-Type': 'application/json' },
      body: data === undefined ? undefined : JSON.stringify(data),
    },
    env,
  );
}
it('upserts revised view buckets, retains source unique totals, and never sums daily uniques', async () => {
  const r = await seed();
  await run(6);
  expect(await db.prepare('SELECT provisional FROM repository_views').first()).toEqual({
    provisional: 1,
  });
  await run(30, collection(15));
  const metrics = await repositoryMetrics(db, { from: at(0), to: at(24) });
  expect(metrics.views).toEqual({ total: 15, complete: true, comparison: null });
  expect(metrics.viewDays).toHaveLength(1);
  expect(metrics.viewDays[0]).toMatchObject({ repositoryId: r.id, uniques: 4, provisional: false });
  const totals = (
    await db
      .prepare(
        "SELECT count,uniques FROM repository_traffic_snapshots WHERE metric='views' ORDER BY observed_at DESC",
      )
      .all()
  ).results;
  expect(totals).toEqual([
    { count: 140, uniques: 45 },
    { count: 140, uniques: 45 },
  ]);
  expect(metrics.views).not.toHaveProperty('uniques');
});
it('saves independent successes and empty snapshots while preserving history on failures', async () => {
  const r = await seed();
  await run(6);
  const partial = collection();
  partial.paths = { data: [], error: null };
  partial.referrers = {
    data: null,
    error: 'GITHUB_RATE_LIMITED',
    retryAfter: 90000000,
    deferred: true,
  };
  const report = await run(30, partial);
  expect(report.partial).toBe(1);
  expect(await getRepository(db, r.id)).toMatchObject({
    trafficError: null,
    trafficSuccess: at(30),
    status: 'partial',
  });
  expect(
    await db
      .prepare(
        "SELECT items FROM repository_traffic_snapshots WHERE metric='paths' ORDER BY observed_at DESC LIMIT 1",
      )
      .first(),
  ).toEqual({ items: '[]' });
  expect(
    await db
      .prepare("SELECT COUNT(*) n FROM repository_traffic_snapshots WHERE metric='referrers'")
      .first(),
  ).toEqual({ n: 1 });
  expect(
    await db
      .prepare(
        "SELECT last_success,status,error FROM repository_traffic_status WHERE metric='referrers'",
      )
      .first(),
  ).toEqual({ last_success: at(6), status: 'deferred', error: 'GITHUB_RATE_LIMITED' });
  expect(Date.parse((await getRepository(db, r.id))!.nextAttempt) - Date.parse(at(30))).toBe(
    90000000,
  );
  const health = await request('/repository-sync');
  expect(repositorySyncSchema.safeParse(await health.json()).success).toBe(true);
});
it('fences new tables against stale commits and failures, and cascades deletion', async () => {
  const r = await seed();
  await claimRepository(db, r.id, 'old', at(0));
  await claimRepository(db, r.id, 'new', at(1));
  const job = { repository_id: r.id, github_id: r.githubId, failures: 0 };
  await commitRepository(db, job, 'old', at(6), at(12), collection());
  await failRepository(db, r.id, 'old', at(6), at(12), 'STALE');
  for (const table of [
    'repository_views',
    'repository_traffic_snapshots',
    'repository_traffic_status',
  ])
    expect(await db.prepare(`SELECT COUNT(*) n FROM ${table}`).first()).toEqual({ n: 0 });
  await commitRepository(db, job, 'new', at(6), at(12), collection());
  await request('/repositories/' + r.id, 'PATCH', { archived: true });
  await request('/repositories/' + r.id + '?confirm=delete-history', 'DELETE');
  for (const table of [
    'repository_views',
    'repository_traffic_snapshots',
    'repository_traffic_status',
  ])
    expect(await db.prepare(`SELECT COUNT(*) n FROM ${table}`).first()).toEqual({ n: 0 });
});
it('selects latest summaries as of range end, preserves stale snapshots, paginates history and retrieves detail', async () => {
  const r = await seed();
  await run(6);
  await run(30);
  const response = await request('/repository-traffic' + query(0, 24));
  const data = trafficListSchema.parse(await response.json());
  expect(data.total).toBe(1);
  expect(data.items[0]!.snapshots).toHaveLength(3);
  expect(data.items[0]!.snapshots.every((s) => s.observedAt === at(6))).toBe(true);
  expect(data.items[0]!.snapshots[0]).not.toHaveProperty('items');
  const stale = trafficListSchema.parse(
    await (await request('/repository-traffic' + query(48, 72))).json(),
  );
  expect(stale.items[0]!.snapshots[0]!.observedAt).toBe(at(30));
  const history = (await (
    await request(
      '/repository-traffic/history' +
        query() +
        '&repositoryId=' +
        r.id +
        '&metric=paths&limit=1&offset=1',
    )
  ).json()) as { total: number; items: { id: string; observedAt: string }[] };
  expect(history.total).toBe(2);
  expect(history.items[0]!.observedAt).toBe(at(6));
  const detail = trafficDetailSchema.parse(
    await (await request('/repository-traffic/snapshots/' + history.items[0]!.id)).json(),
  );
  expect(detail.items[0]!.identity).toBe('/owner/tool');
  expect(detail.windowDays).toBe(14);
  expect((await request('/repository-traffic/snapshots/' + crypto.randomUUID())).status).toBe(404);
  expect(
    (
      await request(
        '/repository-traffic/history' + query() + '&repositoryId=' + r.id + '&metric=bad',
      )
    ).status,
  ).toBe(400);
});
it('paginates repository groups and deduplicates shared repositories across projects', async () => {
  const r = await seed();
  await run(6);
  const projects = [crypto.randomUUID(), crypto.randomUUID()];
  for (const id of projects) {
    await db
      .prepare('INSERT INTO projects(id,name,created_at) VALUES(?,?,?)')
      .bind(id, 'Project', at(0))
      .run();
    await associateRepository(db, id, r.id);
  }
  const workspace = trafficListSchema.parse(
    await (await request('/repository-traffic' + query())).json(),
  );
  expect(workspace.items).toHaveLength(1);
  const project = trafficListSchema.parse(
    await (await request('/repository-traffic' + query() + '&projectId=' + projects[0])).json(),
  );
  expect(project.items).toHaveLength(1);
  expect(
    trafficListSchema.parse(
      await (await request('/repository-traffic' + query() + '&limit=1&offset=1')).json(),
    ),
  ).toEqual({ items: [], total: 1 });
});
it('exports daily observations and rolling snapshots separately, retaining empty lists and neutralizing formulas', async () => {
  await seed();
  const data = collection();
  data.paths = { data: [], error: null };
  data.referrers = {
    data: [{ identity: '=FORMULA()', title: null, count: 5, uniques: 3 }],
    error: null,
  };
  await run(6, data);
  await run(30, data);
  const daily = await (await request('/repository-exports' + query())).text();
  expect(daily).toContain('daily_unique_visitors');
  const csv = await (
    await request('/repository-traffic-exports' + query() + '&metric=referrers')
  ).text();
  expect(csv).toContain('rolling');
  expect(csv).toContain("'=FORMULA()");
  expect(csv).not.toContain('"paths"');
  const empty = await (
    await request('/repository-traffic-exports' + query() + '&metric=paths')
  ).text();
  expect(empty).toContain('empty_snapshot');
  expect((await request('/repository-traffic-exports' + query() + '&metric=unknown')).status).toBe(
    400,
  );
});
it('refuses oversized snapshot exports, counting expanded list rows', async () => {
  const r = await seed();
  const items = JSON.stringify(
    Array.from({ length: 10 }, (_, i) => ({
      identity: 'referrer' + i,
      title: null,
      count: 1,
      uniques: 1,
    })),
  );
  await db
    .prepare(
      `WITH RECURSIVE n(x) AS (SELECT 0 UNION ALL SELECT x+1 FROM n WHERE x<5000)
    INSERT INTO repository_traffic_snapshots(id,repository_id,metric,observed_at,items)
    SELECT printf('70000000-0000-4000-8000-%012d',x),?,'referrers',strftime('%Y-%m-%dT%H:%M:%fZ',julianday('2026-01-01')+x/1440.0),? FROM n`,
    )
    .bind(r.id, items)
    .run();
  expect((await request('/repository-traffic-exports' + query(0, 100))).status).toBe(400);
});

it('rejects large text exports before loading item arrays even below the row limit', async () => {
  const r = await seed();
  const items = JSON.stringify([
    { identity: '/owner/tool', title: 'x'.repeat(4096), count: 1, uniques: 1 },
  ]);
  await db
    .prepare(
      `WITH RECURSIVE n(x) AS (SELECT 0 UNION ALL SELECT x+1 FROM n WHERE x<999)
    INSERT INTO repository_traffic_snapshots(id,repository_id,metric,observed_at,items)
    SELECT printf('71000000-0000-4000-8000-%012d',x),?,'paths',strftime('%Y-%m-%dT%H:%M:%fZ',julianday('2026-01-01')+x/1440.0),? FROM n`,
    )
    .bind(r.id, items)
    .run();
  expect((await request('/repository-traffic-exports' + query(0, 24))).status).toBe(400);
});
