import OAuthProvider, {
  AuthorizationError,
  OAuthError,
  type OAuthHelpers,
  type OAuthResourceContext,
} from '@cloudflare/workers-oauth-provider';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppBindings } from '../../platform/http';
import { AppError } from '../../platform/errors';
import { activeConnection, GRANT_SECONDS } from './connections';
import { serveStats } from './tools';

const propsSchema = z.object({ connectionId: z.string().uuid(), userId: z.string() });
const scopes = ['stats:read', 'offline_access'];
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
function helpers(value?: OAuthHelpers) {
  if (!value) throw new AppError(503, 'OAUTH_UNAVAILABLE', 'OAuth is unavailable.');
  return value;
}
export const authorizeRoutes = new Hono<AppBindings>().all('/', async (c) => {
  if (c.env.DEMO_MODE === 'true')
    throw new AppError(409, 'DEMO_READ_ONLY', 'OAuth connections are disabled in demo mode.');
  const oauth = helpers(c.env.OAUTH_PROVIDER);
  try {
    if (c.req.method === 'GET') {
      const auth = await oauth.parseAuthRequest(c.req.raw);
      if (auth.scope.some((s) => !scopes.includes(s)))
        throw new AppError(
          400,
          'INVALID_SCOPE',
          'Only stats:read and offline_access are supported.',
        );
      // Clients omitting scope still receive the minimum permission explicitly shown here.
      if (!auth.scope.includes('stats:read')) auth.scope.push('stats:read');
      if (!auth.codeChallenge || auth.codeChallengeMethod !== 'S256')
        throw new AppError(400, 'INVALID_PKCE', 'PKCE S256 is required.');
      const details = await oauth.describeConsent(auth);
      c.set('consentRedirectOrigin', new URL(auth.redirectUri).origin);
      const consent = await oauth.beginConsent(auth);
      consent.headers.set('Content-Type', 'text/html; charset=utf-8');
      return new Response(
        `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Connect SourceMetric</title><style>body{font:16px system-ui;max-width:600px;margin:64px auto;padding:24px;line-height:1.6}button{padding:10px 24px;margin-right:12px}</style><h1>Connect ${escapeHtml(details.clientName)}</h1><p>${details.clientDomain ? 'Client domain: ' + escapeHtml(details.clientDomain) : 'This client registered itself; its name is unverified.'}</p><p>Callback destination: <strong>${escapeHtml(details.redirectHost)}</strong></p>${details.redirectIsLoopback ? '<p>This grants access to an app on your computer. Continue only if you started this connection.</p>' : ''}<p>Allow this AI client to read all tracked projects, NuGet downloads, GitHub statistics, private repository names and traffic, and release/campaign context.</p><p>Permissions: ${auth.scope.map(escapeHtml).join(', ')}. This connection cannot change data or trigger collection. Access expires after 30 days and can be revoked on the Connections page.</p><form method="post"><input type="hidden" name="handle" value="${escapeHtml(consent.handle)}"><button name="decision" value="approve">Allow read-only access</button><button name="decision" value="deny">Deny</button></form></html>`,
        { headers: consent.headers },
      );
    }
    if (c.req.method !== 'POST') return c.text('Method not allowed', 405);
    if (Number(c.req.header('content-length')) > 16384) return c.text('Request too large', 413);
    const form = await c.req.formData();
    const handle = String(form.get('handle') ?? '');
    if (form.get('decision') !== 'approve') {
      const denied = await oauth.denyConsent(c.req.raw, handle);
      c.set('consentRedirectOrigin', new URL(denied.request.redirectUri).origin);
      return new Response(null, { status: 302, headers: denied.headers });
    }
    const approved = await oauth.approveConsent(c.req.raw, handle);
    const auth = approved.request;
    c.set('consentRedirectOrigin', new URL(auth.redirectUri).origin);
    if (auth.scope.some((s) => !scopes.includes(s)) || !auth.scope.includes('stats:read'))
      throw new AppError(400, 'INVALID_SCOPE', 'Invalid permissions.');
    const client = await oauth.lookupClient(auth.clientId);
    const id = crypto.randomUUID(),
      now = new Date(),
      owner = c.get('userId');
    await c.env.DB.prepare(
      'INSERT INTO mcp_connections (id,user_id,client_id,client_name,scope,created_at,expires_at) VALUES (?,?,?,?,?,?,?)',
    )
      .bind(
        id,
        owner,
        auth.clientId,
        client?.clientName ?? 'MCP client',
        auth.scope.join(' '),
        now.toISOString(),
        new Date(now.getTime() + GRANT_SECONDS * 1000).toISOString(),
      )
      .run();
    // Multiple installations are independent and individually revocable.
    let result: { redirectTo: string };
    try {
      result = await oauth.completeAuthorization({
        request: auth,
        userId: owner,
        scope: auth.scope,
        metadata: { connectionId: id },
        props: { connectionId: id, userId: owner },
        revokeExistingGrants: false,
      });
    } catch (error) {
      await c.env.DB.prepare('UPDATE mcp_connections SET revoked_at=? WHERE id=?')
        .bind(new Date().toISOString(), id)
        .run();
      throw error;
    }
    approved.headers.set('Location', result.redirectTo);
    return new Response(null, { status: 302, headers: approved.headers });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      if (c.req.method === 'GET' && error.redirectTo)
        return Response.redirect(error.redirectTo, 302);
      return c.text(
        'Authorization request is invalid, expired, or already used. Start the connection again.',
        400,
      );
    }
    throw error;
  }
});

