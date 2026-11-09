import { Hono } from 'hono';
import { packageInput, packagePatch, paginationSchema, idSchema } from '@sourcemetric/contracts';
import { body, parse, type AppBindings } from '../../platform/http';
import { AppError, notFound } from '../../platform/errors';
import { createPackageProvider } from '../../providers/factory';
import { getPackage, listPackages } from './repository';
import { registerPackage } from './use-cases';
export const packageRoutes = new Hono<AppBindings>()
  .get('/', async (c) => {
    const p = parse(paginationSchema, c.req.query());
    const projectId = c.req.query('projectId');
    return c.json(
      await listPackages(
        c.env.DB,
        p.limit,
        p.offset,
        projectId ? parse(idSchema, projectId) : undefined,
      ),
    );
  })
  .post('/resolve', async (c) => {
    const input = await body(c, packageInput);
    return c.json(await createPackageProvider(input.provider).resolve(input.packageId));
  })
  .post('/', async (c) => c.json(await registerPackage(c.env.DB, await body(c, packageInput)), 201))
  .get('/:id', async (c) => {
    const row = await getPackage(c.env.DB, parse(idSchema, c.req.param('id')));
    if (!row) throw notFound();
    return c.json(row);
  })
  .patch('/:id', async (c) => {
    const id = parse(idSchema, c.req.param('id')),
      input = await body(c, packagePatch);
    if (!(await getPackage(c.env.DB, id))) throw notFound();
    const result = await c.env.DB.prepare(
      'UPDATE packages SET archived=? WHERE id=? AND (?=1 OR archived=0 OR (SELECT COUNT(*) FROM packages WHERE archived=0)<20)',
    )
      .bind(input.archived ? 1 : 0, id, input.archived ? 1 : 0)
      .run();
    if (!result.meta.changes)
      throw new AppError(
        409,
        'CAPACITY_REACHED',
        'Archive another package before restoring this package.',
      );
    return c.json(await getPackage(c.env.DB, id));
  })
  .delete('/:id', async (c) => {
    const id = parse(idSchema, c.req.param('id'));
    if (c.req.query('confirm') !== 'delete-history')
      throw new AppError(400, 'CONFIRMATION_REQUIRED', 'Confirm permanent history deletion.');
    const row = await getPackage(c.env.DB, id);
    if (!row) throw notFound();
    if (!row.archived)
      throw new AppError(
        409,
        'ARCHIVE_REQUIRED',
        'Archive the package before deleting its history.',
      );
    await c.env.DB.prepare('DELETE FROM packages WHERE id=?').bind(id).run();
    return c.json({ ok: true });
  });
