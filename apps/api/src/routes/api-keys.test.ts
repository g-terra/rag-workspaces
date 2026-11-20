import { apiKeys, newId, workspaces } from '@rag/db';
import { createTestDatabase } from '@rag/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, type App } from '../app.js';
import { apiKeyAuthenticator, generateSecret, hashSecret } from '../auth/api-keys.js';
import { keycloakAuthenticator } from '../auth/keycloak.js';
import { loadConfig } from '../config.js';
import { testKeycloak } from '../test/tokens.js';

describe('generateSecret', () => {
  it('makes an rw_ secret with a display prefix and a SHA-256 hash', () => {
    const { secret, prefix, hash } = generateSecret();
    expect(secret).toMatch(/^rw_[A-Za-z0-9_-]{43}$/);
    expect(secret.startsWith(prefix)).toBe(true);
    expect(prefix).toHaveLength(7);
    expect(hash).toBe(hashSecret(secret));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('API keys (against TEST_DATABASE_URL)', () => {
  let t: Awaited<ReturnType<typeof createTestDatabase>>;
  let app: App;
  let admin: string;
  let user: string;

  beforeAll(async () => {
    t = await createTestDatabase(url!);
    await t.db.insert(workspaces).values([
      { id: newId('workspace'), slug: 'ouc', name: 'OUC' },
      { id: newId('workspace'), slug: 'personal', name: 'Personal' },
    ]);
    const kc = await testKeycloak();
    admin = `Bearer ${await kc.token({ sub: 'admin-1', realm_access: { roles: ['admin'] } })}`;
    user = `Bearer ${await kc.token({ sub: 'user-1' })}`;
    app = await buildApp({
      config: loadConfig({ NODE_ENV: 'test' }),
      db: t.db,
      logger: false,
      authenticators: [apiKeyAuthenticator(t.db), keycloakAuthenticator(kc.options)],
    });
  });

  afterAll(async () => {
    await app?.close();
    await t?.drop();
  });

  const create = (body: object, authorization = admin) =>
    app.inject({ method: 'POST', url: '/v1/api-keys', headers: { authorization }, payload: body });

  it('an admin creates a key; the secret is shown once and works as a bearer credential', async () => {
    const res = await create({ name: 'Claude agent', role: 'reader', workspaces: ['ouc'] });
    expect(res.statusCode).toBe(201);
    const key = res.json();
    expect(key).toMatchObject({ name: 'Claude agent', role: 'reader', workspaces: ['ouc'], revokedAt: null });
    expect(key.id).toMatch(/^key_/);
    expect(key.secret.startsWith(key.prefix)).toBe(true);

    const [row] = await t.db.select().from(apiKeys).where(eq(apiKeys.id, key.id));
    expect(row!.secretHash).toBe(hashSecret(key.secret));
    expect(JSON.stringify(row)).not.toContain(key.secret);

    const me = await app.inject({ url: '/v1/me', headers: { authorization: `Bearer ${key.secret}` } });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toEqual({
      kind: 'key',
      id: key.id,
      name: 'Claude agent',
      role: 'reader',
      workspaces: ['ouc'],
    });

    const listed = await app.inject({ url: '/v1/api-keys', headers: { authorization: admin } });
    const fromList = listed.json().data.find((k: { id: string }) => k.id === key.id);
    expect(fromList).not.toHaveProperty('secret');
  });

  it('records when a key was last used', async () => {
    const { secret, id } = (await create({ name: 'used', role: 'reader', workspaces: ['ouc'] })).json();
    await app.inject({ url: '/v1/me', headers: { authorization: `Bearer ${secret}` } });
    await new Promise((r) => setTimeout(r, 50)); // the write is fire-and-forget
    const res = await app.inject({ url: `/v1/api-keys/${id}`, headers: { authorization: admin } });
    expect(res.json().lastUsedAt).not.toBeNull();
  });

  it('only admins manage keys: 401 anonymous, 403 for a non-admin or a key', async () => {
    expect((await app.inject({ url: '/v1/api-keys' })).statusCode).toBe(401);
    expect((await app.inject({ url: '/v1/api-keys', headers: { authorization: user } })).statusCode).toBe(
      403,
    );
    const { secret } = (await create({ name: 'k', role: 'editor', workspaces: ['ouc'] })).json();
    const viaKey = await app.inject({ url: '/v1/api-keys', headers: { authorization: `Bearer ${secret}` } });
    expect(viaKey.statusCode).toBe(403);
  });

  it('422 for an unknown workspace, 400 for a bad body', async () => {
    const unknown = await create({ name: 'k', role: 'reader', workspaces: ['ouc', 'nope'] });
    expect(unknown.statusCode).toBe(422);
    expect(unknown.json().detail).toContain('nope');
    const bad = await create({ name: '', role: 'owner', workspaces: [] });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().errors.map((e: { path: string }) => e.path)).toEqual(
      expect.arrayContaining(['body.name', 'body.role', 'body.workspaces']),
    );
  });

  it('PATCH renames and rebinds workspaces', async () => {
    const { id } = (await create({ name: 'old', role: 'reader', workspaces: ['ouc'] })).json();
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/api-keys/${id}`,
      headers: { authorization: admin },
      payload: { name: 'new', workspaces: ['personal', 'ouc'] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ name: 'new', workspaces: ['ouc', 'personal'] });
  });

  it('a revoked key stops working at once', async () => {
    const { id, secret } = (await create({ name: 'gone', role: 'reader', workspaces: ['ouc'] })).json();
    const del = await app.inject({
      method: 'DELETE',
      url: `/v1/api-keys/${id}`,
      headers: { authorization: admin },
    });
    expect(del.statusCode).toBe(204);
    const me = await app.inject({ url: '/v1/me', headers: { authorization: `Bearer ${secret}` } });
    expect(me.statusCode).toBe(401);
    const shown = await app.inject({ url: `/v1/api-keys/${id}`, headers: { authorization: admin } });
    expect(shown.json().revokedAt).not.toBeNull();
  });

  it('an expired key is rejected', async () => {
    const { secret } = (
      await create({ name: 'old', role: 'reader', workspaces: ['ouc'], expiresAt: '2020-01-01T00:00:00Z' })
    ).json();
    const me = await app.inject({ url: '/v1/me', headers: { authorization: `Bearer ${secret}` } });
    expect(me.statusCode).toBe(401);
  });

  it('an unknown rw_ key is rejected', async () => {
    const me = await app.inject({
      url: '/v1/me',
      headers: { authorization: `Bearer ${generateSecret().secret}` },
    });
    expect(me.statusCode).toBe(401);
  });

  it('404 for an unknown key id', async () => {
    const res = await app.inject({ url: '/v1/api-keys/key_nope', headers: { authorization: admin } });
    expect(res.statusCode).toBe(404);
  });
});
