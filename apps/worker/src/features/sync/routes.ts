import { Hono } from 'hono';
import { idSchema, paginationSchema } from '@sourcemetric/contracts';
import { parse, type AppBindings } from '../../platform/http';
import { getPackage, listPackages } from '../packages/repository';
import { AppError, notFound } from '../../platform/errors';
export const syncRoutes = new Hono<AppBindings>()
  .get('/', async (c) => {
    const p = parse(paginationSchema, c.req.query());
    const jobs = parse(paginationSchema, {
      limit: c.req.query('packageLimit'),
      offset: c.req.query('packageOffset'),
    });
    const [packages, count, attempts, total] = await Promise.all([
      listPackages(c.env.DB, jobs.limit, jobs.offset),
      c.env.DB.prepare('SELECT COUNT(*) n FROM observations').first<{ n: number }>(),
      c.env.DB.prepare(
        'SELECT a.id,a.package_id packageId,p.display_name packageName,a.started_at startedAt,a.finished_at finishedAt,a.status,a.error FROM sync_attempts a JOIN packages p ON p.id=a.package_id ORDER BY a.started_at DESC,a.id DESC LIMIT ? OFFSET ?',
      )
        .bind(p.limit, p.offset)
        .all(),
      c.env.DB.prepare('SELECT COUNT(*) n FROM sync_attempts').first<{ n: number }>(),
    ]);
    return c.json({
      packages: packages.items,
      packageTotal: packages.total,
      observationCount: count?.n ?? 0,
      attempts: attempts.results,
      attemptTotal: total?.n ?? 0,
    });
  })
  .post('/:id/refresh', async (c) => {
    const id = parse(idSchema, c.req.param('id')),
      pkg = await getPackage(c.env.DB, id);
    if (!pkg) throw notFound();
    if (pkg.archived) throw new AppError(409, 'ARCHIVED', 'Restore the package before refreshing.');
    const now = new Date(),
      before = new Date(now.getTime() - 300000).toISOString();
    const update = await c.env.DB.prepare(
      "UPDATE collection_jobs SET next_attempt=?,manual_requested_at=?,status='queued' WHERE package_id=? AND (manual_requested_at IS NULL OR manual_requested_at<=?) AND (lease_until IS NULL OR lease_until<?)",
    )
      .bind(now.toISOString(), now.toISOString(), id, before, now.toISOString())
      .run();
    if (!update.meta.changes)
      throw new AppError(
        429,
        'REFRESH_COOLDOWN',
        'Collection is running or refresh was requested within five minutes.',
      );
    return c.json({ status: 'queued', message: 'Queued for the next hourly collector run.' }, 202);
  });
