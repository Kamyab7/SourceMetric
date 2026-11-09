import { Hono } from 'hono';
import { annotationInput, idSchema, paginationSchema } from '@sourcemetric/contracts';
import { body, parse, type AppBindings } from '../../platform/http';
import { notFound } from '../../platform/errors';
import { saveAnnotation, deleteAnnotation } from './repository';
export const annotationRoutes = new Hono<AppBindings>()
  .get('/', async (c) => {
    const p = parse(paginationSchema, c.req.query());
    const rows = await c.env.DB.prepare(
      'SELECT id,project_id projectId,package_id packageId,kind,title,body,occurred_at occurredAt,automatic FROM annotations ORDER BY occurred_at DESC,id DESC LIMIT ? OFFSET ?',
    )
      .bind(p.limit, p.offset)
      .all<Record<string, unknown>>();
    return c.json({
      items: rows.results.map((r) => ({ ...r, automatic: !!r.automatic })),
      total:
        (await c.env.DB.prepare('SELECT COUNT(*) n FROM annotations').first<{ n: number }>())?.n ??
        0,
    });
  })
  .post('/', async (c) => {
    const input = await body(c, annotationInput);
    await validateTarget(c.env.DB, input);
    return c.json(await saveAnnotation(c.env.DB, input), 201);
  })
  .put('/:id', async (c) => {
    const input = await body(c, annotationInput);
    await validateTarget(c.env.DB, input);
    const row = await saveAnnotation(c.env.DB, input, parse(idSchema, c.req.param('id')));
    if (!row) throw notFound();
    return c.json(row);
  })
  .delete('/:id', async (c) => {
    if (!(await deleteAnnotation(c.env.DB, parse(idSchema, c.req.param('id')))).length)
      throw notFound();
    return c.json({ ok: true });
  });
async function validateTarget(db: D1Database, input: { projectId?: string; packageId?: string }) {
  const row = input.projectId
    ? await db.prepare('SELECT id FROM projects WHERE id=?').bind(input.projectId).first()
    : await db.prepare('SELECT id FROM packages WHERE id=?').bind(input.packageId).first();
  if (!row) throw notFound();
}
