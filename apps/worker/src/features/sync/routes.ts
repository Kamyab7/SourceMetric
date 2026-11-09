import { Hono } from 'hono';
import { idSchema } from '@sourcemetric/contracts';
import { parse, type AppBindings } from '../../platform/http';
import { getPackage, listPackages } from '../packages/repository';
import { AppError, notFound } from '../../platform/errors';
export const syncRoutes = new Hono<AppBindings>()
  .get('/', async (c) => {
    const [packages, count, attempts] = await Promise.all([
      listPackages(c.env.DB),
      c.env.DB.prepare('SELECT COUNT(*) n FROM observations').first<{ n: number }>(),
      c.env.DB.prepare(
        'SELECT id,package_id packageId,started_at startedAt,finished_at finishedAt,status,error FROM sync_attempts ORDER BY started_at DESC LIMIT 50',
      ).all(),
    ]);
    return c.json({
      packages: packages.items,
      observationCount: count?.n ?? 0,
      attempts: attempts.results,
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
