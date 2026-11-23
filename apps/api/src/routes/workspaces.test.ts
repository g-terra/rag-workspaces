import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createTestDatabase } from '@rag/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, type App } from '../app.js';
import { apiKeyAuthenticator } from '../auth/api-keys.js';
import { keycloakAuthenticator } from '../auth/keycloak.js';
import { loadConfig } from '../config.js';
import { ChromaService } from '../services/chroma.js';
import { UploadStorage } from '../services/storage.js';
import { testKeycloak } from '../test/tokens.js';

/** A Chroma stand-in that records collection calls. */
function fakeChroma() {
  const calls: string[] = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === 'POST') calls.push(`create ${JSON.parse(String(init.body)).name}`);
    if (init?.method === 'DELETE') calls.push(`delete ${url.split('/').pop()}`);
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  return { chroma: new ChromaService({ CHROMA_URL: 'http://chroma:8000' }, fetchFn), calls };
}

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('workspaces (against TEST_DATABASE_URL)', () => {
  let t: Awaited<ReturnType<typeof createTestDatabase>>;
  let app: App;
  const chromaFake = fakeChroma();
  const auth: Record<'admin' | 'alice' | 'bob', string> = { admin: '', alice: '', bob: '' };

  let kc: Awaited<ReturnType<typeof testKeycloak>>;
  let uploads: string;

  beforeAll(async () => {
    t = await createTestDatabase(url!);
    kc = await testKeycloak();
    uploads = await mkdtemp(path.join(tmpdir(), 'uploads-'));
    auth.admin = `Bearer ${await kc.token({ sub: 'admin-1', realm_access: { roles: ['admin'] } })}`;
    auth.alice = `Bearer ${await kc.token({ sub: 'alice-1' })}`;
    auth.bob = `Bearer ${await kc.token({ sub: 'bob-1', preferred_username: 'bob' })}`;
    app = await buildApp({
      config: loadConfig({ NODE_ENV: 'test' }),
      db: t.db,
      chroma: chromaFake.chroma,
      storage: new UploadStorage(uploads, 1_000_000),
      logger: false,
      authenticators: [apiKeyAuthenticator(t.db), keycloakAuthenticator(kc.options)],
    });
    for (const slug of ['ouc', 'personal']) {
      const res = await call('POST', '/v1/workspaces', 'admin', { slug, name: slug.toUpperCase() });
      expect(res.statusCode).toBe(201);
    }
  });

  afterAll(async () => {
    await app?.close();
    await t?.drop();
    await rm(uploads, { recursive: true, force: true });
  });

  function call(
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    path: string,
    who: keyof typeof auth | string,
    payload?: object,
  ) {
    const authorization = who in auth ? auth[who as keyof typeof auth] : `Bearer ${who}`;
    return app.inject({ method, url: path, headers: { authorization }, ...(payload ? { payload } : {}) });
  }

  it('creating a workspace makes its collection and pins the embedding defaults', async () => {
    expect(chromaFake.calls).toEqual(expect.arrayContaining(['create ws_ouc', 'create ws_personal']));
    const res = await call('GET', '/v1/workspaces/ouc', 'admin');
    expect(res.json()).toMatchObject({
      slug: 'ouc',
      status: 'active',
      access: 'admin',
      settings: {
        embeddingProvider: 'lmstudio',
        embeddingModel: 'text-embedding-nomic-embed-text-v1.5',
        // Pinned with the model: the queries of this workspace must match how its documents were embedded.
        embeddingPrefixes: { document: 'search_document: ', query: 'search_query: ' },
        topK: null,
      },
    });
  });

  it('409 for a taken slug, 400 for a bad one, 403 for non-admins', async () => {
    expect((await call('POST', '/v1/workspaces', 'admin', { slug: 'ouc', name: 'x' })).statusCode).toBe(409);
    expect((await call('POST', '/v1/workspaces', 'admin', { slug: 'Bad Slug', name: 'x' })).statusCode).toBe(
      400,
    );
    expect((await call('POST', '/v1/workspaces', 'alice', { slug: 'mine', name: 'x' })).statusCode).toBe(403);
  });

  it('a person sees only the workspaces they were granted, with their role', async () => {
    expect((await call('GET', '/v1/workspaces', 'alice')).json().data).toEqual([]);
    const grant = await call('PUT', '/v1/workspaces/ouc/members/alice-1', 'admin', { role: 'reader' });
    expect(grant.statusCode).toBe(200);
    const list = (await call('GET', '/v1/workspaces', 'alice')).json().data;
    expect(list.map((w: { slug: string; access: string }) => [w.slug, w.access])).toEqual([
      ['ouc', 'reader'],
    ]);
  });

  it('no access means 404, not 403, so other workspaces stay invisible', async () => {
    const res = await call('GET', '/v1/workspaces/personal', 'alice');
    expect(res.statusCode).toBe(404);
    const missing = await call('GET', '/v1/workspaces/does-not-exist', 'alice');
    expect(missing.json().detail).toBe(res.json().detail.replace('personal', 'does-not-exist'));
  });

  it('a member without the admin role gets 403 on admin actions in their workspace', async () => {
    expect((await call('PATCH', '/v1/workspaces/ouc', 'alice', { name: 'x' })).statusCode).toBe(403);
    expect((await call('GET', '/v1/workspaces/ouc/members', 'alice')).statusCode).toBe(403);
  });

  it('an API key sees only its workspaces', async () => {
    const key = await call('POST', '/v1/api-keys', 'admin', {
      name: 'agent',
      role: 'reader',
      workspaces: ['personal'],
    });
    const secret = key.json().secret as string;
    const list = (await call('GET', '/v1/workspaces', secret)).json().data;
    expect(list.map((w: { slug: string }) => w.slug)).toEqual(['personal']);
    expect((await call('GET', '/v1/workspaces/ouc', secret)).statusCode).toBe(404);
  });

  it('anonymous callers get 401, not 403 or 404', async () => {
    for (const [method, path] of [
      ['GET', '/v1/workspaces/ouc'],
      ['PATCH', '/v1/workspaces/ouc'],
      ['PUT', '/v1/workspaces/ouc/members/bob-1'],
    ] as const) {
      const res = await app.inject({
        method,
        url: path,
        payload: method === 'GET' ? undefined : { role: 'reader' },
      });
      expect(res.statusCode, `${method} ${path}`).toBe(401);
    }
  });

  it('an editor member or editor key still cannot change, delete or manage members', async () => {
    await call('PUT', '/v1/workspaces/personal/members/bob-1', 'admin', { role: 'editor' });
    const key = await call('POST', '/v1/api-keys', 'admin', {
      name: 'ed',
      role: 'editor',
      workspaces: ['personal'],
    });
    for (const who of ['bob', key.json().secret as string]) {
      expect((await call('PATCH', '/v1/workspaces/personal', who, { name: 'x' })).statusCode).toBe(403);
      expect((await call('DELETE', '/v1/workspaces/personal', who)).statusCode).toBe(403);
      expect(
        (await call('PUT', '/v1/workspaces/personal/members/x', who, { role: 'reader' })).statusCode,
      ).toBe(403);
      expect((await call('DELETE', '/v1/workspaces/personal/members/bob-1', who)).statusCode).toBe(403);
    }
    expect((await call('GET', '/v1/workspaces/personal', 'admin')).json().name).toBe('PERSONAL');
    await call('DELETE', '/v1/workspaces/personal/members/bob-1', 'admin');
  });

  it('PATCH takes a known reasoning effort or null, and refuses anything else', async () => {
    expect(
      (await call('PATCH', '/v1/workspaces/ouc', 'admin', { settings: { reasoningEffort: 'low' } })).json(),
    ).toMatchObject({ settings: { reasoningEffort: 'low' } });
    const bad = await call('PATCH', '/v1/workspaces/ouc', 'admin', { settings: { reasoningEffort: 'max' } });
    expect(bad.statusCode).toBe(400);
    expect(
      (await call('PATCH', '/v1/workspaces/ouc', 'admin', { settings: { reasoningEffort: null } })).json(),
    ).toMatchObject({ settings: { reasoningEffort: null } });
  });

  it('PATCH cannot change the pinned embedding provider or model', async () => {
    for (const settings of [{ embeddingProvider: 'openai' }, { embeddingModel: 'other' }]) {
      const res = await call('PATCH', '/v1/workspaces/ouc', 'admin', { settings });
      expect(res.statusCode).toBe(400);
    }
    const ws = (await call('GET', '/v1/workspaces/ouc', 'admin')).json();
    expect(ws.settings.embeddingProvider).toBe('lmstudio');
  });

  it('when Chroma is down, creating a workspace fails and stores nothing', async () => {
    const down = await buildApp({
      config: loadConfig({ NODE_ENV: 'test' }),
      db: t.db,
      chroma: new ChromaService({ CHROMA_URL: 'http://chroma:8000' }, (async () => {
        throw new TypeError('fetch failed');
      }) as typeof fetch),
      logger: false,
      authenticators: [keycloakAuthenticator(kc.options)],
    });
    try {
      const res = await down.inject({
        method: 'POST',
        url: '/v1/workspaces',
        headers: { authorization: auth.admin },
        payload: { slug: 'ghost', name: 'Ghost' },
      });
      expect(res.statusCode).toBeGreaterThanOrEqual(500);
      expect((await call('GET', '/v1/workspaces/ghost', 'admin')).statusCode).toBe(404);
    } finally {
      await down.close();
    }
  });

  it('PATCH merges settings; null returns one to the default', async () => {
    await call('PATCH', '/v1/workspaces/ouc', 'admin', {
      settings: { topK: 8, chatModel: 'qwen2.5-7b-instruct' },
    });
    const res = await call('PATCH', '/v1/workspaces/ouc', 'admin', { settings: { chatModel: null } });
    expect(res.json().settings).toMatchObject({ topK: 8, chatModel: null, embeddingProvider: 'lmstudio' });
  });

  it('members can be listed, changed and removed', async () => {
    await call('PUT', '/v1/workspaces/ouc/members/bob-1', 'admin', { role: 'reader' });
    await call('PUT', '/v1/workspaces/ouc/members/bob-1', 'admin', { role: 'editor' });
    const members = (await call('GET', '/v1/workspaces/ouc/members', 'admin')).json().data;
    expect(members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: 'bob-1', role: 'editor', grantedBy: 'admin-1' }),
      ]),
    );
    expect((await call('DELETE', '/v1/workspaces/ouc/members/bob-1', 'admin')).statusCode).toBe(204);
    expect((await call('GET', '/v1/workspaces/ouc', 'bob')).statusCode).toBe(404);
  });

  it('deleting a workspace drops its collection and revokes keys left with no workspace', async () => {
    await call('POST', '/v1/workspaces', 'admin', { slug: 'scratch', name: 'Scratch' });
    const only = (
      await call('POST', '/v1/api-keys', 'admin', { name: 'only', role: 'reader', workspaces: ['scratch'] })
    ).json();
    const both = (
      await call('POST', '/v1/api-keys', 'admin', {
        name: 'both',
        role: 'reader',
        workspaces: ['scratch', 'ouc'],
      })
    ).json();

    expect((await call('DELETE', '/v1/workspaces/scratch', 'admin')).statusCode).toBe(204);
    expect(chromaFake.calls).toContain('delete ws_scratch');
    expect((await call('GET', '/v1/workspaces/scratch', 'admin')).statusCode).toBe(404);

    expect((await call('GET', `/v1/api-keys/${only.id}`, 'admin')).json().revokedAt).not.toBeNull();
    const kept = (await call('GET', `/v1/api-keys/${both.id}`, 'admin')).json();
    expect(kept).toMatchObject({ revokedAt: null, workspaces: ['ouc'] });
  });
});
