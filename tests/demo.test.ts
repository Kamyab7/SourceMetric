import { it, expect } from 'vitest';
import { env } from 'cloudflare:workers';
import { createDemoFixture, demoIds } from '../scripts/demo-fixture.mjs';
import worker, { app } from '../apps/worker/src/app';

it('seeds realistic data with complete default trends, versions, notes, and collection history', async () => {
  const now = new Date('2026-11-09T12:00:00.000Z');
  const fixture = createDemoFixture(now);
  expect(createDemoFixture(now).sql).toBe(fixture.sql);
  expect(fixture.counts.projects).toBe(3);
  expect(fixture.counts.packages).toBe(6);
  expect(fixture.counts.observations).toBeGreaterThan(10000);
  const statements = fixture.sql.split('\n').filter(Boolean);
  for (let i = 0; i < statements.length; i += 30)
    await env.DB.batch(statements.slice(i, i + 30).map((sql) => env.DB.prepare(sql)));
  const bindings = { ...env, DEMO_MODE: 'true' };
  const response = await app.request(
    'http://localhost:8790/api/v1/metrics?from=2026-10-10T00:00:00Z&to=2026-11-09T00:00:00Z',
    {},
    bindings,
  );
  expect(response.status).toBe(200);
  const data = (await response.json()) as {
    growth: number;
    comparison: number;
    points: unknown[];
    versions: unknown[];
    annotations: unknown[];
  };
  expect(data.growth).toBeGreaterThan(0);
  expect(data.comparison).not.toBeNull();
  expect(data.points.length).toBeGreaterThan(600);
  expect(data.versions.length).toBe(18);
  expect(data.annotations.length).toBeGreaterThan(4);
  const project = await app.request(
    'http://localhost:8790/api/v1/metrics?from=2026-10-10T00:00:00Z&to=2026-11-09T00:00:00Z&projectId=' +
      demoIds.projects[0],
    {},
    bindings,
  );
  expect(project.status).toBe(200);
  const health = await app.request('http://localhost:8790/api/v1/health', {}, bindings);
  expect(await health.json()).toEqual({ ok: true, demo: true });
});

it('blocks demo mutations and scheduled collection without bypassing production auth', async () => {
  const bindings = { ...env, DEMO_MODE: 'true' };
  const post = await app.request(
    'http://localhost:8790/api/v1/packages',
    {
      method: 'POST',
      headers: { Origin: 'http://localhost:8790', 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'nuget', packageId: 'Never.Fetch.This' }),
    },
    bindings,
  );
  expect(post.status).toBe(409);
  expect(await post.json()).toMatchObject({ error: { code: 'DEMO_READ_ONLY' } });
  // No database query or registry call should occur in the scheduled handler.
  const fakeDb = {
    prepare: () => {
      throw new Error('Demo collector accessed the database');
    },
  };
  await worker.scheduled(
    {} as ScheduledController,
    { ...bindings, DB: fakeDb as unknown as D1Database },
    {} as ExecutionContext,
  );
  const production = await app.request(
    'http://localhost:8790/api/v1/health',
    {},
    { ...bindings, APP_ENV: 'production' },
  );
  expect(production.status).toBe(503);
});
