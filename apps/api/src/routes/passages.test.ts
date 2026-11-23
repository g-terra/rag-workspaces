import { documents, folders, newId, workspaces } from '@rag/db';
import { createTestDatabase } from '@rag/db/testing';
import { LangflowClient } from '@rag/langflow-client';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, type App } from '../app.js';
import { apiKeyAuthenticator } from '../auth/api-keys.js';
import { keycloakAuthenticator } from '../auth/keycloak.js';
import { loadConfig } from '../config.js';
import { ChromaService } from '../services/chroma.js';
import { testKeycloak } from '../test/tokens.js';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('passages (against TEST_DATABASE_URL)', () => {
  let t: Awaited<ReturnType<typeof createTestDatabase>>;
  let kc: Awaited<ReturnType<typeof testKeycloak>>;
  let app: App;
  let docId = '';
  let goneId = '';
  const auth = { admin: '', reader: '', stranger: '' };
  const runs: { input_value: string; tweaks: Record<string, Record<string, unknown>> }[] = [];
  let langflowReply: () => Response;
  const chromaGets: string[][] = [];

  /** Chroma holding three chunks of `docId`; page metadata on all but the last. */
  const chromaFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const u = String(input);
    if (u.endsWith('/get')) {
      const { ids } = JSON.parse(String(init?.body)) as { ids: string[] };
      chromaGets.push(ids);
      const known = ids.filter((id) => id.startsWith(`${docId}:`) && Number(id.split(':')[1]) < 3);
      return Response.json({
        ids: known,
        documents: known.map((id) => `chunk ${id.split(':')[1]}`),
        metadatas: known.map((id) => {
          const i = Number(id.split(':')[1]);
          return i < 2
            ? { document_id: docId, chunk_index: i, page: i + 1 }
            : { document_id: docId, chunk_index: i, start_seconds: 42.5 };
        }),
      });
    }
    return Response.json({ id: 'cid' });
  }) as typeof fetch;

  const langflowFetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    runs.push(JSON.parse(String(init?.body)));
    return langflowReply();
  }) as typeof fetch;

  const flowOutput = (passages: unknown) =>
    Response.json({
      outputs: [
        {
          outputs: [
            {
              component_id: 'ChatOutput-passages',
              results: { message: { text: '```json\n' + JSON.stringify({ passages }) + '\n```' } },
            },
          ],
        },
      ],
    });

  beforeAll(async () => {
    t = await createTestDatabase(url!);
    kc = await testKeycloak();
    auth.admin = `Bearer ${await kc.token({ sub: 'admin-1', realm_access: { roles: ['admin'] } })}`;
    auth.reader = `Bearer ${await kc.token({ sub: 'reader-1' })}`;
    auth.stranger = `Bearer ${await kc.token({ sub: 'stranger-1' })}`;
    app = await buildApp({
      config: loadConfig({ NODE_ENV: 'test', DEFAULT_MIN_SCORE: '0.3', DEFAULT_TOP_K: '4' }),
      db: t.db,
      chroma: new ChromaService({ CHROMA_URL: 'http://chroma:8000' }, chromaFetch),
      langflow: new LangflowClient({ baseUrl: 'http://lf', apiKey: 'sk', fetch: langflowFetch }),
      logger: false,
      authenticators: [apiKeyAuthenticator(t.db), keycloakAuthenticator(kc.options)],
    });
    await app.inject({
      method: 'POST',
      url: '/v1/workspaces',
      headers: { authorization: auth.admin },
      payload: { slug: 'ouc', name: 'OUC', settings: { embeddingModel: 'nomic' } },
    });
    await app.inject({
      method: 'PUT',
      url: '/v1/workspaces/ouc/members/reader-1',
      headers: { authorization: auth.admin },
      payload: { role: 'reader' },
    });
    const [ws] = await t.db.select().from(workspaces).where(eq(workspaces.slug, 'ouc'));
    docId = newId('document');
    goneId = newId('document');
    await t.db.insert(documents).values({
      id: docId,
      workspaceId: ws!.id,
      title: 'Week 3 slides',
      fileName: 'week3.pdf',
      type: 'pdf',
      sizeBytes: 10,
      sha256: 'a'.repeat(64),
      storagePath: `ouc/${docId}.pdf`,
      status: 'ready',
      passageCount: 3,
    });
  });

  afterAll(async () => {
    await app?.close();
    await t?.drop();
  });

  beforeEach(() => {
    runs.length = 0;
    chromaGets.length = 0;
    langflowReply = () =>
      flowOutput([
        {
          rank: 1,
          id: `${docId}:1`,
          text: 'RAG retrieves',
          score: 0.83,
          document_id: docId,
          page: 2,
          chunk_index: 1,
        },
        // A document deleted between the search and the lookup is dropped.
        {
          rank: 2,
          id: `${goneId}:0`,
          text: 'old',
          score: 0.7,
          document_id: goneId,
          page: null,
          chunk_index: 0,
        },
      ]);
  });

  const get = (path: string, who: keyof typeof auth = 'reader') =>
    app.inject({ url: path, headers: { authorization: auth[who] } });

  it('search runs rw-retrieve with the workspace model and collection, and returns scored passages', async () => {
    const res = await get('/v1/workspaces/ouc/passages?query=what%20is%20rag');
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([
      {
        id: `psg_${docId.slice(4)}_1`,
        documentId: docId,
        documentTitle: 'Week 3 slides',
        page: 2,
        startSeconds: null,
        chunkIndex: 1,
        text: 'RAG retrieves',
        score: 0.83,
      },
    ]);
    expect(runs[0]!.input_value).toBe('what is rag');
    expect(runs[0]!.tweaks.Search).toEqual({
      collection_name: 'ws_ouc',
      top_k: 4,
      min_score: 0.3,
      folder: '',
    });
    expect(runs[0]!.tweaks.Embeddings).toMatchObject({
      model: 'nomic',
      document_prefix: '',
      query_prefix: '',
    });
  });

  it('a passage from a transcript says the second it starts at', async () => {
    langflowReply = () =>
      flowOutput([
        {
          rank: 1,
          id: `${docId}:1`,
          text: 'At this point',
          score: 0.8,
          document_id: docId,
          page: null,
          chunk_index: 1,
          start_seconds: 754.2,
        },
      ]);
    const res = await get('/v1/workspaces/ouc/passages?query=when');
    expect(res.json().data[0]).toMatchObject({ page: null, startSeconds: 754.2 });
  });

  /** A folder in `ouc`, made straight in the database. */
  async function oucFolder() {
    const [ws] = await t.db.select().from(workspaces).where(eq(workspaces.slug, 'ouc'));
    const id = newId('folder');
    await t.db.insert(folders).values({ id, workspaceId: ws!.id, name: id });
    return id;
  }

  it('folderId limits the search to that folder; a folder from elsewhere is 404', async () => {
    const folderId = await oucFolder();
    expect((await get(`/v1/workspaces/ouc/passages?query=x&folderId=${folderId}`)).statusCode).toBe(200);
    expect(runs[0]!.tweaks.Search).toMatchObject({ folder: folderId });
    runs.length = 0;
    expect((await get('/v1/workspaces/ouc/passages?query=x&folderId=fld_nope')).statusCode).toBe(404);
    expect(runs).toEqual([]);
  });

  it('limit and minScore in the query override the defaults', async () => {
    await get('/v1/workspaces/ouc/passages?query=x&limit=2&minScore=0.6');
    expect(runs[0]!.tweaks.Search).toMatchObject({ top_k: 2, min_score: 0.6 });
  });

  it('400 without a query; 404 for a workspace the caller cannot see', async () => {
    expect((await get('/v1/workspaces/ouc/passages')).statusCode).toBe(400);
    expect((await get('/v1/workspaces/ouc/passages?query=x', 'stranger')).statusCode).toBe(404);
    expect(runs).toHaveLength(0);
  });

  it('a hit from a document that is not ready is dropped', async () => {
    await t.db.update(documents).set({ status: 'processing' }).where(eq(documents.id, docId));
    try {
      expect((await get('/v1/workspaces/ouc/passages?query=x')).json().data).toEqual([]);
      expect((await get(`/v1/workspaces/ouc/passages/psg_${docId.slice(4)}_1`)).statusCode).toBe(404);
    } finally {
      await t.db.update(documents).set({ status: 'ready' }).where(eq(documents.id, docId));
    }
  });

  it('passages are only found through their own workspace, and strangers see 404', async () => {
    await app.inject({
      method: 'POST',
      url: '/v1/workspaces',
      headers: { authorization: auth.admin },
      payload: { slug: 'personal', name: 'Personal', settings: { embeddingModel: 'nomic' } },
    });
    const passage = `/passages/psg_${docId.slice(4)}_1`;
    const docPassages = `/documents/${docId}/passages`;
    for (const p of [passage, docPassages]) {
      expect((await get(`/v1/workspaces/personal${p}`, 'admin')).statusCode).toBe(404);
      expect((await get(`/v1/workspaces/ouc${p}`, 'stranger')).statusCode).toBe(404);
      expect((await app.inject({ url: `/v1/workspaces/ouc${p}` })).statusCode).toBe(401);
    }
  });

  it("a failing flow is a 502 with Langflow's reason; no key yet is a 503", async () => {
    langflowReply = () =>
      Response.json({ detail: { message: 'Embeddings: model not loaded' } }, { status: 500 });
    const failed = await get('/v1/workspaces/ouc/passages?query=x');
    expect(failed.statusCode).toBe(502);
    expect(failed.json().detail).toContain('model not loaded');

    // Before the API has its Langflow key (Langflow still starting).
    const cold = await buildApp({
      config: loadConfig({ NODE_ENV: 'test' }),
      db: t.db,
      chroma: new ChromaService({ CHROMA_URL: 'http://chroma:8000' }, chromaFetch),
      langflow: new LangflowClient({ baseUrl: 'http://lf', fetch: langflowFetch }),
      logger: false,
      authenticators: [keycloakAuthenticator(kc.options)],
    });
    try {
      const res = await cold.inject({
        url: '/v1/workspaces/ouc/passages?query=x',
        headers: { authorization: auth.reader },
      });
      expect(res.statusCode).toBe(503);
      expect(res.headers['retry-after']).toBe('10');
    } finally {
      await cold.close();
    }
  });

  it('a passage comes with its neighbours', async () => {
    const res = await get(`/v1/workspaces/ouc/passages/psg_${docId.slice(4)}_1`);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.passage).toMatchObject({
      chunkIndex: 1,
      page: 2,
      text: 'chunk 1',
      documentTitle: 'Week 3 slides',
    });
    expect(body.previous).toMatchObject({ chunkIndex: 0, page: 1 });
    expect(body.previous.startSeconds).toBeNull();
    expect(body.next).toMatchObject({ chunkIndex: 2, page: null, startSeconds: 42.5 });
    expect(chromaGets[0]).toEqual([`${docId}:0`, `${docId}:1`, `${docId}:2`]);
  });

  it('the first passage has no previous one; unknown ids are 404', async () => {
    const first = await get(`/v1/workspaces/ouc/passages/psg_${docId.slice(4)}_0`);
    expect(first.json()).toMatchObject({ previous: null, next: { chunkIndex: 1 } });
    expect((await get(`/v1/workspaces/ouc/passages/psg_${docId.slice(4)}_9`)).statusCode).toBe(404);
    expect((await get(`/v1/workspaces/ouc/passages/psg_${goneId.slice(4)}_0`)).statusCode).toBe(404);
    expect((await get('/v1/workspaces/ouc/passages/nonsense')).statusCode).toBe(404);
  });

  it("a document's passages page through in order", async () => {
    const p1 = await get(`/v1/workspaces/ouc/documents/${docId}/passages?limit=2`);
    expect(p1.statusCode).toBe(200);
    expect(p1.json().data.map((p: { chunkIndex: number }) => p.chunkIndex)).toEqual([0, 1]);
    expect(p1.json().nextCursor).toBe('2');
    const p2 = await get(`/v1/workspaces/ouc/documents/${docId}/passages?limit=2&cursor=2`);
    expect(p2.json()).toMatchObject({ data: [{ chunkIndex: 2 }], nextCursor: null });
    expect((await get(`/v1/workspaces/ouc/documents/${goneId}/passages`)).statusCode).toBe(404);
  });
});
