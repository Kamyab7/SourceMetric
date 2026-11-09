import { Hono } from 'hono';
import { rangeSchema } from '@sourcemetric/contracts';
import { parse, type AppBindings } from '../../platform/http';
import { getMetrics } from './use-cases';
export const metricRoutes = new Hono<AppBindings>().get('/', async (c) =>
  c.json(await getMetrics(c.env.DB, parse(rangeSchema, c.req.query()))),
);
