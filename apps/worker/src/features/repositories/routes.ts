import { Hono } from 'hono';
import {
  idSchema,
  paginationSchema,
  packagePatch,
  repositoryInput,
  repositoryRangeSchema,
} from '@sourcemetric/contracts';
import { body, parse, type AppBindings } from '../../platform/http';
import { AppError, notFound } from '../../platform/errors';
import { GitHubProvider } from '../../providers/github/provider';
import { getRepository, listRepositories, registerRepository } from './repository';
import { repositoryMetrics } from './metrics';
import { trafficStatuses } from './traffic';
import { csvRow } from '../exports/csv';
export const repositoryRoutes = new Hono<AppBindings>()
  .get('/', async (c) => {
    const p = parse(paginationSchema, c.req.query()),
      projectId = c.req.query('projectId');
    return c.json(
      await listRepositories(
        c.env.DB,
        p.limit,
        p.offset,
        projectId ? parse(idSchema, projectId) : undefined,
      ),
    );
  })
  .post('/resolve', async (c) =>
    c.json(
      await new GitHubProvider(c.env.GITHUB_TOKEN).resolve(
        (await body(c, repositoryInput)).repository,
      ),
    ),
  )
  .post('/', async (c) => {
    const input = await body(c, repositoryInput);
    return c.json(
      await registerRepository(
        c.env.DB,
        await new GitHubProvider(c.env.GITHUB_TOKEN).resolve(input.repository),
        input.projectId,
      ),
      201,
    );
  })
  .get('/:id', async (c) => {
    const row = await getRepository(c.env.DB, parse(idSchema, c.req.param('id')));
    if (!row) throw notFound();
    return c.json(row);
  })
  .patch('/:id', async (c) => {
    const id = parse(idSchema, c.req.param('id')),
      input = await body(c, packagePatch);
    if (!(await getRepository(c.env.DB, id))) throw notFound();
    const result = await c.env.DB.prepare(
      'UPDATE repositories SET archived=? WHERE id=? AND (?=1 OR archived=0 OR (SELECT COUNT(*) FROM repositories WHERE archived=0)<20)',
    )
      .bind(input.archived ? 1 : 0, id, input.archived ? 1 : 0)
      .run();
    if (!result.meta.changes)
      throw new AppError(409, 'CAPACITY_REACHED', 'Archive another repository before restoring.');
    return c.json(await getRepository(c.env.DB, id));
  })
  .delete('/:id', async (c) => {
    const id = parse(idSchema, c.req.param('id'));
    if (c.req.query('confirm') !== 'delete-history')
      throw new AppError(400, 'CONFIRMATION_REQUIRED', 'Confirm permanent history deletion.');
    const row = await getRepository(c.env.DB, id);
    if (!row) throw notFound();
    if (!row.archived)
      throw new AppError(
        409,
        'ARCHIVE_REQUIRED',
        'Archive the repository before deleting its history.',
      );
    await c.env.DB.prepare('DELETE FROM repositories WHERE id=?').bind(id).run();
    return c.json({ ok: true });
  });
export const repositorySyncRoutes = new Hono<AppBindings>()
  .get('/', async (c) => {
    const p = parse(paginationSchema, c.req.query()),
      jobs = parse(paginationSchema, {
        limit: c.req.query('repositoryLimit'),
        offset: c.req.query('repositoryOffset'),
      });
    const [repositories, attempts, count] = await Promise.all([
      listRepositories(c.env.DB, jobs.limit, jobs.offset),
      c.env.DB.prepare(
        `SELECT a.id,a.repository_id repositoryId,r.full_name repositoryName,a.started_at startedAt,a.finished_at finishedAt,a.status,a.error FROM repository_attempts a JOIN repositories r ON r.id=a.repository_id ORDER BY a.started_at DESC,a.id DESC LIMIT ? OFFSET ?`,
      )
        .bind(p.limit, p.offset)
        .all(),
      c.env.DB.prepare('SELECT COUNT(*) n FROM repository_attempts').first<{ n: number }>(),
    ]);
    return c.json({
      repositories: repositories.items,
      repositoryTotal: repositories.total,
      trafficStatuses: await trafficStatuses(
        c.env.DB,
        repositories.items.map((r) => r.id),
      ),
      attempts: attempts.results,
      attemptTotal: count?.n ?? 0,
    });
  })
  .post('/:id/refresh', async (c) => {
    const id = parse(idSchema, c.req.param('id')),
      row = await getRepository(c.env.DB, id);
    if (!row) throw notFound();
    if (row.archived)
      throw new AppError(409, 'ARCHIVED', 'Restore the repository before refreshing.');
    const now = new Date().toISOString();
    const result = await c.env.DB.prepare(
      `UPDATE repository_jobs SET next_attempt=?,manual_requested_at=?,status='queued' WHERE repository_id=? AND (manual_requested_at IS NULL OR manual_requested_at<=?) AND (lease_until IS NULL OR lease_until<?)`,
    )
      .bind(now, now, id, new Date(Date.parse(now) - 300000).toISOString(), now)
      .run();
    if (!result.meta.changes)
      throw new AppError(
        429,
        'REFRESH_COOLDOWN',
        'Collection is running or refresh was requested within five minutes.',
      );
    return c.json({ status: 'queued', message: 'Queued for the next hourly collector run.' }, 202);
  });
export const repositoryMetricRoutes = new Hono<AppBindings>().get('/', async (c) =>
  c.json(await repositoryMetrics(c.env.DB, parse(repositoryRangeSchema, c.req.query()))),
);
export const repositoryExportRoutes = new Hono<AppBindings>().get('/', async (c) => {
  const data = await repositoryMetrics(c.env.DB, parse(repositoryRangeSchema, c.req.query()));
  if (data.truncated)
    throw new AppError(
      400,
      'RANGE_TOO_LARGE',
      'Choose a smaller range to export all observations.',
    );
  const names = new Map(data.repositories.map((r) => [r.id, r.fullName]));
  const rows = [
    csvRow([
      'repository_id',
      'repository_name',
      'metric',
      'source',
      'observed_at_utc',
      'interval_start_utc',
      'interval_end_utc',
      'value',
      'quality',
    ]),
  ];
  for (const p of data.snapshots.filter((p) => p.observedAt >= data.from))
    for (const metric of ['stars', 'forks'] as const)
      rows.push(
        csvRow([
          p.repositoryId,
          names.get(p.repositoryId),
          metric,
          'github',
          p.observedAt,
          null,
          null,
          p[metric],
          'snapshot',
        ]),
      );
  for (const d of data.days)
    for (const metric of ['clones', 'daily_unique_cloners'] as const)
      rows.push(
        csvRow([
          d.repositoryId,
          names.get(d.repositoryId),
          metric,
          'github',
          d.observedAt,
          d.day,
          new Date(Date.parse(d.day) + 86400000).toISOString(),
          metric === 'clones' ? d.count : d.uniques,
          d.provisional ? 'provisional' : 'daily',
        ]),
      );
  for (const d of data.viewDays)
    for (const metric of ['views', 'daily_unique_visitors'] as const)
      rows.push(
        csvRow([
          d.repositoryId,
          names.get(d.repositoryId),
          metric,
          'github',
          d.observedAt,
          d.day,
          new Date(Date.parse(d.day) + 86400000).toISOString(),
          metric === 'views' ? d.count : d.uniques,
          d.provisional ? 'provisional' : 'daily',
        ]),
      );
  return new Response(rows.join(''), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="sourcemetric-repositories.csv"',
    },
  });
});
