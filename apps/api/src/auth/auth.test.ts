import { generateKeyPair, SignJWT } from 'jose';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, type App } from '../app.js';
import { loadConfig } from '../config.js';
import { testKeycloak } from '../test/tokens.js';
import { keycloakAuthenticator, keycloakOptionsFromConfig } from './keycloak.js';

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
    [
      'unsigned (alg none)',
      async () => {
        const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
        const now = Math.floor(Date.now() / 1000);
        return `${enc({ alg: 'none', typ: 'JWT' })}.${enc({ iss: 'http://localhost:8081/realms/rag-workspaces', aud: 'api', sub: 'x', exp: now + 300 })}.`;
      },
    ],
    [
      'signed with HS256',
      async () =>
        new SignJWT({})
          .setProtectedHeader({ alg: 'HS256', kid: 'test-key' })
          .setIssuer('http://localhost:8081/realms/rag-workspaces')
          .setAudience('api')
          .setSubject('x')
          .setExpirationTime('5m')
          .sign(new TextEncoder().encode('a-shared-secret-of-enough-length!')),
    ],
    ['missing a subject', async () => kc.token({ sub: '' })],
  ])('rejects a token that is %s', async (_name, make) => {
    const res = await me(`Bearer ${await make()}`);
    expect(res.statusCode).toBe(401);
    expect(res.json().detail).toBe('Invalid or expired token.');
  });

  it('503, not 401, when Keycloak cannot be reached for its keys', async () => {
    app = await buildApp({
      config,
      logger: false,
      authenticators: [
        keycloakAuthenticator({
          ...kc.options,
          keys: async () => {
            throw new TypeError('fetch failed');
          },
        }),
      ],
    });
    const res = await app.inject({ url: '/v1/me', headers: { authorization: `Bearer ${await kc.token()}` } });
    expect(res.statusCode).toBe(503);
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

describe('keycloakOptionsFromConfig', () => {
  it('checks the issuer against the public URL and fetches keys from the internal one', () => {
    const opts = keycloakOptionsFromConfig({
      KEYCLOAK_INTERNAL_URL: 'http://keycloak:8080/',
      KEYCLOAK_PUBLIC_URL: 'http://localhost:8081/',
      KEYCLOAK_REALM: 'rag-workspaces',
      KEYCLOAK_AUDIENCE: 'api',
    });
    expect(opts.issuer).toBe('http://localhost:8081/realms/rag-workspaces');
    expect(opts.audience).toBe('api');
  });
});
