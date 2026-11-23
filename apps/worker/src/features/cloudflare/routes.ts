import { Hono } from 'hono';
import type { AppBindings } from '../../platform/http';
import { cloudflareUsage } from './usage';

export const cloudflareRoutes = new Hono<AppBindings>().get('/usage', async (c) =>
  c.json(await cloudflareUsage(c.env)),
);
