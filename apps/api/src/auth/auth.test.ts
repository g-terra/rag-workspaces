import { generateKeyPair, SignJWT } from 'jose';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, type App } from '../app.js';
import { loadConfig } from '../config.js';
import { testKeycloak } from '../test/tokens.js';
import { keycloakAuthenticator } from './keycloak.js';
import { requireAdmin } from './plugin.js';

const config = loadConfig({ NODE_ENV: 'test' });
let kc: Awaited<ReturnType<typeof testKeycloak>>;
let app: App | undefined;

beforeAll(async () => {
  kc = await testKeycloak();
});

afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function start() {
  app = await buildApp({ config, logger: false, authenticators: [keycloakAuthenticator(kc.options)] });
  // An admin-only route, just for these tests.
  app.get('/test/admin', { preHandler: requireAdmin }, async () => ({ ok: true }));
  return app;
}

const me = async (authorization?: string) =>
  (await start()).inject({ url: '/v1/me', headers: authorization ? { authorization } : {} });

describe('Keycloak tokens', () => {
  it('a valid token identifies the person', async () => {
    const res = await me(`Bearer ${await kc.token()}`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      kind: 'user',
      id: '5b0d1c5e-0000-4000-8000-000000000001',
      username: 'alice',
      email: 'alice@example.com',
      name: 'Alice Example',
      isAdmin: false,
    });
  });

  it('the realm role admin makes an admin', async () => {
    const res = await me(`Bearer ${await kc.token({ realm_access: { roles: ['admin'] } })}`);
    expect(res.json().isAdmin).toBe(true);
  });

  it('no credentials: 401 with WWW-Authenticate', async () => {
    const res = await me();
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toContain('Bearer');
    expect(res.headers['content-type']).toContain('application/problem+json');
  });

  it.each([
    ['expired', async () => kc.token({}, { expiresIn: '-1m' })],
    [
      'wrong issuer (the internal URL)',
      async () => kc.token({ iss: 'http://keycloak:8080/realms/rag-workspaces' }),
    ],
    ['wrong audience', async () => kc.token({ aud: 'account' })],
    [
      'signed by another key',
      async () => {
        const { privateKey } = await generateKeyPair('RS256');
        return new SignJWT({})
          .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
          .setIssuer('http://localhost:8081/realms/rag-workspaces')
          .setAudience('api')
          .setSubject('x')
          .setExpirationTime('5m')
          .sign(privateKey);
      },
    ],
    ['garbage', async () => 'not.a.jwt'],
  ])('rejects a token that is %s', async (_name, make) => {
    const res = await me(`Bearer ${await make()}`);
    expect(res.statusCode).toBe(401);
    expect(res.json().detail).toBe('Invalid or expired token.');
  });

  it('rejects a non-Bearer Authorization header', async () => {
    const res = await me('Basic YWxpY2U6cHc=');
    expect(res.statusCode).toBe(401);
  });

  it('rejects an rw_ key while no API key authenticator is configured', async () => {
    const res = await me('Bearer rw_abc');
    expect(res.statusCode).toBe(401);
  });

  it('public routes stay public, and a bad token there is still rejected', async () => {
    const a = await start();
    expect((await a.inject({ url: '/health' })).statusCode).toBe(200);
    expect((await a.inject({ url: '/health', headers: { authorization: 'Bearer junk' } })).statusCode).toBe(
      401,
    );
  });
});

describe('requireAdmin', () => {
  it('403 for a signed-in non-admin, 200 for an admin', async () => {
    const a = await start();
    const user = await a.inject({
      url: '/test/admin',
      headers: { authorization: `Bearer ${await kc.token()}` },
    });
    expect(user.statusCode).toBe(403);
    const admin = await a.inject({
      url: '/test/admin',
      headers: { authorization: `Bearer ${await kc.token({ realm_access: { roles: ['admin'] } })}` },
    });
    expect(admin.statusCode).toBe(200);
  });
});