export const publicOAuthPaths = [
  '/mcp',
  '/.well-known/oauth-authorization-server',
  '/.well-known/oauth-protected-resource',
  '/.well-known/oauth-protected-resource/mcp',
  '/oauth/token',
  '/oauth/register',
];
export function isOAuthPath(path: string) {
  return path === '/authorize' || publicOAuthPaths.includes(path);
}
export function createOAuthProvider(
  origin: string,
  defaultHandler: ExportedHandler<Env> & { fetch: NonNullable<ExportedHandler<Env>['fetch']> },
) {
  return new OAuthProvider<Env>({
    apiRoute: '/mcp',
    authorizeEndpoint: '/authorize',
    tokenEndpoint: '/oauth/token',
    clientRegistrationEndpoint: '/oauth/register',
    scopesSupported: scopes,
    requiredScopes: ['stats:read'],
    clientIdMetadataDocumentEnabled: true,
    resourceMetadata: { resource: origin + '/mcp', authorization_servers: [origin] },
    accessTokenTTL: 3600,
    refreshTokenTTL: GRANT_SECONDS,
    defaultHandler,
    apiHandler: {
      async fetch(request, env, ctx) {
        if (new URL(request.url).pathname !== '/mcp')
          return new Response('Not found', { status: 404 });
        if (env.DEMO_MODE === 'true')
          return new Response('OAuth connections disabled in demo mode', { status: 409 });
        const authContext = ctx as OAuthResourceContext<unknown>;
        if (!authContext.auth.scope.includes('stats:read'))
          return new Response('Insufficient scope', {
            status: 403,
            headers: {
              'WWW-Authenticate': `Bearer error="insufficient_scope", scope="stats:read", resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`,
            },
          });
        const props = propsSchema.safeParse(authContext.props);
        if (
          !props.success ||
          props.data.userId !== authContext.auth.userId ||
          !(await activeConnection(env.DB, props.data.connectionId, props.data.userId))
        )
          return new Response('Connection expired or revoked', {
            status: 401,
            headers: {
              'WWW-Authenticate': `Bearer error="invalid_token", resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`,
            },
          });
        const response = await serveStats(request, env.DB);
        response.headers.set('Cache-Control', 'private, no-store');
        response.headers.set('X-Content-Type-Options', 'nosniff');
        return response;
      },
    },
    async tokenExchangeCallback(options) {
      const props = propsSchema.safeParse(options.props);
      if (
        !props.success ||
        props.data.userId !== options.userId ||
        !(await activeConnection(options.env.DB, props.data.connectionId, options.userId))
      )
        throw new OAuthError('invalid_grant', { description: 'Connection expired or revoked.' });
      const result = await options.env.DB.prepare(
        'UPDATE mcp_connections SET grant_id=? WHERE id=? AND user_id=? AND revoked_at IS NULL AND expires_at>? AND (grant_id IS NULL OR grant_id=?)',
      )
        .bind(
          options.grantId,
          props.data.connectionId,
          options.userId,
          new Date().toISOString(),
          options.grantId,
        )
        .run();
      if (!result.meta.changes)
        throw new OAuthError('invalid_grant', { description: 'Connection expired or revoked.' });
    },
  });
}
