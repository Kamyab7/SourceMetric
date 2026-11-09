import { it, expect, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { app } from '../apps/worker/src/app';
it('verifies Access signatures, expiry, audience, and issuer', async () => {
  const keys = await generateKeyPair('RS256', { extractable: true }),
    jwk = await exportJWK(keys.publicKey);
  const fetch = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async () =>
      Response.json({ keys: [{ ...jwk, kid: 'test', alg: 'RS256' }] }),
    );
  const bindings = {
    ...env,
    APP_ENV: 'production',
    APP_ORIGIN: 'https://metrics.example',
    ACCESS_TEAM_DOMAIN: 'test.cloudflareaccess.com',
    ACCESS_AUD: 'expected',
  } as unknown as Env;
  async function token(
    audience = 'expected',
    issuer = 'https://test.cloudflareaccess.com',
    expiration = '1h',
    key = keys.privateKey,
  ) {
    return new SignJWT({ email: 'maintainer@example.com' })
      .setProtectedHeader({ alg: 'RS256', kid: 'test' })
      .setSubject('maintainer')
      .setIssuer(issuer)
      .setAudience(audience)
      .setExpirationTime(expiration)
      .sign(key);
  }
  async function call(jwt: string) {
    return app.request(
      'https://metrics.example/api/v1/health',
      { headers: { 'Cf-Access-Jwt-Assertion': jwt } },
      bindings,
    );
  }
  try {
    expect((await call(await token())).status).toBe(200);
    expect((await call(await token('wrong'))).status).toBe(401);
    expect((await call(await token('expected', 'https://wrong.example'))).status).toBe(401);
    expect(
      (await call(await token('expected', 'https://test.cloudflareaccess.com', '-1h'))).status,
    ).toBe(401);
    const other = await generateKeyPair('RS256');
    expect(
      (
        await call(
          await token('expected', 'https://test.cloudflareaccess.com', '1h', other.privateKey),
        )
      ).status,
    ).toBe(401);
  } finally {
    fetch.mockRestore();
  }
});
