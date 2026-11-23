import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { documents, newId, workspaces } from '@rag/db';
import { createTestDatabase } from '@rag/db/testing';
import { LangflowClient } from '@rag/langflow-client';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, type App } from '../app.js';
import { keycloakAuthenticator } from '../auth/keycloak.js';
import { loadConfig } from '../config.js';
import { ChromaService } from '../services/chroma.js';
import { UploadStorage } from '../services/storage.js';
import { testKeycloak } from '../test/tokens.js';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('workspace reindex (against TEST_DATABASE_URL)', () => {
  let t: Awaited<ReturnType<typeof createTestDatabase>>;
  let app: App;
  let uploads: string;
  const auth = { admin: '', alice: '' };
  const chromaCalls: string[] = [];
  const queued: string[] = [];
  let chromaDown = false;

  const chromaFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    if (chromaDown) throw new TypeError('fetch failed');
    const target = String(input);
    if (init?.method === 'POST') chromaCalls.push(`create ${JSON.parse(String(init.body)).name}`);
    if (init?.method === 'DELETE') chromaCalls.push(`delete ${target.split('/').pop()}`);
    return new Response('{}', { status: 200 });
  }) as typeof fetch;

  beforeAll(async () => {
    t = await createTestDatabase(url!);
    const kc = await testKeycloak();
    uploads = await mkdtemp(path.join(tmpdir(), 'uploads-'));
    auth.admin = `Bearer ${await kc.token({ sub: 'admin-1', realm_access: { roles: ['admin'] } })}`;
    auth.alice = `Bearer ${await kc.token({ sub: 'alice-1' })}`;
    app = await buildApp({
      config: loadConfig({ NODE_ENV: 'test' }),
      db: t.db,
      chroma: new ChromaService({ CHROMA_URL: 'http://chroma:8000' }, chromaFetch),
      storage: new UploadStorage(uploads, 1_000_000),
      queue: { enqueue: async (id) => void queued.push(id) },
      // Never reached: a reindexing workspace answers before any flow runs.
      langflow: new LangflowClient({
        baseUrl: 'http://lf',
        apiKey: 'sk',
        fetch: (async () => {
          throw new Error('Langflow should not be called');
        }) as typeof fetch,
      }),
      logger: false,
      authenticators: [keycloakAuthenticator(kc.options)],
    });
  });

  afterAll(async () => {
    await app?.close();
    await t?.drop();
    await rm(uploads, { recursive: true, force: true });
  });

  beforeEach(() => {
    chromaCalls.length = 0;
    queued.length = 0;
    chromaDown = false;
  });

  function call(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    who: keyof typeof auth,
    payload?: object,
  ) {
    return app.inject({
      method,
      url: path,
      headers: { authorization: auth[who] },
      ...(payload ? { payload } : {}),
    });
  }

  /** A workspace with `count` ready documents. */
  async function workspace(slug: string, count: number) {
    expect((await call('POST', '/v1/workspaces', 'admin', { slug, name: slug })).statusCode).toBe(201);
    const [ws] = await t.db.select().from(workspaces).where(eq(workspaces.slug, slug));
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      const id = newId('document');
      await t.db.insert(documents).values({
        id,
        workspaceId: ws!.id,
        title: `doc ${i}`,
        fileName: `doc-${i}.md`,
        type: 'md',
        sizeBytes: 1,
        sha256: id,
        storagePath: `${slug}/${id}.md`,
        status: 'ready',
        attempts: 1,
        passageCount: 4,
      });
      ids.push(id);
    }
    chromaCalls.length = 0;
    return ids;
  }
  const docsOf = (ids: string[]) =>
    Promise.all(ids.map(async (id) => (await t.db.select().from(documents).where(eq(documents.id, id)))[0]!));

  it('empties the collection, queues every document and blocks search until done', async () => {
    const ids = await workspace('rx-basic', 2);
    const res = await call('POST', '/v1/workspaces/rx-basic/reindex', 'admin');
    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({ slug: 'rx-basic', status: 'reindexing' });
    expect(chromaCalls).toEqual(['delete ws_rx-basic', 'create ws_rx-basic']);
    expect(queued.sort()).toEqual([...ids].sort());
    for (const d of await docsOf(ids)) {
      expect(d).toMatchObject({ status: 'queued', attempts: 0, passageCount: null, error: null });
    }

    for (const [method, path, body] of [
      ['GET', '/v1/workspaces/rx-basic/passages?query=hello', undefined],
      ['GET', `/v1/workspaces/rx-basic/documents/${ids[0]}/passages`, undefined],
      ['POST', '/v1/workspaces/rx-basic/answers', { question: 'hello?' }],
      ['POST', '/v1/workspaces/rx-basic/conversations/conv_x/messages', { content: 'hello?' }],
    ] as const) {
      const blocked = await call(method, path, 'admin', body);
      expect(blocked.statusCode, path).toBe(503);
      expect(blocked.headers['retry-after']).toBe('30');
    }
    // Reading the library still works, so the progress can be watched.
    expect((await call('GET', '/v1/workspaces/rx-basic/documents', 'admin')).statusCode).toBe(200);
  });

  it('409 while a reindex is running', async () => {
    await workspace('rx-twice', 1);
    expect((await call('POST', '/v1/workspaces/rx-twice/reindex', 'admin')).statusCode).toBe(202);
    const again = await call('POST', '/v1/workspaces/rx-twice/reindex', 'admin');
    expect(again.statusCode).toBe(409);
  });

  it('a workspace with no documents is active again at once', async () => {
    await workspace('rx-empty', 0);
    const res = await call('POST', '/v1/workspaces/rx-empty/reindex', 'admin');
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe('active');
  });

  it('changes the embedding model, keeping the other settings', async () => {
    await workspace('rx-model', 1);
    const res = await call('POST', '/v1/workspaces/rx-model/reindex', 'admin', {
      embeddingProvider: 'lmstudio',
      embeddingModel: 'text-embedding-qwen3-embedding-4b',
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().settings).toMatchObject({
      embeddingProvider: 'lmstudio',
      embeddingModel: 'text-embedding-qwen3-embedding-4b',
      embeddingPrefixes: {
        document: '',
        query: 'Instruct: Given a question, retrieve passages that answer the question\nQuery:',
      },
    });
  });

  it('a workspace from before prefixes existed gets them pinned on its next reindex', async () => {
    await workspace('rx-legacy', 1);
    const [ws] = await t.db.select().from(workspaces).where(eq(workspaces.slug, 'rx-legacy'));
    await t.db
      .update(workspaces)
      .set({
        settings: { embeddingProvider: 'lmstudio', embeddingModel: 'text-embedding-nomic-embed-text-v1.5' },
      })
      .where(eq(workspaces.id, ws!.id));
    const before = await call('GET', '/v1/workspaces/rx-legacy', 'admin');
    expect(before.json().settings.embeddingPrefixes).toBeNull();
    const res = await call('POST', '/v1/workspaces/rx-legacy/reindex', 'admin');
    expect(res.json().settings.embeddingPrefixes).toEqual({
      document: 'search_document: ',
      query: 'search_query: ',
    });
  });

  it('refuses a provider without a key (422) or without a model (400), changing nothing', async () => {
    const ids = await workspace('rx-bad', 1);
    const noKey = await call('POST', '/v1/workspaces/rx-bad/reindex', 'admin', {
      embeddingProvider: 'openai',
      embeddingModel: 'text-embedding-3-small',
    });
    expect(noKey.statusCode).toBe(422);
    expect(noKey.json().detail).toMatch(/OPENAI_API_KEY/);
    const noModel = await call('POST', '/v1/workspaces/rx-bad/reindex', 'admin', {
      embeddingProvider: 'lmstudio',
    });
    expect(noModel.statusCode).toBe(400);
    expect(chromaCalls).toEqual([]);
    expect((await docsOf(ids))[0]!.status).toBe('ready');
  });

  it('changes nothing when Chroma is down', async () => {
    const ids = await workspace('rx-down', 1);
    chromaDown = true;
    const res = await call('POST', '/v1/workspaces/rx-down/reindex', 'admin');
    expect(res.statusCode).toBeGreaterThanOrEqual(500);
    expect((await call('GET', '/v1/workspaces/rx-down', 'admin')).json().status).toBe('active');
    expect((await docsOf(ids))[0]!.status).toBe('ready');
  });

  it('only admins can reindex', async () => {
    await workspace('rx-perm', 0);
    await call('PUT', '/v1/workspaces/rx-perm/members/alice-1', 'admin', { role: 'editor' });
    expect((await call('POST', '/v1/workspaces/rx-perm/reindex', 'alice')).statusCode).toBe(403);
  });

  it('deleting the last pending document finishes the reindex', async () => {
    const [id] = await workspace('rx-delete', 1);
    await call('POST', '/v1/workspaces/rx-delete/reindex', 'admin');
    const del = await call('DELETE', `/v1/workspaces/rx-delete/documents/${id}`, 'admin');
    expect(del.statusCode).toBe(204);
    expect((await call('GET', '/v1/workspaces/rx-delete', 'admin')).json().status).toBe('active');
  });
});
