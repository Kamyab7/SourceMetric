import { it, expect } from 'vitest';
import { env } from 'cloudflare:workers';
import { app } from '../apps/worker/src/app';
async function get(path: string) {
  const response = await app.request('http://localhost:8787/api/v1' + path, {}, env);
  expect(response.status).toBe(200);
  return response.json() as Promise<any>;
}
it('pages tied projects, packages, notes, and attempts without truncating at old caps', async () => {
  const ids = Array.from({ length: 125 }, () => crypto.randomUUID());
  const when = '2026-01-01T00:00:00.000Z';
  for (let offset = 0; offset < ids.length; offset += 25) {
    await env.DB.batch(
      ids
        .slice(offset, offset + 25)
        .flatMap((id, n) => [
          env.DB.prepare('INSERT INTO projects(id,name,created_at) VALUES(?,?,?)').bind(
            id,
            'Project ' + (offset + n),
            when,
          ),
          env.DB.prepare(
            'INSERT INTO packages(id,provider,canonical_id,display_name,created_at,archived) VALUES(?,?,?,?,?,?)',
          ).bind(
            id,
            'nuget',
            'package.' + (offset + n),
            'Package ' + (offset + n),
            when,
            offset + n === 0 ? 0 : 1,
          ),
          env.DB.prepare('INSERT INTO collection_jobs(package_id,next_attempt) VALUES(?,?)').bind(
            id,
            when,
          ),
          env.DB.prepare(
            "INSERT INTO annotations(id,project_id,kind,title,occurred_at) VALUES(?,?,'campaign',?,?)",
          ).bind(id, id, 'Note ' + (offset + n), when),
          env.DB.prepare(
            "INSERT INTO sync_attempts(id,package_id,started_at,status) VALUES(?,?,?,'success')",
          ).bind(id, id, when),
        ]),
    );
  }
  for (const path of ['/projects', '/packages', '/annotations']) {
    const a = await get(path + '?limit=10&offset=0'),
      b = await get(path + '?limit=10&offset=10'),
      last = await get(path + '?limit=100&offset=100');
    expect(a.total).toBe(125);
    expect(a.items).toHaveLength(10);
    expect(b.items).toHaveLength(10);
    expect(new Set([...a.items, ...b.items].map((i) => i.id)).size).toBe(20);
    expect(last.items).toHaveLength(25);
    expect((await get(path + '?limit=10&offset=130')).items).toEqual([]);
  }
  const sync = await get('/sync?limit=10&offset=110&packageLimit=10&packageOffset=110');
  expect(sync.attemptTotal).toBe(125);
  expect(sync.packageTotal).toBe(125);
  expect(sync.attempts).toHaveLength(10);
  expect(sync.packages).toHaveLength(10);
  expect(sync.attempts.every((a: any) => a.packageName.startsWith('Package '))).toBe(true);
  const bad = await app.request('http://localhost:8787/api/v1/sync?limit=101', {}, env);
  expect(bad.status).toBe(400);
});
it('provides every available version beyond the old 200-version cap, with stable ties and filters', async () => {
  const id = crypto.randomUUID(),
    at = '2026-01-01T00:00:00.000Z';
  await env.DB.prepare(
    'INSERT INTO packages(id,provider,canonical_id,display_name,created_at) VALUES(?,?,?,?,?)',
  )
    .bind(id, 'nuget', 'large.package', 'Large.Package', at)
    .run();
  for (let offset = 0; offset < 250; offset += 25) {
    await env.DB.batch(
      Array.from({ length: 25 }, (_, index) => {
        const n = offset + index,
          version = '1.0.' + n + (n % 2 ? '-preview' : '');
        return [
          env.DB.prepare(
            'INSERT INTO package_versions(package_id,version,prerelease,first_seen) VALUES(?,?,?,?)',
          ).bind(id, version, n % 2, at),
          env.DB.prepare(
            "INSERT INTO observations(package_id,metric,scope,version,kind,value,observed_at,availability,quality,collection_id) VALUES(?,'downloads','version',?,'cumulative',10,?,'available','source','fixture')",
          ).bind(id, version, at),
        ];
      }).flat(),
    );
  }
  const query = '?from=2026-01-01T00:00:00Z&to=2026-01-02T00:00:00Z&packageId=' + id;
  const first = await get('/metrics/versions' + query + '&limit=100&offset=0');
  const second = await get('/metrics/versions' + query + '&limit=100&offset=100');
  const last = await get('/metrics/versions' + query + '&limit=100&offset=200');
  expect(first.total).toBe(250);
  expect(last.items).toHaveLength(50);
  expect(new Set([...first.items, ...second.items, ...last.items].map((i) => i.version)).size).toBe(
    250,
  );
  const pre = await get('/metrics/versions' + query + '&channel=prerelease&limit=100&offset=100');
  expect(pre.total).toBe(125);
  expect(pre.items).toHaveLength(25);
  expect(pre.items.every((i: any) => i.version.endsWith('-preview'))).toBe(true);
});
