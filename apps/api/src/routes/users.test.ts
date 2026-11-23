import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, type App } from '../app.js';
import type { Authenticator } from '../auth/principal.js';
import { keycloakAuthenticator } from '../auth/keycloak.js';
import { loadConfig } from '../config.js';
import { HttpProblem } from '../errors.js';
import { testKeycloak } from '../test/tokens.js';

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

const alice = {
  id: 'u-alice',
  username: 'alice',
  email: 'alice@example.com',
  name: 'Alice Example',
  isAdmin: true,
  enabled: true,
};

/** An API key with editor access, standing in for apiKeyAuthenticator (no database here). */
const editorKey: Authenticator = async (credential) =>
  credential === 'rw_test'
    ? { kind: 'key', id: 'key_1', name: 'agent', role: 'editor', workspaces: [] }
    : null;

async function start(list: (q: unknown) => Promise<unknown>) {
  const queries: unknown[] = [];
  app = await buildApp({
    config,
    logger: false,
    authenticators: [editorKey, keycloakAuthenticator(kc.options)],
    directory: {
      list: async (q) => {
        queries.push(q);
        return list(q) as never;
      },
    },
  });
  return { app, queries };
}

const adminToken = () => kc.token({ realm_access: { roles: ['admin'] } });

describe('GET /v1/users', () => {
  it('lists people for an admin, passing search, limit and cursor through', async () => {
    const { app, queries } = await start(async () => ({ data: [alice], nextCursor: '1' }));
    const res = await app.inject({
      url: '/v1/users?search=ali&limit=1&cursor=0',
      headers: { authorization: `Bearer ${await adminToken()}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ data: [alice], nextCursor: '1' });
    expect(queries).toEqual([{ search: 'ali', limit: 1, cursor: '0' }]);
  });

  it('defaults to 50 per page', async () => {
    const { app, queries } = await start(async () => ({ data: [], nextCursor: null }));
    await app.inject({ url: '/v1/users', headers: { authorization: `Bearer ${await adminToken()}` } });
    expect(queries).toEqual([{ limit: 50 }]);
  });

  it.each([
    ['a person without the admin role', async () => `Bearer ${await kc.token()}`, 403],
    ['an API key, even an editor', async () => 'Bearer rw_test', 403],
    ['nobody', async () => undefined, 401],
  ])('refuses %s', async (_who, auth, status) => {
    const { app, queries } = await start(async () => ({ data: [alice], nextCursor: null }));
    const authorization = await auth();
    const res = await app.inject({ url: '/v1/users', headers: authorization ? { authorization } : {} });
    expect(res.statusCode).toBe(status);
    expect(queries).toEqual([]);
  });

  it('rejects a cursor it did not hand out', async () => {
    const { app } = await start(async () => ({ data: [], nextCursor: null }));
    const res = await app.inject({
      url: '/v1/users?cursor=abc',
      headers: { authorization: `Bearer ${await adminToken()}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it("passes the directory's 503 through as a problem", async () => {
    const { app } = await start(async () => {
      throw new HttpProblem(503, 'The people list is not set up: KEYCLOAK_DIRECTORY_SECRET is missing.');
    });
    const res = await app.inject({
      url: '/v1/users',
      headers: { authorization: `Bearer ${await adminToken()}` },
    });
    expect(res.statusCode).toBe(503);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.json().detail).toMatch(/KEYCLOAK_DIRECTORY_SECRET/);
  });
});
