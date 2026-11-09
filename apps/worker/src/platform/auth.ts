import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { MiddlewareHandler } from 'hono';
import type { AppBindings } from './http';
import { AppError } from './errors';
// Cache public keys only; never retain user tokens or claims.
const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
function keysFor(issuer: string) {
  let keys = keySets.get(issuer);
  if (!keys) {
    keys = createRemoteJWKSet(new URL(issuer + '/cdn-cgi/access/certs'));
    keySets.set(issuer, keys);
  }
  return keys;
}
export const security: MiddlewareHandler<AppBindings> = async (c, next) => {
  const url = new URL(c.req.url);
  const local =
    c.env.APP_ENV === 'local' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (!local) {
    if (!c.env.ACCESS_TEAM_DOMAIN || !c.env.ACCESS_AUD || !c.env.APP_ORIGIN)
      throw new AppError(503, 'AUTH_NOT_CONFIGURED', 'Cloudflare Access is not configured.');
    if (url.origin !== c.env.APP_ORIGIN)
      throw new AppError(403, 'INVALID_HOST', 'Use the configured application domain.');
    const token = c.req.header('Cf-Access-Jwt-Assertion');
    if (!token) throw new AppError(401, 'UNAUTHENTICATED', 'Sign in with Cloudflare Access.');
    try {
      const issuer = 'https://' + c.env.ACCESS_TEAM_DOMAIN;
      const { payload } = await jwtVerify(token, keysFor(issuer), {
        issuer,
        audience: c.env.ACCESS_AUD,
        algorithms: ['RS256'],
        requiredClaims: ['exp', 'sub'],
      });
      if (!payload.sub) throw new Error('Missing subject');
    } catch {
      throw new AppError(401, 'UNAUTHENTICATED', 'Your Access session is invalid or expired.');
    }
  }
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
    const origin = c.req.header('Origin');
    const allowed = local
      ? [url.origin, 'http://127.0.0.1:5173', 'http://localhost:5173']
      : [c.env.APP_ORIGIN];
    if (!origin || !allowed.includes(origin))
      throw new AppError(403, 'INVALID_ORIGIN', 'Mutation origin is not allowed.');
    if (c.req.method !== 'DELETE' && !c.req.header('content-type')?.startsWith('application/json'))
      throw new AppError(400, 'INVALID_INPUT', 'Use application/json.');
  }
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'same-origin');
  c.header(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  );
  c.header('Cache-Control', 'private, no-store');
};
