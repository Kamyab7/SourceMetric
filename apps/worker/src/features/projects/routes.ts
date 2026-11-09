import { Hono } from 'hono';
import { idSchema, paginationSchema, projectInput, projectPatch } from '@sourcemetric/contracts';
import { body, parse, type AppBindings } from '../../platform/http';
import { notFound, AppError } from '../../platform/errors';
import * as repo from './repository';
export const projectRoutes = new Hono<AppBindings>()
  .get('/', async (c) => {
    const p = parse(paginationSchema, c.req.query());
    return c.json(await repo.listProjects(c.env.DB, p.limit, p.offset));
  })
  .post('/', async (c) => {
    const input = await body(c, projectInput);
    return c.json(await repo.createProject(c.env.DB, input.name), 201);
  })
  .patch('/:id', async (c) => {
    const patch = await body(c, projectPatch);
    if (!Object.keys(patch).length)
      throw new AppError(400, 'INVALID_INPUT', 'Supply a project change.');
    const row = await repo.updateProject(c.env.DB, parse(idSchema, c.req.param('id')), patch);
    if (!row) throw notFound();
    return c.json(row);
  })
  .put('/:id/packages/:packageId', async (c) => {
    if (
      !(await repo.associate(
        c.env.DB,
        parse(idSchema, c.req.param('id')),
        parse(idSchema, c.req.param('packageId')),
      ))
    )
      throw notFound();
    return c.json({ ok: true });
  })
  .delete('/:id/packages/:packageId', async (c) => {
    await repo.dissociate(
      c.env.DB,
      parse(idSchema, c.req.param('id')),
      parse(idSchema, c.req.param('packageId')),
    );
    return c.json({ ok: true });
  });
