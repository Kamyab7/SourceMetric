import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { authorizeRoutes, createOAuthProvider, isOAuthPath } from '../features/mcp/oauth';
import { connectionRoutes } from '../features/mcp/connections';
import { security } from '../platform/auth';
import { AppError } from '../platform/errors';
import type { AppBindings } from '../platform/http';
import { projectRoutes } from '../features/projects/routes';
import { packageRoutes } from '../features/packages/routes';
import { annotationRoutes } from '../features/annotations/routes';
import { metricRoutes } from '../features/metrics/routes';
import { syncRoutes } from '../features/sync/routes';
import { exportRoutes } from '../features/exports/routes';
import { collectDue } from '../features/sync/collector';
import {
  repositoryRoutes,
  repositorySyncRoutes,
  repositoryMetricRoutes,
  repositoryExportRoutes,
} from '../features/repositories/routes';
import { collectRepositories } from '../features/repositories/collector';
import {
  repositoryTrafficRoutes,
  repositoryTrafficExportRoutes,
} from '../features/repositories/traffic';
const app = new Hono<AppBindings>();
app.onError((error, c) => {
  if (error instanceof AppError)
    return c.json({ error: { code: error.code, message: error.message } }, error.status);
  console.error(JSON.stringify({ event: 'request_failed', name: error.name }));
  return c.json(
    { error: { code: 'INTERNAL_ERROR', message: 'The request could not be completed.' } },
    500,
  );
});
app.use('*', security);
app.use(
  '/authorize',
  bodyLimit({ maxSize: 16384, onError: (c) => c.text('Request too large', 413) }),
);
app.use(
  '/api/*',
  bodyLimit({
    maxSize: 16384,
    onError: (c) =>
      c.json({ error: { code: 'INVALID_INPUT', message: 'Request body is too large.' } }, 413),
  }),
);
app.route('/api/v1/repository-traffic', repositoryTrafficRoutes);
app.route('/api/v1/repository-traffic-exports', repositoryTrafficExportRoutes);
app.route('/api/v1/repositories', repositoryRoutes);
app.route('/api/v1/repository-sync', repositorySyncRoutes);
app.route('/api/v1/repository-metrics', repositoryMetricRoutes);
app.route('/api/v1/repository-exports', repositoryExportRoutes);
app.route('/authorize', authorizeRoutes);
app.route('/api/v1/connections', connectionRoutes);
app.route('/api/v1/projects', projectRoutes);
app.route('/api/v1/packages', packageRoutes);
app.route('/api/v1/annotations', annotationRoutes);
app.route('/api/v1/metrics', metricRoutes);
app.route('/api/v1/sync', syncRoutes);
app.route('/api/v1/exports', exportRoutes);
app.get('/api/v1/health', (c) =>
  c.json({ ok: true, demo: c.env.APP_ENV === 'local' && c.env.DEMO_MODE === 'true' }),
);
app.all('/api/*', (c) =>
  c.json({ error: { code: 'NOT_FOUND', message: 'API endpoint not found.' } }, 404),
);
app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw));
export const gateway = new Hono<AppBindings>();
gateway.onError((error, c) => {
  if (error instanceof AppError)
    return c.json({ error: { code: error.code, message: error.message } }, error.status);
  console.error(JSON.stringify({ event: 'oauth_request_failed', name: error.name }));
  return c.json(
    {
      error: {
        code: 'OAUTH_UNAVAILABLE',
        message: 'Connection service is temporarily unavailable.',
      },
    },
    503,
  );
});
gateway.all('*', async (c) => {
  const url = new URL(c.req.url);
  const local =
    c.env.APP_ENV === 'local' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (!local && (!c.env.APP_ORIGIN || !c.env.ACCESS_AUD || !c.env.ACCESS_TEAM_DOMAIN))
    throw new AppError(503, 'AUTH_NOT_CONFIGURED', 'Cloudflare Access is not configured.');
  if (!local && url.origin !== c.env.APP_ORIGIN)
    throw new AppError(403, 'INVALID_HOST', 'Use the configured application domain.');
  const bindings = local ? { ...c.env, APP_ORIGIN: url.origin } : c.env;
  if (isOAuthPath(url.pathname) || url.pathname.startsWith('/api/v1/connections')) {
    // OAuth POSTs use bearer/PKCE checks rather than browser CSRF checks. Consent and
    // management still pass through the original Access and Origin middleware.
    const provider = createOAuthProvider(bindings.APP_ORIGIN, { fetch: app.fetch });
    return provider.fetch(
      c.req.raw,
      bindings,
      c.executionCtx as Parameters<typeof provider.fetch>[2],
    );
  }
  return app.fetch(c.req.raw, bindings);
});
export { gateway as app };
export default {
  fetch: gateway.fetch,
  async scheduled(_controller: ScheduledController, env: Env, _ctx: ExecutionContext) {
    if (env.APP_ENV === 'local' && env.DEMO_MODE === 'true') return;
    // Separate budgets ensure repository failures cannot starve package collection.
    const outcomes = await Promise.allSettled([
      collectDue(env.DB),
      collectRepositories(env.DB, { token: env.GITHUB_TOKEN }),
    ]);
    if (outcomes.some((result) => result.status === 'rejected'))
      throw new Error('Scheduled collection failed');
  },
} satisfies ExportedHandler<Env>;
