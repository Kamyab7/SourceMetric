import { Hono } from 'hono';
import { idSchema, paginationSchema } from '@sourcemetric/contracts';
import { parse, type AppBindings } from '../../platform/http';
import { AppError, notFound } from '../../platform/errors';

export const GRANT_SECONDS = 30 * 86400;
export async function activeConnection(db: D1Database, connectionId: string, userId: string) {
  return db
    .prepare(
      'SELECT id FROM mcp_connections WHERE id=? AND user_id=? AND revoked_at IS NULL AND expires_at>?',
    )
    .bind(connectionId, userId, new Date().toISOString())
    .first();
}
export const connectionRoutes = new Hono<AppBindings>()
  .get('/', async (c) => {
    const p = parse(paginationSchema, c.req.query());
    const owner = c.get('userId');
    const [rows, count] = await Promise.all([
      c.env.DB.prepare(
        'SELECT id,client_name clientName,scope,created_at createdAt,expires_at expiresAt,revoked_at revokedAt,CASE WHEN revoked_at IS NOT NULL AND grant_id IS NOT NULL THEN 1 ELSE 0 END cleanupPending FROM mcp_connections WHERE user_id=? ORDER BY created_at DESC,id LIMIT ? OFFSET ?',
      )
        .bind(owner, p.limit, p.offset)
        .all(),
      c.env.DB.prepare('SELECT COUNT(*) n FROM mcp_connections WHERE user_id=?')
        .bind(owner)
        .first<{ n: number }>(),
    ]);
    return c.json({
      items: rows.results.map((r) => ({
        ...r,
        cleanupPending: Boolean(r.cleanupPending),
        permissions: String(r.scope).split(' '),
      })),
      total: count?.n ?? 0,
      mcpUrl: c.env.APP_ORIGIN + '/mcp',
      demo: c.env.DEMO_MODE === 'true',
    });
  })
  .delete('/:id', async (c) => {
    const id = parse(idSchema, c.req.param('id')),
      owner = c.get('userId');
    const row = await c.env.DB.prepare(
      'SELECT grant_id grantId FROM mcp_connections WHERE id=? AND user_id=?',
    )
      .bind(id, owner)
      .first<{ grantId: string | null }>();
    if (!row) throw notFound();
    await c.env.DB.prepare(
      'UPDATE mcp_connections SET revoked_at=COALESCE(revoked_at,?) WHERE id=? AND user_id=?',
    )
      .bind(new Date().toISOString(), id, owner)
      .run();
    if (row.grantId) {
      if (!c.env.OAUTH_PROVIDER)
        throw new AppError(
          503,
          'OAUTH_UNAVAILABLE',
          'Access is blocked. Retry to finish removing the OAuth grant.',
        );
      try {
        await c.env.OAUTH_PROVIDER.revokeGrant(row.grantId, owner);
      } catch {
        throw new AppError(
          503,
          'OAUTH_CLEANUP_FAILED',
          'Access is blocked. Retry to finish removing the OAuth grant.',
        );
      }
      await c.env.DB.prepare('UPDATE mcp_connections SET grant_id=NULL WHERE id=? AND user_id=?')
        .bind(id, owner)
        .run();
    }
    return c.json({ ok: true });
  });
