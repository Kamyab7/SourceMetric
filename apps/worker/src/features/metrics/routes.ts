import { Hono } from 'hono';
import { rangeSchema, paginationSchema } from '@sourcemetric/contracts';
import { parse, type AppBindings } from '../../platform/http';
import { pagedVersions } from './repository';
import { getMetrics } from './use-cases';
export const metricRoutes = new Hono<AppBindings>()
  .get('/versions', async (c) => {
    const range = parse(rangeSchema, c.req.query()),
      p = parse(paginationSchema, c.req.query());
    return c.json(await pagedVersions(c.env.DB, range, p.limit, p.offset));
  })
  .get('/', async (c) => c.json(await getMetrics(c.env.DB, parse(rangeSchema, c.req.query()))));
