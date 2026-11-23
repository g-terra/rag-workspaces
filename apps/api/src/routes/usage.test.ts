import { answers, apiRequests, documents, newId, workspaces, type NewApiRequest } from '@rag/db';
import { createTestDatabase } from '@rag/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, type App } from '../app.js';
import { keycloakAuthenticator } from '../auth/keycloak.js';
import { loadConfig } from '../config.js';
import { ChromaService } from '../services/chroma.js';
import { testKeycloak } from '../test/tokens.js';
import { UsageLog } from '../usage/log.js';

const url = process.env.TEST_DATABASE_URL;
const HOUR = 60 * 60 * 1000;

describe.skipIf(!url)('usage analytics (against TEST_DATABASE_URL)', () => {
  let t: Awaited<ReturnType<typeof createTestDatabase>>;
  let app: App;
  const auth = { admin: '', editor: '', reader: '' };
  const ids = { ouc: '', personal: '', doc: '' };
  // A fixed window well in the past, so requests made by the tests themselves don't count.
  const base = new Date('2026-01-10T10:00:00Z');
  const range = `from=${new Date(base.getTime() - HOUR).toISOString()}&to=${new Date(base.getTime() + 5 * HOUR).toISOString()}`;

  beforeAll(async () => {
    t = await createTestDatabase(url!);
    const kc = await testKeycloak();
    auth.admin = `Bearer ${await kc.token({ sub: 'admin-1', realm_access: { roles: ['admin'] } })}`;
    auth.editor = `Bearer ${await kc.token({ sub: 'editor-1' })}`;
    auth.reader = `Bearer ${await kc.token({ sub: 'reader-1' })}`;
    app = await buildApp({
      config: loadConfig({ NODE_ENV: 'test' }),
      db: t.db,
      usage: new UsageLog(t.db),
      chroma: new ChromaService({ CHROMA_URL: 'http://chroma:8000' }, (async () =>
        Response.json({ id: 'cid' })) as typeof fetch),
      logger: false,
      authenticators: [keycloakAuthenticator(kc.options)],
    });
    const h = { authorization: auth.admin };
    for (const slug of ['ouc', 'personal']) {
      await app.inject({ method: 'POST', url: '/v1/workspaces', headers: h, payload: { slug, name: slug } });
    }
    for (const [user, role] of [
      ['editor-1', 'editor'],
      ['reader-1', 'reader'],
    ]) {
      await app.inject({
        method: 'PUT',
        url: `/v1/workspaces/ouc/members/${user}`,
        headers: h,
        payload: { role },
      });
    }
    const ws = await t.db.select().from(workspaces);
    ids.ouc = ws.find((w) => w.slug === 'ouc')!.id;
    ids.personal = ws.find((w) => w.slug === 'personal')!.id;
    ids.doc = newId('document');
    await t.db.insert(documents).values({
      id: ids.doc,
      workspaceId: ids.ouc,
      title: 'Week 3 slides',
      fileName: 'w3.pdf',
      type: 'pdf',
      sizeBytes: 1,
      sha256: 'e'.repeat(64),
      storagePath: 'x',
      status: 'ready',
    });

    const at = (h: number) => new Date(base.getTime() + h * HOUR);
    const ask = (h: number, question: string, extra: Partial<NewApiRequest> = {}): NewApiRequest => ({
      createdAt: at(h),
      requestId: newId('answer'),
      method: 'POST',
      route: '/v1/workspaces/:slug/answers',
      statusCode: 201,
      latencyMs: 1000,
      workspaceSlug: 'ouc',
      workspaceId: ids.ouc,
      callerKind: 'user',
      callerId: 'reader-1',
      question,
      answerId: newId('answer'),
      model: 'qwen',
      grounded: true,
      promptTokens: 100,
      completionTokens: 10,
      citedDocumentIds: [ids.doc],
      ...extra,
    });
    await t.db.insert(apiRequests).values([
      ask(0, 'What is RAG?'),
      ask(0.5, 'what is rag?  ', { latencyMs: 3000 }),
      ask(1, 'Capital of Peru?', {
        grounded: false,
        citedDocumentIds: [],
        promptTokens: null,
        completionTokens: null,
      }),
      ask(2, 'Broken', {
        statusCode: 502,
        latencyMs: 200,
        grounded: null,
        answerId: null,
        citedDocumentIds: null,
      }),
      {
        createdAt: at(2),
        requestId: 'r-list',
        method: 'GET',
        route: '/v1/workspaces/:slug/documents',
        statusCode: 200,
        latencyMs: 20,
        workspaceSlug: 'ouc',
        workspaceId: ids.ouc,
        callerKind: 'key',
        callerId: 'key_1',
      },
      {
        createdAt: at(3),
        requestId: 'r-personal',
        method: 'GET',
        route: '/v1/workspaces/:slug/documents',
        statusCode: 404,
        latencyMs: 5,
        workspaceSlug: 'personal',
        workspaceId: ids.personal,
      },
    ]);
    await t.db.insert(answers).values({
      id: newId('answer'),
      workspaceId: ids.ouc,
      askedByKind: 'user',
      askedBy: 'reader-1',
      question: 'q',
      status: 'complete',
      grounded: true,
      latencyMs: 1,
      feedbackRating: 'down',
      feedbackAt: at(1),
    });
  });

  afterAll(async () => {
    await app?.close();
    await t?.drop();
  });

  const get = (path: string, who: keyof typeof auth = 'admin') =>
    app.inject({ url: path, headers: { authorization: auth[who] } });

  it('summary across everything (admin)', async () => {
    const res = await get(`/v1/usage/summary?${range}`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      requests: 6,
      serverErrors: 1,
      clientErrors: 1,
      errorRate: 0.1667,
      questions: 4,
      ungrounded: 1,
      tokens: { prompt: 300, completion: 30 },
      feedback: { up: 0, down: 1 },
    });
    expect(res.json().latencyMs.p50).toBeGreaterThan(0);
  });

  it('a workspace summary only counts that workspace', async () => {
    const res = await get(`/v1/workspaces/personal/usage/summary?${range}`);
    expect(res.json()).toMatchObject({
      requests: 1,
      clientErrors: 1,
      questions: 0,
      feedback: { up: 0, down: 0 },
    });
  });

  it('editors see their workspace usage; readers and non-admins globally do not', async () => {
    expect((await get(`/v1/workspaces/ouc/usage/summary?${range}`, 'editor')).statusCode).toBe(200);
    expect((await get(`/v1/workspaces/ouc/usage/summary?${range}`, 'reader')).statusCode).toBe(403);
    expect((await get(`/v1/usage/summary?${range}`, 'editor')).statusCode).toBe(403);
  });

  it('readers cannot see the request log; editors cannot see the global one', async () => {
    expect((await get(`/v1/workspaces/ouc/usage/requests?${range}`, 'reader')).statusCode).toBe(403);
    expect((await get(`/v1/usage/requests?${range}`, 'editor')).statusCode).toBe(403);
    expect((await get(`/v1/usage/top-questions?${range}`, 'editor')).statusCode).toBe(403);
    expect((await get(`/v1/workspaces/personal/usage/requests?${range}`, 'editor')).statusCode).toBe(404);
  });

  it('every per-workspace endpoint only covers that workspace', async () => {
    const ws = (p: string) => get(`/v1/workspaces/personal/usage/${p}?${range}`);
    expect((await ws('top-questions')).json().data).toEqual([]);
    expect((await ws('top-documents')).json().data).toEqual([]);
    expect((await ws('requests')).json().data.map((r: { requestId: string }) => r.requestId)).toEqual([
      'r-personal',
    ]);
    const points = (await get(`/v1/workspaces/personal/usage/timeseries?${range}&interval=day`)).json().data;
    expect(points.map((p: { requests: number }) => p.requests)).toEqual([1]);
  });

  it('a question refused with a 4xx does not count as asked', async () => {
    await t.db.insert(apiRequests).values({
      createdAt: new Date(base.getTime() + 4 * HOUR),
      requestId: 'r-refused',
      method: 'POST',
      route: '/v1/workspaces/:slug/answers',
      statusCode: 403,
      latencyMs: 3,
      workspaceSlug: 'ouc',
      workspaceId: ids.ouc,
    });
    try {
      expect((await get(`/v1/usage/summary?${range}`)).json()).toMatchObject({ requests: 7, questions: 4 });
    } finally {
      await t.db.delete(apiRequests).where(eq(apiRequests.requestId, 'r-refused'));
    }
  });

  it('400 when the range is backwards', async () => {
    const res = await get('/v1/usage/summary?from=2026-01-02T00:00:00Z&to=2026-01-01T00:00:00Z');
    expect(res.statusCode).toBe(400);
  });

  it('timeseries per hour, grouped by workspace', async () => {
    const res = await get(`/v1/usage/timeseries?${range}&interval=hour&groupBy=workspace`);
    const points = res.json().data as { bucket: string; group: string; requests: number }[];
    expect(points.map((p) => [p.bucket.slice(11, 16), p.group, p.requests])).toEqual([
      ['10:00', 'ouc', 2],
      ['11:00', 'ouc', 1],
      ['12:00', 'ouc', 2],
      ['13:00', 'personal', 1],
    ]);
  });

  it('top questions group by text ignoring case and spaces', async () => {
    const res = await get(`/v1/workspaces/ouc/usage/top-questions?${range}`, 'editor');
    expect(res.json().data[0]).toMatchObject({ question: 'What is RAG?', count: 2 });
  });

  it('top documents count citations, with the title', async () => {
    const res = await get(`/v1/usage/top-documents?${range}`);
    expect(res.json().data).toEqual([{ documentId: ids.doc, title: 'Week 3 slides', citations: 2 }]);
  });

  it('the request log filters and pages, newest first', async () => {
    const p1 = await get(`/v1/usage/requests?${range}&limit=4`);
    expect(p1.json().data).toHaveLength(4);
    expect(p1.json().data[0]).toMatchObject({ requestId: 'r-personal', workspace: 'personal', caller: null });
    const p2 = await get(`/v1/usage/requests?${range}&limit=4&cursor=${p1.json().nextCursor}`);
    expect(p2.json()).toMatchObject({ nextCursor: null });
    expect(p2.json().data).toHaveLength(2);

    const keyed = await get(`/v1/usage/requests?${range}&apiKeyId=key_1`);
    expect(keyed.json().data.map((r: { requestId: string }) => r.requestId)).toEqual(['r-list']);
    const failed = await get(`/v1/usage/requests?${range}&status=502`);
    expect(failed.json().data).toHaveLength(1);
  });

  it('defaults to the last 7 days', async () => {
    const res = await get('/v1/usage/summary');
    const body = res.json();
    expect(new Date(body.to).getTime() - new Date(body.from).getTime()).toBe(7 * 24 * HOUR);
    // The fixed rows above are older than that.
    expect(body.questions).toBe(0);
  });

  it('deleted workspaces still count in the global view', async () => {
    await app.inject({
      method: 'DELETE',
      url: '/v1/workspaces/personal',
      headers: { authorization: auth.admin },
    });
    const res = await get(`/v1/usage/summary?${range}`);
    expect(res.json().requests).toBe(6);
    const [row] = await t.db.select().from(apiRequests).where(eq(apiRequests.requestId, 'r-personal'));
    expect(row!.workspaceSlug).toBe('personal');
  });
});
