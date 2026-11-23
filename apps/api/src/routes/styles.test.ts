import { apiKeys, apiKeyWorkspaces, newId, workspaces } from '@rag/db';
import { createTestDatabase } from '@rag/db/testing';
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, type App } from '../app.js';
import { apiKeyAuthenticator } from '../auth/api-keys.js';
import { keycloakAuthenticator } from '../auth/keycloak.js';
import { loadConfig } from '../config.js';
import { ChromaService } from '../services/chroma.js';
import { testKeycloak } from '../test/tokens.js';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('response styles (against TEST_DATABASE_URL)', () => {
  let t: Awaited<ReturnType<typeof createTestDatabase>>;
  let app: App;
  const auth = { admin: '', reader: '', key: 'Bearer rw_styles_test_key' };

  beforeAll(async () => {
    t = await createTestDatabase(url!);
    const kc = await testKeycloak();
    auth.admin = `Bearer ${await kc.token({ sub: 'admin-1', realm_access: { roles: ['admin'] } })}`;
    auth.reader = `Bearer ${await kc.token({ sub: 'reader-1' })}`;
    app = await buildApp({
      config: loadConfig({ NODE_ENV: 'test' }),
      db: t.db,
      chroma: new ChromaService({ CHROMA_URL: 'http://chroma:8000' }, (async () =>
        Response.json({ id: 'cid' })) as typeof fetch),
      logger: false,
      authenticators: [apiKeyAuthenticator(t.db), keycloakAuthenticator(kc.options)],
    });
    await app.inject({
      method: 'POST',
      url: '/v1/workspaces',
      headers: { authorization: auth.admin },
      payload: { slug: 'ouc', name: 'OUC' },
    });
    const [ws] = await t.db.select().from(workspaces).where(eq(workspaces.slug, 'ouc'));
    const keyId = newId('apiKey');
    await t.db.insert(apiKeys).values({
      id: keyId,
      name: 'agent',
      prefix: 'rw_styl',
      secretHash: createHash('sha256').update('rw_styles_test_key').digest('hex'),
      role: 'reader',
      createdBy: 'admin-1',
    });
    await t.db.insert(apiKeyWorkspaces).values({ apiKeyId: keyId, workspaceId: ws!.id });
  });

  afterAll(async () => {
    await app?.close();
    await t?.drop();
  });

  const call = (
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    who: keyof typeof auth,
    payload?: object,
  ) => app.inject({ method, url: path, headers: { authorization: auth[who] }, payload });
  const slugs = async (who: keyof typeof auth = 'reader') =>
    (await call('GET', '/v1/styles', who)).json().data.map((s: { slug: string }) => s.slug);

  const socratic = {
    slug: 'socratic',
    name: 'Socratic',
    description: 'Answers, then asks one question back.',
    instructions: 'After answering, ask the student one short question that checks they understood.',
  };

  it('lists the built-in styles first to people and API keys; it needs a caller', async () => {
    const res = await call('GET', '/v1/styles', 'reader');
    expect(res.statusCode).toBe(200);
    expect(res.json().data[0]).toMatchObject({ slug: 'academic', name: 'Academic', builtIn: true });
    expect(await slugs('key')).toEqual(['academic', 'talkative', 'concise', 'tutor']);
    expect((await app.inject({ url: '/v1/styles' })).statusCode).toBe(401);
  });

  it('an admin creates a custom style that everyone then sees, after the built-ins', async () => {
    const res = await call('POST', '/v1/styles', 'admin', socratic);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ ...socratic, builtIn: false });
    expect(await slugs('key')).toEqual(['academic', 'talkative', 'concise', 'tutor', 'socratic']);
  });

  it('only admins create, change or delete styles', async () => {
    expect((await call('POST', '/v1/styles', 'reader', { ...socratic, slug: 'x' })).statusCode).toBe(403);
    expect((await call('POST', '/v1/styles', 'key', { ...socratic, slug: 'x' })).statusCode).toBe(403);
    expect((await call('PATCH', '/v1/styles/socratic', 'reader', { name: 'Y' })).statusCode).toBe(403);
    expect((await call('DELETE', '/v1/styles/socratic', 'reader')).statusCode).toBe(403);
  });

  it('a slug is unique, built-ins included', async () => {
    expect((await call('POST', '/v1/styles', 'admin', socratic)).statusCode).toBe(409);
    expect((await call('POST', '/v1/styles', 'admin', { ...socratic, slug: 'academic' })).statusCode).toBe(
      409,
    );
  });

  it('a style needs a valid slug, a name and instructions', async () => {
    for (const bad of [
      { ...socratic, slug: 'Has Spaces' },
      { ...socratic, slug: 'ok-slug', name: '' },
      { ...socratic, slug: 'ok-slug', instructions: '' },
      { ...socratic, slug: 'ok-slug', instructions: 'x'.repeat(2001) },
    ]) {
      expect((await call('POST', '/v1/styles', 'admin', bad)).statusCode).toBe(400);
    }
  });

  it('PATCH changes name, description or instructions; built-ins and unknown styles cannot be changed', async () => {
    const res = await call('PATCH', '/v1/styles/socratic', 'admin', {
      instructions: 'Ask one question back.',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      slug: 'socratic',
      name: 'Socratic',
      instructions: 'Ask one question back.',
    });
    // Fields left out keep their values, description included.
    expect(res.json().description).toBe(socratic.description);
    const empty = await call('PATCH', '/v1/styles/socratic', 'admin', {});
    expect(empty.json()).toMatchObject({
      description: socratic.description,
      instructions: 'Ask one question back.',
    });
    expect((await call('PATCH', '/v1/styles/academic', 'admin', { name: 'Mine' })).statusCode).toBe(403);
    expect((await call('PATCH', '/v1/styles/nope', 'admin', { name: 'Mine' })).statusCode).toBe(404);
  });

  it("a custom style can be a workspace's default, and is then kept until no workspace uses it", async () => {
    const set = (style: string | null) =>
      call('PATCH', '/v1/workspaces/ouc', 'admin', { settings: { style } });
    expect((await set('socratic')).json().settings.style).toBe('socratic');
    const refused = await call('DELETE', '/v1/styles/socratic', 'admin');
    expect(refused.statusCode).toBe(409);
    expect(refused.json().detail).toContain('ouc');
    await set(null);
    expect((await call('DELETE', '/v1/styles/socratic', 'admin')).statusCode).toBe(204);
    expect(await slugs()).not.toContain('socratic');
    expect((await set('socratic')).statusCode).toBe(400);
  });

  it('built-in and unknown styles cannot be deleted', async () => {
    expect((await call('DELETE', '/v1/styles/academic', 'admin')).statusCode).toBe(403);
    expect((await call('DELETE', '/v1/styles/nope', 'admin')).statusCode).toBe(404);
  });
});
